# ATS Resume Builder

Takes a resume you already have and a job description you are applying to, and
produces a tailored, ATS-readable PDF — without inventing anything.

There is no resume template here and no stock content. The uploaded resume is
the only source of material; the app reorders it, reframes it in the job
description's own terminology, and reports what it could not truthfully claim.

## Why the truth guard exists

Any model asked to "optimise a resume for this JD" will drift into adding the
keywords the JD wants. That is what gets a candidate caught in an interview.

So truthfulness is enforced after generation, in code, not requested in a
prompt. Every rewritten line carries the ids of the resume facts it came from,
and `src/lib/truth/guard.ts` checks each one against the original text:

| Check | Catches |
|---|---|
| `UNSOURCED_LINE` / `UNKNOWN_SOURCE_ID` | A line with no traceable origin |
| `UNSOURCED_METRIC` | A figure that was not in the uploaded resume |
| `UNSOURCED_TECH` | A technology the candidate never claimed |
| `ALTERED_EMPLOYER_FACT` | A changed company, title, or employment date |

A draft that fails goes back to the model once with the specific violations. If
the second draft still fails, the offending lines are shown to the candidate
rather than quietly shipped.

## Pipeline

```
resume (PDF/DOCX/TXT) ─┐
                       ├─→ extract facts (ids) ─┐
job URL or pasted text ┴─→ decompose JD ────────┴─→ gap analysis
                                                        │
                                          tailor ←──────┘
                                             │
                                     truth guard ──(fail)──→ repair once
                                             │
                                  score + strategy → ATS PDF
```

| Step | File |
|---|---|
| Resume → text | `src/lib/ingest/resume-text.ts` |
| JD URL → text | `src/lib/ingest/jd-fetch.ts` |
| Schemas | `src/lib/schemas.ts` |
| Prompts | `src/lib/pipeline/prompts.ts` |
| Orchestration | `src/lib/pipeline/index.ts` |
| Truth guard | `src/lib/truth/guard.ts` |
| PDF | `src/lib/pdf/resume-pdf.tsx` |

## On job description URLs

Careers pages and ATS-hosted postings (Greenhouse, Lever, Workday) usually
publish schema.org `JobPosting` JSON-LD, which is read directly.

LinkedIn and Naukri frequently serve a sign-in wall or a client-rendered shell
to a server-side fetch. The fetcher detects that and returns `needsJdPaste`
instead of analysing a login page and reporting a confident score for it. The UI
then asks for the description to be pasted.

## PDF choices

All of these are ATS-parsing decisions, not styling ones: Helvetica (a PDF
base-14 font, so the text layer extracts as real text), one linear column with
nothing side by side (so extraction order is reading order), conventional
section headings that keyword parsers segment on, and no tables, text boxes,
icons, logos or background graphics.

## Running it

```bash
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm install
npm run dev
```

## Tests

```bash
npm run smoke       # truth guard, offline — no API calls, free to run
npm run pdf-check   # /api/pdf end to end; needs a server on :3210
```

`smoke` asserts that an honest rewrite passes and that a fabricated one is
caught on all three axes. `pdf-check` asserts the rendered PDF has an
extractable text layer in reading order.

## Scoring

The ATS score is an expert estimate of how the resume performs through a
keyword-and-parse screen plus a recruiter's first pass. It is not a reading
from any commercial ATS product, and nothing here claims to be one.
