# Evals

Every quality claim about this pipeline used to be a single anecdote. The ATS
score moved from 65 to 78 across a prompt change and there was no way to tell
whether that was the change or the weather.

```bash
./.venv/bin/python evals/run.py                        # all cases
./.venv/bin/python evals/run.py --case strong-match     # one
./.venv/bin/python evals/run.py --compare evals/baseline.json
./.venv/bin/python evals/run.py --save evals/baseline.json
```

This costs real money — about $0.20 per case — so it never runs in CI and never
runs by accident.

## The cases

Fifteen. The first three were the original suite and are kept because the
baseline in `baseline.json` is measured against them.

| Case | Seniority | Domain | Resume | Geography | JD difficulty |
|---|---|---|---|---|---|
| `strong-match` | mid | backend | metrics | India (Bengaluru) | strong |
| `weak-match` | mid | backend vs CV | metrics | India (Bengaluru) | weak |
| `sparse-resume` | mid | backend | terse, no metrics | India (Pune) | do not apply |
| `fresher-frontend-ahmedabad` | fresher | frontend | no metrics | India (Ahmedabad, GTU) | partial |
| `fresher-qa-automation` | fresher | QA | no metrics | India (Bengaluru, VTU) | strong |
| `mid-fullstack-remote-us` | mid | full-stack | rich metrics | US remote | strong |
| `mid-devops-sre-bengaluru` | mid | DevOps/SRE | rich metrics | India (Bengaluru) | strong |
| `mid-mobile-android-nometrics` | mid | mobile | no metrics | India (Pune) | partial |
| `mid-analyst-to-ml-stretch` | mid | data → ML | terse | US remote | weak/stretch |
| `mid-backend-python-verbose` | mid | backend | verbose, UK spelling | India (remote) | partial |
| `senior-backend-java-staff` | senior | backend | rich metrics | US | strong |
| `senior-frontend-twocolumn` | senior | frontend | rich metrics | US remote | partial |
| `senior-qa-vs-ml-research` | senior | QA vs ML research | verbose | US | do not apply |
| `changer-teacher-to-analyst` | career changer | data | no metrics | India (Ahmedabad) | weak/stretch |
| `changer-mech-gaps-devops` | career changer | DevOps | terse | India (Ahmedabad) | do not apply |

That distribution is deliberate rather than convenient:

- **Four cases have almost no metrics.** This is the common real resume and the
  one the product is most likely to embarrass itself on, because the only way
  to make those bullets impressive is to make something up.
- **Three cases are "do not apply".** `sparse-resume`,
  `senior-qa-vs-ml-research` and `changer-mech-gaps-devops` are pairings where
  the correct output is a low score and honest advice. Their expected score
  bands are low on purpose. A suite where every case is winnable measures
  nothing except how well the cases were chosen.
- **Four cases carry the awkward structures.** `senior-frontend-twocolumn` is
  text extracted from a two-column PDF, so the sidebar arrives before the
  experience and the dates are orphaned from their roles. `changer-mech-gaps-devops`
  has two employment gaps stated plainly. `changer-teacher-to-analyst` puts
  education first. `senior-qa-vs-ml-research` has a Publications section, which
  is the strongest available pull toward implying research credentials the
  candidate does not have.
- **Geography is mixed.** Ten India, five US or remote.
  B.E./B.Tech, GTU, VTU, Pune University and LPA figures are
  present because the product's first users are in India and a suite that is
  entirely American tests a product nobody is using.

Each case carries `expect_guard_pass` plus `expect_score_min` and
`expect_score_max`. The bands are set from what the pairing honestly supports,
not from what would make a run look good. `run.py` reads only
`expect_guard_pass`; the bands are there for a human reading a run and for the
ablation report.

Cases are synthetic on purpose. A real resume in a public repo is someone's
phone number in a public repo.

## Ablation: does each step earn its cost?

`run.py` answers "did this change help". `ablate.py` answers a harder question:
if a step were deleted, would anyone notice?

```bash
./.venv/bin/python evals/ablate.py                      # dry run: the plan and an estimate
./.venv/bin/python evals/ablate.py --cases 4            # a smaller plan
./.venv/bin/python evals/ablate.py --execute            # asks you to type the total first
./.venv/bin/python evals/ablate.py --execute --variants full,no_gaps --out ablation.json
```

Three variants run over every case:

| Variant | Pipeline | The claim it tests |
|---|---|---|
| `full` | extract → jd → gaps → tailor | the shipped behaviour, the baseline |
| `no_gaps` | extract → jd → tailor with an empty `GapAnalysis()` | the gap analysis step is load-bearing |
| `gaps_merged` | extract → jd → tailor, gap reasoning asked for inline | it is load-bearing *as a separate call* |

There is no `no_strategy` variant, and that is a finding rather than an
omission. `strategize()` is not in the measured path: `run_case` stops at
`compute_ats_report`, and nothing the strategy step returns feeds the tailored
resume or the score. Ablating it would report a delta of exactly zero on every
case and every metric, which is a tautology, not a measurement. If strategy
ever moves upstream of the rewrite, add the variant then.

Measured per variant per case: ATS score, guard passed, guard error count,
first-draft violation count, whether a repair fired, wall seconds, dollars, and
every structural scorer. Output is a markdown table on stdout and a JSON file
with per-variant means, the delta against `full`, and the recommendation.

**The recommendation rule**, stated once so it cannot drift: **DELETE** the step
if removing it costs under **2.0 mean score points** *and* does not reduce the
guard pass rate. Otherwise **KEEP**. The two conditions are not traded off
against each other. A variant that scores two points higher while letting one
more fabrication through is a worse product, and averaging those two facts into
a single number would hide the exact thing this harness exists to see.

Two details worth knowing before reading a result:

- **The two extractions run once per case and are shared across variants.** They
  are identical in all three, so paying for them three times would buy nothing
  but variance. Their cost is folded into each variant's total so the numbers
  stay comparable with `run.py`, and being shared, they cancel out of every
  delta.
- **`gaps_merged` keeps its own copy of the verify loop**, because it needs a
  different user message and `steps.py` should not carry a parameter that
  exists only for an experiment. That copy must include the entailment call as
  well as the token checks. An early version ran only the token checks, and the
  effect was not noise: the ablated variant was graded by a weaker guard than
  `full`, reported fewer violations, and the harness recommended deleting a step
  on the strength of a measurement error. If `verify` in `steps.py` changes,
  change it here too.

### Cost

The ablation spends real money, so the default spends none. `--dry-run` is the
default, `--execute` is required for any API call, passing both honours
`--dry-run`, and `--execute` prints the estimated total and will not proceed
until you type it back.

At 15 cases across all three variants the estimate is about **$13** on the
balanced profile: $1.80 for the shared extractions, then $4.20, $3.30 and $3.75
for the three variants. Treat it as a floor. The estimate assumes one tailor
call per variant and a case that needs a repair round costs roughly twice that
step.

## The scorers

Deterministic and free. A judge model grading a writer model is two unmeasured
things in a trenchcoat, and it cannot tell you whether a prompt change helped
without costing money to ask.

They check the tailoring prompt's own contract: never return a bullet unchanged,
never repeat an opening verb within a role, never use a banned opener, never
emit an em dash, keep every populated section, keep every employer.

`keyword_coverage` and `surfaced_twice` are **reported, never failed**. The first
run failed coverage on two of three cases and both were correct outputs — a
backend resume genuinely matches no computer-vision keywords, and inventing some
to pass would be the exact failure this project exists to prevent. A scorer must
measure the system, not the candidate.

## What the first run found

Four things, in one run, none of which the 123 unit tests could see:

- **Fact ids were matched case-sensitively.** The model writes `summary` as often
  as `SUMMARY`, and the mismatch bought a repair round for nothing.
- **The posting's word for the candidate's own work was rejected.** A resume
  saying "role-based access" against a posting saying "RBAC" is one claim. The
  prompt tells the model to prefer the posting's term and the guard was
  punishing it for obeying.
- **Word forms counted as fabrication.** "settlements" against "settlement",
  "containerization" against "Containerised", "webhook" against "webhooks".
- **Owning a tool was not claiming what it does.** A resume saying BullMQ has a
  job queue whether or not it writes the word.

Together those were rejecting the first draft on **every single case**. Fixing
them took `strong-match` from 153s and $0.310 to 85s and $0.180, and keyword
coverage from 8/18 to 11/18 — the rewrite scores better once it stops being
punished for using the posting's vocabulary.

## Reading a run

`guard pass` after `repaired` is the system working, not failing: the first
draft reached for something the candidate does not have, the guard stopped it,
and the rewrite came back honest. `weak-match` does this reliably — its first
draft claims computer vision, OpenCV, PyTorch and two years of experience, and
the second claims none of them.

A low `ats` on `weak-match` and `sparse-resume` is the correct answer. Those
candidates are not a fit, and the number saying so is the product being useful.
