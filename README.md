# ATS Resume Builder

Takes a resume you already have and a job description you are applying to, and
produces a tailored resume — **in your own format** — without inventing anything.

There is no resume template here and no stock content. The uploaded resume is
the only source of material; the app reorders it, reframes it in the job
description's own terminology, and reports what it could not truthfully claim.

## Two things this gets right that most tools do not

### 1. It cannot fabricate

Any model asked to "optimise a resume for this JD" will drift into adding the
keywords the JD wants. That is what gets a candidate caught in an interview.

Truthfulness is therefore enforced after generation, in code, not requested in a
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

The vocabulary the guard watches is the built-in technology list **plus this job
description's own terms**, so the words a given application is judged on are
always covered — a static list cannot know about whatever shipped last quarter.

### 2. It reads columns

A two-column resume whose PDF was written row by row — what Word tables and most
HTML-to-PDF converters produce — interleaves under naive text extraction. The
sidebar fuses with the body and you get `"JavaScript Backend Engineer at Acme
TypeScript"`. Every downstream fact is then garbage, and the truth guard cannot
help, because the garbage genuinely *is* in the source text.

`src/lib/ingest/layout.ts` finds the gutter with an occupancy histogram, reads
each column top to bottom in isolation, and only then joins them. This is a
correctness requirement, not a formatting nicety — and it is also the single
most common reason real ATS systems mis-parse a resume.

## Format preservation

How faithfully the original can be reproduced depends entirely on what you
upload, and the UI says which one you got:

| Upload | Mode | What happens | Fidelity |
|---|---|---|---|
| **DOCX** | `preserve-exact` | New text is written into the same `<w:p>` nodes in `word/document.xml`, then LibreOffice converts to PDF | **Your actual file.** Fonts, indents, spacing, tables untouched |
| **PDF** | `preserve-visual` | The style is measured (page, margins, type ladder, accent colour, bullet glyph, columns) and the layout rebuilt | Looks like yours. Is not your file |
| TXT / MD | — | Nothing to preserve | ATS layout only |

**Upload the .docx if you have one.** A PDF stores positioned glyphs, not
paragraphs, and the rewritten bullets are a different length — there is no
reflow engine to absorb the difference, so the layout has to be rebuilt. Anyone
claiming byte-exact PDF text replacement for a resume rewrite is overselling.

Every run offers both outputs, because they serve different readers: your own
format for a human or an email, the ATS layout for a portal that parses
mechanically. If your resume uses two columns, the ATS layout is a genuine
upgrade rather than a compromise — it may be the first version a parser reads
correctly.

DOCX→PDF needs LibreOffice (`brew install --cask libreoffice`). Without it you
still get the edited `.docx`, which is the more useful artefact anyway.

## Pipeline

```
resume (PDF/DOCX/TXT) ─→ layout-aware ingest ─┬─→ rawText ─→ extract facts (ids) ─┐
                                              ├─→ StyleProfile (PDF)              │
                                              └─→ paragraph index (DOCX)          │
job URL or pasted text ──────────────────────────→ decompose JD ──────────────────┤
                                                                                  ▼
                                                                          gap analysis
                                                                                  │
                                                                    tailor ←───────┘
                                                                       │
                                                        truth guard ──(fail)──→ repair once
                                                                       │
                                        ┌──────────────────────────────┴───────────┐
                                        ▼                                          ▼
                              preserve (exact / visual)                    ATS-optimised PDF
                                        └──────────────┬───────────────────────────┘
                                                       ▼
                                          score + strategy + fidelity report
```

| Step | File |
|---|---|
| Ingest dispatch | `src/lib/ingest/index.ts` |
| PDF layout + style profile | `src/lib/ingest/layout.ts` |
| DOCX paragraph index + writer | `src/lib/ingest/docx-layout.ts` |
| JD URL → text | `src/lib/ingest/jd-fetch.ts` |
| Schemas | `src/lib/schemas.ts` |
| Prompts | `src/lib/pipeline/prompts.ts` |
| Orchestration | `src/lib/pipeline/index.ts` |
| Truth guard | `src/lib/truth/guard.ts` |
| Exact preservation | `src/lib/render/preserve-docx.ts` |
| Visual preservation | `src/lib/pdf/styled-pdf.tsx` |
| ATS layout | `src/lib/pdf/resume-pdf.tsx` |

The model is never told about paragraphs. Fact extraction copies bullets
verbatim, so each fact is matched back to its source paragraph deterministically
in `mapFactsToParagraphs`. Putting a formatting concern into a content prompt
would have made it one more thing that can be hallucinated.

## On job description URLs

Careers pages and ATS-hosted postings (Greenhouse, Lever, Workday) usually
publish schema.org `JobPosting` JSON-LD, which is read directly.

LinkedIn and Naukri serve a sign-in wall or a client-rendered shell to a
server-side fetch; Naukri's API additionally requires a browser-generated
anti-bot token. The fetcher detects this and returns `needsJdPaste` rather than
analysing a login page and reporting a confident score for it. Paste the
description instead.

## Running it

```bash
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm install
npm run dev
```

## Tests

```bash
npm run smoke         # truth guard — offline, free
npm run layout-check  # column detection, hyphenation, style profile, DOCX mapping — offline, free
npm run pdf-check     # /api/pdf end to end; needs a server on :3210
```

`smoke` asserts an honest rewrite passes and a fabricated one is caught on all
three axes. `layout-check` builds a two-column PDF whose content stream is
written row by row and asserts the column-aware read keeps each column intact
where the naive read interleaves. `pdf-check` asserts the rendered PDF has an
extractable text layer in reading order.

## Known limits

- **Request duration.** A full run measured ~207s on a one-page resume. Vercel
  caps a serverless function at 300s (Pro), so a long resume against a long JD
  can exceed it. Reliable hosting needs the pipeline behind a job queue with the
  client polling.
- **No caching.** The same resume against ten jobs re-extracts ten times.
- **DOCX tables are not rewritten.** Replacing text inside a `<w:tbl>` cell
  reflows the cell, so those paragraphs are skipped and reported.
- **A split bullet has nowhere to go.** If the rewrite turns one original bullet
  into two, only the first is placed in exact-preserve mode; the rest are
  reported as unplaced.

## Scoring

The ATS score is an expert estimate of how the resume performs through a
keyword-and-parse screen plus a recruiter's first pass. It is not a reading
from any commercial ATS product, and nothing here claims to be one.
