import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDocx, type DocxEdit, type DocxLayout, type DocxParagraph } from "@/lib/ingest/docx-layout";
import type { ResumeFacts, TailoredResume } from "@/lib/schemas";

/**
 * Exact-preservation render path for DOCX uploads.
 *
 * The model never has to know about paragraphs. Fact extraction copies bullets
 * verbatim, so each extracted fact can be matched back to the paragraph it came
 * from here, deterministically, and the rewritten text is written into that
 * same node. Asking the model to carry paragraph ids would have put a
 * formatting concern into a content prompt and made it another thing that can
 * be hallucinated.
 */

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => new Set(normalise(s).split(" ").filter((t) => t.length > 2));

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Below this, a "match" is coincidence rather than the same sentence. */
const MATCH_THRESHOLD = 0.6;

export type ParagraphMap = Map<string, number>;

/**
 * Matches every extracted fact to the paragraph it was copied from. Exact text
 * wins, then containment, then token overlap; each paragraph can only be
 * claimed once so two similar bullets cannot collapse onto the same node.
 */
export function mapFactsToParagraphs(
  facts: ResumeFacts,
  paragraphs: DocxParagraph[],
): ParagraphMap {
  const map: ParagraphMap = new Map();
  const claimed = new Set<number>();

  const candidates = paragraphs.filter((p) => !p.inTable && p.text.trim().length > 0);
  const prepared = candidates.map((p) => ({
    index: p.index,
    norm: normalise(p.text),
    toks: tokens(p.text),
  }));

  const claim = (id: string, text: string) => {
    const norm = normalise(text);
    if (!norm) return;
    const toks = tokens(text);

    let best = -1;
    let bestScore = 0;

    for (const cand of prepared) {
      if (claimed.has(cand.index)) continue;

      let score = 0;
      if (cand.norm === norm) score = 1;
      else if (cand.norm.includes(norm) || norm.includes(cand.norm)) {
        const shorter = Math.min(cand.norm.length, norm.length);
        const longer = Math.max(cand.norm.length, norm.length);
        score = 0.75 + 0.2 * (shorter / longer);
      } else score = jaccard(toks, cand.toks);

      if (score > bestScore) {
        bestScore = score;
        best = cand.index;
      }
      if (score === 1) break;
    }

    if (best >= 0 && bestScore >= MATCH_THRESHOLD) {
      map.set(id, best);
      claimed.add(best);
    }
  };

  // Longest first: a specific bullet should claim its paragraph before a short
  // generic line can match it loosely.
  const entries: { id: string; text: string }[] = [];
  if (facts.summary) entries.push({ id: "SUMMARY", text: facts.summary });
  for (const e of facts.experience) for (const b of e.bullets) entries.push({ id: b.id, text: b.text });
  for (const p of facts.projects) for (const b of p.bullets) entries.push({ id: b.id, text: b.text });
  for (const o of facts.otherSections) for (const b of o.bullets) entries.push({ id: b.id, text: b.text });
  for (const s of facts.skills) entries.push({ id: s.id, text: `${s.category}: ${s.items.join(", ")}` });

  entries.sort((a, b) => b.text.length - a.text.length);
  for (const e of entries) claim(e.id, e.text);

  return map;
}

export type PreservePlan = {
  edits: DocxEdit[];
  /** Rewritten lines with nowhere to go — usually one source split into two. */
  unplaced: { text: string; sourceIds: string[] }[];
  /** Source paragraphs the rewrite dropped, which get blanked. */
  dropped: number[];
};

export function buildDocxEdits(tailored: TailoredResume, map: ParagraphMap): PreservePlan {
  const edits: DocxEdit[] = [];
  const unplaced: { text: string; sourceIds: string[] }[] = [];
  const consumed = new Set<number>();

  /**
   * A rewritten line may only be written into a paragraph it owns.
   *
   * The distinction matters because `sourceIds` means two different things. For
   * a bullet they are the bullets it was built from, so it owns them: merging
   * two into one leaves the second paragraph genuinely empty, and it should be
   * blanked. For a summary they are evidence — the bullets it drew on — which
   * it does not own. Treating those as ownership let the summary write itself
   * over a bullet's paragraph (or blank it), and the bullet's own rewrite then
   * had nowhere to go. A resume with no summary paragraph has nowhere to put a
   * summary, and saying so is better than evicting a bullet to make room.
   */
  const place = (text: string, ownIds: string[], absorbsSources: boolean) => {
    const mapped = ownIds.map((id) => map.get(id)).filter((i): i is number => i !== undefined);
    const target = mapped.find((i) => !consumed.has(i));
    if (target === undefined) {
      unplaced.push({ text, sourceIds: ownIds });
      return;
    }
    edits.push({ paragraphIndex: target, text });
    consumed.add(target);

    if (!absorbsSources) return;
    for (const other of mapped) {
      if (other !== target && !consumed.has(other)) {
        edits.push({ paragraphIndex: other, text: null });
        consumed.add(other);
      }
    }
  };

  // Summary and skills go first so they claim their own paragraphs before a
  // bullet can match one loosely. The summary owns only the summary paragraph;
  // a skills line owns the skill groups it was built from, and merging two of
  // them does empty the second.
  if (tailored.summary.text) place(tailored.summary.text, ["SUMMARY"], false);
  for (const group of tailored.skills) {
    place(`${group.category}: ${group.items.join(", ")}`, group.sourceIds, true);
  }
  for (const exp of tailored.experience) for (const b of exp.bullets) place(b.text, b.sourceIds, true);
  for (const proj of tailored.projects) for (const b of proj.bullets) place(b.text, b.sourceIds, true);

  // Anything mapped but never rewritten was cut by the tailoring step.
  const dropped: number[] = [];
  for (const paragraphIndex of map.values()) {
    if (!consumed.has(paragraphIndex)) {
      edits.push({ paragraphIndex, text: null });
      dropped.push(paragraphIndex);
    }
  }

  return { edits, unplaced, dropped };
}

/* ------------------------------------------------------------------ */
/* DOCX -> PDF                                                         */
/* ------------------------------------------------------------------ */

const SOFFICE_CANDIDATES = [
  process.env.SOFFICE_PATH,
  "soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
].filter((p): p is string => Boolean(p));

function run(bin: string, args: string[], timeoutMs = 90_000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += String(d)));
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolve({ ok: false, stderr: "timed out" });
      }
    }, timeoutMs);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderr: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr });
    });
  });
}

export type ConvertResult =
  | { ok: true; pdf: Buffer }
  | { ok: false; reason: string };

/**
 * Converts the edited DOCX to PDF with LibreOffice. It is the only renderer
 * that reads Word's own layout rules, so it is the only way the PDF matches
 * what the candidate sees in Word. When it is not installed the caller still
 * has the DOCX, which is the more useful artefact anyway.
 */
export async function docxToPdf(docx: Buffer): Promise<ConvertResult> {
  const dir = await mkdtemp(join(tmpdir(), "ats-docx-"));
  const src = join(dir, `${randomUUID()}.docx`);
  try {
    await writeFile(src, docx);
    for (const bin of SOFFICE_CANDIDATES) {
      const { ok } = await run(bin, [
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        src,
      ]);
      if (!ok) continue;
      try {
        const pdf = await readFile(src.replace(/\.docx$/, ".pdf"));
        if (pdf.length > 0) return { ok: true, pdf };
      } catch {
        /* try the next candidate binary */
      }
    }
    return {
      ok: false,
      reason:
        "LibreOffice is not available, so the format-preserved resume could not be converted to PDF. " +
        "Download the .docx and export it yourself, or install LibreOffice (`brew install --cask libreoffice`).",
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function renderPreservedDocx(
  layout: DocxLayout,
  tailored: TailoredResume,
  facts: ResumeFacts,
) {
  const map = mapFactsToParagraphs(facts, layout.paragraphs);
  const plan = buildDocxEdits(tailored, map);
  const written = await writeDocx(layout, plan.edits);
  return { ...written, plan, mappedCount: map.size };
}
