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

| Case | What it is for |
|---|---|
| `strong-match` | A backend engineer against a backend posting. Should score well. |
| `weak-match` | The same engineer against a computer-vision role. The honest answer is no, and nothing may be invented to close the gap. |
| `sparse-resume` | Vague bullets, no metrics, wrong stack. The highest fabrication pressure in the suite. |

Cases are synthetic on purpose. A real resume in a public repo is someone's
phone number in a public repo.

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
