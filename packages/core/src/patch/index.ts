/**
 * JSON Pointer operations against a `TailoredResume`.
 *
 * New in the TypeScript port — there is no Python equivalent. The editor needs
 * to propose, preview, accept and undo individual edits, which means a patch
 * has to be: immutable to apply, invertible, derivable from two documents, and
 * checkable against the truth guard's red lines before it is ever shown.
 *
 * Paths are RFC 6901 JSON Pointers: `/experience/0/bullets/2/text`, with `~0`
 * for a literal `~` and `~1` for a literal `/`. `-` is the array-append index,
 * legal for `add` only.
 */

import type { TailoredResume } from '../schema/index.js';

export type OpKind = 'replace' | 'add' | 'remove';

export interface Op {
  op: OpKind;
  path: string;
  value?: unknown;
  /** Fact ids this edit is grounded in. Carried through, never interpreted. */
  source_ids?: string[];
  /** Why the edit was proposed. Carried through, never interpreted. */
  rationale?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Employment facts the truth guard refuses to let an edit touch. A promoted
 * title is the fastest way to lose an offer, and these are the first things a
 * recruiter verifies.
 */
export const PROTECTED_EXPERIENCE_FIELDS: ReadonlySet<string> = new Set([
  'company',
  'title',
  'start_date',
  'end_date',
]);

/* ------------------------------------------------------------------ */
/* Pointer plumbing                                                    */
/* ------------------------------------------------------------------ */

type Json = unknown;

export function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer (must start with "/"): ${path}`);
  }
  return path
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function formatPointer(tokens: readonly string[]): string {
  if (tokens.length === 0) return '';
  return `/${tokens.map((t) => t.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number | null {
  if (token === '-') return allowEnd ? length : null;
  if (!/^(0|[1-9][0-9]*)$/.test(token)) return null;
  const n = Number(token);
  if (n > length) return null;
  if (n === length && !allowEnd) return null;
  return n;
}

/** Resolve a pointer, or return `undefined` with `found: false`. */
export function resolvePointer(
  doc: Json,
  tokens: readonly string[],
): { found: boolean; value: Json } {
  let node: Json = doc;
  for (const token of tokens) {
    if (Array.isArray(node)) {
      const i = arrayIndex(token, node.length, false);
      if (i === null) return { found: false, value: undefined };
      node = node[i];
    } else if (isRecord(node)) {
      if (!Object.prototype.hasOwnProperty.call(node, token)) {
        return { found: false, value: undefined };
      }
      node = node[token];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: node };
}

/**
 * Deep copy of a JSON value.
 *
 * Not `structuredClone`: that is a host global, and this package has to
 * typecheck and run without `lib.dom` or a Node-only global. A
 * `TailoredResume` is plain JSON by construction, so the three cases below
 * are exhaustive.
 */
export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(value)) out[key] = deepClone(value[key]);
    return out as unknown as T;
  }
  return value;
}

const clone = deepClone;

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

function applyOne(root: Json, op: Op): Json {
  const tokens = parsePointer(op.path);
  if (tokens.length === 0) {
    if (op.op === 'replace') return clone(op.value);
    throw new Error(`Cannot ${op.op} the document root`);
  }
  return rebuild(root, tokens, 0, op);
}

function rebuild(node: Json, tokens: readonly string[], depth: number, op: Op): Json {
  const token = tokens[depth];
  if (token === undefined) throw new Error(`Malformed pointer: ${op.path}`);
  const last = depth === tokens.length - 1;

  if (Array.isArray(node)) {
    const next = node.slice();
    const i = arrayIndex(token, node.length, last && op.op === 'add');
    if (i === null) throw new Error(`Path does not resolve: ${op.path}`);
    if (!last) {
      next[i] = rebuild(node[i], tokens, depth + 1, op);
      return next;
    }
    if (op.op === 'add') next.splice(i, 0, clone(op.value));
    else if (op.op === 'remove') next.splice(i, 1);
    else next[i] = clone(op.value);
    return next;
  }

  if (isRecord(node)) {
    const has = Object.prototype.hasOwnProperty.call(node, token);
    if (!last) {
      if (!has) throw new Error(`Path does not resolve: ${op.path}`);
      return { ...node, [token]: rebuild(node[token], tokens, depth + 1, op) };
    }
    if (op.op === 'remove') {
      if (!has) throw new Error(`Path does not resolve: ${op.path}`);
      const next = { ...node };
      delete next[token];
      return next;
    }
    if (op.op === 'replace' && !has) throw new Error(`Path does not resolve: ${op.path}`);
    return { ...node, [token]: clone(op.value) };
  }

  throw new Error(`Path does not resolve: ${op.path}`);
}

/**
 * Apply ops in order and return a new document.
 *
 * The input is never mutated: every node on the path is copied and everything
 * off the path is shared. Values taken from the ops are deep-cloned, so a
 * caller holding on to `op.value` cannot reach into the result afterwards.
 */
export function applyPatch(doc: TailoredResume, ops: readonly Op[]): TailoredResume {
  let node: Json = doc;
  for (const op of ops) node = applyOne(node, op);
  return node as TailoredResume;
}

/* ------------------------------------------------------------------ */
/* Invert                                                              */
/* ------------------------------------------------------------------ */

/**
 * The ops that undo `ops`, in the order they must be applied.
 *
 * `applyPatch(applyPatch(doc, ops), invertPatch(doc, ops))` deep-equals `doc`.
 * Each inverse is computed against the intermediate document the original op
 * saw, then the whole list is reversed, because undoing a sequence means
 * undoing its last step first.
 */
export function invertPatch(doc: TailoredResume, ops: readonly Op[]): Op[] {
  const inverses: Op[] = [];
  let node: Json = doc;

  for (const op of ops) {
    const tokens = parsePointer(op.path);
    const before = resolvePointer(node, tokens);

    if (op.op === 'add') {
      const parentTokens = tokens.slice(0, -1);
      const parent = resolvePointer(node, parentTokens).value;
      if (Array.isArray(parent)) {
        // An add into an array shifts, it does not overwrite: remove it back.
        const last = tokens[tokens.length - 1] ?? '-';
        const index = last === '-' ? parent.length : Number(last);
        inverses.push({ op: 'remove', path: formatPointer([...parentTokens, String(index)]) });
      } else if (before.found) {
        inverses.push({ op: 'replace', path: op.path, value: clone(before.value) });
      } else {
        inverses.push({ op: 'remove', path: op.path });
      }
    } else if (op.op === 'remove') {
      if (!before.found) throw new Error(`Path does not resolve: ${op.path}`);
      inverses.push({ op: 'add', path: op.path, value: clone(before.value) });
    } else {
      if (!before.found) throw new Error(`Path does not resolve: ${op.path}`);
      inverses.push({ op: 'replace', path: op.path, value: clone(before.value) });
    }

    node = applyOne(node, op);
  }

  return inverses.reverse();
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

/**
 * The shortest sensible op list turning `a` into `b`.
 *
 * Arrays are compared index-wise, with a tail of adds or removes for a length
 * change. That is not a minimal edit script — an insertion at the head rewrites
 * every following element — but it is correct, deterministic, and cheap, and
 * resume arrays are short. Removals are emitted highest-index-first so the
 * indices stay valid as the patch is applied.
 */
export function diffDocs(a: TailoredResume, b: TailoredResume): Op[] {
  const ops: Op[] = [];
  walk(a as unknown as Json, b as unknown as Json, [], ops);
  return ops;
}

function walk(a: Json, b: Json, tokens: string[], ops: Op[]): void {
  if (sameValue(a, b)) return;

  if (Array.isArray(a) && Array.isArray(b)) {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i += 1) {
      walk(a[i], b[i], [...tokens, String(i)], ops);
    }
    for (let i = a.length - 1; i >= b.length; i -= 1) {
      ops.push({ op: 'remove', path: formatPointer([...tokens, String(i)]) });
    }
    for (let i = a.length; i < b.length; i += 1) {
      ops.push({ op: 'add', path: formatPointer([...tokens, '-']), value: clone(b[i]) });
    }
    return;
  }

  if (isRecord(a) && isRecord(b)) {
    for (const key of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        ops.push({ op: 'remove', path: formatPointer([...tokens, key]) });
      } else {
        walk(a[key], b[key], [...tokens, key], ops);
      }
    }
    for (const key of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, key)) {
        ops.push({ op: 'add', path: formatPointer([...tokens, key]), value: clone(b[key]) });
      }
    }
    return;
  }

  ops.push({ op: 'replace', path: formatPointer(tokens), value: clone(b) });
}

function sameValue(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]),
    );
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Validate                                                            */
/* ------------------------------------------------------------------ */

/**
 * Is this path an employment fact, or an ancestor of one?
 *
 * `/experience/0/company` is obviously protected. So is `/experience/0`, which
 * would replace the whole block including those fields, and `/experience`,
 * which would rewrite every block. Reordering or deleting a role is an
 * employment-history change too, so those are refused at the same gate.
 */
function protectedPathError(tokens: readonly string[]): string | null {
  if (tokens[0] !== 'experience') return null;
  if (tokens.length === 1) {
    return 'refuses to rewrite the whole experience list: employment history is guarded';
  }
  if (tokens.length === 2) {
    return 'refuses to add, remove or replace an experience block: employment history is guarded';
  }
  const field = tokens[2];
  if (field !== undefined && PROTECTED_EXPERIENCE_FIELDS.has(field)) {
    return `field '${field}' on an experience block is guarded (company, title, start_date, end_date)`;
  }
  return null;
}

/**
 * Check ops against a document before applying them.
 *
 * Every op is checked against the document as the *preceding* ops would have
 * left it, so a sequence that adds a bullet and then edits it validates. The
 * document is never mutated; a failed op stops the walk for that op only and
 * the remaining ops are still reported, so the caller sees every problem at
 * once instead of one per round trip.
 */
export function validateOps(doc: TailoredResume, ops: readonly Op[]): ValidationResult {
  const errors: string[] = [];
  let node: Json = doc;

  ops.forEach((op, i) => {
    const label = `op ${i} (${op.op} ${op.path})`;

    let tokens: string[];
    try {
      tokens = parsePointer(op.path);
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
      return;
    }

    if (tokens.length === 0) {
      errors.push(`${label}: the document root cannot be patched`);
      return;
    }

    const guarded = protectedPathError(tokens);
    if (guarded !== null) {
      errors.push(`${label}: ${guarded}`);
      return;
    }

    if ((op.op === 'replace' || op.op === 'add') && !('value' in op)) {
      errors.push(`${label}: '${op.op}' needs a value`);
      return;
    }
    if (op.op === 'remove' && 'value' in op && op.value !== undefined) {
      errors.push(`${label}: 'remove' must not carry a value`);
      return;
    }

    const parent = resolvePointer(node, tokens.slice(0, -1));
    if (!parent.found) {
      errors.push(`${label}: path does not resolve`);
      return;
    }

    const leaf = tokens[tokens.length - 1] as string;
    if (Array.isArray(parent.value)) {
      const allowEnd = op.op === 'add';
      if (arrayIndex(leaf, parent.value.length, allowEnd) === null) {
        errors.push(`${label}: path does not resolve`);
        return;
      }
    } else if (isRecord(parent.value)) {
      const has = Object.prototype.hasOwnProperty.call(parent.value, leaf);
      if (!has && op.op !== 'add') {
        errors.push(`${label}: path does not resolve`);
        return;
      }
    } else {
      errors.push(`${label}: path does not resolve`);
      return;
    }

    try {
      node = applyOne(node, op);
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
    }
  });

  return { ok: errors.length === 0, errors };
}
