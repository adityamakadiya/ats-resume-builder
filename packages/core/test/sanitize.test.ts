/**
 * Parity with `backend/src/atsresume/pipeline/sanitize.py`.
 *
 * Every expectation is what the Python produces. The one deliberate
 * difference is that `sanitize()` returns a new document instead of mutating
 * the Pydantic model in place, because this package is used from React state.
 */

import { describe, expect, it } from 'vitest';

import { TailoredResumeSchema, type TailoredResume } from '../src/schema/index.js';
import { REPLACEMENTS, cleanText, containsTells, sanitize } from '../src/sanitize/index.js';

describe('cleanText', () => {
  it.each([
    // Spaced dash -> separator. Note `\s*[–—]\s+`: the trailing space is
    // required, the leading one is not.
    ['Shipped it — fast', 'Shipped it, fast'],
    ['Shipped it— fast', 'Shipped it, fast'],
    ['Shipped it – fast', 'Shipped it, fast'],
    // Unspaced dash -> hyphen.
    ['2019–2023', '2019-2023'],
    ['multi—tenant', 'multi-tenant'],
    // A trailing dash has no following space, so it is a tight dash.
    ['ends with—', 'ends with-'],

    // Quotes and ellipsis.
    ['‘single’', "'single'"],
    ['“double”', '"double"'],
    ['‚one„', '\'one"'],
    ['wait…', 'wait...'],

    // Spaces that are not spaces.
    ['a b', 'a b'],
    ['a b', 'a b'],
    ['a b', 'a b'],

    // Invisibles.
    ['a​b', 'ab'],
    ['a‌b', 'ab'],
    ['a‍b', 'ab'],
    ['﻿leading bom', 'leading bom'],
    ['soft­hyphen', 'softhyphen'],

    // Symbols.
    ['− 5', '- 5'],
    ['• bullet', '- bullet'],
    ['● bullet', '- bullet'],
    ['a → b', 'a -> b'],
    ['✓ done', 'done'], // check mark -> "", then the space is trimmed
    ['a · b', 'a, b'],

    // The tidy passes.
    ['a , , b', 'a, b'],
    ['end , .', 'end.'],
    ['space  before , comma', 'space before, comma'],
    ['too    many     spaces', 'too many spaces'],
    ['  trim me  ', 'trim me'],

    // Nothing to do.
    ['Plain ASCII text.', 'Plain ASCII text.'],
    ['', ''],
  ] as const)('cleanText(%j) === %j', (input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });

  it('takes a separator, as a headline wants a pipe', () => {
    expect(cleanText('Backend Engineer — Payments', ' | ')).toBe(
      'Backend Engineer | Payments',
    );
  });

  it('leaves a falsy value exactly as it was', () => {
    expect(cleanText('')).toBe('');
  });

  it('has a replacement map with no duplicate keys', () => {
    const keys = REPLACEMENTS.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(21);
  });

  it('leaves no non-ASCII character behind for any mapped codepoint', () => {
    for (const [bad] of REPLACEMENTS) {
      const out = cleanText(`x${bad}y`);
      for (let i = 0; i < out.length; i += 1) expect(out.charCodeAt(i)).toBeLessThanOrEqual(127);
    }
  });
});

function dirty(): TailoredResume {
  return TailoredResumeSchema.parse({
    headline: 'Backend Engineer — Payments',
    summary: { text: 'Ships services — reliably…', source_ids: ['SUMMARY'] },
    skills: [
      { category: 'Backend ', items: ['Node.js', '  ', '• Redis'], source_ids: ['S1'] },
    ],
    experience: [
      {
        source_id: 'E1',
        company: 'Acme Payments',
        title: 'Backend–Engineer',
        location: 'Bengaluru ',
        start_date: 'Jun 2023',
        end_date: 'Present',
        bullets: [{ text: 'Cut p95 — by 40%', source_ids: ['E1.B1'], keywords: [] }],
      },
    ],
    projects: [
      {
        source_id: 'P1',
        name: 'Ledger…',
        url: '',
        bullets: [{ text: 'Batched writes → fewer round trips', source_ids: ['P1.B1'], keywords: [] }],
      },
    ],
    education: [
      { source_id: 'ED1', institution: 'VJTI ', degree: 'B.E.–CS', dates: '2019–2023' },
    ],
    certifications: [{ source_id: 'C1', text: 'AWS SAA — 2024' }],
    other_sections: [
      { source_id: 'O1', heading: 'Open Source', bullets: [{ text: '• Maintainer', source_ids: ['O1.B1'], keywords: [] }] },
    ],
    section_order: [],
    rewrite_notes: ['Reordered — for relevance'],
  });
}

describe('sanitize', () => {
  it('cleans every authored field', () => {
    const out = sanitize(dirty());

    expect(out.headline).toBe('Backend Engineer | Payments');
    expect(out.summary.text).toBe('Ships services, reliably...');
    expect(out.skills[0]!.category).toBe('Backend');
    expect(out.skills[0]!.items).toEqual(['Node.js', '- Redis']); // the blank item is dropped
    expect(out.experience[0]!.company).toBe('Acme Payments');
    expect(out.experience[0]!.title).toBe('Backend-Engineer');
    expect(out.experience[0]!.location).toBe('Bengaluru');
    expect(out.experience[0]!.bullets[0]!.text).toBe('Cut p95, by 40%');
    expect(out.projects[0]!.name).toBe('Ledger...');
    expect(out.projects[0]!.bullets[0]!.text).toBe('Batched writes -> fewer round trips');
    expect(out.education[0]!.institution).toBe('VJTI');
    expect(out.education[0]!.degree).toBe('B.E.-CS');
    expect(out.certifications[0]!.text).toBe('AWS SAA, 2024');
    expect(out.other_sections[0]!.heading).toBe('Open Source');
    expect(out.other_sections[0]!.bullets[0]!.text).toBe('- Maintainer');
    expect(out.rewrite_notes).toEqual(['Reordered, for relevance']);
  });

  it('leaves ids and dates alone', () => {
    const out = sanitize(dirty());
    expect(out.experience[0]!.source_id).toBe('E1');
    expect(out.experience[0]!.start_date).toBe('Jun 2023');
    expect(out.experience[0]!.end_date).toBe('Present');
    expect(out.summary.source_ids).toEqual(['SUMMARY']);
    // education.dates is not in the Python's clean list either, en dash and all
    expect(out.education[0]!.dates).toBe('2019–2023');
  });

  it('does not mutate the input, unlike the Python', () => {
    const before = dirty();
    const snapshot = structuredClone(before);
    sanitize(before);
    expect(before).toEqual(snapshot);
  });

  it('is idempotent', () => {
    const once = sanitize(dirty());
    expect(sanitize(once)).toEqual(once);
  });
});

describe('containsTells', () => {
  it('finds every field still carrying a non-ASCII character', () => {
    const tells = containsTells(dirty());
    expect(tells.length).toBeGreaterThan(0);
    expect(tells).toContain('Backend Engineer — Payments');
    expect(tells).toContain('Acme Payments');
  });

  it('finds nothing once the document has been sanitized', () => {
    // `education.dates` is not one of the fields containsTells inspects, which
    // is why the en dash it keeps does not show up here.
    expect(containsTells(sanitize(dirty()))).toEqual([]);
  });

  it('inspects the same field list as the Python', () => {
    const clean = sanitize(dirty());
    const withTell = {
      ...clean,
      certifications: [{ source_id: 'C1', text: 'AWS SAA — 2024' }],
    };
    expect(containsTells(withTell)).toEqual(['AWS SAA — 2024']);
  });
});
