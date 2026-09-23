/**
 * Port of `backend/src/atsresume/pipeline/sanitize.py`.
 *
 * The em dash is the single most recognisable tell that a document was drafted
 * by a language model, and smart quotes / NBSPs / zero-width joiners break
 * literal keyword matching in ATS parsers. Both are fixed in code rather than
 * asked for in a prompt.
 *
 * The replacement map is character-identical to the Python one. It is written
 * with `\uXXXX` escapes here so that an editor normalising the file, or a
 * reviewer eyeballing two visually identical dashes, cannot silently change it.
 * The codepoints, in source order:
 *
 *   U+2018 U+2019 U+201A U+201C U+201D U+201E U+2026 U+00A0 U+202F U+2009
 *   U+200B U+200C U+200D U+FEFF U+2212 U+00AD U+2022 U+25CF U+2192 U+2713
 *   U+00B7
 *
 * Unlike the Python, `sanitize()` here is **immutable**: Pydantic models are
 * mutated in place there, but this package is used from React state where that
 * is a bug. A new document is returned; the input is untouched.
 */

import type { TailoredBullet, TailoredResume } from '../schema/index.js';

/** Spaced dash separating clauses; becomes the separator. */
const SPACED_DASH = /\s*[–—]\s+/g;
/** Unspaced dash is nearly always standing in for a hyphen or a range. */
const TIGHT_DASH = /[–—]/g;

export const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['…', '...'],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  ['​', ''],
  ['‌', ''],
  ['‍', ''],
  ['﻿', ''],
  ['−', '-'],
  ['­', ''],
  ['•', '-'],
  ['●', '-'],
  ['→', '->'],
  ['✓', ''],
  ['·', ','],
];

const TIDY: ReadonlyArray<readonly [RegExp, string]> = [
  [/\s*,\s*,+/g, ', '],
  [/,\s*([.;:!?])/g, '$1'],
  [/\s+([.,;:!?])/g, '$1'],
  [/[ \t]{2,}/g, ' '],
];

/**
 * ASCII-safe, dash-free text.
 *
 * `separator` is what a spaced dash becomes. A headline reads better with a
 * pipe, which is ordinary resume convention; prose wants a comma.
 */
export function cleanText(value: string, separator = ', '): string {
  if (!value) return value;

  let text = value;
  for (const [bad, good] of REPLACEMENTS) {
    text = text.split(bad).join(good);
  }

  text = text.replace(SPACED_DASH, separator);
  text = text.replace(TIGHT_DASH, '-');

  for (const [pattern, repl] of TIDY) {
    text = text.replace(pattern, repl);
  }

  return text.trim();
}

function cleanBullets(bullets: readonly TailoredBullet[]): TailoredBullet[] {
  return bullets.map((b) => ({ ...b, text: cleanText(b.text) }));
}

/**
 * Clean every field the model authored. Ids and dates are left alone.
 *
 * Returns a new document; the input is not mutated.
 */
export function sanitize(tailored: TailoredResume): TailoredResume {
  return {
    ...tailored,
    headline: cleanText(tailored.headline, ' | '),
    summary: { ...tailored.summary, text: cleanText(tailored.summary.text) },
    skills: tailored.skills.map((group) => ({
      ...group,
      category: cleanText(group.category),
      items: group.items.filter((item) => item.trim()).map((item) => cleanText(item)),
    })),
    experience: tailored.experience.map((exp) => ({
      ...exp,
      company: cleanText(exp.company),
      title: cleanText(exp.title),
      location: cleanText(exp.location),
      bullets: cleanBullets(exp.bullets),
    })),
    projects: tailored.projects.map((proj) => ({
      ...proj,
      name: cleanText(proj.name),
      bullets: cleanBullets(proj.bullets),
    })),
    education: tailored.education.map((edu) => ({
      ...edu,
      institution: cleanText(edu.institution),
      degree: cleanText(edu.degree),
    })),
    certifications: tailored.certifications.map((cert) => ({
      ...cert,
      text: cleanText(cert.text),
    })),
    other_sections: tailored.other_sections.map((section) => ({
      ...section,
      heading: cleanText(section.heading),
      bullets: cleanBullets(section.bullets),
    })),
    rewrite_notes: tailored.rewrite_notes.map((note) => cleanText(note)),
  };
}

/** Any text still carrying a dash or a non-ASCII character. Used by tests. */
export function containsTells(tailored: TailoredResume): string[] {
  const fields: string[] = [tailored.headline, tailored.summary.text];
  for (const group of tailored.skills) {
    fields.push(group.category);
    fields.push(...group.items);
  }
  for (const exp of tailored.experience) {
    fields.push(exp.company, exp.title);
    fields.push(...exp.bullets.map((b) => b.text));
  }
  for (const proj of tailored.projects) {
    fields.push(proj.name);
    fields.push(...proj.bullets.map((b) => b.text));
  }
  for (const cert of tailored.certifications) fields.push(cert.text);
  for (const section of tailored.other_sections) {
    fields.push(section.heading);
    fields.push(...section.bullets.map((b) => b.text));
  }

  // `any(ord(ch) > 127 ...)`. Iterating the string by code unit is enough:
  // every unit of a surrogate pair is already above 127.
  return fields.filter((text) => {
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) > 127) return true;
    }
    return false;
  });
}
