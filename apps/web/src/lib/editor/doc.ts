/**
 * The bridge between the two names the same document goes by.
 *
 * `@ats/core` patches and scores a `TailoredResume`. `@ats/templates` renders
 * a `ResumeDoc`, which is that plus `contact`. Rather than teach either side
 * about the other, every crossing goes through this file, so there is exactly
 * one place where the join is made and exactly one place to change if the two
 * shapes ever drift.
 *
 * `applyPatch` copies with `deepClone`, which walks `Object.keys`, so `contact`
 * survives a patch untouched. The cast below is that fact written down rather
 * than assumed.
 */

import {
  applyPatch,
  invertPatch,
  validateOps,
  type Op,
  type TailoredResume,
} from "@ats/core";
import type { ResumeDoc } from "@ats/templates";

/** The scoring and guard layers want the document without contact details. */
export function tailoredOf(doc: ResumeDoc): TailoredResume {
  const { contact: _contact, ...tailored } = doc;
  return tailored;
}

/** Apply ops to the renderable document. Never mutates the input. */
export function applyDocPatch(doc: ResumeDoc, ops: readonly Op[]): ResumeDoc {
  return applyPatch(doc, ops) as ResumeDoc;
}

/** The ops that undo `ops` against `doc`, in the order they must be applied. */
export function invertDocPatch(doc: ResumeDoc, ops: readonly Op[]): Op[] {
  return invertPatch(doc, ops);
}

/** Checks ops against the document, including the guarded employment fields. */
export function validateDocOps(doc: ResumeDoc, ops: readonly Op[]) {
  return validateOps(doc, ops);
}

/* ------------------------------------------------------------ pointers -- */

/**
 * A JSON Pointer built from parts, with the RFC 6901 escapes applied.
 *
 * Every mutation in the editor names its target this way, because the pointer
 * is also the key the edit is recorded under. One spelling means the traced
 * badge and the patch log cannot disagree about what was touched.
 */
export function pointer(...parts: Array<string | number>): string {
  return parts
    .map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1"))
    .map((part) => `/${part}`)
    .join("");
}

/** Reads a string leaf at a pointer, or the empty string when it is absent. */
export function readString(doc: ResumeDoc, path: string): string {
  const tokens = path
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));

  let node: unknown = doc;
  for (const token of tokens) {
    if (Array.isArray(node)) node = node[Number(token)];
    else if (node && typeof node === "object") {
      node = (node as Record<string, unknown>)[token];
    } else return "";
  }
  return typeof node === "string" ? node : "";
}

/* -------------------------------------------------------------- counts -- */

/**
 * How many lines carry at least one source id.
 *
 * Deliberately not called "verified". The guard checked that the model's lines
 * trace back to something the original resume says; it has no opinion about a
 * line the user typed afterwards, and the badge has to say so.
 */
export function countLines(doc: ResumeDoc): { total: number; traced: number } {
  let total = 0;
  let traced = 0;

  const line = (text: string, sourceIds: string[]) => {
    if (!text.trim()) return;
    total += 1;
    if (sourceIds.length > 0) traced += 1;
  };

  line(doc.summary.text, doc.summary.source_ids);
  for (const group of doc.skills) line(group.items.join(", "), group.source_ids);
  for (const exp of doc.experience) for (const b of exp.bullets) line(b.text, b.source_ids);
  for (const proj of doc.projects) for (const b of proj.bullets) line(b.text, b.source_ids);
  for (const sec of doc.other_sections) for (const b of sec.bullets) line(b.text, b.source_ids);

  return { total, traced };
}

/* ----------------------------------------------------------- skill slot -- */

/**
 * Where a suggested term should land.
 *
 * A suggestion that drops into the wrong group means tidying up after every
 * click, so this looks for a group whose name shares a word with the term,
 * falls back to the first group, and only then proposes a new one. Returns the
 * ops rather than performing them: the store is the only thing that mutates.
 */
export function addSkillOps(doc: ResumeDoc, term: string): Op[] {
  const clean = term.trim();
  if (!clean) return [];

  const already = doc.skills.some((g) =>
    g.items.some((i) => i.toLowerCase() === clean.toLowerCase()),
  );
  if (already) return [];

  const words = clean.toLowerCase().split(/[\s/]+/);
  const index = doc.skills.findIndex((g) =>
    words.some((w) => w.length > 3 && g.category.toLowerCase().includes(w)),
  );
  const target = index >= 0 ? index : doc.skills.length > 0 ? 0 : -1;

  if (target === -1) {
    return [
      {
        op: "add",
        path: pointer("skills", "-"),
        value: { category: "Skills", items: [clean], source_ids: [] },
      },
    ];
  }

  return [{ op: "add", path: pointer("skills", target, "items", "-"), value: clean }];
}
