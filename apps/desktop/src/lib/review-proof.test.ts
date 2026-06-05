import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildReviewerProofMarkdown,
  formatHistoryCommandEvidence,
  type HistoryFindingSummary,
} from "./review-proof";

describe("formatHistoryCommandEvidence", () => {
  it("includes raw session source, event, artifact, and transcript path", () => {
    const text = formatHistoryCommandEvidence({
      agent: "codex",
      date: "2026-06-05T00:00:00Z",
      command: "npm run build",
      source: "raw_session",
      source_line: 42,
      event_id: "session-1:raw_session:42",
      session_id: "session-1",
      status: "passed",
      status_reason: "raw-exit",
      artifacts: ["artifacts/build.log"],
      context_excerpt: ["tool: ok artifacts/build.log"],
      source_path: "/tmp/codex/session.jsonl",
    });

    assert.match(text, /codex: npm run build/);
    assert.match(text, /passed/);
    assert.match(text, /raw_session:42/);
    assert.match(text, /event=session-1:raw_session:42/);
    assert.match(text, /1 artifact/);
    assert.match(text, /context=tool: ok artifacts\/build\.log/);
    assert.match(text, /source=\/tmp\/codex\/session\.jsonl/);
  });
});

describe("buildReviewerProofMarkdown", () => {
  it("copies concrete command evidence into finding handoff proof", () => {
    const history = new Map<number, HistoryFindingSummary>();
    history.set(0, {
      findingIdx: 0,
      file: "src/review.ts",
      commits: 1,
      decisions: 0,
      recurring: 0,
      commands: 1,
      claims: 0,
      topCommit: "fix review state",
      topCommands: [
        "codex: npm run build [passed; raw_session:42; event=session-1:raw_session:42; 1 artifact; source=/tmp/codex/session.jsonl]",
      ],
    });

    const markdown = buildReviewerProofMarkdown({
      diffRange: "HEAD",
      score: 82,
      agent: "codex",
      findings: [
        {
          severity: "high",
          title: "Review prompt omits command evidence",
          summary: "Missing evidence",
          filePath: "src/review.ts",
          line: 12,
        },
      ],
      evidence: [
        {
          level: "test",
          status: "reproduced",
          artifact: "artifacts/failure.log",
          notes: "Build failed before the fix.",
          revalidation: {},
        },
      ],
      evidenceCounts: {
        fixed: 0,
        reproduced: 1,
        notReproduced: 0,
      },
      intentReport: null,
      historyFindingSummaries: history,
    });

    assert.match(markdown, /History context: 1 commit, 1 command/);
    assert.match(markdown, /Command evidence: codex: npm run build/);
    assert.match(markdown, /event=session-1:raw_session:42/);
    assert.match(markdown, /source=\/tmp\/codex\/session\.jsonl/);
    assert.match(markdown, /Fix \*\*\[HIGH\]\*\* Review prompt omits command evidence/);
  });
});
