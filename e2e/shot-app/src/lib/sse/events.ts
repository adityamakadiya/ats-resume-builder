/**
 * The event envelope every streaming route writes.
 *
 * One union, declared once, so the browser can `switch (event.t)` and the
 * compiler can tell it when a case is missing. The routes never write an
 * object literal straight onto the wire: they write one of these, and the
 * type is what stops a field being renamed on the server and silently
 * ignored by a client that is still reading the old name.
 *
 * Two deliberate decisions are recorded here rather than in a commit message.
 *
 * `{t:"token"}` is only ever emitted by a route that genuinely has tokens in
 * hand. The tailor route does not: every pipeline step goes through
 * `structured()`, which is a single non-streaming call per step because the
 * output is a strict JSON schema and half a JSON document is not useful to
 * anybody. Emitting invented tokens there would be the same lie as the fake
 * progress bar we are replacing, one layer down. The chat route does stream,
 * so that is where the token events come from.
 *
 * The tailor `done` event carries `persisted`. Supabase has no schema applied
 * on this deployment, so a write can fail for a reason the user cannot act on
 * and must not cost them the run. The result is returned either way, and the
 * flag is how the UI knows whether to offer "saved" or "download this now".
 */

import type {
  AtsReport,
  GapAnalysis,
  Op,
  TailoredResume,
  TruthReport,
  TruthViolation,
} from "@ats/core";

/** The guard's own violation type. Named `Violation` on the wire. */
export type Violation = TruthViolation;

export type StepName = "parse" | "jd" | "gaps" | "tailor" | "guard" | "score";

/** Emitted when a step actually begins and actually ends. Never predicted. */
export type StepEvent = { t: "step"; step: StepName; state: "start" | "done" };

export type TokenEvent = { t: "token"; text: string };

export type GuardEvent = {
  t: "guard";
  passed: boolean;
  violations: Violation[];
  /** True while a rejected draft is being rewritten, so the UI can say so. */
  repairing: boolean;
};

export type ScoreEvent = { t: "score"; report: AtsReport };

/**
 * Something the user can act on. A stack trace is not an event; anything that
 * reaches here has already been turned into a sentence.
 */
export type ErrorEvent = {
  t: "error";
  message: string;
  hint?: string;
  /** The posting's site refused the fetch. The fix is to paste the text. */
  needsJdPaste?: boolean;
};

export type TailorDoneEvent = {
  t: "done";
  resumeId: string;
  versionId: string;
  tailored: TailoredResume;
  truth: TruthReport;
  gaps: GapAnalysis;
  /** False when the database rejected the write. The result above still holds. */
  persisted: boolean;
};

export type TailorEvent =
  | StepEvent
  | TokenEvent
  | GuardEvent
  | ScoreEvent
  | TailorDoneEvent
  | ErrorEvent;

/* ------------------------------------------------------------------ chat  */

/**
 * A proposal, never an applied edit.
 *
 * It reaches the client only after the ops have been applied to a copy and
 * that copy has been through the guard. `scoreDelta` is computed on the same
 * copy, so the number on the Accept button is the number the user will get.
 */
export type PatchEvent = {
  t: "patch";
  id: string;
  ops: Op[];
  rationale: string;
  scoreDelta: number;
};

/**
 * A proposal that was withheld, and why.
 *
 * This is the event that carries the product's whole argument. A suggestion
 * that would put an unsourced metric on the page arrives here, with the
 * violation attached, instead of arriving as a `patch` with an Accept button.
 */
export type RefusedEvent = { t: "refused"; reason: string; violation: Violation };

/**
 * Chat's terminal event.
 *
 * Deliberately not the tailor `done`: chat produces proposals, not a new
 * document, and inventing a `tailored` field here would tempt a client into
 * applying an edit the user never accepted.
 */
export type ChatDoneEvent = { t: "done"; proposed: string[]; refused: number };

export type ChatEvent =
  | StepEvent
  | TokenEvent
  | GuardEvent
  | ScoreEvent
  | PatchEvent
  | RefusedEvent
  | ChatDoneEvent
  | ErrorEvent;
