/**
 * Verifies /api/pdf end to end against a running server: that it returns a real
 * PDF, and that the text layer is extractable (which is the whole point of an
 * ATS-readable resume). Run the server first, then: node scripts/pdf-check.mjs
 */
import { extractText, getDocumentProxy } from "unpdf";

const BASE = process.env.BASE_URL ?? "http://localhost:3210";

const facts = {
  contact: { name: "Priya Nair", email: "priya@example.com", phone: null, location: "Bengaluru", links: [] },
  headline: "Backend Engineer",
  summary: null,
  experience: [{
    id: "E1", company: "Acme Payments", title: "Backend Engineer", location: "Bengaluru",
    startDate: "Jun 2023", endDate: "Present",
    bullets: [{ id: "E1.B1", text: "Built REST APIs in Node.js and PostgreSQL." }],
    tech: ["Node.js", "PostgreSQL", "Redis"],
  }],
  projects: [], education: [],
  skills: [{ id: "S2", category: "Backend", items: ["Node.js", "PostgreSQL", "Redis"] }],
  certifications: [], otherSections: [], totalYearsExperience: 2,
};

const tailored = {
  headline: "Backend Engineer",
  summary: { text: "Backend engineer building REST APIs on Node.js and PostgreSQL.", sourceIds: ["E1.B1"] },
  skills: [{ category: "Backend", items: ["Node.js", "PostgreSQL", "Redis"], sourceIds: ["S2"] }],
  experience: [{
    sourceId: "E1", company: "Acme Payments", title: "Backend Engineer", location: "Bengaluru",
    startDate: "Jun 2023", endDate: "Present",
    bullets: [{ text: "Designed REST APIs on Node.js and PostgreSQL for merchant settlement.", sourceIds: ["E1.B1"], keywords: ["REST APIs"] }],
  }],
  projects: [], education: [], certifications: [],
  sectionOrder: ["summary", "skills", "experience"],
  rewriteNotes: [],
};

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const res = await fetch(`${BASE}/api/pdf`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tailored, facts, company: "Acme Payments" }),
});

check("route returns 200", res.ok, `status ${res.status}`);
check("content type is PDF", res.headers.get("content-type") === "application/pdf");
check(
  "filename is job specific",
  (res.headers.get("content-disposition") ?? "").includes("Priya-Nair-Resume-Acme-Payments.pdf"),
  res.headers.get("content-disposition") ?? "",
);

const bytes = new Uint8Array(await res.arrayBuffer());
check("file is a non-trivial PDF", bytes.length > 1000, `${bytes.length} bytes`);

const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
const flat = String(text).replace(/\s+/g, " ");
check("text layer is selectable", flat.length > 100, `${flat.length} chars extracted`);
check("candidate name survives extraction", flat.includes("Priya Nair"));
check("standard headings survive extraction", flat.includes("PROFESSIONAL EXPERIENCE") && flat.includes("TECHNICAL SKILLS"));
check("bullet content survives extraction", flat.includes("Designed REST APIs on Node.js and PostgreSQL"));
check("reading order is preserved", flat.indexOf("TECHNICAL SKILLS") < flat.indexOf("PROFESSIONAL EXPERIENCE"));

console.log(failures === 0 ? "\nPDF checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
