/**
 * The prompt has to obey its own rules.
 *
 * It bans em dashes, in capitals, because one in a resume is the clearest
 * signal a document was machine-drafted. A prompt that bans them while
 * containing them is teaching by counter-example, and the model copies the
 * text it is shown at least as readily as the instruction it is given.
 *
 * The rest pin the parts that are load bearing: if the placement ladder or
 * the banned openers are edited away, the scorer and the writing standard
 * stop agreeing with each other and nothing else would notice.
 */

import { describe, expect, it } from "vitest";
import { PROMPTS, TAILOR } from "./prompts";

const ALL = Object.values(PROMPTS);

describe("every prompt", () => {
  it.each(ALL.map((p) => [p.id, p] as const))("%s uses ASCII punctuation only", (_id, prompt) => {
    // The exact characters the tailor prompt tells the model never to emit.
    expect(prompt.text).not.toMatch(/[–—]/);
    expect(prompt.text).not.toMatch(/[‘’“”]/);
  });

  it.each(ALL.map((p) => [p.id, p] as const))("%s is versioned", (_id, prompt) => {
    // The version is in the cache key. An unversioned edit serves stale
    // answers from before it.
    expect(prompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the tailor prompt", () => {
  it("tells the model where a term is worth most, in the order the scorer pays", () => {
    /*
      The scorer weights a term by zone: a bullet in the current role is
      worth roughly twice the same word in a skills list. If this ladder
      leaves the prompt, the model goes on padding the skills list and the
      score goes down for reasons the prompt never mentioned.
    */
    const text = TAILOR.text;
    expect(text).toMatch(/where a term goes decides what it is worth/i);

    const current = text.indexOf("current or most recent role");
    const older = text.indexOf("older role");
    const skills = text.indexOf("skills list, which is the cheapest");

    expect(current).toBeGreaterThan(-1);
    expect(older).toBeGreaterThan(current);
    expect(skills).toBeGreaterThan(older);
  });

  it("keeps the rules the truth guard depends on", () => {
    const text = TAILOR.text;
    // Each of these has a mechanical check behind it. Dropping the
    // instruction does not relax the check, it just means the model is
    // surprised by it.
    expect(text).toMatch(/may not add a technology, a metric/i);
    expect(text).toMatch(/A FIGURE BELONGS TO ITS OWN ACHIEVEMENT/);
    expect(text).toMatch(/source_ids/);
  });

  it("names every section it is asked to write", () => {
    for (const section of ["HEADLINE", "SUMMARY", "SKILLS", "EXPERIENCE", "PROJECTS", "EDUCATION"]) {
      expect(TAILOR.text).toContain(section);
    }
  });

  it("shows a weak and a strong version rather than only asserting a rule", () => {
    // Told-not-shown is how a prompt produces output that satisfies the
    // letter of a rule and reads like nothing anyone would write.
    const weak = (TAILOR.text.match(/^ {2}weak:/gm) ?? []).length;
    const strong = (TAILOR.text.match(/^ {2}strong:/gm) ?? []).length;

    expect(weak).toBeGreaterThanOrEqual(4);
    expect(strong).toBe(weak);
  });

  it("still bans the openers the scorer penalises", () => {
    for (const opener of ["Helped", "Assisted", "Participated", "Responsible for"]) {
      expect(TAILOR.text).toContain(opener);
    }
  });
});
