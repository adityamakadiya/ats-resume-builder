/**
 * The editor's single source of truth.
 *
 * Three rules hold this together, and everything else in the store is a
 * consequence of one of them.
 *
 *   1. The document changes only through `applyPatch` from `@ats/core`. Not
 *      through a spread, not through a draft mutation, not through a setter on
 *      a field. A typed character becomes a `replace` op before it becomes
 *      state. That is what makes undo exact, the diff honest, and a proposed
 *      AI edit and a hand edit the same kind of thing.
 *
 *   2. Undo is `invertPatch`, computed against the document the ops were
 *      applied to and kept with them. Nothing is snapshotted, so history costs
 *      the size of the edit rather than the size of the resume, and redo is
 *      just the forward ops again.
 *
 *   3. The score is computed, never fetched. `computeAtsReport` is a pure
 *      function of the job, the facts and the document, so it is recomputed
 *      synchronously inside every mutation. There is no loading state on the
 *      number because there is no request behind it.
 *
 * Immer is used for the bookkeeping around the document, not for the document.
 * `editedKeys` is a real `Set`, which needs `enableMapSet`.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import {
  computeAtsReport,
  computeBreakdown,
  type AtsReport,
  type GapAnalysis,
  type JobSpec,
  type Op,
  type ResumeFacts,
  type ScoreBreakdownV2,
  type TailoredResume,
  type TruthReport,
  type TruthViolation,
} from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { addSkillOps, applyDocPatch, invertDocPatch, tailoredOf, validateDocOps } from "@/lib/editor/doc";
import type { EditorRun } from "@/lib/editor/fixtures";

enableMapSet();

/* ---------------------------------------------------------------- types -- */

export type SaveState =
  /*
    Before `init` runs. EditorRoot loads the run in an effect, so the server
    render and the first client paint both happen on the store's initial
    state, and whatever that state claims is asserted about every resume for
    one frame. It used to start as "sample", which put "Sample document, not
    saved — the database schema is not applied yet" above a document that was
    saved, on a schema that was applied. Nothing is known at this point, so
    this says nothing.
  */
  | { kind: "loading" }
  | { kind: "sample" }
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; message: string };

export type PatchOrigin = "ai_tailor" | "ai_chat" | "user";

/** A change that has been proposed and not yet decided. */
export type PendingPatch = {
  id: string;
  ops: Op[];
  rationale: string;
  origin: PatchOrigin;
  /** The score this patch would produce, computed when it was staged. */
  /** Score this patch would produce. Null with no posting to score against. */
  projected: number | null;
  /** `projected` minus the score at the time of staging. */
  /** Points it would move the score by, or null when there is no score. */
  delta: number | null;
};

/** One reversible step. The ops travel with their own inverse. */
export type HistoryEntry = {
  label: string;
  forward: Op[];
  backward: Op[];
  /** Keys this step added to `editedKeys`, so undo can take them back out. */
  keys: string[];
};

export type ChatMessage = {
  id: string;
  role: "you" | "assistant" | "system";
  text: string;
  /** Set while tokens are still arriving. */
  streaming?: boolean;
  /** A patch proposed inside this message, by id. */
  patchId?: string;
};

export type StepState = "waiting" | "running" | "done" | "failed";

export type EditorState = {
  /* the run */
  resumeId: string;
  baseVersionId: string;
  title: string;
  templateId: string;
  saved: boolean;

  /* the inputs the score is a function of */
  job: JobSpec | null;
  facts: ResumeFacts;

  /* the document and everything derived from it */
  doc: ResumeDoc;
  report: AtsReport | null;
  breakdown: ScoreBreakdownV2 | null;
  /** The score before the last mutation, so the delta pill has something to say. */
  /** The score before the last change, so a delta can be shown. Null when
   *  there was no score to move from. */
  previousOverall: number | null;
  truth: TruthReport;
  gaps: GapAnalysis;

  /* editing */
  pendingPatches: PendingPatch[];
  editedKeys: Set<string>;
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  saveState: SaveState;
  lastError: string | null;

  /* the refusal dialog */
  /** Violations the user has explicitly dropped, by index into `truth`. */
  droppedViolations: number[];

  /* chat and the pipeline */
  messages: ChatMessage[];
  steps: Record<string, StepState>;
  streaming: boolean;

  /* view */
  zoom: number;
  showChanges: boolean;
  /** The "Tailor to a job" drawer. */
  tailorOpen: boolean;
};

/**
 * Everything a finished tailoring run hands back.
 *
 * `tailored` is the document without contact details, because the pipeline
 * keeps contact on the facts rather than on the copy it rewrites. The contact
 * block already on screen is the candidate's own and is carried across
 * untouched: a rewrite is not allowed to change a phone number.
 */
export type TailoredRun = {
  resumeId: string;
  versionId: string;
  tailored: TailoredResume;
  truth: TruthReport;
  gaps: GapAnalysis;
  /** The route's own report. The local recomputation is what is displayed. */
  report?: AtsReport;
  job?: JobSpec | null;
  persisted: boolean;
};

export type EditorActions = {
  init: (run: EditorRun) => void;

  /** A hand edit. Records `path` in `editedKeys` so the badge stays honest. */
  editField: (path: string, value: string, label: string) => void;
  /** A structural edit by the user: adding or removing a line. */
  applyUserOps: (ops: Op[], label: string, keys?: string[]) => void;

  addSuggestion: (term: string, kind: "recoverable" | "missing") => void;

  stagePatch: (patch: { ops: Op[]; rationale: string; origin?: PatchOrigin; id?: string }) => string | null;
  acceptPatch: (id: string) => void;
  declinePatch: (id: string) => void;

  undo: () => void;
  redo: () => void;

  setTemplate: (id: string) => void;
  setZoom: (zoom: number) => void;
  toggleShowChanges: () => void;
  setTailorOpen: (open: boolean) => void;

  /**
   * Replace the document with a finished tailoring run.
   *
   * Returns the score before and after so the panel can state the move
   * without guessing at it. History is cleared rather than extended: the run
   * is a new document, not an edit to the old one, and an undo that half
   * reverted it would leave a document neither the model nor the user wrote.
   */
  /** `before` is null when this run produced the first score. */
  loadTailored: (run: TailoredRun) => { before: number | null; after: number };

  dropViolation: (index: number) => void;

  /* chat */
  pushMessage: (message: Omit<ChatMessage, "id"> & { id?: string }) => string;
  appendToken: (id: string, text: string) => void;
  endMessage: (id: string) => void;
  setStep: (step: string, state: StepState) => void;
  setStreaming: (streaming: boolean) => void;
  setTruth: (truth: TruthReport) => void;
};

export type EditorStore = EditorState & EditorActions;

/* ------------------------------------------------------------- helpers -- */

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** The score of a document. Pure, synchronous, and the reason there is no spinner. */
/**
 * The score, or nothing.
 *
 * There is no such thing as an ATS score without a posting to score against:
 * every dimension the scorer computes is a comparison. Returning null is the
 * honest answer, and the UI renders an invitation rather than a figure.
 */
export function scoreOf(
  job: JobSpec | null,
  facts: ResumeFacts,
  doc: ResumeDoc
): AtsReport | null {
  if (!job) return null;
  return computeAtsReport(job, facts, tailoredOf(doc));
}

function breakdownOf(
  job: JobSpec | null,
  facts: ResumeFacts,
  doc: ResumeDoc
): ScoreBreakdownV2 | null {
  if (!job) return null;
  return computeBreakdown(job, facts, tailoredOf(doc));
}

/**
 * The one place the document is allowed to change.
 *
 * Validation runs first, because `validateOps` is what refuses an edit to a
 * guarded employment fact, and an editor that lets you retitle a job and then
 * fails at save time has already lied to you once.
 */
function mutate(
  state: EditorState,
  ops: Op[],
  label: string,
  keys: string[],
): boolean {
  if (ops.length === 0) return false;

  const check = validateDocOps(state.doc, ops);
  if (!check.ok) {
    state.lastError = check.errors[0] ?? "That edit was refused.";
    return false;
  }

  const backward = invertDocPatch(state.doc, ops);
  const next = applyDocPatch(state.doc, ops);

  state.history.past.push({ label, forward: ops, backward, keys });
  state.history.future = [];
  state.doc = next;
  for (const key of keys) state.editedKeys.add(key);

  state.previousOverall = state.report?.overall ?? null;
  state.report = scoreOf(state.job, state.facts, next);
  state.breakdown = breakdownOf(state.job, state.facts, next);
  state.lastError = null;
  if (state.saveState.kind !== "sample") state.saveState = { kind: "dirty" };
  return true;
}

function rescore(state: EditorState) {
  state.previousOverall = state.report?.overall ?? null;
  state.report = scoreOf(state.job, state.facts, state.doc);
  state.breakdown = breakdownOf(state.job, state.facts, state.doc);
}

/* --------------------------------------------------------------- store -- */

const EMPTY_JOB: JobSpec = {
  company: "",
  title: "",
  location: "",
  work_mode: "unspecified",
  employment_type: "",
  experience_years: { min: 0, max: 0, raw: "" },
  requirements: [],
  responsibilities: [],
  keywords: [],
  implicit_requirements: [],
  compensation: "",
  extraction_confidence: "high",
  extraction_notes: "",
};

const EMPTY_FACTS: ResumeFacts = {
  contact: { name: "", email: "", phone: "", location: "", links: [] },
  headline: "",
  summary: "",
  experience: [],
  projects: [],
  education: [],
  skills: [],
  certifications: [],
  other_sections: [],
  total_years_experience: 0,
};

const EMPTY_DOC: ResumeDoc = {
  contact: { name: "", email: "", phone: "", location: "", links: [] },
  headline: "",
  summary: { text: "", source_ids: [] },
  skills: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  other_sections: [],
  section_order: [],
  rewrite_notes: [],
};

export const useEditorStore = create<EditorStore>()(
  immer((set, get) => ({
    resumeId: "",
    baseVersionId: "",
    title: "",
    templateId: "standard",
    saved: false,

    job: null,
    facts: EMPTY_FACTS,

    doc: EMPTY_DOC,
    report: null,
    breakdown: breakdownOf(EMPTY_JOB, EMPTY_FACTS, EMPTY_DOC),
    previousOverall: null,
    truth: { passed: true, error_count: 0, warning_count: 0, violations: [] },
    gaps: {
      strong_matches: [],
      partial_matches: [],
      transferable: [],
      missing: [],
      missing_keywords: [],
      recoverable_keywords: [],
      emphasize: [],
      deemphasize: [],
      recruiter_concerns: [],
      ats_rejection_risks: [],
    },

    pendingPatches: [],
    editedKeys: new Set<string>(),
    history: { past: [], future: [] },
    saveState: { kind: "loading" },
    lastError: null,

    droppedViolations: [],

    messages: [],
    steps: {},
    streaming: false,

    zoom: 1,
    showChanges: true,
    tailorOpen: false,

    /* ------------------------------------------------------------ init -- */

    init: (run) =>
      set((state) => {
        state.resumeId = run.resumeId;
        state.baseVersionId = run.versionId;
        state.title = run.title;
        state.templateId = run.templateId;
        state.saved = run.saved;
        state.job = run.job;
        state.facts = run.facts;
        state.doc = run.doc;
        state.truth = run.truth;
        state.gaps = run.gaps;
        state.report = run.report;
        state.breakdown = breakdownOf(run.job, run.facts, run.doc);
        state.previousOverall = run.report?.overall ?? null;
        state.pendingPatches = [];
        state.editedKeys = new Set<string>();
        state.history = { past: [], future: [] };
        state.droppedViolations = [];
        state.saveState = run.saved ? { kind: "clean" } : { kind: "sample" };
        /*
          There is no refusal dialog any more. It opened itself after every
          run and stacked three labelled blocks per refusal, so the one
          feature that is this product's whole argument was delivered as a
          wall the user closed without reading. Refusals live in the rail
          now, next to the document they are about. See RefusedLines.
        */
        state.messages = [];
        state.steps = {};
      }),

    /* ---------------------------------------------------------- edits -- */

    editField: (path, value, label) =>
      set((state) => {
        mutate(state, [{ op: "replace", path, value }], label, [path]);
      }),

    applyUserOps: (ops, label, keys = []) =>
      set((state) => {
        mutate(state, ops, label, keys);
      }),

    addSuggestion: (term, kind) =>
      set((state) => {
        const ops = addSkillOps(state.doc, term);
        if (ops.length === 0) return;
        /*
          A recoverable term is already somewhere in the parsed resume, so
          putting it back changes nothing about what the document claims and
          is not recorded as a hand edit. A missing term is the user asserting
          something the guard never checked, so it is, and the traced badge
          will say so for as long as it stays on the page.
        */
        const keys = kind === "missing" ? [`asserted:${term}`] : [];
        mutate(state, ops, kind === "missing" ? `Asserted ${term}` : `Restored ${term}`, keys);
      }),

    /* -------------------------------------------------------- patches -- */

    stagePatch: ({ ops, rationale, origin = "ai_chat", id }) => {
      const state = get();
      const check = validateDocOps(state.doc, ops);
      if (!check.ok) {
        set((draft) => {
          draft.lastError = check.errors[0] ?? "That change could not be applied.";
        });
        return null;
      }

      /*
        Projected, not promised: scored against the document as it stands
        now. Null with no posting, because a change cannot be worth points
        when there is nothing awarding them, and a made up delta on an
        Accept button is a lie in the most persuasive possible place.
      */
      const projectedDoc = applyDocPatch(state.doc, ops);
      const projected = scoreOf(state.job, state.facts, projectedDoc)?.overall ?? null;
      const patchId = id ?? nextId("patch");

      set((draft) => {
        draft.pendingPatches.push({
          id: patchId,
          ops,
          rationale,
          origin,
          projected,
          delta:
            projected !== null && draft.report
              ? Math.round((projected - draft.report.overall) * 10) / 10
              : null,
        });
      });
      return patchId;
    },

    acceptPatch: (id) =>
      set((state) => {
        const patch = state.pendingPatches.find((p) => p.id === id);
        if (!patch) return;
        /*
          An accepted AI patch is not a hand edit. The guard ran on it, so its
          lines keep whatever source ids they arrived with and the traced count
          moves on its own. Only `editedKeys` claims are the user's.
        */
        const applied = mutate(state, patch.ops, patch.rationale || "Accepted a change", []);
        state.pendingPatches = state.pendingPatches.filter((p) => p.id !== id);
        if (!applied) return;
      }),

    declinePatch: (id) =>
      set((state) => {
        // Declining touches nothing but the queue. No document, no score.
        state.pendingPatches = state.pendingPatches.filter((p) => p.id !== id);
      }),

    /* -------------------------------------------------------- history -- */

    undo: () =>
      set((state) => {
        const entry = state.history.past.pop();
        if (!entry) return;
        state.doc = applyDocPatch(state.doc, entry.backward);
        for (const key of entry.keys) state.editedKeys.delete(key);
        state.history.future.push(entry);
        rescore(state);
        if (state.saveState.kind !== "sample") state.saveState = { kind: "dirty" };
      }),

    redo: () =>
      set((state) => {
        const entry = state.history.future.pop();
        if (!entry) return;
        state.doc = applyDocPatch(state.doc, entry.forward);
        for (const key of entry.keys) state.editedKeys.add(key);
        state.history.past.push(entry);
        rescore(state);
        if (state.saveState.kind !== "sample") state.saveState = { kind: "dirty" };
      }),

    /* ----------------------------------------------------------- view -- */

    setTemplate: (id) =>
      set((state) => {
        state.templateId = id;
      }),

    setZoom: (zoom) =>
      set((state) => {
        state.zoom = Math.min(1.5, Math.max(0.4, Math.round(zoom * 100) / 100));
      }),

    toggleShowChanges: () =>
      set((state) => {
        state.showChanges = !state.showChanges;
      }),

    setTailorOpen: (open) =>
      set((state) => {
        state.tailorOpen = open;
      }),

    /* -------------------------------------------------------- tailoring -- */

    loadTailored: (run) => {
      // Null on the first run: this is what creates the posting.
      const before = get().report?.overall ?? null;

      set((state) => {
        const doc = { ...run.tailored, contact: state.doc.contact } as ResumeDoc;

        state.doc = doc;
        state.baseVersionId = run.versionId;
        state.resumeId = run.resumeId || state.resumeId;
        if (run.job) state.job = run.job;
        state.gaps = run.gaps;
        state.truth = run.truth;
        state.droppedViolations = [];

        state.previousOverall = before;
        state.report = scoreOf(state.job, state.facts, doc);
        state.breakdown = breakdownOf(state.job, state.facts, doc);

        /*
          A tailoring run is a new document rather than an edit to the old
          one, so the undo stack and the hand-edit ledger both start again.
          Carrying `editedKeys` across would leave the provenance line
          claiming the user had typed lines that no longer exist.
        */
        state.history = { past: [], future: [] };
        state.editedKeys = new Set<string>();
        state.pendingPatches = [];
        state.lastError = null;

        /*
          `persisted:false` means the write was refused, usually because the
          schema is not applied. The document is real either way, and saying
          "saved" when nothing was stored is the one thing this must not do.
        */
        state.saveState = run.persisted ? { kind: "saved", at: Date.now() } : { kind: "sample" };
      });

      return { before, after: get().report?.overall ?? 0 };
    },

    /* ---------------------------------------------------- the refusal -- */

    dropViolation: (index) =>
      set((state) => {
        if (!state.droppedViolations.includes(index)) state.droppedViolations.push(index);
      }),

    /* ----------------------------------------------------------- chat -- */

    pushMessage: (message) => {
      const id = message.id ?? nextId("msg");
      set((state) => {
        state.messages.push({ ...message, id });
      });
      return id;
    },

    appendToken: (id, text) =>
      set((state) => {
        const message = state.messages.find((m) => m.id === id);
        if (message) message.text += text;
      }),

    endMessage: (id) =>
      set((state) => {
        const message = state.messages.find((m) => m.id === id);
        if (message) message.streaming = false;
      }),

    setStep: (step, stepState) =>
      set((state) => {
        state.steps[step] = stepState;
      }),

    setStreaming: (streaming) =>
      set((state) => {
        state.streaming = streaming;
      }),

    setTruth: (truth) =>
      set((state) => {
        state.truth = truth;
        state.droppedViolations = [];
      }),
  })),
);

/* ------------------------------------------------------------ selectors -- */

export const selectCanUndo = (s: EditorStore) => s.history.past.length > 0;
export const selectCanRedo = (s: EditorStore) => s.history.future.length > 0;
export const selectEditedCount = (s: EditorStore) => s.editedKeys.size;

/**
 * Violations the user has not dismissed, paired with their original index.
 *
 * NOT a store selector, and the distinction is load bearing. This builds a
 * new array of new objects on every call, and Zustand 5 compares selector
 * results with Object.is through useSyncExternalStore. Passed straight to
 * useEditorStore it returns a different reference every render, React
 * re-renders because the value changed, the selector runs again, and the
 * component loops until React gives up with "Maximum update depth exceeded".
 * It took the whole editor down behind the error boundary.
 *
 * `useShallow` would not save it either: shallow equality compares the array
 * one level deep, and the elements are freshly built objects.
 *
 * So the derivation happens in the component, memoised on the two stable
 * slices it reads. Select state; derive in render.
 */
export function openViolations(
  violations: readonly TruthViolation[],
  dropped: readonly number[]
): Array<{ index: number; violation: TruthViolation }> {
  return violations
    .map((violation, index) => ({ violation, index }))
    .filter(({ index }) => !dropped.includes(index));
}
