/** Result shape returned by run-synthetic-qa.mjs and the Tauri command. */
export interface SyntheticQaTrace {
  final_url: string;
  page_title: string;
  console_errors: string[];
}

export interface SyntheticQaRunResult {
  loop_id: string;
  route: string;
  goal: string;
  pass: boolean;
  notes: string;
  screenshot_path: string | null;
  duration_ms: number;
  trace: SyntheticQaTrace;
  error: string | null;
}

export interface SyntheticQaLoopDef {
  id: string;
  label: string;
  route: string;
  goal: string;
  /** Default base URL when the reviewed app is CodeVetter itself. */
  default_base_url: string;
}