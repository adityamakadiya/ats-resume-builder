import type { StyleProfile } from "@/lib/ingest/layout";
import type {
  AtsReport,
  GapAnalysis,
  JobSpec,
  ResumeFacts,
  Strategy,
  TailoredResume,
  TruthReport,
} from "@/lib/schemas";

export type RenderMode = "preserve" | "optimize";

export type SourceSummary = {
  kind: "pdf" | "docx" | "text";
  preservable: "exact" | "visual" | "none";
  pageCount: number;
  notes: string[];
  style: StyleProfile | null;
};

export type AnalyzeSuccess = {
  job: JobSpec;
  facts: ResumeFacts;
  gaps: GapAnalysis;
  tailored: TailoredResume;
  truth: TruthReport;
  repairAttempted: boolean;
  report: AtsReport;
  strategy: Strategy;
  rawResumeText: string;
  source: SourceSummary;
};

export type AnalyzeError = {
  error: string;
  needsJdPaste?: boolean;
  portal?: string;
  hint?: string;
};

/** What the render route reports back about how faithful the output was. */
export type RenderFidelity = {
  mode: string;
  mapped: number | null;
  rewritten: number | null;
  skipped: number | null;
  unplaced: number | null;
  columns: number | null;
  convertWarning: string | null;
  filename: string;
};
