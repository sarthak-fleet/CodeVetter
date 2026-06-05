import type { ReviewIntentReport } from "@/lib/intent-debugger/types";
import type { FindingEvidence } from "@/lib/synthetic-qa/apply-evidence";
import type { CliReviewFinding, RepoHistoryContext } from "@/lib/tauri-ipc";

export interface EvidenceCounts {
  fixed: number;
  reproduced: number;
  notReproduced: number;
}

export interface HistoryFindingSummary {
  findingIdx: number;
  file: string;
  commits: number;
  decisions: number;
  recurring: number;
  commands: number;
  claims: number;
  topDecision?: string;
  topCommit?: string;
  topClaim?: string;
  topCommands?: string[];
}

export interface RevalidationItem {
  id: string;
  label: string;
}

export interface ReviewerProofInput {
  diffRange: string;
  score: number;
  agent: string;
  findings: CliReviewFinding[];
  evidence: FindingEvidence[];
  evidenceCounts: EvidenceCounts;
  intentReport: ReviewIntentReport | null;
  historyFindingSummaries: Map<number, HistoryFindingSummary>;
}

export function formatHistoryCommandEvidence(
  signal: NonNullable<RepoHistoryContext["command_signals"]>[number],
): string {
  const parts = [
    signal.status && signal.status !== "unknown" ? signal.status : null,
    signal.source ? `${signal.source}${signal.source_line ? `:${signal.source_line}` : ""}` : null,
    signal.event_id ? `event=${signal.event_id}` : null,
    signal.artifacts && signal.artifacts.length > 0
      ? `${signal.artifacts.length} artifact${signal.artifacts.length === 1 ? "" : "s"}`
      : null,
    signal.context_excerpt && signal.context_excerpt.length > 0
      ? `context=${signal.context_excerpt[0]}`
      : null,
    signal.source_path ? `source=${signal.source_path}` : null,
  ].filter(Boolean);
  return `${signal.agent}: ${signal.command}${parts.length > 0 ? ` [${parts.join("; ")}]` : ""}`;
}

export function buildRevalidationChecklist(
  finding: CliReviewFinding,
  evidence: FindingEvidence,
): RevalidationItem[] {
  const items: RevalidationItem[] = [];
  const loc = finding.filePath
    ? `${finding.filePath}${finding.line != null ? `:${finding.line}` : ""}`
    : null;

  items.push({
    id: "original-gone",
    label: loc
      ? `Confirm the original failure no longer reproduces at ${loc}.`
      : "Confirm the originally-described failure no longer reproduces.",
  });

  const artifact = evidence.artifact.trim();
  if (artifact) {
    items.push({
      id: "rerun-artifact",
      label: `Re-run the recorded artifact (${artifact}) and confirm it now passes.`,
    });
  } else if (evidence.level !== "static") {
    items.push({
      id: "capture-artifact",
      label: "Capture a fresh artifact (command output, screenshot, or trace) proving the fix.",
    });
  }

  if (evidence.level === "static") {
    items.push({
      id: "add-regression-test",
      label: "Add or extend a test covering this case — the original signal was static-only.",
    });
  } else if (evidence.level === "browser") {
    items.push({
      id: "rerun-browser-flow",
      label: "Walk the browser flow end-to-end and verify no console/network regressions.",
    });
  } else if (evidence.level === "runtime") {
    items.push({
      id: "watch-runtime",
      label: "Watch the relevant logs / runtime trace for one more cycle to confirm silence.",
    });
  }

  if (evidence.notes.trim()) {
    items.push({
      id: "recheck-notes",
      label: "Re-read the QA notes and tick off each documented pass criterion.",
    });
  }

  items.push({
    id: "scan-neighbors",
    label: "Spot-check adjacent files in the same diff for the same pattern.",
  });

  return items;
}

export function buildReviewerProofMarkdown(input: ReviewerProofInput): string {
  const notChecked =
    input.findings.length -
    input.evidenceCounts.reproduced -
    input.evidenceCounts.fixed -
    input.evidenceCounts.notReproduced;
  const statusIcon = (status: FindingEvidence["status"]): string => {
    if (status === "fixed") return "✅";
    if (status === "reproduced") return "⚠️";
    if (status === "not_reproduced") return "🔵";
    return "⏳";
  };
  const formatLoc = (finding: CliReviewFinding): string =>
    finding.filePath
      ? ` (\`${finding.filePath}${finding.line != null ? `:${finding.line}` : ""}\`)`
      : "";

  const lines: string[] = [];
  lines.push(`## Reviewer handoff — ${input.diffRange || "local diff"}`);
  lines.push("");
  lines.push(
    `**Score:** ${Math.round(input.score)}/100 · **Agent:** ${input.agent} · **Findings:** ${input.findings.length}`,
  );
  lines.push(
    `**Fixed:** ${input.evidenceCounts.fixed} · **Reproduced:** ${input.evidenceCounts.reproduced} · **Not reproduced:** ${input.evidenceCounts.notReproduced} · **Unchecked:** ${notChecked}`,
  );

  if (input.intentReport) {
    lines.push("", "### Intent check");
    lines.push(`Intent: ${input.intentReport.inferredIntent}`);
    lines.push(`Changed surfaces: ${input.intentReport.changedSurfaces.join(", ")}`);
    lines.push("");
    lines.push("Verification gaps:");
    lines.push(
      ...(input.intentReport.verificationGaps.length
        ? input.intentReport.verificationGaps.map((gap) => `- ${gap}`)
        : ["- No obvious gaps."]),
    );
  }

  lines.push("", "### Findings & evidence");
  if (input.findings.length === 0) {
    lines.push("- _No findings._");
  } else {
    input.findings.forEach((finding, idx) => {
      const ev = input.evidence[idx];
      const artifact = ev.artifact.trim()
        ? ` · artifact: \`${ev.artifact.trim()}\``
        : "";
      lines.push(
        `- ${statusIcon(ev.status)} **[${finding.severity.toUpperCase()}]** ${finding.title}${formatLoc(finding)} — ${ev.status.replace("_", " ")}${artifact}`,
      );
      const historySummary = input.historyFindingSummaries.get(idx);
      if (historySummary) {
        const sample =
          historySummary.topDecision ??
          historySummary.topCommit ??
          historySummary.topClaim;
        const counts = [
          historySummary.decisions ? `${historySummary.decisions} decision` : null,
          historySummary.commits ? `${historySummary.commits} commit` : null,
          historySummary.recurring ? `${historySummary.recurring} recurring` : null,
          historySummary.commands ? `${historySummary.commands} command` : null,
          historySummary.claims ? `${historySummary.claims} claim` : null,
        ].filter(Boolean).join(", ");
        lines.push(`  - History context: ${counts}${sample ? ` — ${sample}` : ""}`);
        for (const command of historySummary.topCommands ?? []) {
          lines.push(`  - Command evidence: ${command}`);
        }
      }
      const notes = ev.notes.trim();
      if (notes) {
        notes.split("\n").forEach((line) => lines.push(`  - ${line}`));
      }
    });
  }

  const nextActions: string[] = [];
  input.findings.forEach((finding, idx) => {
    const ev = input.evidence[idx];
    const sev = `[${finding.severity.toUpperCase()}]`;
    if (ev.status === "not_checked") {
      nextActions.push(`- [ ] Verify **${sev}** ${finding.title}${formatLoc(finding)}`);
    } else if (ev.status === "reproduced") {
      const artifact = ev.artifact.trim()
        ? ` (artifact: \`${ev.artifact.trim()}\`)`
        : "";
      nextActions.push(
        `- [ ] Fix **${sev}** ${finding.title}${formatLoc(finding)} — currently reproduced${artifact}`,
      );
    } else if (ev.status === "fixed") {
      buildRevalidationChecklist(finding, ev).forEach((item) => {
        if (!ev.revalidation[item.id]) {
          nextActions.push(`- [ ] ${item.label}`);
        }
      });
    }
  });
  if (nextActions.length > 0) {
    lines.push("", "### Next actions");
    lines.push(...nextActions);
  }

  return lines.join("\n");
}
