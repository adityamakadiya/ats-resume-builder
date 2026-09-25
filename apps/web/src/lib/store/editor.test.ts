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
import { countLines, tailoredOf, pointer } from "@/lib/editor/doc";

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

    /*
      The fastest run, not the average.

      This suite runs across twenty-odd parallel workers and the mean picks
      up whatever else the machine was doing, so it measured the scheduler
      as much as the scorer and went red on an unrelated change that only
      made other tests heavier. The minimum is the least-contended sample
      and therefore the closest estimate of what one keystroke actually
      costs. It cannot hide a real regression either: if the true cost went
      over a frame, the fastest run would be over a frame too.
    */
    let fastest = Infinity;
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      scoreOf(job, facts, doc);
      fastest = Math.min(fastest, performance.now() - start);
    }

    expect(fastest).toBeLessThan(16);
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

/*
  EditorRoot calls `init` from an effect, so the server render and the first
  client paint both run on whatever the store starts as. That made the
  initial value a claim about every resume ever opened, for one frame.
*/
describe("the state before the run has loaded", () => {
  it("does not announce a sample document before it knows there is one", () => {
    // The pristine value, not the post-init one every other test sees.
    const initial = useEditorStore.getInitialState();

    // "sample" renders "Sample document, not saved. The database schema is
    // not applied yet, so there is no version to load." Both halves were
    // false on a saved resume with the migrations applied, which is the
    // ordinary case, and it flashed on every single load.
    expect(initial.saveState.kind).toBe("loading");
    expect(initial.saveState.kind).not.toBe("sample");
  });

  it("still says sample once a run arrives that really is one", () => {
    state().init({ ...sampleRun("test"), saved: false });
    expect(state().saveState.kind).toBe("sample");
  });

  it("says clean for a run that was stored", () => {
    state().init({ ...sampleRun("test"), saved: true });
    expect(state().saveState.kind).toBe("clean");
  });
});

/*
  The other half of the truth guard.

  Refusing a claim because no fact supports it is only half an answer: the
  claim is often true and the resume simply never said it. Attesting is how
  the user supplies the missing evidence. What these assert is that it stays
  honest on the way in - the line becomes usable without ever becoming
  something the uploaded document is said to contain.
*/
describe("attesting a fact the resume never carried", () => {
  // Per-describe in this file rather than global. Without it these share a
  // store and the attested line numbering carries over between cases.
  beforeEach(reset);

  it("adds it to the ledger under the role it belongs to", () => {
    const roleId = state().facts.experience[0]!.id;
    const before = state().facts.experience[0]!.bullets.length;

    const key = state().attestFact({
      groupId: roleId,
      text: "Ran Kubernetes in production for the billing service, including the rollout.",
    });

    expect(key).toBe(`${roleId}.A1`);
    expect(state().facts.experience[0]!.bullets).toHaveLength(before + 1);
    expect(state().facts.experience[0]!.bullets.at(-1)!.text).toMatch(/Kubernetes in production/);
  });

  it("numbers attested lines apart from parsed ones so they stay identifiable", () => {
    const roleId = state().facts.experience[0]!.id;
    state().attestFact({ groupId: roleId, text: "First thing I actually did with it." });
    const second = state().attestFact({ groupId: roleId, text: "Second thing I actually did." });

    expect(second).toBe(`${roleId}.A2`);
    // The parsed bullets are .B and must not have been renumbered.
    expect(state().facts.experience[0]!.bullets.some((b) => /\.B1$/.test(b.id))).toBe(true);
  });

  it("does not write into the document, so the user still chooses the placement", () => {
    const roleId = state().facts.experience[0]!.id;
    const before = JSON.stringify(state().doc);

    state().attestFact({ groupId: roleId, text: "Something true that was never on the page." });

    expect(JSON.stringify(state().doc)).toBe(before);
  });

  it("refuses an empty claim and an unknown role", () => {
    expect(state().attestFact({ groupId: state().facts.experience[0]!.id, text: "   " })).toBeNull();
    expect(state().attestFact({ groupId: "nope", text: "A real sentence about real work." })).toBeNull();
  });

  it("never counts an attested line as traced to the resume", () => {
    const roleId = state().facts.experience[0]!.id;
    const key = state().attestFact({
      groupId: roleId,
      text: "Ran Kubernetes in production for the billing service.",
    })!;

    // Put it into the document the way the suggestion machinery would.
    const path = pointer("experience", 0, "bullets", 0);
    state().applyUserOps(
      [{ op: "add", path, value: { text: "Ran Kubernetes in production.", source_ids: [key], keywords: [] } }],
      "Attested line",
      [],
    );

    const { traced, total } = countLines(state().doc);
    const sourced = state().doc.experience[0]!.bullets.filter((b) => b.source_ids.length > 0).length;

    /*
      It has a source id, so a naive count would call it traced. It is not:
      the whole claim this product makes is that a traced line came out of
      the uploaded file, and this one came out of the user. Counting it
      would turn the provenance number into a number that means nothing.
    */
    expect(sourced).toBeGreaterThan(traced === total ? -1 : 0);
    expect(traced).toBeLessThan(total);
  });
});
