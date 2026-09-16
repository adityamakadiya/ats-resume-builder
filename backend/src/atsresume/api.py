"""HTTP surface.

The endpoints follow the three parts of the job rather than the internals:
parse a resume, read a job description, produce a tailored PDF. ``/api/run``
does all three in one call for clients that do not want to hold state.

Everything CPU- or subprocess-bound runs in a worker thread. FastAPI's async
event loop is single-threaded; a synchronous PDF parse or a four-second
subprocess on the loop would stall every other request in flight.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import __version__
from .config import get_settings
from .ingest.jd import JdFetchError, clamp_jd_text, fetch_jd
from .ingest.resume import ResumeIngestError, ingest_resume, ingest_resume_text
from .llm import LLMError
from .models import (
    AtsReport,
    GapAnalysis,
    JobSpec,
    ResumeFacts,
    SourceDocument,
    Strategy,
    TailoredResume,
    TruthReport,
)
from .pipeline import (
    analyze_gaps,
    extract_job_spec,
    extract_resume_facts,
    run_pipeline,
    strategize,
    tailor_resume,
)
from .render.rendercv_adapter import RenderError, render_pdf

logger = logging.getLogger(__name__)

app = FastAPI(
    title="ATS Resume Builder",
    version=__version__,
    description=(
        "Tailors a resume to one job description using only what the resume already "
        "says. Every rewritten line is traced back to a source fact, and anything that "
        "cannot be traced is reported rather than shipped."
    ),
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    # Response headers are invisible to cross-origin JavaScript unless they are
    # named here. Without this the browser downloads the PDF as "resume.pdf" and
    # silently drops the render warnings — the endpoint looks like it works.
    expose_headers=["Content-Disposition", "X-Render-Warnings"],
)


# --------------------------------------------------------------------------- #
# Schemas                                                                      #
# --------------------------------------------------------------------------- #


class ParseResponse(BaseModel):
    source: SourceDocument
    facts: ResumeFacts


class JdResponse(BaseModel):
    text: str
    portal: str
    method: str
    source_note: str
    blocked: bool = False
    block_reason: str = ""


class RunResponse(BaseModel):
    job: JobSpec
    facts: ResumeFacts
    gaps: GapAnalysis
    tailored: TailoredResume
    truth: TruthReport
    report: AtsReport
    strategy: Strategy
    repair_attempted: bool
    source: SourceDocument


class TailorRequest(BaseModel):
    """Facts the client already has, plus the posting text.

    Splitting this out of ``/api/run`` is what lets a client show real progress:
    parsing the resume and tailoring it are two long steps, and a single
    five-minute request can only be reported as a spinner.
    """

    facts: ResumeFacts
    jd_text: str
    source_note: str = "pasted by the candidate"


class TailorResponse(BaseModel):
    job: JobSpec
    gaps: GapAnalysis
    tailored: TailoredResume
    truth: TruthReport
    report: AtsReport
    strategy: Strategy
    repair_attempted: bool


class RenderRequest(BaseModel):
    tailored: TailoredResume
    facts: ResumeFacts
    company: str = ""
    theme: str = Field(default="", description="rendercv theme; blank uses the configured default")


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #


async def _read_resume(file: UploadFile | None, text: str) -> SourceDocument:
    if file is not None and file.filename:
        data = await file.read()
        return await run_in_threadpool(ingest_resume, file.filename, data)
    if text and text.strip():
        return await run_in_threadpool(ingest_resume_text, text)
    raise HTTPException(
        status_code=400,
        detail="Upload a resume file, or paste the resume text.",
    )


async def _read_jd(url: str, text: str) -> tuple[str, str]:
    """Returns (jd_text, source_note)."""
    if text and text.strip():
        return clamp_jd_text(text), "pasted by the candidate"

    if not url or not url.strip():
        raise HTTPException(
            status_code=400,
            detail="Provide a job description URL, or paste the job description text.",
        )

    result = await run_in_threadpool(fetch_jd, url.strip())
    if result.blocked:
        raise HTTPException(
            status_code=422,
            detail={
                "error": result.block_reason,
                "needs_jd_paste": True,
                "portal": result.portal,
                "hint": (
                    "Open the posting in your browser, copy the full job description, and "
                    "paste it instead. Portals that require a sign-in cannot be read from "
                    "a server."
                ),
            },
        )
    return clamp_jd_text(result.text), result.source_note


# --------------------------------------------------------------------------- #
# Routes                                                                       #
# --------------------------------------------------------------------------- #


@app.get("/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "version": __version__,
        "model": settings.model,
        "api_key_configured": bool(settings.anthropic_api_key),
        "playwright_fallback": settings.enable_playwright_fallback,
    }


@app.post("/api/resume/parse", response_model=ParseResponse)
async def parse_resume(
    resume: Annotated[UploadFile | None, File()] = None,
    resume_text: Annotated[str, Form()] = "",
) -> ParseResponse:
    """Part 1: a resume in, structured facts out."""
    source = await _read_resume(resume, resume_text)
    facts = await run_in_threadpool(extract_resume_facts, source.raw_text)
    return ParseResponse(source=source, facts=facts)


@app.post("/api/jd/fetch", response_model=JdResponse)
async def fetch_job_description(
    url: Annotated[str, Form()] = "",
    text: Annotated[str, Form()] = "",
) -> JdResponse:
    """Part 2a: a link in, the posting's text out."""
    if text and text.strip():
        return JdResponse(
            text=clamp_jd_text(text),
            portal="pasted",
            method="paste",
            source_note="pasted by the candidate",
        )
    if not url.strip():
        raise HTTPException(status_code=400, detail="Provide a URL or the posting text.")

    result = await run_in_threadpool(fetch_jd, url.strip())
    return JdResponse(
        text="" if result.blocked else clamp_jd_text(result.text),
        portal=result.portal,
        method=result.method,
        source_note=result.source_note,
        blocked=result.blocked,
        block_reason=result.block_reason,
    )


@app.post("/api/run", response_model=RunResponse)
async def run(
    resume: Annotated[UploadFile | None, File()] = None,
    resume_text: Annotated[str, Form()] = "",
    jd_url: Annotated[str, Form()] = "",
    jd_text: Annotated[str, Form()] = "",
) -> RunResponse:
    """Parts 1-2 together: resume plus posting in, a verified tailored resume out."""
    source = await _read_resume(resume, resume_text)
    text, note = await _read_jd(jd_url, jd_text)

    result = await run_in_threadpool(run_pipeline, source.raw_text, text, note)

    return RunResponse(
        job=result.job,
        facts=result.facts,
        gaps=result.gaps,
        tailored=result.tailored,
        truth=result.truth,
        report=result.report,
        strategy=result.strategy,
        repair_attempted=result.repair_attempted,
        source=source,
    )


@app.post("/api/tailor", response_model=TailorResponse)
async def tailor(request: TailorRequest) -> TailorResponse:
    """Part 2b: already-parsed facts plus a posting, tailored and verified.

    The resume text is reconstructed from the facts for the truth guard's
    corpus. That is slightly narrower than the original upload — a line the
    extractor dropped is not in it — which makes the guard marginally stricter
    here than in ``/api/run``. Stricter is the safe direction.
    """
    from .pipeline.scoring import compute_ats_report, facts_text_of

    jd_text = clamp_jd_text(request.jd_text)
    job = await run_in_threadpool(extract_job_spec, jd_text, request.source_note)
    gaps = await run_in_threadpool(analyze_gaps, job, request.facts)
    outcome = await run_in_threadpool(
        tailor_resume, job, request.facts, gaps, facts_text_of(request.facts)
    )
    report = compute_ats_report(job, request.facts, outcome.tailored)
    strategy = await run_in_threadpool(strategize, job, gaps, outcome.tailored, report)

    return TailorResponse(
        job=job,
        gaps=gaps,
        tailored=outcome.tailored,
        truth=outcome.truth,
        report=report,
        strategy=strategy,
        repair_attempted=outcome.repair_attempted,
    )


@app.post(
    "/api/render",
    responses={200: {"content": {"application/pdf": {}}, "description": "The rendered resume"}},
)
async def render(request: RenderRequest) -> Response:
    """Part 3: a tailored resume in, an ATS-clean PDF out."""
    result = await run_in_threadpool(
        render_pdf,
        request.tailored,
        request.facts,
        request.company,
        request.theme or None,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{result.filename}"',
        "X-Render-Warnings": " | ".join(result.warnings) if result.warnings else "",
    }
    return Response(content=result.pdf, media_type="application/pdf", headers=headers)


# --------------------------------------------------------------------------- #
# Error handling                                                               #
# --------------------------------------------------------------------------- #
#
# Every one of these is something the candidate can act on, so each becomes a
# 4xx with a readable message rather than a 500 and a stack trace.


@app.exception_handler(ResumeIngestError)
async def _resume_error(_request, exc: ResumeIngestError) -> Response:
    return _json_error(400, str(exc))


@app.exception_handler(JdFetchError)
async def _jd_error(_request, exc: JdFetchError) -> Response:
    return _json_error(400, str(exc))


@app.exception_handler(RenderError)
async def _render_error(_request, exc: RenderError) -> Response:
    return _json_error(422, str(exc))


@app.exception_handler(LLMError)
async def _llm_error(_request, exc: LLMError) -> Response:
    return _json_error(502, str(exc))


def _json_error(status: int, message: str) -> Response:
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=status, content={"detail": message})
