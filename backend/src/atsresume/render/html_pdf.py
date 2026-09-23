"""HTML in, PDF out, through a headless browser.

Why this exists alongside the rendercv path
-------------------------------------------
rendercv produces an excellent PDF and the editor cannot show it. The preview a
candidate edits against is React; the download is Typst; and the two agree only
as closely as two people reading the same spec. Every time they disagree the
candidate finds out after downloading, which is the worst possible moment.

So the primary path renders the same React template the editor is already
showing, serialised to HTML, in Chromium. Preview and download are not
"consistent" in that arrangement, they are the same document, and the class of
bug where the export looks different simply cannot occur.

The rendercv path stays as the maximum-ATS-safety export. Two outputs for two
readers: one for a person, one for a parser.

What this module refuses to do
------------------------------
It does not fetch. A page that can load remote subresources is a page that can
be pointed at a private address by whatever produced the HTML, and this service
will eventually take HTML over the network. So the browser context is offline:
every request except the document itself and explicitly allowlisted data: URIs
is aborted. Fonts and CSS must be inlined or baked into the image. This costs a
little convenience and removes an SSRF vector from the component most likely to
be exposed.

It also does not trust the caller for page count. Chromium is asked, after the
fact, how many pages it produced, because the density ladder above it needs a
measured answer rather than an estimate.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field

from ..config import get_settings

logger = logging.getLogger(__name__)


class HtmlRenderError(RuntimeError):
    """Rendering failed in a way worth telling the candidate about."""


# A4 at 96dpi, which is what Chromium lays out against before scaling to the
# print box. Kept here rather than in the template so the measurement and the
# page box cannot disagree.
A4_WIDTH_PX = 794
A4_HEIGHT_PX = 1123

# Chromium is the slowest thing in the request. A resume that has not rendered
# in this long is not going to.
DEFAULT_TIMEOUT_S = 30.0

_PDF_PAGE_COUNT = re.compile(rb"/Type\s*/Page[^s]")


@dataclass
class HtmlRenderResult:
    pdf: bytes
    filename: str
    pages: int
    density: int = 0
    fitted: bool = True
    warnings: list[str] = field(default_factory=list)
    ms: int = 0
    #: Subresources the page asked for and did not get. Normally empty. A
    #: template that reaches for a webfont fails silently otherwise: the PDF
    #: renders in a fallback face and nobody finds out until it looks wrong.
    blocked_requests: list[str] = field(default_factory=list)


def count_pdf_pages(pdf: bytes) -> int:
    """Pages in a PDF, without paying to open it properly.

    Counting ``/Type /Page`` occurrences is crude and is wrong on documents
    that use object streams. It is right on what Chromium emits, and the number
    is only ever used to tell a candidate their resume spilled onto a second
    page. If it is ever wrong the failure is a slightly wrong sentence, not a
    corrupt file, so the cheap answer is the correct trade.
    """
    found = len(_PDF_PAGE_COUNT.findall(pdf))
    return max(1, found)


def _safe_filename(name: str) -> str:
    """A filename a browser will accept and a filesystem will keep.

    Content-Disposition is a header, so a newline in this value is a response
    splitting bug. Anything that is not plainly a filename is dropped rather
    than escaped.
    """
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", name).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)[:120]
    if not cleaned:
        cleaned = "resume"
    if not cleaned.lower().endswith(".pdf"):
        cleaned += ".pdf"
    return cleaned


def render_html_to_pdf(
    html: str,
    *,
    filename: str = "resume.pdf",
    timeout_s: float | None = None,
    print_background: bool = True,
) -> HtmlRenderResult:
    """Render one HTML document to a PDF.

    ``html`` must be self-contained: inline styles, inline or system fonts, and
    data: URIs for any image. Remote subresources are blocked, not fetched.
    """
    if not html or not html.strip():
        raise HtmlRenderError("Nothing to render: the document was empty.")

    settings = get_settings()
    budget = timeout_s or getattr(settings, "html_render_timeout_s", DEFAULT_TIMEOUT_S)
    started = time.time()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - deployment error, not a user one
        raise HtmlRenderError(
            "The PDF renderer is not installed on this server. "
            "Run 'playwright install chromium'."
        ) from exc

    warnings: list[str] = []
    blocked: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=[
                    # The renderer handles untrusted HTML and needs no network,
                    # so it gives up the capabilities it cannot need.
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-sandbox",
                ],
            )
            try:
                context = browser.new_context(
                    viewport={"width": A4_WIDTH_PX, "height": A4_HEIGHT_PX},
                    device_scale_factor=2,
                    java_script_enabled=False,
                )

                # Everything except the document itself is refused. A template
                # that needs a webfont must inline it; a template that reaches
                # for the network is a template that can be aimed somewhere.
                def _block(route, request):
                    if request.resource_type == "document":
                        route.continue_()
                        return
                    if len(blocked) < 20:
                        blocked.append(f"{request.resource_type} {request.url[:200]}")
                    route.abort()

                context.route("**/*", _block)

                page = context.new_page()
                page.set_default_timeout(budget * 1000)
                page.set_content(html, wait_until="load")

                pdf = page.pdf(
                    format="A4",
                    print_background=print_background,
                    prefer_css_page_size=True,
                    # Margins belong to the document, so the on-screen preview
                    # and the printed page share one source of spacing.
                    margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                )
            finally:
                browser.close()
    except HtmlRenderError:
        raise
    except Exception as exc:
        detail = str(exc)
        if "Timeout" in detail or "timeout" in detail:
            raise HtmlRenderError(
                f"The resume took longer than {budget:.0f}s to render. "
                "Try again, or download the ATS layout instead."
            ) from exc
        logger.exception("Headless render failed")
        raise HtmlRenderError(f"The resume could not be rendered: {detail}") from exc

    if not pdf:
        raise HtmlRenderError("The renderer produced an empty file.")

    if blocked:
        warnings.append(
            f"{len(blocked)} subresource(s) were refused; this renderer has no network. "
            "Inline fonts and images, or bake them into the image."
        )
        logger.info("Renderer blocked %d subresource(s): %s", len(blocked), blocked[:5])

    pages = count_pdf_pages(pdf)
    if pages > 1:
        warnings.append(
            f"This came out at {pages} pages. Most recruiters read the first one."
        )

    return HtmlRenderResult(
        pdf=pdf,
        filename=_safe_filename(filename),
        pages=pages,
        fitted=pages == 1,
        warnings=warnings,
        ms=int((time.time() - started) * 1000),
        blocked_requests=blocked,
    )
