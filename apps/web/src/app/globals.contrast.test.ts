/**
 * The palette has to stay readable.
 *
 * This exists because it did not. `--ink-faint` shipped at #8a94a6, which is
 * 3.05:1 on white, and a redesign agent found it with axe only after building
 * five screens on top of it. It is exactly the colour a product reaches for
 * when text is "secondary", which in practice means timestamps, counts,
 * helper lines and empty-state copy, all of which somebody has to read.
 *
 * A palette is a contract and this is the test for it. Picking a colour
 * because it looks right in one place, on one monitor, at one time of day is
 * how the last one happened.
 *
 * The threshold is WCAG AA for normal text, 4.5:1, measured against the
 * WORST surface each colour can land on rather than against white. Text on
 * this product sits on three grounds and the sunk one is darkest, so passing
 * on white proves nothing.
 *
 * Large text is allowed 3:1 by the standard. That allowance is not used
 * here: a token cannot know how big the text using it will be, and the one
 * that failed was failing precisely because it was used at small sizes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

/** Read a custom property out of the `:root` block. */
function token(name: string): string {
  const root = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf(".dark {"));
  const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`--${name} is not a literal hex in :root`);
  return match[1].toLowerCase();
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x! > y! ? [x!, y!] : [y!, x!];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe("the palette meets WCAG AA on every surface it lands on", () => {
  const surfaces = () => ({
    page: token("paper"),
    raised: token("paper-raised"),
    sunk: token("paper-sunk"),
  });

  const foregrounds = ["ink", "ink-muted", "ink-faint", "stamp", "traced", "caution", "refused"];

  it.each(foregrounds)("--%s is readable on the page, on white and on a well", (name) => {
    const fg = token(name);
    const { page, raised, sunk } = surfaces();

    for (const [label, bg] of Object.entries({ page, raised, sunk })) {
      const ratio = contrast(fg, bg);
      expect(
        ratio,
        `--${name} (${fg}) on --paper-${label} (${bg}) is ${ratio.toFixed(2)}:1, below ${AA}`
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each([
    ["stamp", "stamp-soft"],
    ["traced", "traced-soft"],
    ["caution", "caution-soft"],
    ["refused", "refused-soft"],
  ])("--%s is readable on its own soft fill --%s", (fg, bg) => {
    // A soft-filled chip has to carry text, not merely suggest a colour.
    const ratio = contrast(token(fg), token(bg));
    expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
  });

  it("keeps a visible step between the three text weights", () => {
    const white = token("paper-raised");
    const ink = contrast(token("ink"), white);
    const muted = contrast(token("ink-muted"), white);
    const faint = contrast(token("ink-faint"), white);

    // Hierarchy still has to exist. Fixing the contrast failure compressed
    // this, and compressing it to nothing would be a different bug.
    expect(ink).toBeGreaterThan(muted);
    expect(muted).toBeGreaterThan(faint);
    expect(ink - muted).toBeGreaterThan(1);
  });

  it("does not follow the operating system's colour scheme", () => {
    /*
      A resume is printed on white and judged on white, so the editor sits on
      white. Dark is available behind an explicit class; the OS does not get
      to decide. If a prefers-color-scheme branch comes back, most people
      open a resume tool in the evening and are handed a dark document.
    */
    expect(CSS).not.toMatch(/@media\s*\(prefers-color-scheme/);
    expect(CSS).toContain(".dark {");
  });
});
