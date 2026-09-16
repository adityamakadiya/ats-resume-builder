"""JD fetching.

The network is mocked so the suite is deterministic and free. What is asserted
here is the decision-making: which portal, which extraction path, and — most
importantly — refusing to treat a login wall as a job description. Reporting a
confident match against a sign-in page is worse than reporting nothing.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from atsresume.ingest.jd import (
    JdFetchError,
    clamp_jd_text,
    fetch_jd,
    linkedin_job_id,
    portal_of,
)

JD_BODY = (
    "We are looking for a Backend Engineer with 2-4 years of experience. "
    "Must have: strong Node.js and TypeScript, RESTful APIs in production, "
    "solid PostgreSQL including query optimisation and indexing, caching with Redis, "
    "background job processing, authentication with OAuth2 and JWT, Docker and CI/CD. "
    "Good to have: AWS (ECS, S3, SQS), Kafka, Prometheus and Grafana, payments domain. "
    "Responsibilities: design build and own backend services end to end including on-call, "
    "optimise database access patterns and API latency under load, write tests, "
    "participate in code review, partner with product and frontend engineers. "
) * 3


def json_ld_page(description: str) -> str:
    return f"""<html><head>
    <script type="application/ld+json">
    {{"@context":"https://schema.org","@type":"JobPosting",
      "title":"Backend Engineer","hiringOrganization":{{"name":"Acme Payments"}},
      "employmentType":"FULL_TIME","datePosted":"2026-09-01",
      "description":"<p>{description}</p>"}}
    </script></head><body><div>nav junk</div></body></html>"""


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.linkedin.com/jobs/view/4395109023/", "LinkedIn"),
        ("https://www.naukri.com/job-listings-backend-1234", "Naukri"),
        ("https://boards.greenhouse.io/acme/jobs/1", "Greenhouse"),
        ("https://jobs.lever.co/acme/1", "Lever"),
        ("https://acme.wd1.myworkdayjobs.com/x", "Workday"),
        ("https://careers.acme.com/job/1", "careers.acme.com"),
    ],
)
def test_portal_detection(url, expected):
    assert portal_of(url) == expected


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.linkedin.com/jobs/view/4395109023/", "4395109023"),
        ("https://www.linkedin.com/jobs/view/backend-engineer-at-acme-4395109023", "4395109023"),
        ("https://www.linkedin.com/jobs/search/?currentJobId=4465647580", "4465647580"),
        ("https://www.linkedin.com/feed/", ""),
    ],
)
def test_linkedin_job_id_extraction(url, expected):
    assert linkedin_job_id(url) == expected


@respx.mock
def test_json_ld_is_preferred_over_the_rendered_dom():
    url = "https://boards.greenhouse.io/acme/jobs/1"
    respx.get(url).mock(return_value=httpx.Response(200, html=json_ld_page(JD_BODY)))

    result = fetch_jd(url)
    assert not result.blocked
    assert result.method == "json-ld"
    assert "Acme Payments" in result.text
    assert "nav junk" not in result.text


@respx.mock
def test_linkedin_uses_the_guest_endpoint():
    url = "https://www.linkedin.com/jobs/view/4395109023/"
    guest = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4395109023"
    respx.get(guest).mock(
        return_value=httpx.Response(200, html=f"<div class='description'>{JD_BODY}</div>")
    )

    result = fetch_jd(url)
    assert result.method == "linkedin-guest"
    assert "Backend Engineer" in result.text


@respx.mock
def test_linkedin_falls_through_when_the_guest_endpoint_fails():
    url = "https://www.linkedin.com/jobs/view/4395109023/"
    respx.get("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4395109023").mock(
        return_value=httpx.Response(404)
    )
    respx.get(url).mock(
        return_value=httpx.Response(200, html="<html><body>Sign in to continue</body></html>")
    )

    result = fetch_jd(url)
    assert result.blocked
    assert "sign-in" in result.block_reason


def test_naukri_is_refused_without_a_request():
    """Every server-side Naukri route is captcha-gated, so failing fast beats a
    slow timeout that ends in the same place."""
    result = fetch_jd("https://www.naukri.com/job-listings-backend-engineer-1234")
    assert result.blocked
    assert result.method == "refused"
    assert "paste" in result.block_reason.lower()


@respx.mock
def test_a_login_wall_is_not_mistaken_for_a_posting():
    url = "https://example.com/job/1"
    respx.get(url).mock(
        return_value=httpx.Response(
            200, html="<html><body>" + ("Please enable JavaScript. " * 200) + "</body></html>"
        )
    )
    result = fetch_jd(url)
    assert result.blocked


@respx.mock
def test_a_thin_page_is_not_mistaken_for_a_posting(monkeypatch):
    from atsresume import config

    monkeypatch.setattr(config.get_settings(), "enable_playwright_fallback", False)
    url = "https://example.com/job/2"
    respx.get(url).mock(return_value=httpx.Response(200, html="<html><body>Loading…</body></html>"))
    assert fetch_jd(url).blocked


@respx.mock
def test_http_error_is_reported_not_raised():
    url = "https://example.com/job/3"
    respx.get(url).mock(return_value=httpx.Response(503))
    result = fetch_jd(url)
    assert result.blocked
    assert "503" in result.block_reason


def test_bad_url_is_rejected():
    with pytest.raises(JdFetchError):
        fetch_jd("not-a-url")


def test_clamp_rejects_a_stub():
    with pytest.raises(JdFetchError, match="too short"):
        clamp_jd_text("Backend engineer wanted.")


def test_clamp_truncates_a_giant_posting():
    from atsresume.config import get_settings

    limit = get_settings().max_jd_chars
    assert len(clamp_jd_text("x" * (limit * 2))) == limit
