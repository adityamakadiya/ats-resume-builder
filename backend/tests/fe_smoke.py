"""Frontend smoke check.

Drives the real UI with the API stubbed, so the whole client path — progress
rail, score, verification stamp, gaps, strategy, download — is exercised without
spending a cent of model time. Fixtures mirror the shapes the API actually
returns; if a field is renamed on the backend this fails the same way a user
would see it fail.

Run with both servers up:
    ./.venv/bin/python tests/fe_smoke.py
"""

from __future__ import annotations

import json
import sys

import pymupdf
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
API = "http://localhost:8000"

FACTS = {
    "contact": {
        "name": "Aditya Makadiya",
        "email": "aditya@example.com",
        "phone": "+91 97379 32872",
        "location": "Ahmedabad, India",
        "links": [{"label": "GitHub", "url": "https://github.com/adityamakadiya"}],
    },
    "headline": "Full-stack product engineer",
    "summary": "Full-stack product engineer who takes systems from requirement to production.",
    "experience": [
        {
            "id": "E1",
            "company": "Bacancy Technology",
            "title": "Software Engineer, Product Team",
            "location": "Ahmedabad, India",
            "start_date": "Jun 2025",
            "end_date": "Present",
            "bullets": [
                {"id": "E1.B1", "text": "Took the platform from zero to production in under 3 months."},
                {"id": "E1.B2", "text": "Architected multi-tenant isolation across 141 backend modules."},
            ],
            "tech": ["Node.js", "PostgreSQL", "Redis"],
        }
    ],
    "projects": [],
    "education": [],
    "skills": [{"id": "S1", "category": "Backend", "items": ["Node.js", "Express", "PostgreSQL"]}],
    "certifications": [],
    "other_sections": [],
    "total_years_experience": 1.5,
}

PARSE = {
    "source": {
        "kind": "pdf",
        "raw_text": "…",
        "page_count": 1,
        "style": {
            "page_width": 595.3,
            "page_height": 841.9,
            "column_count": 1,
            "font_sizes": {"name": 17.0, "heading": 12.0, "body": 10.0, "small": 9.0},
            "accent_color": "#00367b",
            "serif": True,
            "bullet_glyph": "•",
            "fonts": ["LMRoman10-Regular"],
        },
        "notes": [],
    },
    "facts": FACTS,
}

JD = {
    "text": "Senior Full Stack Engineer…" * 40,
    "portal": "Greenhouse",
    "method": "json-ld",
    "source_note": "Greenhouse via json-ld",
    "blocked": False,
    "block_reason": "",
}

TAILOR = {
    "job": {
        "company": "Acme Payments",
        "title": "Senior Full Stack Engineer",
        "location": "Bengaluru",
        "work_mode": "hybrid",
        "experience_years": {"min": 2, "max": 5, "raw": "2-5 years"},
        "requirements": [],
        "responsibilities": [],
        "keywords": [],
        "implicit_requirements": [],
        "extraction_confidence": "high",
        "extraction_notes": "",
    },
    "gaps": {
        "strong_matches": [],
        "partial_matches": [],
        "transferable": [],
        "missing": [
            {"jd_term": "Kubernetes", "severity": "significant", "note": "Not claimed anywhere on the resume."},
            {"jd_term": "Mentoring", "severity": "blocking", "note": "A Senior requisition screens on this."},
        ],
        "missing_keywords": ["Kubernetes", "Kafka"],
        "recoverable_keywords": ["Docker"],
        "recruiter_concerns": [
            "One year of experience against a stated two-year floor.",
            "Ahmedabad-based for a Bengaluru hybrid seat.",
        ],
        "ats_rejection_risks": [],
    },
    "tailored": {
        "headline": "Full Stack Engineer — TypeScript, Node.js, React",
        "summary": {
            "text": "Full-stack product engineer in TypeScript, working across Node.js REST API design and PostgreSQL.",
            "source_ids": ["SUMMARY", "E1.B1"],
        },
        "skills": [
            {"category": "Backend", "items": ["Node.js", "Express", "PostgreSQL"], "source_ids": ["S1"]}
        ],
        "experience": [
            {
                "source_id": "E1",
                "company": "Bacancy Technology",
                "title": "Software Engineer, Product Team",
                "location": "Ahmedabad, India",
                "start_date": "Jun 2025",
                "end_date": "Present",
                "bullets": [
                    {
                        "text": "Took a multi-tenant white-label SaaS from zero to production in under 3 months.",
                        "source_ids": ["E1.B1"],
                        "keywords": ["multi-tenant"],
                    },
                    {
                        "text": "Architected multi-tenant isolation across 141 backend modules with tenant-scoped queries.",
                        "source_ids": ["E1.B2"],
                        "keywords": ["PostgreSQL"],
                    },
                ],
            }
        ],
        "projects": [],
        "education": [],
        "certifications": [],
        "other_sections": [],
        "section_order": ["summary", "skills", "experience"],
        "rewrite_notes": ["Led with multi-tenancy because the posting opens on it."],
    },
    "truth": {"passed": True, "error_count": 0, "warning_count": 0, "violations": []},
    "report": {
        "overall": 71.6,
        "sub_scores": {
            "keyword_match": 76.6,
            "skills_coverage": 58.3,
            "section_completeness": 100.0,
            "experience_match": 50.0,
        },
        "matched_keywords": ["Node.js", "TypeScript", "PostgreSQL"],
        "missing_keywords": ["Kubernetes", "Kafka"],
        "recoverable_keywords": ["Docker"],
        "recommendations": [
            "Put Docker back — the original resume claims it and the rewrite dropped it.",
            "The posting asks for 2-5 years and the resume shows about 1.5.",
        ],
    },
    "strategy": {
        "should_apply": "yes_with_caveats",
        "fit_estimate": "Strong stack fit, weak seniority fit. Treat the portal as a formality and direct outreach as the real application.",
        "biggest_strength": "You have shipped the exact multi-tenant system this team is hiring someone to own.",
        "biggest_gap": "One year against a Senior requisition with a two-year floor.",
        "interview_emphasis": [
            "Open with the zero-to-production timeline.",
            "Have the tenant-isolation design ready to whiteboard.",
        ],
        "cover_letter_worthwhile": True,
        "cover_letter_rationale": "The seniority gap needs a sentence you control.",
        "outreach_angle": "Message the hiring manager about the settlement reconciliation work.",
        "top_improvements": [],
    },
    "repair_attempted": True,
}


def tiny_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Aditya Makadiya", fontsize=14)
    data = doc.tobytes()
    doc.close()
    return data


def main() -> int:
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"{'PASS' if ok else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")
        if not ok:
            failures.append(name)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 1200}, device_scale_factor=2)

        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        # A fulfilled route bypasses the real server, so the stub has to carry the
        # CORS headers the browser requires — including expose-headers, without
        # which the client cannot read the filename off the PDF response.
        CORS = {
            "access-control-allow-origin": BASE,
            "access-control-expose-headers": "Content-Disposition, X-Render-Warnings",
        }

        def stub(payload: dict):
            return lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                headers=CORS,
                body=json.dumps(payload),
            )

        page.route(f"{API}/api/resume/parse", stub(PARSE))
        page.route(f"{API}/api/jd/fetch", stub(JD))
        page.route(f"{API}/api/tailor", stub(TAILOR))
        page.route(
            f"{API}/api/render",
            lambda route: route.fulfill(
                status=200,
                content_type="application/pdf",
                headers={
                    **CORS,
                    "content-disposition": 'attachment; filename="Aditya-Makadiya-Resume-Acme-Payments.pdf"',
                    "x-render-warnings": "",
                },
                body=tiny_pdf(),
            ),
        )

        page.goto(BASE, wait_until="networkidle")

        # Submit stays disabled until both inputs are present.
        submit = page.get_by_role("button", name="Tailor and verify")
        check("submit is disabled before input", submit.is_disabled())

        page.locator("textarea").first.fill("Aditya Makadiya\nFull-stack engineer\n" + "x" * 300)
        page.locator('input[type="url"]').fill("https://boards.greenhouse.io/acme/jobs/1")
        check("submit enables once both inputs exist", submit.is_enabled())

        submit.click()
        page.wait_for_selector("text=The rewrite", timeout=30_000)

        check("score is rendered", "72" in page.locator("h2:has-text('Match') + div").inner_text()
              or page.get_by_text("72", exact=True).count() > 0)
        check("verification stamp shows verified", page.get_by_text("Verified", exact=True).count() == 1)
        check("repair note is surfaced", page.get_by_text("rejected and rewritten").count() == 1)
        check("recoverable keyword is called out", page.get_by_text("Already true, currently missing.").count() == 1)
        check("blocking gap is marked", page.get_by_text("blocking", exact=True).count() >= 1)
        check("verdict chip renders", page.get_by_text("Apply, with caveats").count() == 1)
        check("provenance trail is shown", page.get_by_text("← E1.B1").count() >= 1)
        check("run summary records the completed steps",
              page.get_by_text(f"{4} steps").count() == 1)

        with page.expect_download(timeout=15_000) as dl:
            page.get_by_role("button", name="Download PDF").click()
        check("download fires with the server filename",
              dl.value.suggested_filename == "Aditya-Makadiya-Resume-Acme-Payments.pdf",
              dl.value.suggested_filename)

        page.screenshot(path="/tmp/fe-results.png", full_page=True)
        check("no console errors", not console_errors, "; ".join(console_errors[:3]))

        # Mobile: nothing may overflow horizontally.
        page.set_viewport_size({"width": 390, "height": 900})
        page.wait_for_timeout(400)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        check("no horizontal overflow at 390px", overflow <= 1, f"{overflow}px")
        page.screenshot(path="/tmp/fe-mobile.png", full_page=True)

        browser.close()

    print("\nAll frontend checks passed." if not failures else f"\n{len(failures)} failed.")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
