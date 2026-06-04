import type { SyntheticQaLoopDef } from "./types";

/** First shipped loop — dogfoods CodeVetter /review in the local Vite dev server. */
export const CODEVETTER_REVIEW_SHELL: SyntheticQaLoopDef = {
  id: "codevetter-review-shell",
  label: "CodeVetter — Review page loads",
  route: "/review",
  goal:
    "Open the Review page in a real browser, confirm the shell renders, and collect console errors.",
  default_base_url: "http://localhost:1420",
};

export const SYNTHETIC_QA_LOOPS: SyntheticQaLoopDef[] = [CODEVETTER_REVIEW_SHELL];

export function getSyntheticQaLoop(id: string): SyntheticQaLoopDef | undefined {
  return SYNTHETIC_QA_LOOPS.find((loop) => loop.id === id);
}