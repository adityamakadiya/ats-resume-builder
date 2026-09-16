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
    assert "model" in body


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
