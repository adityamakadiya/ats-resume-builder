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
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Op } from "@ats/core";
import { scoreOf, useEditorStore } from "./editor";
import { sampleRun } from "@/lib/editor/fixtures";
import { pointer } from "@/lib/editor/doc";

const BULLET = pointer("experience", 0, "bullets", 0, "text");

function reset() {
  useEditorStore.getState().init(sampleRun("test"));
}

function state() {
  return useEditorStore.getState();
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
    const score = state().report.overall;

    const id = state().stagePatch({ ops, rationale: "Name the language." });
    expect(id).not.toBeNull();
    expect(state().pendingPatches).toHaveLength(1);

    state().declinePatch(id as string);

    expect(state().pendingPatches).toHaveLength(0);
    expect(JSON.stringify(state().doc)).toBe(doc);
    expect(state().report.overall).toBe(score);
    expect(state().history.past).toHaveLength(0);
  });

  it("accepting updates both and records the score delta", () => {
    const doc = JSON.stringify(state().doc);
    const score = state().report.overall;

    const id = state().stagePatch({ ops, rationale: "Name the language." }) as string;
    const staged = state().pendingPatches[0]!;

    // The delta is computed against a copy, before anything is applied.
    expect(staged.delta).toBeCloseTo(staged.projected - score, 5);

    state().acceptPatch(id);

    expect(JSON.stringify(state().doc)).not.toBe(doc);
    expect(state().report.overall).toBeCloseTo(staged.projected, 5);
    expect(state().report.overall).toBeGreaterThan(score);
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
    const before = state().report.overall;
    state().addSuggestion("gRPC", "recoverable");
    expect(state().report.overall).toBeGreaterThan(before);
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
