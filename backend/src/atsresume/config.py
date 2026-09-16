"""Runtime configuration.

The cost lever that matters is which model runs which step. Four of the five
steps are mechanical: pulling structured facts out of a resume, decomposing a
posting, comparing two structured objects, and writing advice about a score that
was already computed. Sonnet does those as well as Opus does and costs a
fraction as much.

The rewrite is the exception. It is the step whose quality decides whether the
resume passes a first screen, so it stays on Opus in every profile except
``fast``. Cutting cost there would be cutting the product.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

Effort = Literal["low", "medium", "high", "xhigh", "max"]

OPUS = "claude-opus-5"
SONNET = "claude-sonnet-5"


class StepConfig(BaseModel):
    model: str
    effort: Effort


class Profile(StrEnum):
    FAST = "fast"
    BALANCED = "balanced"
    THOROUGH = "thorough"


PROFILES: dict[Profile, dict[str, StepConfig]] = {
    # Measured, not assumed: putting the rewrite on Sonnet made the pipeline
    # *slower* than balanced (167s versus 92s for that step), because Sonnet
    # spends longer thinking on this task than Opus does. So fast keeps Opus and
    # buys its speed by lowering effort instead.
    Profile.FAST: {
        "extract": StepConfig(model=SONNET, effort="low"),
        "analyze": StepConfig(model=SONNET, effort="medium"),
        "gaps": StepConfig(model=SONNET, effort="low"),
        "tailor": StepConfig(model=OPUS, effort="medium"),
        "strategy": StepConfig(model=SONNET, effort="low"),
    },
    # The default. Everything mechanical on Sonnet, the rewrite on Opus.
    Profile.BALANCED: {
        "extract": StepConfig(model=SONNET, effort="medium"),
        "analyze": StepConfig(model=SONNET, effort="high"),
        # Measured at 92s on high and it is pure input-to-input reasoning, so it
        # is the cheapest place to buy wall clock back.
        "gaps": StepConfig(model=SONNET, effort="medium"),
        "tailor": StepConfig(model=OPUS, effort="high"),
        "strategy": StepConfig(model=SONNET, effort="medium"),
    },
    # What the pipeline did before profiles existed.
    Profile.THOROUGH: {
        "extract": StepConfig(model=OPUS, effort="medium"),
        "analyze": StepConfig(model=OPUS, effort="high"),
        "gaps": StepConfig(model=OPUS, effort="high"),
        "tailor": StepConfig(model=OPUS, effort="xhigh"),
        "strategy": StepConfig(model=OPUS, effort="high"),
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"), env_file_encoding="utf-8", extra="ignore"
    )

    anthropic_api_key: str = ""
    profile: Profile = Profile.BALANCED

    max_tokens: int = 32_000
    request_timeout_s: float = 900.0

    # Ingest limits. A resume is a few pages; anything far larger is either a
    # mistake or an attempt to run up a bill.
    max_upload_bytes: int = 10 * 1024 * 1024
    max_resume_chars: int = 60_000
    min_resume_chars: int = 200
    max_jd_chars: int = 40_000
    min_jd_chars: int = 400

    # One resume against many postings is the normal pattern, and re-extracting
    # identical text every time is the easiest money in the pipeline to stop
    # spending.
    cache_facts: bool = True
    cache_dir: str = ""

    jd_fetch_timeout_s: float = 20.0
    # A reader service renders the page on its own infrastructure, which is the
    # only thing that gets past Naukri. Only the public job URL leaves this
    # process, but that is still a third party, so it is switchable.
    use_reader_fallback: bool = True
    jina_api_key: str = ""
    enable_playwright_fallback: bool = True
    playwright_timeout_ms: int = 25_000

    render_timeout_s: float = 120.0
    rendercv_theme: str = "engineeringresumes"

    # Both common dev ports, because moving the frontend and forgetting this
    # produces a browser-only failure that the server logs never show.
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    def step(self, name: str) -> StepConfig:
        return PROFILES[self.profile][name]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
