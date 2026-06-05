export interface CommitIntentFixture {
  id: string;
  author: "agent" | "human";
  sha: string;
  message: string;
  changedFiles: Array<{
    path: string;
    additions: number;
    deletions: number;
    surface: "ui" | "api" | "test" | "docs" | "config";
  }>;
  evidence: Array<{
    kind: "test" | "screenshot" | "manual" | "none";
    label: string;
    status: "pass" | "fail" | "missing";
  }>;
}

export interface CommitIntentReport {
  id: string;
  sha: string;
  author: CommitIntentFixture["author"];
  inferredIntent: string;
  changedSurfaces: string[];
  suspectedRisks: string[];
  verificationGaps: string[];
  evidenceSummary: string;
}

export interface ReviewIntentInput {
  reviewId: string;
  diffRange: string;
  changeDescription: string;
  findings: Array<{
    severity: string;
    title: string;
    filePath?: string;
  }>;
  evidence: Array<{
    level: "static" | "test" | "browser" | "runtime";
    status: "not_checked" | "reproduced" | "fixed" | "not_reproduced";
  }>;
  history?: {
    recentCommits: number;
    priorDecisions: number;
    priorAgentRuns: number;
    recurringFailures: number;
    commands?: number;
    claims?: number;
    commandStatus?: {
      passed: number;
      failed: number;
      stale: number;
      unknown: number;
    };
    commandArtifacts?: number;
    rawSessionCommands?: number;
    structuredCommands?: number;
    latestCommand?: string | null;
    latestClaim?: string | null;
  } | null;
  qaRuns?: Array<{
    pass: boolean;
    runnerType: string;
    goal: string;
    durationMs: number;
    consoleErrors?: number;
  }>;
  fix?: {
    changedFiles: number;
    findingsFixed: number;
  } | null;
  reviewMode?: string;
  riskTier?: string;
  changedLines?: number;
  sensitivePaths?: string[];
  blast?: {
    totalCallers: number;
    totalSymbols: number;
    changedFiles: number;
  } | null;
}

export interface ReviewTimelineItem {
  id: string;
  phase: "intent" | "history" | "review" | "qa" | "fix" | "evidence";
  label: string;
  detail: string;
  status: "done" | "warning" | "missing";
}

export interface ReviewIntentReport {
  id: string;
  inferredIntent: string;
  changedSurfaces: string[];
  suspectedRisks: string[];
  verificationGaps: string[];
  evidenceSummary: string;
  timeline: ReviewTimelineItem[];
}
