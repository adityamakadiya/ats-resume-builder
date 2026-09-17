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
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import __version__, store
from .config import PROFILES, get_settings
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
from .render.rendercv_adapter import THEMES, RenderError, render_pdf

logger = logging.getLogger(__name__)

store.init()

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
    resume_id: int


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

    # Either identifies a stored resume, or carries the facts directly for a
    # client that has them. resume_id is preferred: it keeps the request small
    # and lets the run be attributed to a resume in the history.
    resume_id: int | None = None
    facts: ResumeFacts | None = None
    jd_text: str
    source_note: str = "pasted by the candidate"


class TailorResponse(BaseModel):
    run_id: int
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
    theme: str = Field(default="", description="One of /api/themes; blank uses the default")


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


def _resolve_resume(request: TailorRequest) -> tuple[ResumeFacts, str]:
    """A stored resume by id, or facts supplied inline.

    The raw text matters beyond identification: the truth guard checks the
    rewrite against what the resume actually said, and reconstructing that from
    the extracted facts alone loses anything the extractor dropped.
    """
    if request.resume_id is not None:
        stored = store.get_resume(request.resume_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="No such resume. Upload it again.")
        return stored

    if request.facts is None:
        raise HTTPException(status_code=400, detail="Provide resume_id or facts.")

    from .pipeline.scoring import facts_text_of

    return request.facts, facts_text_of(request.facts)


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
        "profile": settings.profile.value,
        "models": {name: cfg.model for name, cfg in PROFILES[settings.profile].items()},
        "api_key_configured": bool(settings.anthropic_api_key),
        "playwright_fallback": settings.enable_playwright_fallback,
        "cache_facts": settings.cache_facts,
    }


@app.get("/api/themes")
def themes() -> dict[str, Any]:
    """The themes on offer, and which one is used when none is chosen.

    Only themes that pass the ATS checks appear here, so a client can render the
    list without having to know which are safe.
    """
    return {"default": get_settings().rendercv_theme, "themes": THEMES}


@app.post("/api/resume/parse", response_model=ParseResponse)
async def parse_resume(
    resume: Annotated[UploadFile | None, File()] = None,
    resume_text: Annotated[str, Form()] = "",
) -> ParseResponse:
    """Part 1: a resume in, structured facts out."""
    source = await _read_resume(resume, resume_text)
    facts = await run_in_threadpool(extract_resume_facts, source.raw_text)
    resume_id = await run_in_threadpool(store.put_facts, source.raw_text, facts)
    return ParseResponse(source=source, facts=facts, resume_id=resume_id)


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
    import time

    from .llm import current_usage, start_usage
    from .pipeline.scoring import compute_ats_report

    facts, raw_text = _resolve_resume(request)
    jd_text = clamp_jd_text(request.jd_text)

    started = time.time()
    start_usage()
    job = await run_in_threadpool(extract_job_spec, jd_text, request.source_note)
    gaps = await run_in_threadpool(analyze_gaps, job, facts)
    outcome = await run_in_threadpool(tailor_resume, job, facts, gaps, raw_text)
    report = compute_ats_report(job, facts, outcome.tailored)
    strategy = await run_in_threadpool(strategize, job, gaps, outcome.tailored, report)
    usage = current_usage()

    run_id = await run_in_threadpool(
        lambda: store.save_run(
            raw_text=raw_text,
            facts=facts,
            job=job,
            gaps=gaps,
            tailored=outcome.tailored,
            truth=outcome.truth,
            report=report,
            strategy=strategy,
            jd_text=jd_text,
            jd_source=request.source_note,
            repair_attempted=outcome.repair_attempted,
            seconds=time.time() - started,
            cost_usd=usage.cost_usd if usage else 0.0,
        )
    )

    return TailorResponse(
        run_id=run_id,
        job=job,
        gaps=gaps,
        tailored=outcome.tailored,
        truth=outcome.truth,
        report=report,
        strategy=strategy,
        repair_attempted=outcome.repair_attempted,
    )


class ScoreRequest(BaseModel):
    tailored: TailoredResume
    facts: ResumeFacts
    job: JobSpec


@app.post("/api/score", response_model=AtsReport)
async def score(request: ScoreRequest) -> AtsReport:
    """Re-score an edited document.

    Free and instant: the score is computed, not asked of a model, so the editor
    can call it on every change and show the number moving as you work. That is
    the whole payoff of having refused to let the model invent the number.
    """
    from .pipeline.scoring import compute_ats_report

    return compute_ats_report(request.job, request.facts, request.tailored)


class RunPatch(BaseModel):
    tailored: TailoredResume | None = None
    status: str | None = None
    notes: str | None = None


@app.get("/api/runs")
async def runs(limit: int = 50) -> dict[str, Any]:
    """History. Every tailored resume used to vanish when the browser moved on."""
    summaries = await run_in_threadpool(store.list_runs, min(max(limit, 1), 200))
    return {"runs": [asdict(s) for s in summaries], "statuses": list(store.STATUSES)}


@app.get("/api/runs/{run_id}")
async def run_detail(run_id: int) -> dict[str, Any]:
    """The whole run, so the editor can reopen it exactly as it was left."""
    found = await run_in_threadpool(store.get_run, run_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No such run.")
    return found


@app.patch("/api/runs/{run_id}")
async def patch_run(run_id: int, patch: RunPatch) -> dict[str, Any]:
    """Save edits and application status.

    This is what makes a hand-edited resume survive a refresh, and what turns a
    list of runs into a record of where each application actually got to.
    """
    if patch.status is not None and patch.status not in store.STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown status. Use one of: {', '.join(store.STATUSES)}.",
        )
    ok = await run_in_threadpool(
        store.update_run,
        run_id,
        tailored=patch.tailored,
        status=patch.status,
        notes=patch.notes,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="No such run.")
    return {"ok": True}


@app.delete("/api/runs/{run_id}")
async def remove_run(run_id: int) -> dict[str, Any]:
    if not await run_in_threadpool(store.delete_run, run_id):
        raise HTTPException(status_code=404, detail="No such run.")
    return {"ok": True}


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
