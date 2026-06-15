import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentAction, AgentStep } from "@/lib/tauri-ipc";

import { actionReasoning, describeAction } from "./agent-action-format";

function step(action: AgentAction): AgentStep {
  return {
    index: 0,
    action,
    url: "https://example.com",
    page_title: "Example",
    screenshot_path: null,
    screenshot_data_url: null,
    elapsed_ms: 100,
    error: null,
  };
}

describe("describeAction", () => {
  it("renders click with selector", () => {
    assert.equal(
      describeAction(
        step({ type: "click", selector: "#dl", reasoning: "primary cta" }),
      ),
      "click #dl",
    );
  });

  it("renders type with text and selector", () => {
    assert.equal(
      describeAction(
        step({
          type: "type",
          selector: "input[name=email]",
          text: "hi@x.com",
          reasoning: "form fill",
        }),
      ),
      'type "hi@x.com" → input[name=email]',
    );
  });

  it("renders scroll with delta", () => {
    assert.equal(
      describeAction(step({ type: "scroll", delta: 600, reasoning: "see more" })),
      "scroll 600px",
    );
  });

  it("renders done and give_up labels", () => {
    assert.equal(
      describeAction(step({ type: "done", reasoning: "found it" })),
      "done",
    );
    assert.equal(
      describeAction(step({ type: "give_up", reasoning: "stuck" })),
      "gave up",
    );
  });
});

describe("actionReasoning", () => {
  it("returns the reasoning on each variant", () => {
    assert.equal(
      actionReasoning(
        step({ type: "scroll", delta: 600, reasoning: "see footer" }),
      ),
      "see footer",
    );
  });
});
