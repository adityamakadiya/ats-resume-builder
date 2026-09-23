/**
 * `@ats/core` — the pure-TypeScript brain.
 *
 * Zero I/O, zero React, zero network. Everything here runs identically in a
 * browser, in a Next.js route handler, and in a test, and nothing here reaches
 * for `fetch`, `fs`, `process` or a clock. Determinism is a hard requirement:
 * the same inputs must score the same forever, because a score that drifts
 * cannot be regression-tested or explained to the candidate.
 */

export * from './schema/index.js';
export * from './vocabulary/index.js';
export * from './scoring/index.js';
export * from './sanitize/index.js';
export * from './patch/index.js';
// `pyRound` is re-exported through ./scoring.
