//! Rust-native `Brain` impl that spawns claude / codex CLIs directly,
//! mirroring local-ai's per-provider args + JSON-stream parsing. Used when
//! the local-ai HTTP gateway isn't reachable — typically the shipped DMG
//! case where no Node runtime is bundled.
//!
//! Stays in sync with `../local-ai/index.mjs`:
//!   - claude: `-p --output-format stream-json --verbose --system-prompt SYS`
//!             prompt via stdin; collect text from `assistant.message.content`
//!             and `content_block_delta.delta.text`.
//!   - codex:  `exec --json [-i FILE…]` with system prompt embedded in prompt
//!             body; collect text from `item.completed → agent_message`.

use std::process::Stdio;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::brain::{Brain, BrainContext};
use super::prompts::system_prompt_for_goal;
use super::types::AgentAction;

pub struct CliBrain {
    pub provider: String,
    pub model: Option<String>,
}

impl CliBrain {
    pub fn new(provider: String, model: Option<String>) -> Self {
        Self { provider, model }
    }
}

impl Brain for CliBrain {
    async fn next_action(&self, ctx: BrainContext<'_>) -> Result<AgentAction, String> {
        let text = match self.provider.as_str() {
            "claude" => spawn_claude(&ctx, self.model.as_deref()).await?,
            "codex" => spawn_codex(&ctx, self.model.as_deref()).await?,
            other => {
                return Err(format!(
                    "CliBrain: provider `{other}` not supported in the bundled brain. \
                     Run local-ai if you need gemini."
                ))
            }
        };
        super::brain::extract_action(&text)
    }
}

fn format_user_message(ctx: &BrainContext<'_>) -> String {
    let mut buf = String::new();
    if !ctx.history.is_empty() {
        buf.push_str("Previous steps:\n");
        for (i, line) in ctx.history.iter().enumerate() {
            buf.push_str(&format!("  {}. {}\n", i + 1, line));
        }
        buf.push('\n');
    }
    buf.push_str(&format!("Current URL: {}\n", ctx.url));
    buf.push_str(&format!("Page title: {}\n\n", ctx.page_title));
    buf.push_str("Visible interactable elements:\n");
    buf.push_str(ctx.accessibility_tree);
    buf.push_str("\n\nReturn the next action as a JSON object on its own line.");
    buf
}

/// claude has a dedicated `--system-prompt` flag, so the prompt body is just
/// the user message (no system header inline).
fn build_claude_prompt(ctx: &BrainContext<'_>) -> String {
    format!("User: {}", format_user_message(ctx))
}

/// codex has no system-prompt flag — local-ai prepends "System instructions: …".
/// We mirror that exact shape so behavior is identical across paths.
fn build_codex_prompt(ctx: &BrainContext<'_>) -> String {
    let sys = system_prompt_for_goal(ctx.goal, ctx.persona);
    format!(
        "System instructions: {sys}\n\nUser: {body}",
        body = format_user_message(ctx),
    )
}

async fn spawn_claude(ctx: &BrainContext<'_>, model: Option<&str>) -> Result<String, String> {
    let prompt = build_claude_prompt(ctx);
    let system_prompt = system_prompt_for_goal(ctx.goal, ctx.persona);

    let mut cmd = Command::new("claude");
    cmd.args(["-p", "--output-format", "stream-json", "--verbose"]);
    if let Some(m) = model {
        cmd.args(["--model", m]);
    }
    cmd.args(["--system-prompt", &system_prompt]);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn claude CLI: {e}. Is `claude` on PATH?"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("claude stdin write: {e}"))?;
        let _ = stdin.shutdown().await;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "claude: no stdout pipe".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let mut assembled = String::new();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("read claude stdout: {e}"))?
    {
        parse_claude_line(&line, &mut assembled);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("wait claude: {e}"))?;
    if !status.success() {
        return Err(format!("claude exited with status {status}"));
    }
    Ok(assembled)
}

async fn spawn_codex(ctx: &BrainContext<'_>, model: Option<&str>) -> Result<String, String> {
    let prompt = build_codex_prompt(ctx);

    let mut cmd = Command::new("codex");
    cmd.args(["exec", "--json"]);
    if let Some(m) = model {
        cmd.args(["--model", m]);
    }
    if let Some(path) = ctx.screenshot_path {
        // codex supports `-i FILE…` for image attachments. Pass the screenshot
        // path so the model gets the same multimodal input it would via local-ai.
        cmd.arg("-i").arg(path);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn codex CLI: {e}. Is `codex` on PATH?"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("codex stdin write: {e}"))?;
        let _ = stdin.shutdown().await;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "codex: no stdout pipe".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let mut assembled = String::new();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("read codex stdout: {e}"))?
    {
        parse_codex_line(&line, &mut assembled);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("wait codex: {e}"))?;
    if !status.success() {
        return Err(format!("codex exited with status {status}"));
    }
    Ok(assembled)
}

/// Append any text fragments from one claude stream-json line into the
/// assembled buffer. Stays tolerant of unrelated event types.
pub(crate) fn parse_claude_line(line: &str, out: &mut String) {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("assistant") => {
            if let Some(content) = v["message"]["content"].as_array() {
                for block in content {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            out.push_str(text);
                        }
                    }
                }
            }
        }
        Some("content_block_delta") => {
            if let Some(text) = v["delta"]["text"].as_str() {
                out.push_str(text);
            }
        }
        _ => {}
    }
}

/// Append any text fragments from one codex `exec --json` line into the
/// assembled buffer. We only care about `item.completed → agent_message`.
pub(crate) fn parse_codex_line(line: &str, out: &mut String) {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    if v.get("type").and_then(|t| t.as_str()) != Some("item.completed") {
        return;
    }
    if v["item"]["type"].as_str() != Some("agent_message") {
        return;
    }
    if let Some(text) = v["item"]["text"].as_str() {
        out.push_str(text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_claude_assistant_text_block() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}"#;
        let mut out = String::new();
        parse_claude_line(line, &mut out);
        assert_eq!(out, "hello");
    }

    #[test]
    fn parse_claude_content_block_delta() {
        let line = r#"{"type":"content_block_delta","delta":{"text":"world"}}"#;
        let mut out = String::new();
        parse_claude_line(line, &mut out);
        assert_eq!(out, "world");
    }

    #[test]
    fn parse_claude_assistant_skips_non_text_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x"}]}}"#;
        let mut out = String::new();
        parse_claude_line(line, &mut out);
        assert_eq!(out, "");
    }

    #[test]
    fn parse_claude_ignores_unknown_types() {
        let line = r#"{"type":"system","message":"warming up"}"#;
        let mut out = String::new();
        parse_claude_line(line, &mut out);
        assert_eq!(out, "");
    }

    #[test]
    fn parse_claude_tolerates_malformed_lines() {
        let mut out = String::new();
        parse_claude_line("not json", &mut out);
        parse_claude_line("", &mut out);
        assert_eq!(out, "");
    }

    #[test]
    fn parse_codex_agent_message() {
        let line = r#"{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}"#;
        let mut out = String::new();
        parse_codex_line(line, &mut out);
        assert_eq!(out, "hi");
    }

    #[test]
    fn parse_codex_skips_non_agent_messages() {
        let line = r#"{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}"#;
        let mut out = String::new();
        parse_codex_line(line, &mut out);
        assert_eq!(out, "");
    }

    #[test]
    fn parse_codex_ignores_non_completion_events() {
        let line = r#"{"type":"item.started","item":{"type":"agent_message"}}"#;
        let mut out = String::new();
        parse_codex_line(line, &mut out);
        assert_eq!(out, "");
    }

    #[test]
    fn codex_prompt_embeds_system_block() {
        let ctx = BrainContext {
            goal: "find the price",
            persona: None,
            history: &[],
            url: "https://x.test",
            page_title: "X",
            accessibility_tree: "[ 0] button ...",
            screenshot_path: None,
        };
        let prompt = build_codex_prompt(&ctx);
        assert!(prompt.starts_with("System instructions: "));
        assert!(prompt.contains("Current URL: https://x.test"));
        assert!(prompt.contains("\n\nUser: "));
    }

    #[test]
    fn claude_prompt_omits_system_block() {
        let ctx = BrainContext {
            goal: "find the price",
            persona: None,
            history: &[],
            url: "https://x.test",
            page_title: "X",
            accessibility_tree: "[ 0] button ...",
            screenshot_path: None,
        };
        let prompt = build_claude_prompt(&ctx);
        assert!(!prompt.contains("System instructions:"));
        assert!(prompt.starts_with("User: "));
        assert!(prompt.contains("Current URL: https://x.test"));
    }

    /// End-to-end smoke against the real `claude` CLI. Ignored by default;
    /// run with `cargo test -- --ignored cli_brain` once `claude` is on PATH
    /// and authenticated.
    #[tokio::test]
    #[ignore]
    async fn e2e_claude_returns_text() {
        let ctx = BrainContext {
            goal: "return the literal text DONE",
            persona: None,
            history: &[],
            url: "https://example.com",
            page_title: "Example",
            accessibility_tree: "(nothing)",
            screenshot_path: None,
        };
        let text = spawn_claude(&ctx, None).await.expect("spawn claude");
        assert!(!text.is_empty(), "expected non-empty response");
    }
}
