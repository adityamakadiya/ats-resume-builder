/**
 * A word-level diff, for reading a proposed rewrite rather than decoding one.
 *
 * Two versions of a bullet shown as two paragraphs makes the reader do the
 * comparison themselves, and they will do it badly: the interesting change is
 * usually one number or one verb inside forty words that are identical. So the
 * diff is computed at word granularity and rendered inline.
 *
 * Plain LCS over whitespace-split tokens. Resume bullets are tens of words, so
 * the quadratic table is a few hundred cells and the simplicity is worth more
 * than an asymptotically better algorithm nobody will read.
 */

export type WordChunk = { kind: "same" | "added" | "removed"; text: string };

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

export function diffWords(before: string, after: string): WordChunk[] {
  const a = tokenize(before);
  const b = tokenize(after);

  // table[i][j] is the LCS length of a[i:] and b[j:].
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      const nextRow = table[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (nextRow[j + 1] as number) + 1
          : Math.max(nextRow[j] as number, row[j + 1] as number);
    }
  }

  const out: WordChunk[] = [];
  const push = (kind: WordChunk["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i] as string);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      push("removed", a[i] as string);
      i += 1;
    } else {
      push("added", b[j] as string);
      j += 1;
    }
  }
  while (i < a.length) {
    push("removed", a[i] as string);
    i += 1;
  }
  while (j < b.length) {
    push("added", b[j] as string);
    j += 1;
  }

  return out;
}

/**
 * A human name for a JSON Pointer into the document.
 *
 * "/experience/0/bullets/2/text" is a correct answer to "what changed" and a
 * useless one. This is the same answer in the words the page uses.
 */
export function describePath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const [root, a, b, c] = parts;

  switch (root) {
    case "headline":
      return "Headline";
    case "summary":
      return "Summary";
    case "skills":
      return c === undefined ? "Skills" : `Skills, group ${Number(a) + 1}`;
    case "experience":
      return b === "bullets" ? `Experience, bullet ${Number(c) + 1}` : "Experience";
    case "projects":
      return b === "bullets" ? `Project, bullet ${Number(c) + 1}` : "Projects";
    case "education":
      return "Education";
    case "certifications":
      return "Certifications";
    case "other_sections":
      return "Additional section";
    default:
      return path;
  }
}
