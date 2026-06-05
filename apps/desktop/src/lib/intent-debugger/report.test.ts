import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMIT_INTENT_FIXTURES } from "./fixtures.ts";
import {
  buildCommitIntentReport,
  buildReviewIntentReport,
  renderCommitIntentMarkdown,
} from "./report.ts";

describe("buildCommitIntentReport", () => {
  it("flags agent-authored UI changes as needing flow proof", () => {
    const report = buildCommitIntentReport(COMMIT_INTENT_FIXTURES[0]);

    assert.equal(report.author, "agent");
    assert.ok(report.changedSurfaces.includes("ui"));
    assert.ok(report.suspectedRisks.some((risk) => /Agent-authored UI change/.test(risk)));
    assert.equal(report.verificationGaps.length, 0);
  });

  it("surfaces missing verification evidence for human changes", () => {
    const report = buildCommitIntentReport(COMMIT_INTENT_FIXTURES[1]);

    assert.equal(report.author, "human");
    assert.ok(report.verificationGaps.some((gap) => /npm run lint/.test(gap)));
    assert.match(renderCommitIntentMarkdown(report), /Verification gaps/);
  });
});

describe("buildReviewIntentReport", () => {
  it("flags UI reviews without browser proof", () => {
    const report = buildReviewIntentReport({
      reviewId: "review-1",
      diffRange: "HEAD~1",
      changeDescription: "Improve the settings page",
      reviewMode: "specialist-lite",
      riskTier: "lite",
      findings: [
        {
          severity: "medium",
          title: "Missing empty state",
          filePath: "src/pages/Settings.tsx",
        },
      ],
      evidence: [{ level: "static", status: "not_checked" }],
      qaRuns: [],
      blast: { totalCallers: 0, totalSymbols: 1, changedFiles: 1 },
    });

    assert.ok(report.changedSurfaces.includes("ui"));
    assert.ok(report.verificationGaps.some((gap) => /browser\/user-flow/.test(gap)));
    assert.ok(report.verificationGaps.some((gap) => /unchecked/.test(gap)));
    assert.ok(report.timeline.some((item) => item.id === "qa" && item.status === "missing"));
  });

  it("flags sensitive high-risk findings without evidence", () => {
    const report = buildReviewIntentReport({
      reviewId: "review-2",
      diffRange: "main..HEAD",
      changeDescription: "",
      reviewMode: "specialist-full",
      riskTier: "full-sensitive",
      changedLines: 30,
      sensitivePaths: ["src-tauri/src/commands/auth.rs"],
      history: {
        recentCommits: 2,
        priorDecisions: 1,
        priorAgentRuns: 0,
        recurringFailures: 0,
      },
      findings: [
        {
          severity: "high",
          title: "Token leak",
          filePath: "src-tauri/src/commands/auth.rs",
        },
      ],
      evidence: [{ level: "static", status: "not_checked" }],
      blast: { totalCallers: 8, totalSymbols: 1, changedFiles: 1 },
    });

    assert.ok(report.changedSurfaces.includes("sensitive"));
    assert.ok(report.suspectedRisks.some((risk) => /Sensitive path/.test(risk)));
    assert.ok(report.verificationGaps.some((gap) => /Original goal/.test(gap)));
    assert.ok(report.verificationGaps.some((gap) => /high-risk/.test(gap)));
    assert.ok(report.timeline.some((item) => item.id === "history" && item.status === "done"));
  });

  it("adds transcript command and claim signals to the timeline", () => {
    const report = buildReviewIntentReport({
      reviewId: "review-3",
      diffRange: "HEAD",
      changeDescription: "Verify the settings update",
      findings: [],
      evidence: [],
      history: {
        recentCommits: 1,
        priorDecisions: 0,
        priorAgentRuns: 1,
        recurringFailures: 0,
        commands: 2,
        claims: 1,
        commandStatus: { passed: 1, failed: 1, stale: 0, unknown: 0 },
        commandArtifacts: 2,
        rawSessionCommands: 1,
        structuredCommands: 1,
        latestCommand: "npm run build",
        latestClaim: "Implemented settings persistence",
      },
      blast: null,
    });

    const transcript = report.timeline.find((item) => item.id === "agent-transcript");
    assert.ok(transcript);
    assert.match(transcript.detail, /npm run build/);
    assert.match(transcript.detail, /1 pass/);
    assert.match(transcript.detail, /1 fail/);
    assert.match(transcript.detail, /2 artifacts/);
    assert.match(transcript.detail, /1 raw session/);
    assert.match(transcript.detail, /1 structured/);
    assert.match(transcript.detail, /Implemented settings persistence/);
  });
});
