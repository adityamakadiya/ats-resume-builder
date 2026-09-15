/**
 * Offline smoke test for the deterministic half of the pipeline: the truth
 * guard. No API calls, so this is free to run and safe in CI.
 * The PDF renderer is verified separately through the /api/pdf route, since
 * that is the environment it actually runs in (see scripts/pdf-check.mjs).
 * Run with: npx tsx scripts/smoke.mts
 */
import { runTruthGuard } from "../src/lib/truth/guard";
import type { ResumeFacts, TailoredResume } from "../src/lib/schemas";

const rawResume = `Priya Nair
Backend Engineer | Bengaluru | priya@example.com

EXPERIENCE
Acme Payments — Backend Engineer (Jun 2023 - Present)
- Built REST APIs in Node.js and PostgreSQL for the merchant settlement service.
- Added Redis caching to the settlement lookup endpoint, cutting response time by 45%.

SKILLS
Languages: JavaScript, TypeScript
Backend: Node.js, Express, PostgreSQL, Redis`;

const facts: ResumeFacts = {
  contact: {
    name: "Priya Nair",
    email: "priya@example.com",
    phone: "",
    location: "Bengaluru",
    links: [],
  },
  headline: "Backend Engineer",
  summary: "",
  experience: [
    {
      id: "E1",
      company: "Acme Payments",
      title: "Backend Engineer",
      location: "Bengaluru",
      startDate: "Jun 2023",
      endDate: "Present",
      bullets: [
        { id: "E1.B1", text: "Built REST APIs in Node.js and PostgreSQL for the merchant settlement service." },
        { id: "E1.B2", text: "Added Redis caching to the settlement lookup endpoint, cutting response time by 45%." },
      ],
      tech: ["Node.js", "PostgreSQL", "Redis"],
    },
  ],
  projects: [],
  education: [],
  skills: [
    { id: "S1", category: "Languages", items: ["JavaScript", "TypeScript"] },
    { id: "S2", category: "Backend", items: ["Node.js", "Express", "PostgreSQL", "Redis"] },
  ],
  certifications: [],
  otherSections: [],
  totalYearsExperience: 2,
};

const honest: TailoredResume = {
  headline: "Backend Engineer",
  summary: {
    text: "Backend engineer building REST APIs on Node.js and PostgreSQL for payment settlement.",
    sourceIds: ["E1.B1"],
  },
  skills: [{ category: "Backend", items: ["Node.js", "PostgreSQL", "Redis"], sourceIds: ["S2"] }],
  experience: [
    {
      sourceId: "E1",
      company: "Acme Payments",
      title: "Backend Engineer",
      location: "Bengaluru",
      startDate: "Jun 2023",
      endDate: "Present",
      bullets: [
        {
          text: "Designed REST APIs on Node.js and PostgreSQL for merchant settlement, cutting lookup response time 45% with a Redis cache layer.",
          sourceIds: ["E1.B1", "E1.B2"],
          keywords: ["REST APIs", "Node.js", "PostgreSQL", "Redis"],
        },
      ],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
  sectionOrder: ["summary", "skills", "experience"],
  rewriteNotes: ["Merged two bullets to lead with the architecture."],
};

// Same resume, but with three fabrications a keyword-hungry rewrite would make.
const fabricated: TailoredResume = structuredClone(honest);
fabricated.experience[0].bullets.push(
  {
    text: "Deployed the settlement service on Kubernetes with Terraform-managed infrastructure.",
    sourceIds: ["E1.B1"],
    keywords: ["Kubernetes", "Terraform"],
  },
  {
    text: "Scaled the settlement pipeline to 12000 transactions per second.",
    sourceIds: ["E1.B2"],
    keywords: ["scalability"],
  },
);
fabricated.experience[0].title = "Senior Backend Engineer";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const clean = runTruthGuard(honest, facts, rawResume);
check("honest rewrite passes the guard", clean.passed, clean.violations.map((v) => v.code).join(","));

const dirty = runTruthGuard(fabricated, facts, rawResume);
const codes = new Set(dirty.violations.map((v) => v.code));
check("fabricated rewrite is rejected", !dirty.passed);
check("invented technology is caught", codes.has("UNSOURCED_TECH"));
check("invented metric is caught", codes.has("UNSOURCED_METRIC"));
check("self-promotion in job title is caught", codes.has("ALTERED_EMPLOYER_FACT"));


console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
