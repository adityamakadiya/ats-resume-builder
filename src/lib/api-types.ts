import type {
  AtsReport,
  GapAnalysis,
  JobSpec,
  ResumeFacts,
  Strategy,
  TailoredResume,
  TruthReport,
} from "@/lib/schemas";

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
};

export type AnalyzeError = {
  error: string;
  needsJdPaste?: boolean;
  portal?: string;
  hint?: string;
};
