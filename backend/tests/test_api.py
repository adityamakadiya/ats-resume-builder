"""HTTP surface.

The LLM is stubbed, so these assert the plumbing: what gets a 4xx with a
readable message, what runs off the event loop, and that a blocked portal comes
back as structured guidance rather than a stack trace.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from atsresume import api
from atsresume.ingest.jd import JdFetchResult
from atsresume.models import Contact, ResumeFacts


@pytest.fixture
def client() -> TestClient:
    return TestClient(api.app, raise_server_exceptions=False)


RESUME_TEXT = (
    "Priya Nair\nBackend Engineer | Bengaluru | priya@example.com\n\n"
    "EXPERIENCE\nAcme Payments - Backend Engineer (Jun 2023 - Present)\n"
    "- Built REST APIs in Node.js and Express for the merchant settlement service.\n"
    "- Added Redis caching to the settlement lookup endpoint, cutting response time by 45%.\n"
    "- Wrote PostgreSQL queries and added indexes for the reconciliation reports module.\n\n"
    "SKILLS\nBackend: Node.js, Express, PostgreSQL, Redis\n"
) * 2


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["profile"] in {"fast", "balanced", "thorough"}
    # The rewrite is the step whose quality decides the outcome, so the default
    # profile must not quietly downgrade it.
    assert body["models"]["tailor"] == "claude-opus-5"


def test_parse_requires_some_input(client):
    assert client.post("/api/resume/parse", data={}).status_code == 400


def test_parse_rejects_an_unsupported_format(client):
    response = client.post(
        "/api/resume/parse",
        files={"resume": ("resume.pages", io.BytesIO(b"x" * 500), "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Unsupported format" in response.json()["detail"]


def test_parse_rejects_a_stub(client):
    response = client.post("/api/resume/parse", data={"resume_text": "hi"})
    assert response.status_code == 400
    assert "at least a few hundred" in response.json()["detail"]


def test_parse_rejects_an_empty_file(client):
    response = client.post(
        "/api/resume/parse", files={"resume": ("resume.pdf", io.BytesIO(b""), "application/pdf")}
    )
    assert response.status_code == 400


def test_parse_rejects_an_image_only_pdf(client, monkeypatch):
    import pymupdf

    doc = pymupdf.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()

    response = client.post(
        "/api/resume/parse", files={"resume": ("scan.pdf", io.BytesIO(data), "application/pdf")}
    )
    assert response.status_code == 400
    assert "No text layer" in response.json()["detail"]


def test_parse_happy_path(client, monkeypatch, facts):
    monkeypatch.setattr(api, "extract_resume_facts", lambda text: facts)
    response = client.post("/api/resume/parse", data={"resume_text": RESUME_TEXT})
    assert response.status_code == 200
    body = response.json()
    assert body["facts"]["contact"]["name"] == "Priya Nair"
    assert body["source"]["kind"] == "text"


def test_jd_fetch_reports_a_block_without_failing(client, monkeypatch):
    monkeypatch.setattr(
        api,
        "fetch_jd",
        lambda url: JdFetchResult(
            text="",
            url=url,
            portal="Naukri",
            method="refused",
            blocked=True,
            block_reason="Naukri requires a browser-generated token.",
        ),
    )
    response = client.post("/api/jd/fetch", data={"url": "https://www.naukri.com/job-listings-1"})
    assert response.status_code == 200
    body = response.json()
    assert body["blocked"] is True
    assert body["portal"] == "Naukri"


def test_run_turns_a_blocked_portal_into_actionable_guidance(client, monkeypatch):
    monkeypatch.setattr(
        api,
        "fetch_jd",
        lambda url: JdFetchResult(
            text="",
            url=url,
            portal="LinkedIn",
            method="html",
            blocked=True,
            block_reason="LinkedIn served a sign-in page.",
        ),
    )
    response = client.post(
        "/api/run",
        data={"resume_text": RESUME_TEXT, "jd_url": "https://www.linkedin.com/jobs/view/1"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["needs_jd_paste"] is True
    assert "paste" in detail["hint"].lower()


def test_run_requires_a_job_description(client):
    response = client.post("/api/run", data={"resume_text": RESUME_TEXT})
    assert response.status_code == 400


def test_run_rejects_a_stub_job_description(client):
    response = client.post(
        "/api/run", data={"resume_text": RESUME_TEXT, "jd_text": "Backend engineer wanted."}
    )
    assert response.status_code == 400


def test_llm_failure_becomes_a_502_not_a_500(client, monkeypatch):
    from atsresume.llm import LLMError

    def boom(_text):
        raise LLMError("ANTHROPIC_API_KEY was rejected.")

    monkeypatch.setattr(api, "extract_resume_facts", boom)
    response = client.post("/api/resume/parse", data={"resume_text": RESUME_TEXT})
    assert response.status_code == 502
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]


@pytest.mark.slow
def test_render_endpoint_returns_a_pdf(client, tailored, facts):
    response = client.post(
        "/api/render",
        json={
            "tailored": tailored.model_dump(mode="json"),
            "facts": facts.model_dump(mode="json"),
            "company": "Acme Payments",
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "Priya-Nair-Resume-Acme-Payments.pdf" in response.headers["content-disposition"]
    assert response.content[:5] == b"%PDF-"


def test_render_rejects_a_malformed_payload(client):
    response = client.post("/api/render", json={"tailored": {}, "facts": {}})
    assert response.status_code == 422


def test_render_surfaces_a_warning_for_a_dropped_phone(client, tailored, facts):
    facts.contact.phone = "ring me maybe"
    response = client.post(
        "/api/render",
        json={
            "tailored": tailored.model_dump(mode="json"),
            "facts": facts.model_dump(mode="json"),
        },
    )
    assert response.status_code == 200
    assert "phone" in response.headers.get("x-render-warnings", "").lower()


def test_facts_model_round_trips_through_json():
    """The frontend sends these back verbatim; a lossy round trip would silently
    drop sections between analysis and render."""
    original = ResumeFacts(contact=Contact(name="Priya"), total_years_experience=2.5)
    assert ResumeFacts.model_validate(original.model_dump(mode="json")) == original


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    from atsresume import store
    from atsresume.config import get_settings

    monkeypatch.setattr(get_settings(), "db_path", str(tmp_path / "api.db"))
    store.init()
    return store


def test_parse_returns_a_resume_id(client, monkeypatch, facts, temp_db):
    """The id is what lets /api/tailor look the resume up instead of having the
    client ship the whole facts blob back on every call."""
    monkeypatch.setattr(api, "extract_resume_facts", lambda text: facts)
    body = client.post("/api/resume/parse", data={"resume_text": RESUME_TEXT}).json()
    assert body["resume_id"] > 0
    assert temp_db.get_resume(body["resume_id"]) is not None


def test_tailor_rejects_an_unknown_resume_id(client, temp_db):
    response = client.post(
        "/api/tailor", json={"resume_id": 9999, "jd_text": "x" * 500}
    )
    assert response.status_code == 404


def test_tailor_requires_one_of_id_or_facts(client, temp_db):
    response = client.post("/api/tailor", json={"jd_text": "x" * 500})
    assert response.status_code == 400


def test_runs_history_is_empty_before_anything_runs(client, temp_db):
    body = client.get("/api/runs").json()
    assert body["runs"] == []
    assert "applied" in body["statuses"]


def test_a_saved_run_can_be_listed_reopened_and_updated(client, facts, tailored, temp_db):
    from tests.test_store import _run_kwargs

    run_id = temp_db.save_run(**_run_kwargs(facts, tailored))

    listed = client.get("/api/runs").json()["runs"]
    assert len(listed) == 1 and listed[0]["id"] == run_id

    detail = client.get(f"/api/runs/{run_id}").json()
    assert detail["tailored"]["headline"] == tailored.headline

    edited = tailored.model_dump(mode="json")
    edited["experience"][0]["bullets"][0]["text"] = "Edited through the API."
    patched = client.patch(
        f"/api/runs/{run_id}", json={"tailored": edited, "status": "applied"}
    )
    assert patched.status_code == 200

    reopened = client.get(f"/api/runs/{run_id}").json()
    assert reopened["tailored"]["experience"][0]["bullets"][0]["text"] == "Edited through the API."
    assert reopened["status"] == "applied"


def test_an_unknown_status_is_refused(client, facts, tailored, temp_db):
    from tests.test_store import _run_kwargs

    run_id = temp_db.save_run(**_run_kwargs(facts, tailored))
    response = client.patch(f"/api/runs/{run_id}", json={"status": "ghosted"})
    assert response.status_code == 400
    assert "Unknown status" in response.json()["detail"]


def test_missing_runs_are_404_not_500(client, temp_db):
    assert client.get("/api/runs/9999").status_code == 404
    assert client.patch("/api/runs/9999", json={"status": "applied"}).status_code == 404
    assert client.delete("/api/runs/9999").status_code == 404


def test_a_run_can_be_deleted(client, facts, tailored, temp_db):
    from tests.test_store import _run_kwargs

    run_id = temp_db.save_run(**_run_kwargs(facts, tailored))
    assert client.delete(f"/api/runs/{run_id}").status_code == 200
    assert client.get(f"/api/runs/{run_id}").status_code == 404


def test_score_endpoint_is_free_and_deterministic(client, tailored, facts):
    """No model call, so the editor can re-score on every keystroke."""
    payload = {
        "tailored": tailored.model_dump(mode="json"),
        "facts": facts.model_dump(mode="json"),
        "job": {
            "company": "Acme",
            "title": "Backend Engineer",
            "keywords": [
                {"term": "Node.js", "variants": ["NodeJS"], "weight": 5},
                {"term": "Kubernetes", "variants": [], "weight": 3},
            ],
        },
    }
    first = client.post("/api/score", json=payload)
    assert first.status_code == 200
    second = client.post("/api/score", json=payload)
    assert first.json() == second.json()
    assert "Kubernetes" in first.json()["missing_keywords"]


def test_adding_a_skill_moves_the_score(client, tailored, facts):
    """What makes one-click adding worth building: the number responds."""
    job = {
        "company": "Acme",
        "title": "Backend Engineer",
        "keywords": [{"term": "Kubernetes", "variants": [], "weight": 5}],
    }
    before = client.post(
        "/api/score",
        json={
            "tailored": tailored.model_dump(mode="json"),
            "facts": facts.model_dump(mode="json"),
            "job": job,
        },
    ).json()

    with_skill = tailored.model_dump(mode="json")
    with_skill["skills"][0]["items"].append("Kubernetes")
    after = client.post(
        "/api/score",
        json={"tailored": with_skill, "facts": facts.model_dump(mode="json"), "job": job},
    ).json()

    assert after["sub_scores"]["keyword_match"] > before["sub_scores"]["keyword_match"]


# --------------------------------------------------------------------------- #
# The document service surface                                                 #
# --------------------------------------------------------------------------- #
#
# These two endpoints are what survives when the pipeline moves to the web app.
# Everything that touches a binary format or a browser stays here; the
# orchestration leaves. So they are the contract, and they get tested as one.

SMALL_PAGE = (
    "<!doctype html><html><head><style>@page{size:A4;margin:0}"
    "body{margin:0;font-family:Helvetica,Arial,sans-serif}"
    ".p{padding:.6in}</style></head><body><div class='p'>"
    "<h1>Rohan Iyer</h1><p>Backend Engineer, Pune</p>"
    "<ul><li>Built settlement APIs in Node.js</li></ul>"
    "</div></body></html>"
)


@pytest.mark.slow
def test_html_render_returns_a_pdf_with_measured_headers(client):
    response = client.post(
        "/api/render/html", json={"html": SMALL_PAGE, "filename": "rohan.pdf"}
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    assert 'filename="rohan.pdf"' in response.headers["content-disposition"]
    # The page count is measured after the fact rather than predicted, because
    # the density ladder above this needs an answer it can act on.
    assert response.headers["x-render-pages"] == "1"
    assert response.headers["x-render-fitted"] == "1"


def test_html_render_refuses_an_empty_document(client):
    assert client.post("/api/render/html", json={"html": ""}).status_code == 422


def test_html_render_caps_the_payload(client):
    """A resume is a few tens of kilobytes. Four megabytes is a mistake."""
    huge = "<p>x</p>" * 600_000
    assert client.post("/api/render/html", json={"html": huge}).status_code == 422


@pytest.mark.slow
def test_a_filename_cannot_inject_a_header(client):
    """Content-Disposition is a header, so a newline here is response splitting."""
    response = client.post(
        "/api/render/html",
        json={"html": SMALL_PAGE, "filename": "ok\r\nX-Evil: yes"},
    )

    assert response.status_code == 200
    assert "X-Evil" not in response.headers
    assert "\n" not in response.headers["content-disposition"]


def test_guard_passes_an_honest_rewrite(client, facts, tailored):
    response = client.post(
        "/api/guard",
        json={
            "tailored": tailored.model_dump(mode="json"),
            "facts": facts.model_dump(mode="json"),
            "raw_resume_text": "",
            "entailment": False,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is True
    assert body["error_count"] == 0


def test_guard_catches_a_relocated_figure(client, facts, tailored):
    """The endpoint carries the rule, not just the call.

    45% belongs to the caching work in E1.B2. Claiming it for the API work in
    E1.B1 is the fabrication this whole product exists to refuse, and it has
    to be refused over HTTP as well as in process.
    """
    draft = tailored.model_dump(mode="json")
    draft["experience"][0]["bullets"].append(
        {
            "text": "Shipped settlement endpoints, lifting throughput by 45%.",
            "source_ids": ["E1.B1"],
            "keywords": [],
        }
    )

    response = client.post(
        "/api/guard",
        json={
            "tailored": draft,
            "facts": facts.model_dump(mode="json"),
            "raw_resume_text": "",
            "entailment": False,
        },
    )

    body = response.json()
    assert body["passed"] is False
    assert "UNSOURCED_METRIC" in {v["code"] for v in body["violations"]}


def test_guard_does_not_call_a_model_unless_asked(client, facts, tailored, monkeypatch):
    """Entailment costs a call. The default must be free.

    The caller knows whether it is verifying a finished draft or a single line
    somebody just typed, and only one of those is worth paying for.
    """
    from atsresume.truth import entailment

    def explode(*_args, **_kwargs):
        raise AssertionError("entailment ran without being asked for")

    monkeypatch.setattr(entailment, "structured", explode)

    response = client.post(
        "/api/guard",
        json={
            "tailored": tailored.model_dump(mode="json"),
            "facts": facts.model_dump(mode="json"),
        },
    )
    assert response.status_code == 200
