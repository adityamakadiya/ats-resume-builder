"""Fetching a job description from a URL.

What actually works, measured rather than assumed:

* **Careers pages and ATS-hosted postings** (Greenhouse, Lever, Workday, most
  company sites) publish schema.org ``JobPosting`` JSON-LD. It is cleaner than
  the rendered DOM and is tried first.
* **LinkedIn** serves a login shell on ``/jobs/view/{id}`` with no JSON-LD, but
  its guest endpoint returns the full description unauthenticated. Note that
  ``/jobs-guest/`` is disallowed in LinkedIn's robots.txt, so this is a
  single-URL fetch on the candidate's behalf, never a crawl — and it is off by
  default in hosted deployments.
* **Naukri** gates every server-side path behind a recaptcha token its own
  frontend generates (``jobapi/v3/search`` and ``jobapi/v4/job/{id}`` both
  return 406). There is no stable unauthenticated route. Paste is the answer.

Playwright is a fallback for pages that are merely client-rendered. It does not
defeat a login wall or a captcha, and nothing here pretends otherwise.
"""

from __future__ import annotations

import contextlib
import json
import logging
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
from selectolax.parser import HTMLParser

from ..config import get_settings

logger = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

WALL_MARKERS = (
    "sign in to continue",
    "join linkedin",
    "please enable javascript",
    "are you a robot",
    "captcha",
    "access denied",
    "enable cookies",
    "this page isn't available",
    "recaptcha required",
)

# A real job description is long. A login wall or an empty SPA shell is not.
MIN_JD_TEXT = 600

STRIP_TAGS = ("script", "style", "noscript", "svg", "header", "footer", "nav", "form")


@dataclass
class JdFetchResult:
    text: str
    url: str
    portal: str
    method: str
    blocked: bool = False
    block_reason: str = ""

    @property
    def source_note(self) -> str:
        return f"{self.portal} via {self.method} — {self.url}"


class JdFetchError(RuntimeError):
    pass


def portal_of(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return "unknown"
    host = host.removeprefix("www.")
    for needle, name in (
        ("naukri", "Naukri"),
        ("linkedin", "LinkedIn"),
        ("indeed", "Indeed"),
        ("greenhouse", "Greenhouse"),
        ("lever.co", "Lever"),
        ("myworkdayjobs", "Workday"),
        ("workday", "Workday"),
        ("wellfound", "Wellfound"),
        ("angel.co", "Wellfound"),
        ("glassdoor", "Glassdoor"),
    ):
        if needle in host:
            return name
    return host or "unknown"


def _html_to_text(html: str) -> str:
    tree = HTMLParser(html)
    for tag in STRIP_TAGS:
        for node in tree.css(tag):
            node.decompose()
    scope = tree.css_first("main") or tree.css_first("article") or tree.body
    if scope is None:
        return ""
    text = scope.text(separator="\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*", "\n\n", text)
    return text.strip()


def _job_posting_from_json_ld(html: str) -> str:
    tree = HTMLParser(html)
    for node in tree.css('script[type="application/ld+json"]'):
        raw = node.text()
        if not raw or not raw.strip():
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue

        candidates = parsed if isinstance(parsed, list) else [parsed]
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            nodes = [candidate, *candidate.get("@graph", [])]
            for item in nodes:
                if not isinstance(item, dict) or item.get("@type") != "JobPosting":
                    continue
                org = item.get("hiringOrganization") or {}
                parts = [
                    f"Job title: {item.get('title', '')}",
                    f"Company: {org.get('name', '') if isinstance(org, dict) else org}",
                    f"Employment type: {item.get('employmentType', '')}",
                    f"Location: {json.dumps(item.get('jobLocation', ''))[:300]}",
                    f"Date posted: {item.get('datePosted', '')}",
                    "",
                    _html_to_text(str(item.get("description", ""))),
                ]
                text = "\n".join(parts).strip()
                if len(text) > 300:
                    return text
    return ""


_LINKEDIN_ID = re.compile(r"/jobs/view/(?:[^/]*-)?(\d{6,})|currentJobId=(\d{6,})")


def linkedin_job_id(url: str) -> str:
    match = _LINKEDIN_ID.search(url)
    if not match:
        return ""
    return match.group(1) or match.group(2) or ""


def _blocked(url: str, portal: str, reason: str, method: str) -> JdFetchResult:
    return JdFetchResult(
        text="", url=url, portal=portal, method=method, blocked=True, block_reason=reason
    )


def _fetch_linkedin_guest(client: httpx.Client, job_id: str, url: str) -> JdFetchResult | None:
    guest = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
    try:
        response = client.get(guest)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    text = _html_to_text(response.text)
    if len(text) < 200:
        return None
    return JdFetchResult(text=text, url=url, portal="LinkedIn", method="linkedin-guest")


def fetch_jd(url: str) -> JdFetchResult:
    settings = get_settings()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise JdFetchError("That does not look like a job posting URL.")

    portal = portal_of(url)

    # Naukri is gated end to end; failing fast beats a slow, confusing timeout.
    if portal == "Naukri":
        return _blocked(
            url,
            portal,
            "Naukri requires a browser-generated anti-bot token on every server-side route, "
            "so the posting cannot be read from here. Open it in your browser, copy the full "
            "description, and paste it instead.",
            "refused",
        )

    with httpx.Client(
        headers=HEADERS,
        timeout=settings.jd_fetch_timeout_s,
        follow_redirects=True,
        max_redirects=5,
    ) as client:
        if portal == "LinkedIn":
            job_id = linkedin_job_id(url)
            if job_id:
                result = _fetch_linkedin_guest(client, job_id, url)
                if result is not None:
                    return result

        try:
            response = client.get(url)
        except httpx.TimeoutException:
            return _blocked(url, portal, f"{portal} did not respond in time.", "http")
        except httpx.HTTPError as exc:
            return _blocked(url, portal, f"Could not reach the page ({exc}).", "http")

        if response.status_code >= 400:
            return _blocked(
                url, portal, f"{portal} returned HTTP {response.status_code}.", "http"
            )

        html = response.text

    text = _job_posting_from_json_ld(html)
    method = "json-ld"
    if not text:
        text = _html_to_text(html)
        method = "html"

    lowered = text.lower()
    wall = next((m for m in WALL_MARKERS if m in lowered), "")

    if wall or len(text) < MIN_JD_TEXT:
        if settings.enable_playwright_fallback and not wall:
            rendered = _fetch_with_playwright(url)
            if rendered is not None and len(rendered) >= MIN_JD_TEXT:
                return JdFetchResult(text=rendered, url=url, portal=portal, method="playwright")

        reason = (
            f"{portal} served a sign-in or bot-check page instead of the job description."
            if wall
            else f"{portal} returned too little text to be a job description."
        )
        return _blocked(url, portal, reason, method)

    return JdFetchResult(text=text, url=url, portal=portal, method=method)


def _fetch_with_playwright(url: str) -> str | None:
    """Render the page in a headless browser.

    This fixes client-rendered pages — Workday, SPA careers sites — where the
    description is injected after load. It does not defeat a login wall or a
    captcha, and it is not retried when one was already detected.
    """
    settings = get_settings()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.info("Playwright not installed; skipping browser fallback")
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=UA, locale="en-US")
                page.goto(url, timeout=settings.playwright_timeout_ms, wait_until="domcontentloaded")
                # networkidle never settles on pages that poll in the background.
                with contextlib.suppress(Exception):
                    page.wait_for_load_state("networkidle", timeout=8_000)
                html = page.content()
            finally:
                browser.close()
    except Exception as exc:
        logger.info("Playwright fallback failed for %s: %s", url, exc)
        return None

    return _job_posting_from_json_ld(html) or _html_to_text(html)


def clamp_jd_text(text: str) -> str:
    settings = get_settings()
    cleaned = re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n")).strip()
    if len(cleaned) < settings.min_jd_chars:
        raise JdFetchError(
            "That job description is too short to analyse. Paste the full posting — "
            "requirements, responsibilities, everything."
        )
    return cleaned[: settings.max_jd_chars]
