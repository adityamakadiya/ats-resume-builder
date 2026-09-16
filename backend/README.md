# ATS Resume Builder — backend

Takes a resume and one job description, and produces a tailored, ATS-clean PDF
using only what the resume already says.

Three parts, three endpoints:

| Part | Endpoint | What it does |
|---|---|---|
| 1. Read the resume | `POST /api/resume/parse` | PDF/DOCX/text → structured facts with stable ids |
| 2. Read the posting and tailor | `POST /api/jd/fetch`, `POST /api/run` | URL or pasted text → decomposed posting → rewritten resume → verified |
| 3. Render | `POST /api/render` | Tailored resume → single-column PDF via rendercv |

`GET /health` reports whether a key is configured. Interactive docs at `/docs`.

## The part that matters

Any model asked to optimise a resume for a posting will drift into adding the
keywords the posting asks for. That is what gets a candidate caught in an
interview, and asking the model nicely is not a control.

So truthfulness is enforced after generation, in code. Every rewritten line
cites the ids of the facts it derives from, and `truth/guard.py` checks each
one against the original text:

| Code | Catches |
|---|---|
| `UNSOURCED_LINE` / `UNKNOWN_SOURCE_ID` | A line with no traceable origin |
| `UNSOURCED_METRIC` | A figure that was not in the uploaded resume |
| `UNSOURCED_TECH` | A technology the candidate never claimed |
| `ALTERED_EMPLOYER_FACT` | A changed company, title, or employment date |

A failing draft goes back to the model once, with the specific violations. Once,
not in a loop: a loop that pushes until the guard passes is an optimiser
applying pressure toward whatever wording slips past it, which is the opposite
of the point. A second failure is reported to the candidate instead of shipped.

The watched vocabulary is the built-in technology list **plus the posting's own
terms**, so the words a given application is judged on are always covered.

## The score is computed, not asked

`pipeline/scoring.py` calculates the ATS score in code:

```
overall = 0.45·keyword_match + 0.25·skills_coverage
        + 0.15·section_completeness + 0.15·experience_match
```

A number the model invents drifts between runs, cannot be regression-tested, and
cannot be explained when it moves from 70 to 74. This one is reproducible and
every point traces to a term. The model is still asked for the *judgement* —
whether to apply, what to say in an interview — which is what it is good at.

## Reading a resume

`ingest/pdf_layout.py` reads geometry, not just characters. A two-column resume
whose PDF was written row by row — what Word tables and HTML-to-PDF converters
produce — interleaves under naive extraction, giving `"JavaScript Backend
Engineer at Acme TypeScript"`. Every downstream fact is then wrong, and no
later check can catch it because the nonsense genuinely is in the text.

So columns are found with an occupancy histogram and read in isolation. This is
a correctness requirement, not a formatting nicety, and it is also the most
common reason real ATS mis-parse a resume.

Hyphenation is repaired on the way out: `mod-\nules` becomes `modules`, while
`exponential-\nbackoff` keeps its hyphen.

## Job descriptions

Measured, not assumed:

| Source | Result |
|---|---|
| Greenhouse, Lever, Workday, careers pages | schema.org `JobPosting` JSON-LD — works |
| LinkedIn | login shell on `/jobs/view/`; the guest endpoint returns the full text |
| Naukri | every server route is captcha-gated (406) — refused fast, paste instead |
| Client-rendered pages | Playwright fallback |

Playwright fixes pages that are merely client-rendered. It does not defeat a
login wall or a captcha, and nothing here pretends otherwise.

Note that LinkedIn's `robots.txt` disallows `/jobs-guest/`. This is a
single-URL fetch on the candidate's behalf, never a crawl. Set
`ENABLE_PLAYWRIGHT_FALLBACK=false` and avoid that path in a hosted deployment.

## Running it

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -e ".[dev]"
cp .env.example .env.local        # add your ANTHROPIC_API_KEY
./.venv/bin/playwright install chromium   # optional, for the fallback

./.venv/bin/uvicorn atsresume.api:app --reload --port 8000
```

## Tests

```bash
./.venv/bin/python -m pytest          # 101 tests, no API calls, free
./.venv/bin/python -m pytest -m slow  # includes real rendercv subprocess renders
```

Nothing in the default suite calls the Anthropic API. Tests marked `live` are
deselected by default because they cost money.

The suite asserts the things that would otherwise fail silently: that a
two-column PDF is read column-wise (and that the naive read really does
interleave, so the fixture still reproduces the problem), that an invented
metric or technology is caught, that a promoted job title is caught, that
substring matches like "Go" in "Google" are rejected, and that the rendered PDF
comes back single-column with no broken words when read through this project's
own reader.

## Cost and latency

Set `PROFILE` in `.env.local`. Measured on a one-page resume against a long
posting:

| Profile | Wall clock | Cost | Rewrite runs on |
|---|---|---|---|
| `fast` | ~2 min | ~$0.25 | Opus, medium effort |
| `balanced` (default) | **2 to 3 min** | **~$0.40** | Opus, high effort |
| `thorough` | ~6 min | ~$2.00 | Opus, xhigh effort |

Four of the five model calls are mechanical - extracting facts, decomposing a
posting, comparing two structured objects, writing advice about an
already-computed score - and run on Sonnet. The rewrite stays on Opus in every
profile, because it is the step that decides whether the resume passes a screen.

Two measurements worth recording, because both contradicted the obvious guess:

- Putting the **rewrite** on Sonnet made the pipeline *slower*, not faster: 167s
  for that step against Opus's 92s, because Sonnet spends longer thinking on it.
  `fast` therefore keeps Opus and lowers effort instead.
- The **gap analysis** was the real bottleneck at 92s on high effort. It is pure
  reasoning over two JSON objects and reads almost the same at medium, which is
  where most of the wall clock came back.

Resume facts are cached on disk by a hash of the extracted text, so the second
posting you run against the same resume skips extraction entirely (~25s and a
model call). `CACHE_FACTS=false` disables it.

## Known limits

- **No progress streaming inside a step.** The client gets real progress across
  the four calls, but a single call is opaque while it runs.
- **The repair round fires on roughly half of runs**, which adds an Opus call.
  It is usually the model citing a source id that does not exist.
- **`total_years_experience`** is inferred by the model from dates and is
  occasionally off by a few months, which moves `experience_match`.
- **Format preservation is out of scope here.** This backend renders the
  ATS-optimised layout only. The preservation work (DOCX exact text-swap, PDF
  style rebuild) lives in the TypeScript tree.

## Playwright browser

The Python package is installed with the dependencies; the browser binary is a
separate download and the fallback is skipped cleanly without it:

```bash
./.venv/bin/playwright install chromium
```

## Typography

Everything the model writes goes through `pipeline/sanitize.py` before the truth
guard sees it, so the guard verifies exactly what will be rendered.

The em dash is the clearest signal that a document was machine-drafted, and a
recruiter who spots one in a bullet has a reason to discount the rest. Models
reach for them constantly and an instruction alone does not reliably stop it, so
they are removed in code: spaced dashes become commas, tight ones become
hyphens, and the headline uses a pipe. Smart quotes, ellipsis characters and
non-breaking spaces go too, because keyword matching against non-ASCII is
inconsistent across parsers.
