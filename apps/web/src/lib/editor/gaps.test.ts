/**
 * The ranking, the arithmetic, and the four things this must never do.
 *
 * The delta assertions do not hardcode a number. They run `computeAtsReport`
 * themselves, on a copy of the document with the suggestion's own ops applied,
 * and compare. If the scorer changes, this test follows it; if `gaps.ts` ever
 * starts estimating instead of computing, it fails.
 */

import { describe, expect, it } from "vitest";
import { computeAtsReport, type GapAnalysis, type JobSpec } from "@ats/core";
import {
  SAMPLE_DOC,
  SAMPLE_FACTS,
  SAMPLE_GAPS,
  SAMPLE_JOB,
  SAMPLE_REPORT,
} from "./fixtures";
import { applyDocPatch, tailoredOf } from "./doc";
import { blockingGaps, groupByImportance, suggestionsFor } from "./gaps";

function suggestions(job: JobSpec | null = SAMPLE_JOB, gaps: GapAnalysis = SAMPLE_GAPS) {
  return suggestionsFor(job, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, gaps);
}

function find(term: string) {
  const hit = suggestions().find((s) => s.term === term);
  if (!hit) throw new Error(`expected a suggestion for ${term}`);
  return hit;
}

describe("suggestionsFor", () => {
  it("sorts every required term above every preferred one", () => {
    const all = suggestions();
    const lastRequired = all.map((s) => s.importance).lastIndexOf("required");
    const firstPreferred = all.map((s) => s.importance).indexOf("preferred");

    expect(lastRequired).toBeGreaterThanOrEqual(0);
    expect(firstPreferred).toBeGreaterThanOrEqual(0);
    expect(lastRequired).toBeLessThan(firstPreferred);

    // gRPC is the posting's one unmet required term, so it leads.
    expect(all[0].term).toBe("gRPC");
    expect(all[0].importance).toBe("required");
  });

  it("orders by the posting's weight inside a group", () => {
    const { required, preferred } = groupByImportance(suggestions());
    for (const group of [required, preferred]) {
      const weights = group.map((s) => s.weight);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
    }

    // Terraform is weighted 2 in the posting and Grafana 1, so Terraform is
    // offered first even though the two would earn the same points.
    const terms = preferred.map((s) => s.term);
    expect(terms.indexOf("Terraform")).toBeLessThan(terms.indexOf("Grafana"));
    expect(find("Terraform").weight).toBe(2);
    expect(find("Grafana").weight).toBe(1);
  });

  it("computes the delta rather than guessing it", () => {
    const grpc = find("gRPC");
    const base = SAMPLE_REPORT.overall;

    for (const placement of grpc.placements) {
      const next = applyDocPatch(SAMPLE_DOC, placement.ops);
      const scored = computeAtsReport(SAMPLE_JOB, SAMPLE_FACTS, tailoredOf(next)).overall;
      expect(placement.delta).toBe(Math.round((scored - base) * 10) / 10);
      expect(placement.delta).toBeGreaterThan(0);
    }

    // The headline number is the best placement's, and the placements are
    // ordered by it.
    expect(grpc.delta).toBe(grpc.placements[0].delta);
    expect(grpc.delta).toBe(Math.max(...grpc.placements.map((p) => p.delta ?? 0)));

    // gRPC is a required term weighted 2: it is worth several points, not a
    // rounding error, and the exact figure is the scorer's, not this file's.
    expect(grpc.delta).toBeGreaterThan(5);
  });

  it("offers the bullet the resume already wrote, carrying its source id", () => {
    const terraform = find("Terraform");
    const bullet = terraform.placements.find((p) => p.kind === "bullet");
    if (!bullet) throw new Error("expected a bullet placement for Terraform");

    expect(bullet.traced).toBe(true);
    expect(bullet.label).toMatch(/Meridian Payments/);
    // Verbatim from the parsed resume, not rewritten to work the term in.
    expect(bullet.preview).toBe(
      SAMPLE_FACTS.experience[0].bullets.find((b) => b.id === "E1.B5")?.text,
    );

    const op = bullet.ops[0];
    expect(op.op).toBe("add");
    expect(op.path).toMatch(/^\/experience\/0\/bullets\/\d+$/);
    expect((op.value as { source_ids: string[] }).source_ids).toEqual(["E1.B5"]);

    // It lands where it came from, after the earlier lines of the same role.
    const next = applyDocPatch(SAMPLE_DOC, bullet.ops);
    expect(next.experience[0].bullets.map((b) => b.source_ids[0])).toEqual([
      "E1.B1",
      "E1.B2",
      "E1.B3",
      "E1.B5",
      "E1.B6",
    ]);
  });

  it("never offers a bullet for a term the resume does not state", () => {
    for (const suggestion of suggestions()) {
      if (suggestion.kind !== "missing") continue;
      expect(suggestion.placements.every((p) => p.kind === "skills")).toBe(true);
      expect(suggestion.placements.every((p) => p.traced === false)).toBe(true);
    }
    expect(find("Rust").kind).toBe("missing");
  });

  it("returns nothing at all when there is no posting", () => {
    expect(suggestionsFor(null, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, SAMPLE_GAPS)).toEqual([]);
    expect(suggestionsFor(null, SAMPLE_FACTS, SAMPLE_DOC, null, SAMPLE_GAPS)).toEqual([]);
    // And with a posting but no score yet, there is nothing to subtract from.
    expect(suggestionsFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, null, SAMPLE_GAPS)).toEqual([]);
  });

  it("does not suggest a term the document already contains", () => {
    const withGrpc = applyDocPatch(SAMPLE_DOC, [
      { op: "add", path: "/skills/2/items/-", value: "gRPC" },
    ]);
    const report = computeAtsReport(SAMPLE_JOB, SAMPLE_FACTS, tailoredOf(withGrpc));
    const terms = suggestionsFor(SAMPLE_JOB, SAMPLE_FACTS, withGrpc, report, SAMPLE_GAPS).map(
      (s) => s.term,
    );

    expect(terms).not.toContain("gRPC");
    expect(terms).toContain("Terraform");
  });

  it("does not suggest a term the document already contains under a variant", () => {
    // The posting lists Kafka with the variant "Apache Kafka". The document
    // says Kafka, so neither spelling is a gap.
    expect(suggestions().map((s) => s.term)).not.toContain("Kafka");
  });

  it("never offers a blocking gap as something to click", () => {
    const blocking: GapAnalysis = {
      ...SAMPLE_GAPS,
      missing: [
        { jd_term: "Rust", severity: "blocking", note: "Five years of Rust is the bar." },
        { jd_term: "Apache Flink", severity: "minor", note: "Adjacent experience." },
      ],
    };

    const terms = suggestions(SAMPLE_JOB, blocking).map((s) => s.term);
    expect(terms).not.toContain("Rust");
    expect(terms).toContain("Apache Flink");

    expect(blockingGaps(blocking).map((m) => m.jd_term)).toEqual(["Rust"]);
    expect(blockingGaps(SAMPLE_GAPS)).toEqual([]);
    expect(blockingGaps(null)).toEqual([]);
  });

  it("keeps the recoverable and missing split intact", () => {
    const all = suggestions();
    const recoverable = all.filter((s) => s.kind === "recoverable").map((s) => s.term);
    const missing = all.filter((s) => s.kind === "missing").map((s) => s.term);

    expect(recoverable.sort()).toEqual(["Grafana", "Terraform", "gRPC"]);
    expect(missing.sort()).toEqual(["Apache Flink", "Rust"]);
    expect(recoverable.some((t) => missing.includes(t))).toBe(false);
  });
});
