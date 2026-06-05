import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  syntheticQaFailureFinding,
  syntheticQaToFindingEvidence,
} from "./apply-evidence.ts";
import type { SyntheticQaRunResult } from "./types.ts";

const baseRun: SyntheticQaRunResult = {
  loop_id: "codevetter-review-shell",
  route: "/review",
  goal: "Open Review page",
  pass: false,
  notes: "Console error: TypeError",
  screenshot_path: "/tmp/synthetic-qa/1/failure.png",
  artifacts: [],
  duration_ms: 1200,
  trace: {
    final_url: "http://localhost:1420/review",
    page_title: "CodeVetter",
    console_errors: ["TypeError: x"],
  },
  error: null,
};

describe("syntheticQaToFindingEvidence", () => {
  it("maps failure to browser + reproduced", () => {
    const ev = syntheticQaToFindingEvidence(baseRun);
    assert.equal(ev.level, "browser");
    assert.equal(ev.status, "reproduced");
    assert.equal(ev.artifact, "/tmp/synthetic-qa/1/failure.png");
    assert.match(ev.notes, /FAIL/);
    assert.match(ev.notes, /TypeError: x/);
  });

  it("maps pass to not_reproduced", () => {
    const ev = syntheticQaToFindingEvidence({ ...baseRun, pass: true, notes: "ok" });
    assert.equal(ev.status, "not_reproduced");
    assert.match(ev.notes, /PASS/);
  });

  it("prefers first explicit artifact and lists all artifacts", () => {
    const ev = syntheticQaToFindingEvidence({
      ...baseRun,
      artifacts: [
        "/tmp/synthetic-qa/1/trace.zip",
        "/tmp/synthetic-qa/1/video.webm",
      ],
    });
    assert.equal(ev.artifact, "/tmp/synthetic-qa/1/trace.zip");
    assert.match(ev.notes, /trace\.zip/);
    assert.match(ev.notes, /video\.webm/);
    assert.match(ev.notes, /failure\.png/);
  });
});

describe("syntheticQaFailureFinding", () => {
  it("creates a warning finding from a failed run", () => {
    const f = syntheticQaFailureFinding(baseRun);
    assert.equal(f.severity, "warning");
    assert.match(f.title ?? "", /Synthetic QA failed/);
    assert.equal(f.summary, baseRun.notes);
  });
});
