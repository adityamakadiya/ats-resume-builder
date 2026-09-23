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
  return 406). Nothing this process can send gets past it.
* **A reader service closes that gap.** Jina's Reader renders the page on its
  own infrastructure and returns markdown. Measured against live postings it
  returns the complete description for Naukri (875 words) and LinkedIn (2,180),
  keylessly, at 20 requests a minute.

Order is chosen so the cheapest, most private option runs first: a direct fetch
needs no third party, so it is tried before the reader, and the reader before a
local browser. The URL of a public job posting is all that leaves this process,
but that is still a third party and `USE_READER_FALLBACK=false` turns it off.

One trap the reader sets: a dead or redirected link comes back as HTTP 200 with
whatever the site served instead, which for Naukri is its generic search page.
Reader output therefore goes through exactly the same wall and length checks as
a direct fetch; success is never inferred from the status code.
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
from .net import BlockedAddressError, assert_public_host

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
    # Cloudflare's interstitial. The reader renders it happily and returns 200,
    # so without this an Indeed link comes back as a challenge page dressed up
    # as a job description.
    "just a moment",
    "checking your browser",
    "verify you are human",
    "enable javascript and cookies to continue",
)

# A real job description is long. A login wall or an empty SPA shell is not.
MIN_JD_TEXT = 600

READER_ENDPOINT = "https://r.jina.ai/"
# Measured at ~4s; a slow render should not hold a request open much past that.
READER_TIMEOUT_S = 45.0

STRIP_TAGS = ("script", "style", "noscript", "svg", "header", "footer", "nav", "form")

# Redirects are walked by hand rather than by httpx, so that every hop's host
# goes through the SSRF check before a request is sent to it. Letting the client
# follow them internally means a public URL that 302s to 169.254.169.254 is
# fetched and returned before anything here gets a look at it.
MAX_REDIRECTS = 5

# A job description is a page of prose. Anything past this is either broken or
# aimed at the process's memory, and streaming means we notice before we have
# swallowed it.
MAX_BODY_BYTES = 5 * 1024 * 1024


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


class _FetchRefused(Exception):
    """A fetch this module refused on its own terms, with a reason to show."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def assert_public_url(url: str) -> list[str]:
    """Run the SSRF check over a URL's host. Raises ``BlockedAddressError``."""
    try:
        host = urlparse(url).hostname or ""
    except ValueError as exc:
        raise BlockedAddressError("That does not look like a job posting URL.") from exc
    return assert_public_host(host)


def _read_capped(response: httpx.Response) -> httpx.Response:
    """Drain a streamed response into a new one, refusing an oversized body."""
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise _FetchRefused("That page is far too large to be a job description.")

    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            raise _FetchRefused("That page is far too large to be a job description.")
        chunks.append(chunk)

    # A fresh Response because the streamed one has no ``.text`` once read in
    # chunks. Content-encoding is dropped: ``iter_bytes`` already decoded it.
    return httpx.Response(
        status_code=response.status_code,
        headers={"content-type": response.headers.get("content-type", "text/html")},
        content=b"".join(chunks),
        request=response.request,
    )


def _fetch_guarded(client: httpx.Client, url: str) -> httpx.Response:
    """GET a URL, checking the host on every hop of the redirect chain.

    The client is configured with ``follow_redirects=False`` so that each
    ``Location`` is resolved and validated here before it is requested.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        assert_public_url(current)
        with client.stream("GET", current) as response:
            if not response.is_redirect:
                return _read_capped(response)
            location = response.headers.get("location", "").strip()
            if not location:
                # A redirect status with nowhere to go. Treat the body as final.
                return _read_capped(response)
            current = str(httpx.URL(current).join(location))
    raise _FetchRefused("That link redirects too many times to follow.")


def _fetch_linkedin_guest(client: httpx.Client, job_id: str, url: str) -> JdFetchResult | None:
    guest = f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}"
    try:
        # Hardcoded host, but it goes through the same check as everything
        # else: a hostname is only as trustworthy as what DNS returns for it.
        response = _fetch_guarded(client, guest)
    except (httpx.HTTPError, BlockedAddressError, _FetchRefused):
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

    # Before anything else, and before any third party is handed the URL: the
    # candidate supplies this, and hosted that makes it a request forgery
    # primitive aimed at the operator's own network.
    try:
        assert_public_url(url)
    except BlockedAddressError as exc:
        return _blocked(url, portal, str(exc), "url-check")

    # Naukri refuses every request this process can make, so the direct attempt
    # is pure latency. Go straight to the reader.
    if portal == "Naukri":
        rendered = _fetch_via_reader(url)
        if rendered is not None:
            return JdFetchResult(text=rendered, url=url, portal=portal, method="reader")
        return _blocked(
            url,
            portal,
            "Naukri requires a browser-generated anti-bot token on every server-side route, "
            "and the reader could not render the posting either. Open it in your browser, "
            "copy the full description, and paste it instead.",
            "reader",
        )

    with httpx.Client(
        headers=HEADERS,
        timeout=settings.jd_fetch_timeout_s,
        follow_redirects=False,
    ) as client:
        if portal == "LinkedIn":
            job_id = linkedin_job_id(url)
            if job_id:
                result = _fetch_linkedin_guest(client, job_id, url)
                if result is not None:
                    return result

        try:
            response = _fetch_guarded(client, url)
        except BlockedAddressError as exc:
            # Almost always a redirect that hopped off the public internet.
            return _blocked(url, portal, str(exc), "url-check")
        except _FetchRefused as exc:
            return _blocked(url, portal, exc.reason, "http")
        except httpx.TimeoutException:
            return _blocked(url, portal, f"{portal} did not respond in time.", "http")
        except httpx.HTTPError as exc:
            return _blocked(url, portal, f"Could not reach the page ({exc}).", "http")

        if response.status_code >= 400:
            # A hard refusal is exactly when rendering elsewhere helps: Indeed
            # answers 401 and Glassdoor 403 to anything without a browser
            # session. Returning here meant the reader tier never ran for the
            # two portals most likely to need it.
            rendered = _fetch_via_reader(url)
            if rendered is not None:
                return JdFetchResult(text=rendered, url=url, portal=portal, method="reader")
            return _blocked(
                url,
                portal,
                f"{portal} returned HTTP {response.status_code}, and the reader could not "
                "render the posting either. Copy the description and paste it instead.",
                "http",
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
        # The reader renders on someone else's infrastructure, so it clears both
        # a client-rendered shell and a block aimed at this process.
        rendered = _fetch_via_reader(url)
        if rendered is not None:
            return JdFetchResult(text=rendered, url=url, portal=portal, method="reader")

        if settings.enable_playwright_fallback and not wall:
            local = _fetch_with_playwright(url)
            if local is not None and len(local) >= MIN_JD_TEXT:
                return JdFetchResult(text=local, url=url, portal=portal, method="playwright")

        reason = (
            f"{portal} served a sign-in or bot-check page instead of the job description."
            if wall
            else f"{portal} returned too little text to be a job description."
        )
        return _blocked(url, portal, reason, method)

    return JdFetchResult(text=text, url=url, portal=portal, method=method)


def _looks_like_a_posting(text: str) -> bool:
    """The same bar a direct fetch has to clear.

    The reader returns HTTP 200 whatever the site served, so a dead Naukri link
    arrives as its generic "Jobs In India" search page with a perfectly healthy
    status. Trusting the status code here would turn a broken link into a
    confident analysis of a search results page.
    """
    if len(text) < MIN_JD_TEXT:
        return False
    lowered = text.lower()
    if any(marker in lowered for marker in WALL_MARKERS):
        return False
    # A search or listing page names many roles and describes none.
    listing_signals = ("job vacancies in", "jobs in india", "search results", "filter by")
    return not any(signal in lowered for signal in listing_signals)


def _fetch_via_reader(url: str) -> str | None:
    """Render the page through Jina's Reader and return markdown.

    Keyless works at 20 requests a minute, which is ample for one person
    applying to jobs; ``JINA_API_KEY`` raises that when set.
    """
    settings = get_settings()
    if not settings.use_reader_fallback:
        return None

    # This tier does not connect to the URL itself, it hands it to Jina. The
    # host check still runs, for two reasons: handing someone else's
    # infrastructure a private address is still an attempt at reaching it — the
    # reader would resolve 169.254.169.254 from wherever it runs, and against
    # its own metadata endpoint at that — and it keeps the operator's internal
    # hostnames from leaving the process in a third party's request log.
    try:
        assert_public_url(url)
    except BlockedAddressError as exc:
        logger.info("Refusing to send %s to the reader: %s", url, exc)
        return None

    # Deliberately NOT the browser User-Agent used elsewhere in this module.
    # The reader returns 403 to anything impersonating a browser, which is a
    # reasonable anti-abuse rule and the opposite of what job sites want. Spoof
    # the site, identify honestly to the service doing you a favour.
    headers = {"Accept": "text/plain", "User-Agent": f"atsresume/{__import__('atsresume').__version__}"}
    if settings.jina_api_key:
        headers["Authorization"] = f"Bearer {settings.jina_api_key}"

    try:
        response = httpx.get(
            f"{READER_ENDPOINT}{url}", headers=headers, timeout=READER_TIMEOUT_S
        )
    except httpx.HTTPError as exc:
        logger.info("Reader fetch failed for %s: %s", url, exc)
        return None

    if response.status_code == 429:
        logger.info("Reader rate limit hit for %s", url)
        return None
    if response.status_code != 200:
        return None

    text = response.text.strip()
    # Strip the reader's own preamble so only the posting reaches the model.
    body = re.split(r"^Markdown Content:\s*$", text, maxsplit=1, flags=re.M)
    title = re.search(r"^Title:\s*(.+)$", text, re.M)
    cleaned = (body[1] if len(body) > 1 else text).strip()
    if title:
        cleaned = f"Job posting: {title.group(1).strip()}\n\n{cleaned}"

    return cleaned if _looks_like_a_posting(cleaned) else None


def _fetch_with_playwright(url: str) -> str | None:
    """Render the page in a headless browser.

    This fixes client-rendered pages — Workday, SPA careers sites — where the
    description is injected after load. It does not defeat a login wall or a
    captcha, and it is not retried when one was already detected.
    """
    settings = get_settings()
    # A browser is the most willing SSRF client there is: page.goto will load a
    # private address without complaint and run whatever it finds there.
    try:
        assert_public_url(url)
    except BlockedAddressError as exc:
        logger.info("Refusing to open %s in a browser: %s", url, exc)
        return None

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
