/**
 * A demoable editor with no database behind it.
 *
 * The Supabase schema is written but not applied, so a read for a run either
 * errors with "relation does not exist" or comes back empty. Neither is a
 * reason to show a broken page: the editor is the product, and it can be
 * exercised end to end against an invented candidate.
 *
 * Invented, for the same reason `packages/templates/src/fixtures.ts` invents
 * one: a real resume checked into a repository is someone's phone number
 * checked into a repository. The document below is that file's `rich` doc with
 * three bullets dulled, so the tailoring has something to actually recover.
 *
 * What this file must never do is fake a saved state. The page renders a
 * standing banner saying the document is a sample and is not being stored, and
 * `saved: false` travels with the run so nothing downstream can forget.
 */

import {
  computeAtsReport,
  type AtsReport,
  type GapAnalysis,
  type JobSpec,
  type ResumeFacts,
  type TruthReport,
} from "@ats/core";
import { rich } from "@ats/templates/fixtures";
import type { ResumeDoc } from "@ats/templates";
import { tailoredOf } from "./doc";

/* ------------------------------------------------------------- the job -- */

export const SAMPLE_JOB: JobSpec = {
  company: "Northwind Rails",
  title: "Senior Backend Engineer, Payments Platform",
  location: "Bengaluru, India",
  work_mode: "hybrid",
  employment_type: "Full time",
  experience_years: { min: 5, max: 9, raw: "5 to 9 years" },
  requirements: [
    { term: "Go", category: "language", importance: "required", evidence: "Services are written in Go." },
    { term: "PostgreSQL", category: "database", importance: "required", evidence: "Ledger runs on Postgres." },
    { term: "Kafka", category: "tooling", importance: "required", evidence: "Event backbone is Kafka." },
    { term: "gRPC", category: "framework", importance: "required", evidence: "Internal calls are gRPC." },
    { term: "Kubernetes", category: "cloud_devops", importance: "preferred", evidence: "Workloads run on EKS." },
    { term: "Terraform", category: "cloud_devops", importance: "preferred", evidence: "Infrastructure is code." },
    { term: "idempotency", category: "system_design", importance: "required", evidence: "Exactly-once settlement." },
    { term: "Rust", category: "language", importance: "preferred", evidence: "Ledger core is moving to Rust." },
    { term: "Apache Flink", category: "tooling", importance: "preferred", evidence: "Streaming aggregates." },
  ],
  responsibilities: [
    "Own the settlement and reconciliation path end to end.",
    "Keep p99 latency inside the payment network's window.",
    "Carry the pager for the services you build.",
  ],
  keywords: [
    { term: "Go", variants: ["Golang"], weight: 3 },
    { term: "Kafka", variants: ["Apache Kafka"], weight: 3 },
    { term: "PostgreSQL", variants: ["Postgres"], weight: 3 },
    { term: "gRPC", variants: [], weight: 2 },
    { term: "Terraform", variants: [], weight: 2 },
    { term: "Grafana", variants: [], weight: 1 },
    { term: "Kubernetes", variants: ["K8s"], weight: 2 },
    { term: "idempotency", variants: ["idempotent"], weight: 2 },
    { term: "Rust", variants: [], weight: 2 },
    { term: "Apache Flink", variants: ["Flink"], weight: 1 },
  ],
  implicit_requirements: [
    {
      requirement: "Comfortable being on call for money movement",
      rationale: "A payments platform team of this size has no separate SRE rota.",
    },
  ],
  compensation: "Not stated",
  extraction_confidence: "high",
  extraction_notes: "",
};

/* ----------------------------------------------------------- the facts -- */

/**
 * The original resume, as the parser read it.
 *
 * It says gRPC, Terraform and Grafana. The tailored document below does not,
 * which is exactly the situation the recoverable chips exist for: the term is
 * already the candidate's to claim, and putting it back costs nothing.
 */
export const SAMPLE_FACTS: ResumeFacts = {
  contact: rich.contact,
  headline: rich.headline,
  summary: rich.summary.text,
  experience: [
    {
      id: "E1",
      company: "Meridian Payments",
      title: "Senior Backend Engineer",
      location: "Pune, India",
      start_date: "Mar 2023",
      end_date: "Present",
      bullets: [
        {
          id: "E1.B1",
          text: "Rebuilt settlement reconciliation on Kafka in Go, cutting the close-of-day window from six hours to under twenty minutes.",
        },
        {
          id: "E1.B2",
          text: "Introduced idempotency keys across the payments API, ending the duplicate-charge class of incident.",
        },
        {
          id: "E1.B3",
          text: "Profiled and reindexed the PostgreSQL ledger, dropping p99 read latency from 840ms to 96ms under production load.",
        },
        {
          id: "E1.B4",
          text: "Moved eight internal services from REST to gRPC and cut cross-service call overhead by about a third.",
        },
        {
          id: "E1.B5",
          text: "Wrote the Terraform modules the team now uses for every new service, and the Grafana boards on-call reads first.",
        },
        {
          id: "E1.B6",
          text: "Mentored three engineers through their first on-call rotation and wrote the runbooks the team still uses.",
        },
      ],
      tech: ["Go", "Kafka", "PostgreSQL", "gRPC", "Terraform", "Grafana", "Kubernetes"],
    },
    {
      id: "E2",
      company: "Harbourline Logistics",
      title: "Backend Engineer",
      location: "Bengaluru, India",
      start_date: "Jul 2021",
      end_date: "Feb 2023",
      bullets: [
        {
          id: "E2.B1",
          text: "Designed the shipment tracking service handling 40k events per minute, using Redis streams for ordering guarantees.",
        },
        {
          id: "E2.B2",
          text: "Migrated eleven services from a shared database to per-service schemas with no customer-visible downtime.",
        },
        {
          id: "E2.B3",
          text: "Cut container image sizes by 70 percent and shortened the deploy cycle from eighteen minutes to five.",
        },
      ],
      tech: ["Go", "Redis", "PostgreSQL", "Docker", "Kubernetes"],
    },
    {
      id: "E3",
      company: "Castille Analytics",
      title: "Software Engineer",
      location: "Remote",
      start_date: "Aug 2019",
      end_date: "Jun 2021",
      bullets: [
        {
          id: "E3.B1",
          text: "Built the ingestion layer for a clickstream warehouse taking 2TB a day into partitioned Postgres.",
        },
        {
          id: "E3.B2",
          text: "Replaced a hand-rolled scheduler with Airflow, halving the number of failed overnight jobs.",
        },
      ],
      tech: ["Python", "PostgreSQL", "Airflow"],
    },
  ],
  projects: [
    {
      id: "P1",
      name: "Ledgerpeek",
      description: "Double-entry ledger inspector.",
      url: "https://github.com/rohaniyer/ledgerpeek",
      bullets: [
        {
          id: "P1.B1",
          text: "Open-source double-entry ledger inspector, 900 stars, used as teaching material by two fintech bootcamps.",
        },
      ],
      tech: ["Go", "SQLite"],
    },
    {
      id: "P2",
      name: "Queuewatch",
      description: "Kafka consumer lag dashboard.",
      url: "",
      bullets: [
        {
          id: "P2.B1",
          text: "Kafka consumer lag dashboard that became the on-call first port of call across four teams.",
        },
      ],
      tech: ["Kafka", "Grafana"],
    },
  ],
  education: [
    {
      id: "ED1",
      institution: "College of Engineering, Pune",
      degree: "B.E. in Computer Engineering",
      dates: "2015 - 2019",
      details: "",
    },
  ],
  skills: [
    { id: "S1", category: "Languages", items: ["Go", "TypeScript", "Python", "SQL"] },
    {
      id: "S2",
      category: "Infrastructure",
      items: ["PostgreSQL", "Redis", "Kafka", "Docker", "Kubernetes", "AWS", "Terraform", "Grafana"],
    },
    {
      id: "S3",
      category: "Practices",
      items: ["Distributed tracing", "Load testing", "CI/CD", "Incident response", "gRPC"],
    },
  ],
  certifications: [
    { id: "C1", text: "AWS Certified Solutions Architect, Associate, 2024" },
    { id: "C2", text: "Certified Kubernetes Application Developer, 2022" },
  ],
  other_sections: [
    {
      id: "O1",
      heading: "Publications",
      bullets: [
        {
          id: "O1.B1",
          text: "Exactly-once settlement without distributed transactions, PyCon India 2024, invited talk.",
        },
        { id: "O1.B2", text: "Reindexing a live ledger, Meridian Engineering Blog, 2023." },
      ],
    },
  ],
  total_years_experience: 6,
};

/* ------------------------------------------------------- the document -- */

/**
 * The tailored draft. `rich`, with gRPC, Terraform and Grafana dropped from
 * the skills list and the bullets, so the recoverable chips have work to do.
 */
export const SAMPLE_DOC: ResumeDoc = {
  ...rich,
  skills: [
    { category: "Languages", items: ["Go", "TypeScript", "Python", "SQL"], source_ids: ["S1"] },
    {
      category: "Infrastructure",
      items: ["PostgreSQL", "Redis", "Kafka", "Docker", "Kubernetes", "AWS"],
      source_ids: ["S2"],
    },
    {
      category: "Practices",
      items: ["Distributed tracing", "Load testing", "CI/CD", "Incident response"],
      source_ids: ["S3"],
    },
  ],
  experience: rich.experience.map((exp, i) =>
    i === 0
      ? {
          ...exp,
          bullets: [
            {
              text: "Rebuilt the settlement reconciliation pipeline around Kafka, cutting the close-of-day window from six hours to under twenty minutes.",
              source_ids: ["E1.B1"],
              keywords: ["Kafka"],
            },
            {
              text: "Introduced idempotency keys across the payments API, eliminating the duplicate-charge class of incident entirely.",
              source_ids: ["E1.B2"],
              keywords: ["idempotency"],
            },
            {
              text: "Profiled and reindexed the ledger database, dropping p99 read latency from 840ms to 96ms under production load.",
              source_ids: ["E1.B3"],
              keywords: [],
            },
            {
              text: "Mentored three engineers through their first on-call rotation and wrote the runbooks the team still uses.",
              source_ids: ["E1.B6"],
              keywords: [],
            },
          ],
        }
      : exp,
  ),
  rewrite_notes: [
    "Led with settlement and reconciliation, which is the first line of the posting.",
    "Kept the ledger latency figures verbatim. They are the strongest numbers on the page.",
  ],
};

/* -------------------------------------------------------- the analysis -- */

export const SAMPLE_GAPS: GapAnalysis = {
  strong_matches: [
    { jd_term: "Kafka", source_ids: ["E1.B1", "P2.B1"], note: "Two roles and a side project." },
    { jd_term: "PostgreSQL", source_ids: ["E1.B3", "E3.B1"], note: "Reindexed a live ledger." },
    { jd_term: "idempotency", source_ids: ["E1.B2"], note: "Named as the fix, with the outcome." },
  ],
  partial_matches: [
    { jd_term: "Kubernetes", source_ids: ["S2", "C2"], note: "Listed and certified, never described in a bullet." },
  ],
  transferable: [
    {
      jd_term: "Apache Flink",
      source_ids: ["E2.B1"],
      note: "Redis streams is stream processing, on different machinery.",
    },
  ],
  missing: [
    { jd_term: "Rust", severity: "significant", note: "Nothing in the resume mentions it." },
    { jd_term: "Apache Flink", severity: "minor", note: "Adjacent experience, not the tool." },
  ],
  missing_keywords: ["Rust", "Apache Flink"],
  recoverable_keywords: ["gRPC", "Terraform", "Grafana"],
  emphasize: [
    { source_id: "E1.B2", reason: "Idempotency is the posting's stated hard problem." },
    { source_id: "E1.B1", reason: "Settlement is the first responsibility listed." },
  ],
  deemphasize: [{ source_id: "E3.B2", reason: "Airflow is not in this posting at all." }],
  recruiter_concerns: [
    "Two of the three roles are under two years, which reads as movement on a first pass.",
    "No line shows ownership of production Kubernetes, only a certification.",
  ],
  ats_rejection_risks: [
    "Rust appears in the requirements block and nowhere in the resume.",
  ],
};

/**
 * Two lines the guard refused after the repair round.
 *
 * Both are the realistic failure: the model reached for a rounder number than
 * the source supports, and invented a tool the resume never names. The editor
 * shows these in a dialog rather than a toast, because being told what was
 * refused and why is the whole reason to trust the rest of the page.
 */
export const SAMPLE_TRUTH: TruthReport = {
  passed: false,
  error_count: 2,
  warning_count: 0,
  violations: [
    {
      code: "UNSOURCED_METRIC",
      severity: "error",
      location: "Experience / Meridian Payments / bullet 3",
      detail:
        "The rewrite rounded 840ms to 96ms up to a tenfold improvement. The source says 840 to 96, which is 8.75x.",
      offending:
        "Profiled and reindexed the ledger database, delivering a tenfold reduction in p99 read latency under production load.",
    },
    {
      code: "UNSOURCED_TECH",
      severity: "error",
      location: "Summary",
      detail:
        "The rewrite named Rust. No fact in the parsed resume mentions Rust, so there is nothing to trace it to.",
      offending:
        "Backend engineer with six years building payment and settlement systems in Go and Rust.",
    },
  ],
};

/** Computed, not stored. The score is a function of the document. */
export const SAMPLE_REPORT: AtsReport = computeAtsReport(
  SAMPLE_JOB,
  SAMPLE_FACTS,
  tailoredOf(SAMPLE_DOC),
);

/* ------------------------------------------------------------- the run -- */

export type EditorRun = {
  resumeId: string;
  versionId: string;
  title: string;
  templateId: string;
  /** False means nothing on this screen is being written anywhere. Say so. */
  saved: boolean;
  doc: ResumeDoc;
  job: JobSpec;
  facts: ResumeFacts;
  report: AtsReport;
  truth: TruthReport;
  gaps: GapAnalysis;
};

export function sampleRun(resumeId = "sample"): EditorRun {
  return {
    resumeId,
    versionId: "sample-version",
    title: `${SAMPLE_JOB.title}, ${SAMPLE_JOB.company}`,
    templateId: "standard",
    saved: false,
    doc: SAMPLE_DOC,
    job: SAMPLE_JOB,
    facts: SAMPLE_FACTS,
    report: SAMPLE_REPORT,
    truth: SAMPLE_TRUTH,
    gaps: SAMPLE_GAPS,
  };
}
