import { describe, expect, it } from 'vitest';

import { TailoredResumeSchema, type TailoredResume } from '../src/schema/index';
import {
  applyPatch,
  diffDocs,
  formatPointer,
  invertPatch,
  parsePointer,
  resolvePointer,
  validateOps,
  type Op,
  deepClone,
} from '../src/patch/index';

function doc(): TailoredResume {
  return TailoredResumeSchema.parse({
    headline: 'Backend Engineer',
    summary: { text: 'Ships services.', source_ids: ['SUMMARY'] },
    skills: [{ category: 'Backend', items: ['Node.js', 'PostgreSQL'], source_ids: ['S1'] }],
    experience: [
      {
        source_id: 'E1',
        company: 'Acme Payments',
        title: 'Backend Engineer',
        location: 'Bengaluru',
        start_date: 'Jun 2023',
        end_date: 'Present',
        bullets: [
          { text: 'Added a covering index.', source_ids: ['E1.B1'], keywords: [] },
          { text: 'Cached hot reads in Redis.', source_ids: ['E1.B2'], keywords: [] },
        ],
      },
    ],
    projects: [],
    education: [{ source_id: 'ED1', institution: 'VJTI', degree: 'B.E.', dates: '2019 - 2023' }],
    certifications: [],
    other_sections: [],
    section_order: [],
    rewrite_notes: [],
  });
}

const B0 = '/experience/0/bullets/0/text';

describe('pointer plumbing', () => {
  it('round-trips escaped tokens', () => {
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(formatPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
    expect(parsePointer('')).toEqual([]);
    expect(formatPointer([])).toBe('');
  });

  it('rejects a pointer that does not start with a slash', () => {
    expect(() => parsePointer('experience/0')).toThrow();
  });

  it('reports whether a path resolves', () => {
    const d = doc();
    expect(resolvePointer(d, parsePointer(B0))).toEqual({
      found: true,
      value: 'Added a covering index.',
    });
    expect(resolvePointer(d, parsePointer('/experience/9/title')).found).toBe(false);
    expect(resolvePointer(d, parsePointer('/nope')).found).toBe(false);
    // An index equal to the length is out of range for a read.
    expect(resolvePointer(d, parsePointer('/experience/1')).found).toBe(false);
  });
});

describe('applyPatch', () => {
  it('replaces a leaf without mutating the input', () => {
    const before = doc();
    const snapshot = deepClone(before);
    const after = applyPatch(before, [{ op: 'replace', path: B0, value: 'Added a partial index.' }]);

    expect(after.experience[0]!.bullets[0]!.text).toBe('Added a partial index.');
    expect(before).toEqual(snapshot);
    expect(before.experience[0]!.bullets[0]!.text).toBe('Added a covering index.');
  });

  it('shares every node that is off the edited path', () => {
    const before = doc();
    const after = applyPatch(before, [{ op: 'replace', path: B0, value: 'x' }]);
    expect(after).not.toBe(before);
    expect(after.experience).not.toBe(before.experience);
    expect(after.experience[0]!.bullets[1]).toBe(before.experience[0]!.bullets[1]);
    expect(after.education).toBe(before.education);
    expect(after.skills).toBe(before.skills);
  });

  it('adds into an array at an index and at the append marker', () => {
    const base = doc();
    const head = applyPatch(base, [
      { op: 'add', path: '/experience/0/bullets/0', value: { text: 'first', source_ids: [], keywords: [] } },
    ]);
    expect(head.experience[0]!.bullets.map((b) => b.text)).toEqual([
      'first',
      'Added a covering index.',
      'Cached hot reads in Redis.',
    ]);

    const tail = applyPatch(base, [
      { op: 'add', path: '/experience/0/bullets/-', value: { text: 'last', source_ids: [], keywords: [] } },
    ]);
    expect(tail.experience[0]!.bullets.map((b) => b.text)).toEqual([
      'Added a covering index.',
      'Cached hot reads in Redis.',
      'last',
    ]);
  });

  it('removes an array element', () => {
    const after = applyPatch(doc(), [{ op: 'remove', path: '/experience/0/bullets/0' }]);
    expect(after.experience[0]!.bullets.map((b) => b.text)).toEqual(['Cached hot reads in Redis.']);
  });

  it('adds and removes an object member', () => {
    const added = applyPatch(doc(), [{ op: 'add', path: '/summary/note', value: 'hi' }]);
    expect((added.summary as unknown as Record<string, unknown>)['note']).toBe('hi');
    const removed = applyPatch(added, [{ op: 'remove', path: '/summary/note' }]);
    expect('note' in removed.summary).toBe(false);
  });

  it('deep-clones op values, so the caller cannot reach into the result', () => {
    const value = { text: 'shared', source_ids: ['E1.B1'], keywords: [] };
    const after = applyPatch(doc(), [{ op: 'add', path: '/experience/0/bullets/-', value }]);
    value.source_ids.push('TAMPERED');
    expect(after.experience[0]!.bullets[2]!.source_ids).toEqual(['E1.B1']);
  });

  it('applies a sequence in order', () => {
    const after = applyPatch(doc(), [
      { op: 'add', path: '/experience/0/bullets/-', value: { text: 'new', source_ids: [], keywords: [] } },
      { op: 'replace', path: '/experience/0/bullets/2/text', value: 'newer' },
    ]);
    expect(after.experience[0]!.bullets[2]!.text).toBe('newer');
  });

  it('throws on a path that does not resolve', () => {
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/nope/0', value: 1 }])).toThrow(
      /does not resolve/,
    );
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/summary/absent', value: 1 }])).toThrow(
      /does not resolve/,
    );
    expect(() => applyPatch(doc(), [{ op: 'remove', path: '/experience/0/bullets/9' }])).toThrow(
      /does not resolve/,
    );
  });
});

describe('invertPatch round-trips', () => {
  const cases: ReadonlyArray<readonly [string, Op[]]> = [
    ['replace a leaf string', [{ op: 'replace', path: B0, value: 'rewritten' }]],
    ['replace a whole object', [
      { op: 'replace', path: '/summary', value: { text: 'new', source_ids: [] } },
    ]],
    ['replace an array', [{ op: 'replace', path: '/section_order', value: ['skills'] }]],
    ['add at an array index', [
      { op: 'add', path: '/experience/0/bullets/0', value: { text: 'head', source_ids: [], keywords: [] } },
    ]],
    ['add at the append marker', [
      { op: 'add', path: '/experience/0/bullets/-', value: { text: 'tail', source_ids: [], keywords: [] } },
    ]],
    ['add an object member', [{ op: 'add', path: '/summary/note', value: 'hi' }]],
    ['add over an existing object member', [{ op: 'add', path: '/headline', value: 'Staff Engineer' }]],
    ['remove an array element', [{ op: 'remove', path: '/experience/0/bullets/1' }]],
    ['remove the only education row', [{ op: 'remove', path: '/education/0' }]],
    ['remove an object member', [{ op: 'remove', path: '/summary/source_ids' }]],
    ['a mixed sequence', [
      { op: 'replace', path: B0, value: 'one' },
      { op: 'add', path: '/experience/0/bullets/-', value: { text: 'two', source_ids: [], keywords: [] } },
      { op: 'remove', path: '/experience/0/bullets/0' },
      { op: 'replace', path: '/headline', value: 'Three' },
    ]],
  ];

  it.each(cases)('%s', (_name, ops) => {
    const original = doc();
    const snapshot = deepClone(original);

    const patched = applyPatch(original, ops);
    const inverse = invertPatch(original, ops);
    const restored = applyPatch(patched, inverse);

    expect(restored).toEqual(snapshot);
    expect(original).toEqual(snapshot); // neither call mutated the input
    expect(patched).not.toEqual(snapshot); // the ops actually did something
  });

  it('refuses to invert an op whose path does not resolve', () => {
    expect(() => invertPatch(doc(), [{ op: 'remove', path: '/experience/0/bullets/9' }])).toThrow();
  });
});

describe('diffDocs', () => {
  it('produces nothing for identical documents', () => {
    expect(diffDocs(doc(), doc())).toEqual([]);
  });

  it('round-trips an arbitrary edit', () => {
    const a = doc();
    const b = applyPatch(a, [
      { op: 'replace', path: B0, value: 'Added a partial index on tenant_id.' },
      { op: 'add', path: '/experience/0/bullets/-', value: { text: 'Batched the writes.', source_ids: ['E1.B3'], keywords: [] } },
      { op: 'replace', path: '/headline', value: 'Senior Backend Engineer' },
    ]);

    const ops = diffDocs(a, b);
    expect(ops.length).toBeGreaterThan(0);
    expect(applyPatch(a, ops)).toEqual(b);
  });

  it('handles a shrinking array, emitting removes from the tail inwards', () => {
    const a = doc();
    const b = applyPatch(a, [{ op: 'remove', path: '/experience/0/bullets/1' }]);
    const ops = diffDocs(a, b);
    expect(applyPatch(a, ops)).toEqual(b);
  });

  it('handles a growing array', () => {
    const a = doc();
    const b = applyPatch(a, [
      { op: 'add', path: '/projects/-', value: { source_id: 'P1', name: 'Ledger', url: '', bullets: [] } },
    ]);
    expect(applyPatch(a, diffDocs(a, b))).toEqual(b);
  });

  it('is invertible through invertPatch', () => {
    const a = doc();
    const b = applyPatch(a, [{ op: 'replace', path: '/summary/text', value: 'Different.' }]);
    const ops = diffDocs(a, b);
    expect(applyPatch(applyPatch(a, ops), invertPatch(a, ops))).toEqual(a);
  });
});

describe('validateOps', () => {
  it('accepts an edit to a bullet', () => {
    expect(validateOps(doc(), [{ op: 'replace', path: B0, value: 'fine' }])).toEqual({
      ok: true,
      errors: [],
    });
  });

  it('accepts a sequence where a later op depends on an earlier one', () => {
    const result = validateOps(doc(), [
      { op: 'add', path: '/experience/0/bullets/-', value: { text: 'new', source_ids: [], keywords: [] } },
      { op: 'replace', path: '/experience/0/bullets/2/text', value: 'newer' },
    ]);
    expect(result.ok).toBe(true);
  });

  it.each([
    '/experience/0/company',
    '/experience/0/title',
    '/experience/0/start_date',
    '/experience/0/end_date',
  ])('rejects an edit to %s', (path) => {
    const result = validateOps(doc(), [{ op: 'replace', path, value: 'Fictional Corp' }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/guarded/);
  });

  it('rejects replacing or removing a whole experience block or the list', () => {
    for (const path of ['/experience', '/experience/0']) {
      expect(validateOps(doc(), [{ op: 'replace', path, value: {} }]).ok).toBe(false);
      expect(validateOps(doc(), [{ op: 'remove', path }]).ok).toBe(false);
    }
  });

  it('allows the unguarded fields of an experience block', () => {
    expect(validateOps(doc(), [{ op: 'replace', path: '/experience/0/location', value: 'Pune' }]).ok).toBe(true);
    expect(validateOps(doc(), [{ op: 'replace', path: B0, value: 'x' }]).ok).toBe(true);
  });

  it('rejects paths that do not resolve', () => {
    const result = validateOps(doc(), [
      { op: 'replace', path: '/experience/9/bullets/0/text', value: 'x' },
      { op: 'replace', path: '/summary/absent', value: 'x' },
      { op: 'remove', path: '/skills/0/items/5' },
      { op: 'replace', path: '/skills/0/items/1/deeper', value: 'x' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(4);
    for (const message of result.errors) expect(message).toMatch(/does not resolve/);
  });

  it('reports every bad op, not just the first', () => {
    const result = validateOps(doc(), [
      { op: 'replace', path: '/experience/0/company', value: 'X' },
      { op: 'replace', path: B0, value: 'fine' },
      { op: 'replace', path: '/nope', value: 'X' },
    ]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('op 0');
    expect(result.errors[1]).toContain('op 2');
  });

  it('rejects a malformed pointer and the document root', () => {
    expect(validateOps(doc(), [{ op: 'replace', path: 'headline', value: 'x' }]).ok).toBe(false);
    expect(validateOps(doc(), [{ op: 'replace', path: '', value: {} }]).ok).toBe(false);
  });

  it('rejects a value-less replace and a value-carrying remove', () => {
    expect(validateOps(doc(), [{ op: 'replace', path: '/headline' }]).ok).toBe(false);
    expect(validateOps(doc(), [{ op: 'remove', path: '/headline', value: 'x' }]).ok).toBe(false);
  });

  it('never mutates the document it is checking', () => {
    const d = doc();
    const snapshot = deepClone(d);
    validateOps(d, [
      { op: 'replace', path: B0, value: 'changed' },
      { op: 'remove', path: '/experience/0/bullets/1' },
    ]);
    expect(d).toEqual(snapshot);
  });

  it('carries source_ids and rationale through without interpreting them', () => {
    const op: Op = {
      op: 'replace',
      path: B0,
      value: 'Added a partial index.',
      source_ids: ['E1.B1'],
      rationale: 'Names the mechanism.',
    };
    expect(validateOps(doc(), [op]).ok).toBe(true);
    expect(applyPatch(doc(), [op]).experience[0]!.bullets[0]!.text).toBe('Added a partial index.');
  });
});
