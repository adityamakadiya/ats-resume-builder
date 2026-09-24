/** Does the real pipeline work against this account's real models? */
import { readFileSync } from "node:fs";
import { extractJobSpec, analyzeGaps, tailorResume } from "../src/lib/pipeline/steps";
import { factsToDocument } from "../src/lib/editor/ingest";
import { computeAtsReport } from "@ats/core";

const env = readFileSync("../../apps/web/.env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]!] = m[2]!;
}

const parsed = JSON.parse(readFileSync("/tmp/parsed.json", "utf8"));
const facts = parsed.facts;
const scope = { kind: "user", userId: "probe" } as const;

const JD = `Senior Frontend Engineer, Real-Time Systems
We are hiring a frontend engineer to own our streaming UI layer.
Requirements: strong React and TypeScript, experience with Server-Sent Events
or WebSockets, performance profiling in the browser, Next.js App Router,
and comfort owning a feature end to end. Nice to have: Node.js, PostgreSQL,
and experience with AI product surfaces.
Responsibilities: build and maintain real-time dashboards, reduce render
cost on data-heavy pages, work directly with design and AI engineers.`;

console.log("1. decomposing the posting...");
const t0 = Date.now();
const job = await extractJobSpec(JD, "probe");
console.log(`   ${job.value.title} at ${job.value.company || "(unnamed)"} | ${job.value.requirements.length} requirements, ${job.value.keywords.length} keywords | ${job.trace.ms}ms $${job.trace.usage?.costUsd.toFixed(4) ?? "cached"}`);

console.log("2. gap analysis...");
const gaps = await analyzeGaps(job.value, facts, scope);
console.log(`   ${gaps.value.strong_matches.length} strong, ${gaps.value.missing.length} missing, ${gaps.value.recoverable_keywords.length} recoverable | ${gaps.trace.ms}ms`);

console.log("3. score BEFORE tailoring:");
const before = computeAtsReport(job.value, facts, factsToDocument(facts) as never);
console.log(`   ${before.overall}/100`);

console.log(`\ntotal so far ${((Date.now()-t0)/1000).toFixed(1)}s`);
