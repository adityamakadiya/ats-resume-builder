/**
 * Layout-engine checks. Offline and free — no API calls.
 *
 * The important one is the two-column case. A sidebar resume whose content
 * stream is written row by row (which is what Word tables and HTML-to-PDF
 * converters produce) interleaves under naive extraction: the skills column
 * fuses with the experience column and every extracted fact is nonsense. That
 * failure is silent, so it needs a test that would catch its return.
 *
 * Run: npm run layout-check
 */
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import { pdfToLayout } from "../src/lib/ingest/layout";
import { docxToLayout } from "../src/lib/ingest/docx-layout";
import { buildDocxEdits, mapFactsToParagraphs } from "../src/lib/render/preserve-docx";
import type { TailoredResume } from "../src/lib/schemas";
import type { ResumeFacts } from "../src/lib/schemas";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ */
/* A minimal PDF writer, so the fixtures are exact and dependency-free */
/* ------------------------------------------------------------------ */

type Item = { text: string; x: number; y: number; size?: number };

function buildPdf(items: Item[], width = 595, height = 842): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = items
    .map((i) => `BT /F1 ${i.size ?? 10} Tf 1 0 0 1 ${i.x} ${i.y} Tm (${esc(i.text)}) Tj ET`)
    .join("\n");

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/* ------------------------------------------------------------------ */
/* 1. Two columns, drawn row by row — the interleaving case            */
/* ------------------------------------------------------------------ */

// Left band 40-150pt, right band 250-540pt, gutter 100pt wide.
// Draw order alternates across the gutter, exactly like a table row.
const LEFT = 40;
const RIGHT = 250;
const rows: Item[] = [];
let y = 760;
const pairs: [string, string][] = [
  ["SKILLS", "EXPERIENCE"],
  ["JavaScript", "Backend Engineer at Acme Payments"],
  ["TypeScript", "Bengaluru, India, Jun 2023 to Present"],
  ["PostgreSQL", "Built REST APIs in Node.js for settlement"],
  ["Redis", "Added Redis caching cutting latency by half"],
  ["Docker", "Wrote PostgreSQL indexes for reconciliation"],
  ["Express", "Implemented JWT authentication for admin tools"],
  ["BullMQ", "Containerised three services and set up CI"],
  ["Git", "Owned the settlement service end to end"],
  ["CONTACT", "EDUCATION"],
  ["priya@example.com", "B.E. Computer Engineering GTU"],
  ["Bengaluru", "Graduated 2023 with distinction"],
];
for (const [l, r] of pairs) {
  rows.push({ text: l, x: LEFT, y });
  rows.push({ text: r, x: RIGHT, y });
  y -= 18;
}

const twoCol = buildPdf(rows);

// pdf.js takes ownership of the array it is handed and detaches the underlying
// buffer, so a second reader of the same bytes sees zero length. Each consumer
// gets its own copy.
const naive = await extractText(await getDocumentProxy(twoCol.slice()), { mergePages: true });
const naiveText = String(naive.text).replace(/\s+/g, " ");
const aware = await pdfToLayout(Buffer.from(twoCol.slice()));

console.log("=== two-column resume, content stream written row by row ===");
console.log("  naive :", naiveText.slice(0, 96));
console.log("  aware :", aware.text.replace(/\n/g, " | ").slice(0, 96));
console.log();

check("columns detected", aware.style.columnCount === 2, `found ${aware.style.columnCount}`);
check(
  "column-aware read keeps the sidebar intact",
  /SKILLS \| JavaScript \| TypeScript/.test(aware.text.replace(/\n/g, " | ")),
);
check(
  "column-aware read keeps experience contiguous",
  aware.text.includes("Built REST APIs in Node.js for settlement"),
);
const naiveInterleaved = /SKILLS\s+EXPERIENCE/.test(naiveText);
check(
  "naive read does interleave (this is what we are fixing)",
  naiveInterleaved,
  naiveInterleaved ? "confirmed" : "this generator did not interleave; the guard still holds",
);

/* ------------------------------------------------------------------ */
/* 2. Single column is not mistaken for two                            */
/* ------------------------------------------------------------------ */

const singleItems: Item[] = [];
let sy = 780;
for (const line of [
  "PRIYA NAIR",
  "Backend Engineer building payment settlement services",
  "EXPERIENCE",
  "Acme Payments  Bengaluru, India",
  "Backend Engineer  Jun 2023 - Present",
  "Built REST APIs in Node.js and Express for merchant settlement",
  "Added Redis caching to the settlement lookup endpoint",
  "Wrote PostgreSQL queries and added indexes for reconciliation",
]) {
  singleItems.push({ text: line, x: 56, y: sy });
  sy -= 16;
}
const oneCol = await pdfToLayout(Buffer.from(buildPdf(singleItems)));
check("single column stays single", oneCol.style.columnCount === 1, `found ${oneCol.style.columnCount}`);

/* ------------------------------------------------------------------ */
/* 3. Hyphenation rejoining                                            */
/* ------------------------------------------------------------------ */

const hyphen = await pdfToLayout(
  Buffer.from(
    buildPdf([
      { text: "Architected isolation across 141 backend mod-", x: 56, y: 700 },
      { text: "ules and 860 API routes with exponential-", x: 56, y: 684 },
      { text: "backoff retries on every queue worker", x: 56, y: 668 },
    ]),
  ),
);
check("soft hyphen is closed up", hyphen.text.includes("modules"), "mod-ules -> modules");
check(
  "real compound hyphen survives",
  hyphen.text.includes("exponential-backoff"),
  hyphen.text.includes("exponentialbackoff") ? "got exponentialbackoff" : "kept the hyphen",
);

/* ------------------------------------------------------------------ */
/* 4. Style profile against a real resume, if one is on disk           */
/* ------------------------------------------------------------------ */

const REAL = process.env.REAL_RESUME ?? "/Users/apple/career-ops/latex/Aditya-Makadiya-Resume.pdf";
try {
  const real = await pdfToLayout(await readFile(REAL));
  const s = real.style;
  console.log("\n=== style profile read from a real resume ===");
  console.log(`  page ${s.pageWidth.toFixed(0)}x${s.pageHeight.toFixed(0)}pt · columns ${s.columnCount}`);
  console.log(`  sizes name ${s.fontSizes.name} / heading ${s.fontSizes.heading} / body ${s.fontSizes.body}`);
  console.log(`  margins L${s.margins.left.toFixed(0)} R${s.margins.right.toFixed(0)} · accent ${s.accentColor ?? "none"}`);
  console.log(`  serif ${s.serif} · bullet ${JSON.stringify(s.bulletGlyph)} · fonts resolved ${s.confidence.fonts}`);

  check("real resume reads as one column", s.columnCount === 1);
  check("type ladder is ordered", s.fontSizes.name > s.fontSizes.heading && s.fontSizes.heading >= s.fontSizes.body);
  check("margins are plausible", s.margins.left > 10 && s.margins.left < 120, `left ${s.margins.left.toFixed(1)}pt`);
  // pdf.js has changed the shape of setFillRGBColor's arguments between
  // versions; a null accent on a resume that plainly has one means it changed
  // again rather than that the resume is monochrome.
  check("an accent colour was recovered", s.accentColor !== null, s.accentColor ?? "none");
  check("fonts resolved", s.confidence.fonts);
  check("right-aligned dates stay on their line", /Bacancy Technology\s+Ahmedabad/.test(real.text));
} catch (err) {
  console.log(`\n(skipped real-resume checks: ${(err as Error).message})`);
}

/* ------------------------------------------------------------------ */
/* 5. DOCX paragraph mapping                                           */
/* ------------------------------------------------------------------ */

const { default: JSZip } = await import("jszip");

const para = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const docXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
  para("PRIYA NAIR") +
  para("Built REST APIs in Node.js and Express for the merchant settlement service.") +
  para("Added Redis caching to the settlement lookup endpoint, cutting response time by 45%.") +
  `<w:tbl><w:tr><w:tc>${para("Inside a table cell")}</w:tc></w:tr></w:tbl>` +
  `</w:body></w:document>`;

const zip = new JSZip();
zip.file("[Content_Types].xml", "<Types/>");
zip.file("word/document.xml", docXml);
const docxBytes = await zip.generateAsync({ type: "nodebuffer" });

const layout = await docxToLayout(docxBytes);
check("paragraphs parsed", layout.paragraphs.length === 4, `${layout.paragraphs.length} found`);
check("table paragraph is flagged", layout.paragraphs.some((p) => p.inTable));

const facts = {
  contact: { name: "Priya Nair", email: "", phone: "", location: "", links: [] },
  headline: "",
  summary: "",
  experience: [
    {
      id: "E1",
      company: "Acme Payments",
      title: "Backend Engineer",
      location: "",
      startDate: "Jun 2023",
      endDate: "Present",
      bullets: [
        { id: "E1.B1", text: "Built REST APIs in Node.js and Express for the merchant settlement service." },
        { id: "E1.B2", text: "Added Redis caching to the settlement lookup endpoint, cutting response time by 45%." },
      ],
      tech: [],
    },
  ],
  projects: [],
  education: [],
  skills: [],
  certifications: [],
  otherSections: [],
  totalYearsExperience: 2,
} satisfies ResumeFacts;

const map = mapFactsToParagraphs(facts, layout.paragraphs);
check("both bullets mapped to their paragraphs", map.size === 2, `mapped ${map.size}`);
check("bullets mapped to distinct paragraphs", new Set(map.values()).size === map.size);
check("table paragraph was not claimed", ![...map.values()].some((i) => layout.paragraphs[i].inTable));

// A summary cites bullets as evidence without replacing them. Treating those
// citations as a merge blanked the bullets' paragraphs and left their rewrites
// with nowhere to go — the resume lost the bullets entirely.
const tailored = {
  headline: "Backend Engineer",
  summary: { text: "Backend engineer on payment settlement.", sourceIds: ["SUMMARY", "E1.B1"] },
  skills: [],
  experience: [
    {
      sourceId: "E1",
      company: "Acme Payments",
      title: "Backend Engineer",
      location: "",
      startDate: "Jun 2023",
      endDate: "Present",
      bullets: [
        { text: "Designed REST APIs on Node.js for merchant settlement.", sourceIds: ["E1.B1"], keywords: [] },
        { text: "Cut settlement lookup time 45% with a Redis cache layer.", sourceIds: ["E1.B2"], keywords: [] },
      ],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
  sectionOrder: ["summary", "experience"],
  rewriteNotes: [],
} satisfies TailoredResume;

const plan = buildDocxEdits(tailored, map);
const placedTexts = plan.edits.filter((e) => e.text !== null).map((e) => e.text);

check(
  "a summary citing a bullet does not evict it",
  placedTexts.some((t) => t?.startsWith("Designed REST APIs")),
  plan.unplaced.map((u) => u.text.slice(0, 30)).join(" / ") || "nothing unplaced",
);
check(
  "the second bullet is placed too",
  placedTexts.some((t) => t?.startsWith("Cut settlement lookup")),
);
check("no mapped bullet was blanked", plan.dropped.length === 0, `${plan.dropped.length} dropped`);
// This fixture has no summary paragraph, so there is genuinely nowhere to put
// one. Reporting that is the correct outcome; evicting a bullet is not.
check(
  "the summary is the only thing reported unplaced",
  plan.unplaced.length === 1 && plan.unplaced[0].sourceIds.includes("SUMMARY"),
  `${plan.unplaced.length} unplaced`,
);

console.log(failures === 0 ? "\nAll layout checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
