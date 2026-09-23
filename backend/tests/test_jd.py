"""JD fetching.

The network is mocked so the suite is deterministic and free. What is asserted
here is the decision-making: which portal, which extraction path, and — most
importantly — refusing to treat a login wall as a job description. Reporting a
confident match against a sign-in page is worse than reporting nothing.
"""

from __future__ import annotations

import socket

import httpx
import pytest
import respx

from atsresume.ingest.jd import (
    MAX_BODY_BYTES,
    MAX_REDIRECTS,
    JdFetchError,
    clamp_jd_text,
    fetch_jd,
    linkedin_job_id,
    portal_of,
)
from atsresume.ingest.net import (
    BlockedAddressError,
    UnresolvableHostError,
    assert_public_host,
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


READER = "https://r.jina.ai/"


def reader_body(description: str) -> str:
    return f"Title: Backend Engineer at Acme\n\nURL Source: x\n\nMarkdown Content:\n{description}"


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
    respx.get(f"https://r.jina.ai/{url}").mock(return_value=httpx.Response(451))

    result = fetch_jd(url)
    assert result.blocked
    assert "sign-in" in result.block_reason


@respx.mock
def test_naukri_never_gets_a_direct_request():
    """Every server-side Naukri route is captcha-gated, so the direct attempt is
    pure latency. Nothing should be sent to naukri.com at all."""
    url = "https://www.naukri.com/job-listings-backend-engineer-1234"
    direct = respx.get(url).mock(return_value=httpx.Response(200, html="<html></html>"))
    respx.get(f"https://r.jina.ai/{url}").mock(
        return_value=httpx.Response(200, text=reader_body(JD_BODY))
    )
    assert not fetch_jd(url).blocked
    assert not direct.called


@respx.mock
def test_a_login_wall_is_not_mistaken_for_a_posting():
    url = "https://example.com/job/1"
    respx.get(url).mock(
        return_value=httpx.Response(
            200, html="<html><body>" + ("Please enable JavaScript. " * 200) + "</body></html>"
        )
    )
    respx.get(f"https://r.jina.ai/{url}").mock(return_value=httpx.Response(451))
    result = fetch_jd(url)
    assert result.blocked


@respx.mock
def test_a_thin_page_is_not_mistaken_for_a_posting(monkeypatch):
    from atsresume import config

    monkeypatch.setattr(config.get_settings(), "enable_playwright_fallback", False)
    url = "https://example.com/job/2"
    respx.get(url).mock(return_value=httpx.Response(200, html="<html><body>Loading…</body></html>"))
    respx.get(f"https://r.jina.ai/{url}").mock(return_value=httpx.Response(451))
    assert fetch_jd(url).blocked


@respx.mock
def test_http_error_is_reported_not_raised():
    url = "https://example.com/job/3"
    respx.get(url).mock(return_value=httpx.Response(503))
    # The reader is tried on an HTTP error too; when it also fails, the original
    # status is still what the candidate is told.
    respx.get(f"{READER}{url}").mock(return_value=httpx.Response(502))
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


@respx.mock
def test_naukri_goes_straight_to_the_reader():
    """Naukri refuses every request this process can make, so the direct attempt
    is pure latency. The reader renders it elsewhere and it comes back."""
    url = "https://www.naukri.com/job-listings-backend-engineer-1234"
    respx.get(f"{READER}{url}").mock(return_value=httpx.Response(200, text=reader_body(JD_BODY)))

    result = fetch_jd(url)
    assert not result.blocked
    assert result.method == "reader"
    assert "Node.js" in result.text
    # The reader's own preamble must not reach the model.
    assert "Markdown Content:" not in result.text


@respx.mock
def test_the_reader_does_not_get_a_spoofed_user_agent():
    """It answers 403 to anything impersonating a browser, which is a reasonable
    anti-abuse rule and the exact opposite of what the job sites want."""
    url = "https://www.naukri.com/job-listings-backend-1"
    route = respx.get(f"{READER}{url}").mock(
        return_value=httpx.Response(200, text=reader_body(JD_BODY))
    )
    fetch_jd(url)
    sent = route.calls.last.request.headers["user-agent"]
    assert "Mozilla" not in sent and "Chrome" not in sent
    assert "atsresume" in sent


@respx.mock
def test_a_reader_200_carrying_a_search_page_is_still_a_failure():
    """The reader returns 200 whatever the site served. A dead Naukri link comes
    back as its generic listing page, and trusting the status code would turn a
    broken link into a confident analysis of search results."""
    url = "https://www.naukri.com/job-listings-gone-999"
    respx.get(f"{READER}{url}").mock(
        return_value=httpx.Response(
            200, text=reader_body("Jobs In India - 119168 Job Vacancies In India. " * 60)
        )
    )
    assert fetch_jd(url).blocked


@respx.mock
def test_reader_rescues_a_client_rendered_page():
    url = "https://careers.example.com/job/1"
    respx.get(url).mock(return_value=httpx.Response(200, html="<html><body>Loading…</body></html>"))
    respx.get(f"{READER}{url}").mock(return_value=httpx.Response(200, text=reader_body(JD_BODY)))

    result = fetch_jd(url)
    assert result.method == "reader"
    assert not result.blocked


@respx.mock
def test_reader_rate_limit_is_not_an_error(monkeypatch):
    from atsresume import config

    monkeypatch.setattr(config.get_settings(), "enable_playwright_fallback", False)
    url = "https://www.naukri.com/job-listings-busy-1"
    respx.get(f"{READER}{url}").mock(return_value=httpx.Response(429))
    result = fetch_jd(url)
    assert result.blocked
    assert "paste" in result.block_reason.lower()


@respx.mock
def test_the_reader_can_be_switched_off(monkeypatch):
    from atsresume import config

    monkeypatch.setattr(config.get_settings(), "use_reader_fallback", False)
    url = "https://www.naukri.com/job-listings-backend-2"
    route = respx.get(f"{READER}{url}").mock(
        return_value=httpx.Response(200, text=reader_body(JD_BODY))
    )
    result = fetch_jd(url)
    assert result.blocked
    assert not route.called, "no URL should leave the process when the reader is off"


@respx.mock
def test_an_http_refusal_still_tries_the_reader():
    """Indeed answers 401 and Glassdoor 403 to anything without a browser
    session, which is exactly when rendering elsewhere helps. Returning on the
    status code meant the reader never ran for the two portals most likely to
    need it."""
    url = "https://in.indeed.com/viewjob?jk=abc123"
    respx.get(url).mock(return_value=httpx.Response(401))
    respx.get(f"{READER}{url}").mock(return_value=httpx.Response(200, text=reader_body(JD_BODY)))

    result = fetch_jd(url)
    assert not result.blocked
    assert result.method == "reader"


@respx.mock
def test_a_cloudflare_challenge_is_not_a_job_description():
    """The reader renders the interstitial happily and returns 200, so the
    challenge page arrives looking exactly like a successful fetch."""
    url = "https://in.indeed.com/viewjob?jk=abc456"
    respx.get(url).mock(return_value=httpx.Response(401))
    respx.get(f"{READER}{url}").mock(
        return_value=httpx.Response(
            200,
            text=reader_body("Just a moment... Enable JavaScript and cookies to continue. " * 30),
        )
    )
    assert fetch_jd(url).blocked


# ---------------------------------------------------------------------------
# SSRF: a candidate-supplied URL must never reach the operator's own network.
# ---------------------------------------------------------------------------

PUBLIC_IP = "93.184.216.34"


def _fake_getaddrinfo(address: str):
    def resolver(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port or 0))]

    return resolver


@pytest.fixture(autouse=True)
def _dns_never_leaves_the_process(monkeypatch):
    """No test in this file may touch a real resolver.

    Every hostname used here resolves to one public address unless a test says
    otherwise, which keeps the suite deterministic and offline now that the
    fetch path resolves before it connects.
    """
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo(PUBLIC_IP))


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:8000/",
        "http://localhost/",
        "http://[::1]/",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.0.1/",
        "http://0.0.0.0/",
        "http://metadata.google.internal/",
        "http://[::ffff:169.254.169.254]/",
        "http://[64:ff9b::a9fe:a9fe]/",
        "http://[fd00::1]/",
        "http://[fe80::1]/",
        "http://intranet/",
        "http://wiki.internal/",
        "http://printer.local/",
    ],
)
@respx.mock
def test_private_and_metadata_addresses_are_refused(url):
    """Hosted, fetch_jd is an SSRF primitive unless every one of these is a
    flat refusal. The metadata endpoint hands out cloud credentials to anything
    that can make an HTTP request from inside the VPC.

    No route is registered, so respx raises on any request that is attempted:
    the refusal has to happen before a socket is opened, not after.
    """
    result = fetch_jd(url)
    assert result.blocked, url
    assert not respx.calls, f"a request was sent to {url}"


def test_a_blocked_address_is_a_handled_result_not_a_crash():
    result = fetch_jd("http://169.254.169.254/latest/meta-data/iam/")
    assert result.blocked
    assert result.text == ""
    assert "169.254.169.254" in result.block_reason


@respx.mock
def test_a_public_host_is_still_allowed():
    url = "https://careers.example.com/job/ok"
    respx.get(url).mock(return_value=httpx.Response(200, html=json_ld_page(JD_BODY)))
    result = fetch_jd(url)
    assert not result.blocked
    assert result.method == "json-ld"


def test_assert_public_host_returns_the_resolved_literals(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo("93.184.216.34"))
    assert assert_public_host("careers.example.com") == ["93.184.216.34"]


def test_a_public_name_that_resolves_privately_is_refused(monkeypatch):
    """The classic bypass: the name is public, the A record is not."""
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo("169.254.169.254"))
    with pytest.raises(BlockedAddressError):
        assert_public_host("evil.example.com")


@respx.mock
def test_a_redirect_into_the_private_network_is_blocked():
    """The subtle one. httpx following redirects internally meant a public URL
    that 302s to the metadata endpoint was fetched and returned, with the check
    on the original host satisfied. Every hop is validated before it is
    requested, so the second request is never made."""
    url = "https://careers.example.com/job/redirect"
    respx.get(url).mock(
        return_value=httpx.Response(302, headers={"Location": "http://169.254.169.254/"})
    )
    hop = respx.get("http://169.254.169.254/").mock(
        return_value=httpx.Response(200, html=json_ld_page(JD_BODY))
    )
    reader = respx.get(f"{READER}{url}").mock(return_value=httpx.Response(451))

    result = fetch_jd(url)
    assert result.blocked
    assert not hop.called, "the redirect target was fetched"
    assert not reader.called, "a blocked address must not be handed to a third party"
    assert "169.254.169.254" in result.block_reason


@respx.mock
def test_a_relative_redirect_is_resolved_and_followed():
    respx.get("https://careers.example.com/job/rel").mock(
        return_value=httpx.Response(301, headers={"Location": "/job/final"})
    )
    respx.get("https://careers.example.com/job/final").mock(
        return_value=httpx.Response(200, html=json_ld_page(JD_BODY))
    )
    result = fetch_jd("https://careers.example.com/job/rel")
    assert not result.blocked
    assert result.method == "json-ld"


@respx.mock
def test_a_redirect_loop_is_refused():
    url = "https://careers.example.com/loop"
    respx.get(url).mock(return_value=httpx.Response(302, headers={"Location": url}))
    respx.get(f"{READER}{url}").mock(return_value=httpx.Response(451))
    result = fetch_jd(url)
    assert result.blocked
    assert "redirects" in result.block_reason
    assert len(respx.calls) <= MAX_REDIRECTS + 1


@respx.mock
def test_a_declared_content_length_over_the_cap_is_refused():
    url = "https://careers.example.com/huge"
    respx.get(url).mock(
        return_value=httpx.Response(
            200,
            headers={"Content-Length": str(MAX_BODY_BYTES * 4), "Content-Type": "text/html"},
            content=b"<html></html>",
        )
    )
    result = fetch_jd(url)
    assert result.blocked
    assert "too large" in result.block_reason


@respx.mock
def test_a_streamed_body_past_the_cap_is_refused():
    """No Content-Length at all, so the only defence is counting bytes as they
    arrive and hanging up."""
    url = "https://careers.example.com/streamed"

    def chunks():
        for _ in range(MAX_BODY_BYTES // (256 * 1024) + 4):
            yield b"x" * (256 * 1024)

    respx.get(url).mock(return_value=httpx.Response(200, content=chunks()))
    result = fetch_jd(url)
    assert result.blocked
    assert "too large" in result.block_reason


@respx.mock
def test_a_body_under_the_cap_is_read_normally():
    url = "https://careers.example.com/job/normal"
    respx.get(url).mock(return_value=httpx.Response(200, html=json_ld_page(JD_BODY)))
    assert not fetch_jd(url).blocked


def test_a_host_that_does_not_resolve_is_a_clean_error(monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    result = fetch_jd("https://no-such-host.example/job/1")
    assert result.blocked
    assert "does not resolve" in result.block_reason


def test_unresolvable_host_raises_the_specific_subclass(monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror(-2, "Name or service not known")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(UnresolvableHostError):
        assert_public_host("no-such-host.example")
