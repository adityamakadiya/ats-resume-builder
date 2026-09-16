"""Runtime configuration.

Everything tunable lives here so the pipeline modules stay free of magic
numbers, and so cost and latency can be traded without editing logic.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

Effort = Literal["low", "medium", "high", "xhigh", "max"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"), env_file_encoding="utf-8", extra="ignore"
    )

    anthropic_api_key: str = ""
    model: str = "claude-opus-5"

    # Effort is the first quality/cost lever. Extraction is mechanical and does
    # not repay deep reasoning; rewriting and gap analysis do.
    effort_extract: Effort = "medium"
    effort_analyze: Effort = "high"
    effort_tailor: Effort = "xhigh"

    max_tokens: int = 32_000
    request_timeout_s: float = 900.0

    # Ingest limits. A resume is a few pages; anything far larger is either a
    # mistake or an attempt to run up a bill.
    max_upload_bytes: int = 10 * 1024 * 1024
    max_resume_chars: int = 60_000
    min_resume_chars: int = 200
    max_jd_chars: int = 40_000
    min_jd_chars: int = 400

    # JD fetching
    jd_fetch_timeout_s: float = 20.0
    enable_playwright_fallback: bool = True
    playwright_timeout_ms: int = 25_000

    # Rendering
    render_timeout_s: float = 120.0
    rendercv_theme: str = "engineeringresumes"

    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
