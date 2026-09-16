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

        submit = page.get_by_role("button", name="Tailor", exact=True)
        check("submit is disabled before input", submit.is_disabled())

        page.locator("textarea").first.fill("Aditya Makadiya\nFull-stack engineer\n" + "x" * 300)
        page.locator('input[type="url"]').fill("https://boards.greenhouse.io/acme/jobs/1")
        check("submit enables once both inputs exist", submit.is_enabled())

        submit.click()
        page.wait_for_selector("text=Download PDF", timeout=30_000)

        # The document is the page, and it is editable on arrival.
        headline = page.get_by_label("Headline")
        check("lands directly in the editor", headline.count() == 1)
        check(
            "headline carries the rewrite",
            "Full Stack Engineer" in (headline.input_value() or ""),
        )
        check("score is on the rail", page.get_by_text("72", exact=True).count() >= 1)
        check("verified state is shown", page.get_by_text("Verified", exact=True).count() == 1)

        # Edit a bullet and confirm the edit is tracked and reaches the render.
        bullet = page.get_by_label("Role 1 bullet 1")
        bullet.fill("Hand edited bullet text for the export check.")
        page.wait_for_timeout(200)
        check("manual edit is counted", page.get_by_text("edited by you").count() == 1)

        # Add and remove a skill.
        add_skill = page.get_by_label("Add a skill to Backend")
        add_skill.fill("Prisma")
        add_skill.press("Enter")
        page.wait_for_timeout(150)
        # The chip is "Prisma ×", so an exact text match misses it; the chip's own
        # remove control is the unambiguous signal that it rendered.
        check("a skill can be added", page.get_by_label("Remove Prisma").count() == 1)
        page.get_by_label("Remove Express").click()
        page.wait_for_timeout(150)
        check("a skill can be removed", page.get_by_label("Remove Express").count() == 0)

        # Remove a bullet.
        before = page.get_by_label("Role 1 bullet 2").count()
        if before:
            page.get_by_label("Remove bullet 2").click()
            page.wait_for_timeout(150)
        check("a bullet can be removed", page.get_by_label("Role 1 bullet 2").count() == 0)

        # The render must receive the edited document, not the original draft.
        sent: dict = {}

        def capture(route):
            try:
                sent.update(route.request.post_data_json or {})
            except Exception:
                pass
            route.fulfill(
                status=200,
                content_type="application/pdf",
                headers={
                    **CORS,
                    "content-disposition": 'attachment; filename="Aditya-Makadiya-Resume-Acme-Payments.pdf"',
                    "x-render-warnings": "",
                },
                body=tiny_pdf(),
            )

        page.unroute(f"{API}/api/render")
        page.route(f"{API}/api/render", capture)

        with page.expect_download(timeout=15_000) as dl:
            page.get_by_role("button", name="Download PDF").click()
        check(
            "download uses the server filename",
            dl.value.suggested_filename == "Aditya-Makadiya-Resume-Acme-Payments.pdf",
            dl.value.suggested_filename,
        )

        rendered = json.dumps(sent.get("tailored", {}))
        check("the PDF is rendered from the EDITED document", "Hand edited bullet text" in rendered)
        check("removed skill is absent from the export", '"Express"' not in rendered)
        check("added skill is present in the export", '"Prisma"' in rendered)

        page.screenshot(path="/tmp/fe-results.png", full_page=True)
        check("no console errors", not console_errors, "; ".join(console_errors[:3]))

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
