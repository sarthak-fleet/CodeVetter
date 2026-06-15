import type { AgentStep } from "@/lib/tauri-ipc";

export function describeAction(step: AgentStep): string {
  const { action } = step;
  switch (action.type) {
    case "click":
      return `click ${action.selector}`;
    case "type":
      return `type "${action.text}" → ${action.selector}`;
    case "key":
      return `press ${action.key}`;
    case "scroll":
      return `scroll ${action.delta}px`;
    case "goto":
      return `goto ${action.url}`;
    case "done":
      return "done";
    case "give_up":
      return "gave up";
  }
}

export function actionReasoning(step: AgentStep): string {
  return step.action.reasoning ?? "";
}
