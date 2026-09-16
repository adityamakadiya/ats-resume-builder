"""Run the pipeline over the eval cases and report what happened.

This costs real money — roughly $0.40 per case on the balanced profile — so it
is never part of the test suite and never runs by accident.

What it exists for: every quality claim about this pipeline before now was a
single anecdote. The score moved from 65 to 78 across a prompt change and there
was no way to tell whether that was the change or the weather. A prompt edit
should be a measurement.

    python evals/run.py                       # all cases, balanced profile
    python evals/run.py --case strong-match   # one case
    python evals/run.py --save baseline.json  # record a baseline
    python evals/run.py --compare baseline.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import asdict
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(_ROOT / "src"), str(_ROOT)]

from atsresume.config import get_settings  # noqa: E402
from atsresume.ingest.resume import ingest_resume_text  # noqa: E402
from atsresume.llm import current_usage, start_usage  # noqa: E402
from atsresume.pipeline.scoring import compute_ats_report  # noqa: E402
from atsresume.pipeline.steps import (  # noqa: E402
    analyze_gaps,
    extract_job_spec,
    extract_resume_facts,
    tailor_resume,
)
from evals.scorers import CaseResult, score_all  # noqa: E402

CASES_DIR = Path(__file__).parent / "cases"


def run_case(path: Path) -> CaseResult:
    case = json.loads(path.read_text())
    started = time.time()
    start_usage()

    source = ingest_resume_text(case["resume_text"])
    facts = extract_resume_facts(source.raw_text)
    job = extract_job_spec(case["jd_text"], f"eval case {case['name']}")
    gaps = analyze_gaps(job, facts)
    outcome = tailor_resume(job, facts, gaps, source.raw_text)
    report = compute_ats_report(job, facts, outcome.tailored)

    keywords = [k.term for k in job.keywords]
    usage = current_usage()

    return CaseResult(
        case=case["name"],
        findings=score_all(facts, outcome.tailored, keywords),
        ats_score=report.overall,
        guard_passed=outcome.truth.passed,
        expect_guard_pass=case.get("expect_guard_pass", True),
        repair_attempted=outcome.repair_attempted,
        seconds=time.time() - started,
        cost_usd=usage.cost_usd if usage else 0.0,
        first_draft_violations=outcome.first_draft_violations,
    )


def render(results: list[CaseResult]) -> None:
    print()
    for result in results:
        mark = "ok" if result.as_expected else "FAIL"
        print(
            f"{result.case:16} {mark:5} ats {result.ats_score:5.1f}  "
            f"guard {'pass' if result.guard_passed else 'held'}"
            f"{'  repaired' if result.repair_attempted else '':>10}  "
            f"{result.seconds:5.0f}s  ${result.cost_usd:.3f}"
        )
        if result.guard_passed != result.expect_guard_pass:
            expected = "pass" if result.expect_guard_pass else "hold"
            print(f"   ! guard was expected to {expected} and did not")
        for finding in result.findings:
            flag = " " if finding.passed else "!"
            print(f"   {flag} {finding.scorer:24} {finding.value:5.2f}  {finding.detail}")
        for violation in result.first_draft_violations:
            print(f"   > rejected {violation[:96]}")
        print()

    print("-" * 64)
    print(
        f"{'TOTAL':16}       ats {statistics.mean(r.ats_score for r in results):5.1f}  "
        f"as expected {sum(r.as_expected for r in results)}/{len(results)}  "
        f"repairs {sum(r.repair_attempted for r in results)}/{len(results)}  "
        f"{sum(r.seconds for r in results):5.0f}s  ${sum(r.cost_usd for r in results):.2f}"
    )
    failures = [f for r in results for f in r.failures]
    print(f"{'':16}       {len(failures)} scorer failure(s) across {len(results)} case(s)")


def compare(results: list[CaseResult], baseline_path: Path) -> None:
    """Only the deltas. A run that reports everything reports nothing."""
    baseline = {b["case"]: b for b in json.loads(baseline_path.read_text())}
    print("\nagainst", baseline_path.name)
    for result in results:
        before = baseline.get(result.case)
        if not before:
            print(f"  {result.case:16} new case")
            continue
        delta = result.ats_score - before["ats_score"]
        arrow = "+" if delta > 0 else ""
        print(
            f"  {result.case:16} ats {before['ats_score']:5.1f} -> {result.ats_score:5.1f} "
            f"({arrow}{delta:.1f})"
        )
        was = {f["scorer"] for f in before["findings"] if not f["passed"]}
        now = {f.scorer for f in result.failures}
        for fixed in sorted(was - now):
            print(f"      fixed   {fixed}")
        for broke in sorted(now - was):
            print(f"      BROKE   {broke}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", help="run one case by name")
    parser.add_argument("--save", help="write results to this file")
    parser.add_argument("--compare", help="compare against a saved run")
    args = parser.parse_args()

    paths = sorted(CASES_DIR.glob("*.json"))
    if args.case:
        paths = [p for p in paths if p.stem == args.case]
        if not paths:
            print(f"no case named {args.case}", file=sys.stderr)
            return 1

    settings = get_settings()
    print(f"profile {settings.profile.value} · {len(paths)} case(s) · ~${0.4 * len(paths):.2f}")

    results = [run_case(p) for p in paths]
    render(results)

    if args.save:
        Path(args.save).write_text(json.dumps([asdict(r) for r in results], indent=2))
        print(f"\nsaved {args.save}")
    if args.compare:
        compare(results, Path(args.compare))

    return 0 if all(r.as_expected for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
