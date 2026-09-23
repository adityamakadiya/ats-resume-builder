"""Ablation harness: does each pipeline step earn what it costs?

`evals/run.py` answers "did this change help". This answers a different and
more uncomfortable question: if we deleted a step entirely, would anyone be
able to tell? A step that survives because nobody has measured it is a step
that is being paid for out of superstition.

Three variants are measured over every case:

    full         extract -> jd -> gaps -> tailor          (current behaviour)
    no_gaps      extract -> jd -> tailor(GapAnalysis())   (the step is removed)
    gaps_merged  extract -> jd -> tailor(inline reasoning) (the step is folded
                 into the tailor prompt instead of being its own call)

`no_strategy` is deliberately absent. `strategize()` is not in the measured
path: `run_case` in run.py stops at `compute_ats_report`, and nothing the
strategy step returns feeds the tailored resume or the score. Ablating it here
would report a delta of exactly zero on every case and every metric, which is
not a finding, it is a tautology. If strategy is ever moved upstream of the
rewrite, add the variant then.

What it measures, per variant per case: the ATS score, whether the truth guard
passed, the guard's error count, how many violations the first draft had, wall
clock, dollars, and every structural scorer from evals/scorers.py.

Cost. This spends real money and the default is to spend none:

    python evals/ablate.py                        # dry run: the plan and an estimate
    python evals/ablate.py --cases 4 --dry-run    # a smaller plan
    python evals/ablate.py --execute              # asks you to type the total first
    python evals/ablate.py --execute --variants full,no_gaps --out ablation.json

The two extractions are run once per case and shared across variants, because
they are identical in all three and paying for them three times would buy
nothing but variance. Their cost is added into each variant's total so the
numbers stay comparable with run.py; being shared, they cancel out of every
delta.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(_ROOT / "src"), str(_ROOT)]

from atsresume.config import get_settings  # noqa: E402
from atsresume.ingest.resume import ingest_resume_text  # noqa: E402
from atsresume.llm import current_usage, start_usage, structured  # noqa: E402
from atsresume.models import (  # noqa: E402
    GapAnalysis,
    JobSpec,
    ResumeFacts,
    TailoredResume,
)
from atsresume.pipeline import prompts  # noqa: E402
from atsresume.pipeline.sanitize import sanitize  # noqa: E402
from atsresume.pipeline.scoring import compute_ats_report  # noqa: E402
from atsresume.pipeline.steps import (  # noqa: E402
    TailorOutcome,
    analyze_gaps,
    extract_job_spec,
    extract_resume_facts,
    tailor_resume,
)
from atsresume.truth.entailment import check_entailment  # noqa: E402
from atsresume.truth.guard import (  # noqa: E402
    entailment_pairs,
    merge_violations,
    run_truth_guard,
)
from evals.scorers import score_all  # noqa: E402

CASES_DIR = Path(__file__).parent / "cases"

# What each variant is expected to cost per case on the balanced profile, in
# USD. Only used by the estimate; nothing branches on it. Split so the estimate
# reflects that two of the three variants do not make a gap-analysis call.
SHARED_COST = 0.12  # extract + jd, paid once per case
VARIANT_COST = {
    "full": 0.28,  # gaps call + tailor, with a repair round some of the time
    "no_gaps": 0.22,  # tailor only
    "gaps_merged": 0.25,  # tailor only, but a longer prompt and more thinking
}

# The rule for the recommendation line, stated once so it cannot drift between
# the code and the docs. A step that costs less than this many mean score
# points, and does not cost guard pass rate, is not paying for itself.
SCORE_TOLERANCE = 2.0


# --------------------------------------------------------------------------- #
# Variants                                                                     #
# --------------------------------------------------------------------------- #


def _block(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def _tailor_with_brief(
    brief: str,
    facts: ResumeFacts,
    raw_resume_text: str,
    jd_terms: list[str],
) -> TailorOutcome:
    """tailor_resume's rewrite-then-verify loop, with the brief supplied.

    A copy of the control flow in `steps.tailor_resume`, not an import of it,
    because the whole point of the `gaps_merged` variant is a different user
    message. steps.py is not edited to accommodate an experiment: the shipped
    path should not carry a parameter that exists only for this file.

    The copy includes `verify`, deliberately. Verification is two layers, the
    token checks and then the entailment call, and an earlier version of this
    file ran only the first. That does not produce a slightly noisier result,
    it produces a systematically flattering one: the ablated variant is graded
    by a weaker guard than `full`, so it reports fewer violations and a higher
    pass rate, and the harness recommends deleting a step on the strength of a
    measurement error. If `steps.verify` changes, this must change with it.
    """

    def verify(draft: TailoredResume):
        report = run_truth_guard(draft, facts, raw_resume_text, jd_terms)
        if not get_settings().enable_entailment:
            return report
        return merge_violations(report, check_entailment(entailment_pairs(draft, facts)))

    tailored = sanitize(
        structured(system=prompts.TAILOR, user=brief, schema=TailoredResume, step="tailor")
    )
    truth = verify(tailored)
    repair_attempted = False
    first_draft_violations: list[str] = []

    if not truth.passed:
        repair_attempted = True
        first_draft_violations = [
            f"{v.code.value}: {v.detail}" for v in truth.violations if v.severity == "error"
        ]
        findings = "\n".join(
            f'- [{v.code.value}] {v.location}: {v.detail}\n  Line: "{v.offending}"'
            for v in truth.violations
            if v.severity == "error"
        )
        repair_brief = "\n\n".join(
            [
                brief,
                "Your previous draft failed verification against the uploaded resume:\n"
                + findings,
                "Rewrite it. For each failing line, either restate it using only what its "
                "sources actually say, or drop it. Do not try to justify a figure or a "
                "technology that is not in the original resume.",
            ]
        )
        tailored = sanitize(
            structured(
                system=prompts.TAILOR, user=repair_brief, schema=TailoredResume, step="tailor"
            )
        )
        truth = verify(tailored)

    return TailorOutcome(
        tailored=tailored,
        truth=truth,
        repair_attempted=repair_attempted,
        first_draft_violations=first_draft_violations,
    )


def variant_full(job: JobSpec, facts: ResumeFacts, raw: str) -> TailorOutcome:
    """The shipped pipeline: gap analysis is its own call, its output is passed in."""
    gaps = analyze_gaps(job, facts)
    return tailor_resume(job, facts, gaps, raw)


def variant_no_gaps(job: JobSpec, facts: ResumeFacts, raw: str) -> TailorOutcome:
    """The step is deleted. The tailor prompt still receives a GapAnalysis, but an
    empty one, so the model is told nothing about what the candidate is missing."""
    return tailor_resume(job, facts, GapAnalysis(), raw)


def variant_gaps_merged(job: JobSpec, facts: ResumeFacts, raw: str) -> TailorOutcome:
    """The step is folded in. No separate call; the tailor prompt is asked to do the
    gap reasoning itself before it writes. Same information available, one call fewer.

    The brief mirrors `steps.tailor_resume` block for block so that the only
    difference being measured is the gap analysis, not the prompt scaffolding.
    """
    brief = "\n\n".join(
        [
            "Rewrite this candidate's resume for this role.",
            _block("job_spec", job.model_dump_json(indent=2)),
            _block("resume_facts", facts.model_dump_json(indent=2)),
            "Before you write anything, do the gap analysis yourself, silently:\n"
            "1. Which job_spec requirements does this candidate genuinely meet? Those are "
            "the ones to lead with.\n"
            "2. Which requirements are already true of this candidate but buried in the "
            "resume_facts under different wording? Those are the recoverable keywords and "
            "surfacing them is the single largest win available to you.\n"
            "3. Which requirements can this candidate not truthfully claim? Those are the "
            "missing keywords. Do not use them. Do not imply them. Leaving a gap visible is "
            "the correct outcome, not a failure of the rewrite.\n"
            "4. Which of the candidate's material is irrelevant to this role and should be "
            "shortened to make room?\n"
            "Then write the tailored resume.",
        ]
    )
    return _tailor_with_brief(brief, facts, raw, job.all_terms())


VARIANTS = {
    "full": variant_full,
    "no_gaps": variant_no_gaps,
    "gaps_merged": variant_gaps_merged,
}

# Which step each ablated variant is a claim about, and how it removes it.
ABLATES = {
    "no_gaps": "gap-analysis step (removed entirely)",
    "gaps_merged": "gap-analysis as a separate call (folded into the tailor prompt)",
}


# --------------------------------------------------------------------------- #
# Running                                                                      #
# --------------------------------------------------------------------------- #


@dataclass
class Cell:
    """One case under one variant."""

    case: str
    variant: str
    ats_score: float = 0.0
    guard_passed: bool = False
    guard_error_count: int = 0
    first_draft_violation_count: int = 0
    repair_attempted: bool = False
    seconds: float = 0.0
    cost_usd: float = 0.0
    scorers: dict[str, float] = field(default_factory=dict)
    scorer_failures: list[str] = field(default_factory=list)
    error: str = ""


def run_cell(
    case: dict, variant: str, job: JobSpec, facts: ResumeFacts, raw: str, shared_cost: float
) -> Cell:
    started = time.time()
    start_usage()
    try:
        outcome = VARIANTS[variant](job, facts, raw)
    except Exception as exc:  # noqa: BLE001 - one bad cell must not lose the run
        usage = current_usage()
        return Cell(
            case=case["name"],
            variant=variant,
            seconds=time.time() - started,
            cost_usd=shared_cost + (usage.cost_usd if usage else 0.0),
            error=f"{type(exc).__name__}: {exc}",
        )

    report = compute_ats_report(job, facts, outcome.tailored)
    findings = score_all(facts, outcome.tailored, [k.term for k in job.keywords])
    usage = current_usage()

    return Cell(
        case=case["name"],
        variant=variant,
        ats_score=report.overall,
        guard_passed=outcome.truth.passed,
        guard_error_count=outcome.truth.error_count,
        first_draft_violation_count=len(outcome.first_draft_violations),
        repair_attempted=outcome.repair_attempted,
        seconds=time.time() - started,
        cost_usd=shared_cost + (usage.cost_usd if usage else 0.0),
        scorers={f.scorer: round(f.value, 3) for f in findings},
        scorer_failures=[f.scorer for f in findings if not f.passed],
    )


def run_case(case: dict, variants: list[str]) -> list[Cell]:
    """Extract once, then run each variant off the same facts and job spec."""
    start_usage()
    source = ingest_resume_text(case["resume_text"])
    facts = extract_resume_facts(source.raw_text)
    job = extract_job_spec(case["jd_text"], f"eval case {case['name']}")
    shared = current_usage()
    shared_cost = shared.cost_usd if shared else 0.0

    return [
        run_cell(case, variant, job, facts, source.raw_text, shared_cost)
        for variant in variants
    ]


# --------------------------------------------------------------------------- #
# Reporting                                                                    #
# --------------------------------------------------------------------------- #

SCORER_COLUMNS = (
    "bullets_were_rewritten",
    "no_repeated_openers",
    "no_banned_openers",
    "ascii_only",
    "keyword_coverage",
    "surfaced_twice",
)


@dataclass
class VariantSummary:
    variant: str
    cells: int
    mean_ats: float
    guard_pass_rate: float
    mean_guard_errors: float
    mean_first_draft_violations: float
    repair_rate: float
    mean_seconds: float
    mean_cost: float
    total_cost: float
    scorer_means: dict[str, float]
    scorer_failure_count: int
    errors: int


def _mean(values: list[float]) -> float:
    return statistics.mean(values) if values else 0.0


def summarise(cells: list[Cell], variant: str) -> VariantSummary:
    rows = [c for c in cells if c.variant == variant]
    ok = [c for c in rows if not c.error]
    return VariantSummary(
        variant=variant,
        cells=len(rows),
        mean_ats=round(_mean([c.ats_score for c in ok]), 2),
        guard_pass_rate=round(_mean([float(c.guard_passed) for c in ok]), 3),
        mean_guard_errors=round(_mean([float(c.guard_error_count) for c in ok]), 2),
        mean_first_draft_violations=round(
            _mean([float(c.first_draft_violation_count) for c in ok]), 2
        ),
        repair_rate=round(_mean([float(c.repair_attempted) for c in ok]), 3),
        mean_seconds=round(_mean([c.seconds for c in ok]), 1),
        mean_cost=round(_mean([c.cost_usd for c in ok]), 4),
        total_cost=round(sum(c.cost_usd for c in rows), 4),
        scorer_means={
            name: round(_mean([c.scorers.get(name, 0.0) for c in ok]), 3)
            for name in SCORER_COLUMNS
        },
        scorer_failure_count=sum(len(c.scorer_failures) for c in ok),
        errors=len(rows) - len(ok),
    )


def recommendation(base: VariantSummary, ablated: VariantSummary) -> tuple[str, str]:
    """DELETE if removing the step is nearly free. KEEP otherwise.

    Two conditions, both of which must hold to delete: the mean ATS score must
    not drop by more than SCORE_TOLERANCE points, and the guard pass rate must
    not fall at all. The second is not negotiable against the first. A variant
    that scores two points higher while letting one more fabrication through is
    a worse product, and averaging those two facts into one number would hide
    exactly the thing this harness exists to see.
    """
    step = ABLATES.get(ablated.variant, ablated.variant)
    drop = base.mean_ats - ablated.mean_ats
    guard_drop = base.guard_pass_rate - ablated.guard_pass_rate
    saving = base.mean_cost - ablated.mean_cost

    if drop < SCORE_TOLERANCE and guard_drop <= 0:
        verdict = f"DELETE {step}"
        why = (
            f"costs {drop:+.2f} mean score points (under the {SCORE_TOLERANCE:.1f} point "
            f"tolerance) and guard pass rate is {'unchanged' if guard_drop == 0 else 'higher'} "
            f"at {ablated.guard_pass_rate:.0%}; saves ${saving:.3f} per case"
        )
    else:
        verdict = f"KEEP {step}"
        reasons = []
        if drop >= SCORE_TOLERANCE:
            reasons.append(f"removing it costs {drop:.2f} mean score points")
        if guard_drop > 0:
            reasons.append(
                f"guard pass rate falls {base.guard_pass_rate:.0%} -> "
                f"{ablated.guard_pass_rate:.0%}"
            )
        why = "; ".join(reasons) + f" (it costs ${saving:.3f} per case, and is worth it)"
    return verdict, why


def render(cells: list[Cell], variants: list[str]) -> list[VariantSummary]:
    summaries = [summarise(cells, v) for v in variants]
    base = next((s for s in summaries if s.variant == "full"), None)

    print("\n## Per case\n")
    header = "| case | variant | ats | guard | guard errs | 1st-draft viols | scorer fails | s | $ |"
    print(header)
    print("|" + "---|" * 9)
    for case_name in dict.fromkeys(c.case for c in cells):
        for variant in variants:
            cell = next(
                (c for c in cells if c.case == case_name and c.variant == variant), None
            )
            if cell is None:
                continue
            if cell.error:
                print(
                    f"| {case_name} | {variant} | ERROR | - | - | - | - | "
                    f"{cell.seconds:.0f} | {cell.cost_usd:.3f} |  {cell.error}"
                )
                continue
            print(
                f"| {case_name} | {variant} | {cell.ats_score:.1f} | "
                f"{'pass' if cell.guard_passed else 'HELD'} | {cell.guard_error_count} | "
                f"{cell.first_draft_violation_count} | "
                f"{','.join(cell.scorer_failures) or '-'} | "
                f"{cell.seconds:.0f} | {cell.cost_usd:.3f} |"
            )

    print("\n## Per variant\n")
    print(
        "| variant | mean ats | d ats | guard pass | d guard | mean guard errs | "
        "1st-draft viols | repair rate | mean s | mean $ | d $ | scorer fails | errors |"
    )
    print("|" + "---|" * 13)
    for s in summaries:
        d_ats = "" if base is None or s is base else f"{s.mean_ats - base.mean_ats:+.2f}"
        d_guard = (
            ""
            if base is None or s is base
            else f"{s.guard_pass_rate - base.guard_pass_rate:+.0%}"
        )
        d_cost = "" if base is None or s is base else f"{s.mean_cost - base.mean_cost:+.3f}"
        print(
            f"| {s.variant} | {s.mean_ats:.2f} | {d_ats or '-'} | {s.guard_pass_rate:.0%} | "
            f"{d_guard or '-'} | {s.mean_guard_errors:.2f} | "
            f"{s.mean_first_draft_violations:.2f} | {s.repair_rate:.0%} | "
            f"{s.mean_seconds:.0f} | {s.mean_cost:.3f} | {d_cost or '-'} | "
            f"{s.scorer_failure_count} | {s.errors} |"
        )

    print("\n## Structural scorers (mean value, delta vs full)\n")
    print("| scorer | " + " | ".join(variants) + " |")
    print("|" + "---|" * (len(variants) + 1))
    for name in SCORER_COLUMNS:
        cols = []
        for s in summaries:
            value = s.scorer_means[name]
            if base is None or s is base:
                cols.append(f"{value:.3f}")
            else:
                cols.append(f"{value:.3f} ({value - base.scorer_means[name]:+.3f})")
        print(f"| {name} | " + " | ".join(cols) + " |")

    print("\n## Recommendation\n")
    if base is None:
        print("  no `full` variant in this run, so there is nothing to compare against.")
    else:
        ablated = [s for s in summaries if s.variant != "full"]
        if not ablated:
            print("  only `full` was run. Nothing was ablated, so nothing is recommended.")
        for s in ablated:
            verdict, why = recommendation(base, s)
            print(f"  {verdict}")
            print(f"      {why}")
        print(
            f"\n  Rule: DELETE if removing the step costs under {SCORE_TOLERANCE:.1f} mean "
            "score points AND does not reduce the guard pass rate. Otherwise KEEP."
        )
    print()
    return summaries


# --------------------------------------------------------------------------- #
# CLI                                                                          #
# --------------------------------------------------------------------------- #


def load_cases(limit: int | None, seed: int) -> list[dict]:
    paths = sorted(CASES_DIR.glob("*.json"))
    cases = [json.loads(p.read_text()) for p in paths]
    if limit is not None and limit < len(cases):
        # Sampled rather than truncated: the case files sort alphabetically,
        # which would hand a --cases 4 run four career-changer and fresher
        # cases and none of the senior ones.
        cases = sorted(random.Random(seed).sample(cases, limit), key=lambda c: c["name"])
    return cases


def print_plan(cases: list[dict], variants: list[str], profile: str) -> float:
    shared = SHARED_COST * len(cases)
    per_variant = {v: VARIANT_COST.get(v, 0.25) * len(cases) for v in variants}
    total = shared + sum(per_variant.values())

    print(f"\nprofile {profile}")
    print(f"{len(cases)} case(s) x {len(variants)} variant(s) = {len(cases) * len(variants)} cells\n")
    print("  cases:")
    for case in cases:
        print(f"    - {case['name']}")
    print("\n  variants:")
    for variant in variants:
        note = ABLATES.get(variant, "the shipped pipeline, unmodified")
        print(f"    - {variant:12} {note}")
    print("\n  estimated cost:")
    print(f"    extract + jd, once per case   {len(cases):3} x ${SHARED_COST:.2f} = ${shared:6.2f}")
    for variant, cost in per_variant.items():
        print(
            f"    {variant:29} {len(cases):3} x ${VARIANT_COST.get(variant, 0.25):.2f} = ${cost:6.2f}"
        )
    print(f"    {'':29}              ${total:6.2f}")
    print(
        "\n  This is an estimate from published per-call costs, not a quote. Cases with a "
        "\n  repair round cost roughly twice the tailor step. Treat it as a floor."
    )
    return total


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--cases", type=int, help="sample this many cases instead of all")
    parser.add_argument("--seed", type=int, default=7, help="sampling seed (default 7)")
    parser.add_argument(
        "--variants",
        default=",".join(VARIANTS),
        help=f"comma separated, from: {', '.join(VARIANTS)}",
    )
    parser.add_argument("--out", default="ablation.json", help="write results here")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=None,
        help="print the plan and the estimate without calling the API. This is the "
        "default, and passing it explicitly overrides --execute.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="actually run it. Costs money. You will be asked to confirm the total.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="skip the typed confirmation. For a non-interactive shell you trust.",
    )
    args = parser.parse_args()

    # --dry-run beats --execute. Somebody who typed both wanted the safe one,
    # and a flag pair where the expensive option silently wins is a trap.
    if args.dry_run and args.execute:
        print("--dry-run and --execute were both given. Honouring --dry-run.", file=sys.stderr)
        args.execute = False

    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    unknown = [v for v in variants if v not in VARIANTS]
    if unknown:
        print(f"unknown variant(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"choose from: {', '.join(VARIANTS)}", file=sys.stderr)
        return 2

    cases = load_cases(args.cases, args.seed)
    if not cases:
        print(f"no cases found in {CASES_DIR}", file=sys.stderr)
        return 1

    total = print_plan(cases, variants, get_settings().profile.value)

    if not args.execute:
        print("\n  dry run. Nothing was called and nothing was spent.")
        print("  Add --execute to run it for real.\n")
        return 0

    if not args.yes:
        print(f"\n  About to spend roughly ${total:.2f}.")
        try:
            typed = input(f"  Type the amount to continue (e.g. {total:.2f}): ").strip()
        except EOFError:
            print("\n  no input available. Aborted.", file=sys.stderr)
            return 1
        if typed.lstrip("$") != f"{total:.2f}":
            print("  that did not match. Aborted, nothing spent.", file=sys.stderr)
            return 1

    print()
    cells: list[Cell] = []
    for index, case in enumerate(cases, 1):
        print(f"  [{index}/{len(cases)}] {case['name']}", flush=True)
        cells.extend(run_case(case, variants))

    summaries = render(cells, variants)

    payload = {
        "profile": get_settings().profile.value,
        "variants": variants,
        "score_tolerance": SCORE_TOLERANCE,
        "cells": [asdict(c) for c in cells],
        "summaries": [asdict(s) for s in summaries],
        "recommendations": [
            dict(zip(("verdict", "reason"), recommendation(base, s)))
            for base in [next((x for x in summaries if x.variant == "full"), None)]
            if base is not None
            for s in summaries
            if s.variant != "full"
        ],
        "total_cost_usd": round(sum(c.cost_usd for c in cells), 4),
    }
    Path(args.out).write_text(json.dumps(payload, indent=2))
    print(f"wrote {args.out} · spent ${payload['total_cost_usd']:.2f}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
