/**
 * The invariants the editor is built on, asserted rather than assumed.
 *
 * Byte-identical undo is the load-bearing one. If `applyPatch` then
 * `invertPatch` does not return the exact document, then every other promise
 * on the screen is soft: the score is measuring a document that drifted, the
 * preview is rendering one, and the traced badge is counting lines that are no
 * longer the lines the guard checked. It is asserted on the serialised JSON,
 * key order included, because a deep-equality check would pass on a document
 * whose keys had been reordered and that is exactly the kind of drift that is
 * invisible until a diff is shown to a user.
 *
 * The second invariant here is newer and just as load bearing: a resume with
 * no posting attached has NO SCORE. Not zero, not a sample, nothing. Every
 * dimension the scorer computes is a comparison, so with nothing to compare
 * against the honest answer is null all the way through, and the document
 * still has to be fully editable while that is true. These tests used to
 * assume a score always existed, because the editor used to invent one out
 * of a fixture posting. They assert the absence now.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { AtsReport, Op } from "@ats/core";
import { scoreOf, useEditorStore } from "./editor";
import { SAMPLE_JOB, sampleRun, type EditorRun } from "@/lib/editor/fixtures";
import { tailoredOf, pointer } from "@/lib/editor/doc";

const BULLET = pointer("experience", 0, "bullets", 0, "text");

function reset() {
  useEditorStore.getState().init(sampleRun("test"));
}

/** The same run with the posting taken off it, which is how a resume starts. */
function unaimedRun(): EditorRun {
  return { ...sampleRun("test"), job: null, report: null };
}

function state() {
  return useEditorStore.getState();
}

/**
 * Narrow a nullable score to a score, by asserting it.
 *
 * Not a `!` and not a cast. `report` is genuinely nullable now, and the
 * point of these tests is which of the two states the store is in, so the
 * narrowing has to be a real runtime check that fails with a sentence when
 * the store is in the other one. A non-null assertion would compile the
 * question away and leave `Cannot read overall of null` as the failure
 * message.
 */
function scored(report: AtsReport | null): AtsReport {
  if (report === null) {
    throw new Error("expected a score here: this store was given a posting");
  }
  return report;
}

/** The overall of a store that is supposed to have one. */
function overall(): number {
  return scored(state().report).overall;
}

/** The same narrowing for a patch's projected score and its delta. */
function points(value: number | null, what: string): number {
  if (value === null) {
    throw new Error(`expected ${what} to be a number: this store has a posting`);
  }
  return value;
}

describe("the document changes only through patches", () => {
  beforeEach(reset);

  it("returns the document byte-identical after applying and undoing a patch", () => {
    const before = JSON.stringify(state().doc);

    const ops: Op[] = [
      { op: "replace", path: BULLET, value: "Rebuilt settlement reconciliation on Kafka in Go." },
    ];
    state().stagePatch({ ops, rationale: "Name the language." });
    state().acceptPatch(state().pendingPatches[0]!.id);

    expect(JSON.stringify(state().doc)).not.toBe(before);

    state().undo();
    expect(JSON.stringify(state().doc)).toBe(before);
  });

  it("survives a round trip through several kinds of op", () => {
    const before = JSON.stringify(state().doc);

    state().applyUserOps(
      [
        { op: "replace", path: pointer("headline"), value: "Payments Engineer" },
        { op: "add", path: pointer("skills", 0, "items", "-"), value: "Rust" },
        { op: "remove", path: pointer("certifications", 1) },
      ],
      "A bit of everything",
    );
    state().undo();

    expect(JSON.stringify(state().doc)).toBe(before);
  });
});

describe("deciding on a proposed patch", () => {
  beforeEach(reset);

  const ops: Op[] = [
    {
      op: "replace",
      path: BULLET,
      value:
        "Rebuilt settlement reconciliation on Kafka with gRPC services, cutting the close-of-day window from six hours to twenty minutes.",
    },
  ];

  it("declining changes neither the document nor the score", () => {
    const doc = JSON.stringify(state().doc);
    const score = overall();

    const id = state().stagePatch({ ops, rationale: "Name the language." });
    expect(id).not.toBeNull();
    expect(state().pendingPatches).toHaveLength(1);

    state().declinePatch(id as string);

    expect(state().pendingPatches).toHaveLength(0);
    expect(JSON.stringify(state().doc)).toBe(doc);
    expect(overall()).toBe(score);
    expect(state().history.past).toHaveLength(0);
  });

  it("accepting updates both and records the score delta", () => {
    const doc = JSON.stringify(state().doc);
    const score = overall();

    const id = state().stagePatch({ ops, rationale: "Name the language." }) as string;
    const staged = state().pendingPatches[0]!;

    // With a posting in hand both of these are numbers, and the test says so
    // rather than assuming it: the same call against an unaimed store
    // returns null on purpose, and that case is asserted below.
    const projected = points(staged.projected, "the projected score");
    const delta = points(staged.delta, "the delta");

    // The delta is computed against a copy, before anything is applied.
    expect(delta).toBeCloseTo(projected - score, 5);

    state().acceptPatch(id);

    expect(JSON.stringify(state().doc)).not.toBe(doc);
    expect(overall()).toBeCloseTo(projected, 5);
    expect(overall()).toBeGreaterThan(score);
    expect(state().pendingPatches).toHaveLength(0);
  });

  it("refuses a patch against a guarded employment fact", () => {
    const id = state().stagePatch({
      ops: [{ op: "replace", path: pointer("experience", 0, "title"), value: "Staff Engineer" }],
      rationale: "A promotion nobody had.",
    });

    expect(id).toBeNull();
    expect(state().pendingPatches).toHaveLength(0);
    expect(state().lastError).toMatch(/guarded/);
  });
});

describe("hand edits are counted separately", () => {
  beforeEach(reset);

  it("records the key it touched and takes it back on undo", () => {
    expect(state().editedKeys.size).toBe(0);

    state().editField(BULLET, "Rebuilt the settlement pipeline.", "Edited a bullet");

    expect(state().editedKeys.size).toBe(1);
    expect(state().editedKeys.has(BULLET)).toBe(true);

    state().undo();
    expect(state().editedKeys.size).toBe(0);

    state().redo();
    expect(state().editedKeys.has(BULLET)).toBe(true);
  });

  it("does not count an accepted AI patch as a hand edit", () => {
    const id = state().stagePatch({
      ops: [{ op: "replace", path: BULLET, value: "Rebuilt settlement on Kafka." }],
      rationale: "Tighter.",
    }) as string;
    state().acceptPatch(id);

    expect(state().editedKeys.size).toBe(0);
  });

  it("counts an asserted keyword and not a recovered one", () => {
    state().addSuggestion("gRPC", "recoverable");
    expect(state().editedKeys.size).toBe(0);

    state().addSuggestion("Rust", "missing");
    expect(state().editedKeys.has("asserted:Rust")).toBe(true);
    expect(state().editedKeys.size).toBe(1);
  });
});

describe("the score", () => {
  beforeEach(reset);

  it("moves when a recoverable term is put back", () => {
    const before = overall();
    state().addSuggestion("gRPC", "recoverable");
    expect(overall()).toBeGreaterThan(before);
  });

  it("moves when a field is edited by hand, and moves back on undo", () => {
    const before = overall();

    state().editField(
      pointer("summary", "text"),
      "Backend engineer. Go, Kafka, PostgreSQL, gRPC, Terraform, Kubernetes, idempotency.",
      "Edited the summary",
    );

    const after = overall();
    expect(after).not.toBe(before);
    expect(state().previousOverall).toBeCloseTo(before, 5);

    state().undo();
    expect(overall()).toBeCloseTo(before, 5);
  });

  /*
    16ms is one frame. The score is recomputed synchronously inside every
    keystroke, so if this regresses the whole premise of a live number goes
    with it, and the failure mode is a form that feels broken rather than one
    that looks slow.
  */
  it("recomputes a realistic document inside one frame", () => {
    const { job, facts, doc } = state();

    // Warm the JIT so the measurement is of steady state, not of first run.
    for (let i = 0; i < 5; i += 1) scoreOf(job, facts, doc);

    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) scoreOf(job, facts, doc);
    const each = (performance.now() - start) / runs;

    expect(each).toBeLessThan(16);
  });
});

/*
  The state that exists now and did not before: a resume nobody has aimed at
  anything yet. It is the state every upload starts in, and it used to be
  papered over with a fixture posting, which is how a frontend engineer was
  shown a confident 56 out of 100 computed against an invented backend
  payments role. Null is the truth and the store has to carry it.
*/
describe("a resume with no posting", () => {
  beforeEach(() => {
    useEditorStore.getState().init(unaimedRun());
  });

  it("has no score, no breakdown and nothing to compare against", () => {
    expect(state().job).toBeNull();
    expect(state().report).toBeNull();
    expect(state().breakdown).toBeNull();
    expect(state().previousOverall).toBeNull();
  });

  it("still has a document, and editing it leaves the score absent", () => {
    const before = JSON.stringify(state().doc);

    state().editField(BULLET, "Rebuilt the settlement pipeline.", "Edited a bullet");

    expect(JSON.stringify(state().doc)).not.toBe(before);
    expect(state().editedKeys.has(BULLET)).toBe(true);
    // Absent, not stale and not zero.
    expect(state().report).toBeNull();
    expect(state().breakdown).toBeNull();
    expect(state().previousOverall).toBeNull();

    state().undo();
    expect(JSON.stringify(state().doc)).toBe(before);
    expect(state().report).toBeNull();
  });

  it("stages a patch with no projected score and no delta", () => {
    const id = state().stagePatch({
      ops: [{ op: "replace", path: BULLET, value: "Rebuilt settlement reconciliation in Go." }],
      rationale: "Name the language.",
    });

    expect(id).not.toBeNull();

    const staged = state().pendingPatches[0]!;
    /*
      A number here would be a lie in the most persuasive place on the
      screen: next to an Accept button. There is no posting awarding the
      points, so there are no points to promise.
    */
    expect(staged.projected).toBeNull();
    expect(staged.delta).toBeNull();
  });

  it("applies an accepted patch in full, and only the scoring is missing", () => {
    const before = JSON.stringify(state().doc);
    const id = state().stagePatch({
      ops: [{ op: "replace", path: BULLET, value: "Rebuilt settlement reconciliation in Go." }],
      rationale: "Name the language.",
    }) as string;

    state().acceptPatch(id);

    const doc = state().doc;
    expect(doc.experience[0]!.bullets[0]!.text).toBe(
      "Rebuilt settlement reconciliation in Go.",
    );
    expect(JSON.stringify(doc)).not.toBe(before);
    expect(state().pendingPatches).toHaveLength(0);
    expect(state().history.past).toHaveLength(1);
    expect(state().report).toBeNull();

    // And it is still exactly reversible, which is the invariant at the top
    // of this file holding with no score in the picture.
    state().undo();
    expect(JSON.stringify(state().doc)).toBe(before);
  });

  it("gets a score the moment a posting arrives, with nothing to compare it to", () => {
    const moved = state().loadTailored({
      resumeId: "test",
      versionId: "v2",
      tailored: tailoredOf(state().doc),
      truth: { passed: true, error_count: 0, warning_count: 0, violations: [] },
      gaps: state().gaps,
      job: SAMPLE_JOB,
      persisted: true,
    });

    /*
      `before` is null rather than 0. This run is what created the posting,
      so there was no earlier number, and "+56.0 from 0" would invent a
      baseline that never existed.
    */
    expect(moved.before).toBeNull();
    expect(moved.after).toBeGreaterThan(0);

    expect(state().job).not.toBeNull();
    expect(state().report).not.toBeNull();
    expect(state().breakdown).not.toBeNull();
    expect(overall()).toBeCloseTo(moved.after, 5);
    expect(state().previousOverall).toBeNull();
  });

  it("reports a real movement on the second run, once there is a first", () => {
    const tailored = tailoredOf(state().doc);
    const truth = { passed: true, error_count: 0, warning_count: 0, violations: [] };

    const first = state().loadTailored({
      resumeId: "test",
      versionId: "v2",
      tailored,
      truth,
      gaps: state().gaps,
      job: SAMPLE_JOB,
      persisted: true,
    });

    const second = state().loadTailored({
      resumeId: "test",
      versionId: "v3",
      tailored,
      truth,
      gaps: state().gaps,
      job: SAMPLE_JOB,
      persisted: true,
    });

    expect(second.before).toBeCloseTo(first.after, 5);
  });
});
