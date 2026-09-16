"""The single call shape every pipeline step uses.

Design notes, each one paid for:

* **Streaming, not ``messages.parse``.** The rewrite step runs long enough at
  these token budgets that the SDK refuses to issue it as one blocking request
  ("Streaming is required for operations that may take longer than 10 minutes").
  Streaming sidesteps that, at the cost of validating the schema here instead of
  letting the SDK do it.

* **Strict schemas are normalised by hand.** Pydantic marks a field with a
  default as not-required; Anthropic's strict mode wants every property in
  ``required`` and ``additionalProperties: false`` everywhere. Passing a raw
  ``model_json_schema()`` fails in ways that look like model errors.

* **The grammar has a size ceiling.** A wide model full of nullable unions gets
  rejected with "the compiled grammar is too large", which reads like a bug in
  your prompt. It is caught here and re-raised as something actionable.
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypeVar

import anthropic
from pydantic import BaseModel, ValidationError

from .config import Effort, get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_client: anthropic.Anthropic | None = None


class LLMError(RuntimeError):
    """Raised for anything the caller can act on: refusals, bad schemas, truncation."""


def get_client() -> anthropic.Anthropic:
    global _client
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise LLMError(
            "ANTHROPIC_API_KEY is not set. Add it to backend/.env.local before running "
            "the pipeline."
        )
    if _client is None:
        _client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key,
            timeout=settings.request_timeout_s,
            max_retries=3,
        )
    return _client


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Turn a Pydantic schema into one Anthropic's strict mode accepts.

    Every object gets ``additionalProperties: false`` and a ``required`` list
    naming all of its properties. Defaults stay in the schema as documentation
    but stop being a licence for the model to omit the key.
    """
    schema = model.model_json_schema()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node["properties"].keys())
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(schema)
    return schema


def _extract_text(message: Any) -> str:
    return "".join(
        block.text for block in message.content if getattr(block, "type", None) == "text"
    )


def structured(
    *,
    system: str,
    user: str,
    schema: type[T],
    effort: Effort = "high",
    max_tokens: int | None = None,
) -> T:
    """One cached system prompt, one user message, one validated object back."""
    settings = get_settings()
    client = get_client()

    try:
        with client.messages.stream(
            model=settings.model,
            max_tokens=max_tokens or settings.max_tokens,
            thinking={"type": "adaptive"},
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": strict_schema(schema)},
            },
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.BadRequestError as exc:
        detail = str(exc)
        if "grammar is too large" in detail:
            raise LLMError(
                f"The response schema for {schema.__name__} is too complex for strict mode. "
                "Flatten it: fewer nullable unions, fewer distinct nested object shapes."
            ) from exc
        raise LLMError(f"The API rejected the request: {detail}") from exc
    except anthropic.AuthenticationError as exc:
        raise LLMError("ANTHROPIC_API_KEY was rejected.") from exc
    except anthropic.RateLimitError as exc:
        raise LLMError("Rate limited by the API. Retry in a moment.") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMError(f"Could not reach the API: {exc}") from exc
    except anthropic.APIStatusError as exc:
        raise LLMError(f"API error {exc.status_code}: {exc}") from exc

    if message.stop_reason == "refusal":
        category = getattr(getattr(message, "stop_details", None), "category", "unspecified")
        raise LLMError(f"The model declined this request ({category}).")
    if message.stop_reason == "max_tokens":
        raise LLMError(
            "The response hit the token ceiling before it finished. "
            "Try a shorter resume or job description."
        )

    raw = _extract_text(message)
    if not raw.strip():
        raise LLMError("The model returned an empty response.")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("Non-JSON response for %s: %.400s", schema.__name__, raw)
        raise LLMError("The model returned a response that was not valid JSON.") from exc

    try:
        return schema.model_validate(payload)
    except ValidationError as exc:
        issues = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:3]
        )
        raise LLMError(f"The response did not match {schema.__name__}: {issues}") from exc
