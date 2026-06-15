//! Brain layer: given the current page state + goal + history, return the
//! next AgentAction. A `Brain` trait abstracts the model provider so the
//! runner is generic across LocalAiBrain (claude/codex CLI via local-ai),
//! and future direct-API or Ollama-backed brains.

use std::time::Duration;

use futures::StreamExt;

use super::prompts::system_prompt_for_goal;
use super::types::AgentAction;

pub struct BrainContext<'a> {
    pub goal: &'a str,
    pub persona: Option<&'a str>,
    /// Compact summaries of prior steps for short-term memory.
    pub history: &'a [String],
    pub url: &'a str,
    pub page_title: &'a str,
    pub accessibility_tree: &'a str,
    /// Path to a screenshot of the current viewport, if captured.
    pub screenshot_path: Option<&'a std::path::Path>,
}

pub trait Brain: Send + Sync {
    fn next_action(
        &self,
        ctx: BrainContext<'_>,
    ) -> impl std::future::Future<Output = Result<AgentAction, String>> + Send;
}

pub struct LocalAiBrain {
    pub endpoint: String,
    pub provider: String,
    pub model: Option<String>,
    client: reqwest::Client,
}

impl LocalAiBrain {
    pub fn new(provider: String, model: Option<String>) -> Self {
        Self {
            endpoint: "http://localhost:3456/chat".into(),
            provider,
            model,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("reqwest client"),
        }
    }

    /// Build the request body in local-ai's expected shape. For providers that
    /// support images (currently `codex`), the screenshot is attached as an
    /// image content part. For text-only providers (`claude`, `gemini`) the
    /// screenshot path is dropped and only the element-list summary is sent.
    fn build_request_body(&self, ctx: &BrainContext) -> serde_json::Value {
        let supports_images = self.provider == "codex";
        let mut user_parts: Vec<serde_json::Value> = Vec::new();
        user_parts.push(serde_json::json!({
            "type": "text",
            "text": format_user_turn(ctx),
        }));
        if supports_images {
            if let Some(path) = ctx.screenshot_path {
                user_parts.push(serde_json::json!({
                    "type": "image",
                    "image_path": path.to_string_lossy(),
                }));
            }
        }
        serde_json::json!({
            "provider": self.provider,
            "model": self.model,
            "systemPrompt": system_prompt_for_goal(ctx.goal, ctx.persona),
            "messages": [{ "role": "user", "content": user_parts }],
        })
    }

}

impl Brain for LocalAiBrain {
    /// POST to local-ai, drain the SSE stream, parse the JSON action.
    async fn next_action(&self, ctx: BrainContext<'_>) -> Result<AgentAction, String> {
        let body = self.build_request_body(&ctx);

        let resp = self
            .client
            .post(&self.endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                format!(
                    "local-ai POST failed at {}: {e}. Is the local-ai server running \
                     (cd ../local-ai && npm start)?",
                    self.endpoint
                )
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(format!("local-ai returned {status}: {body_text}"));
        }

        let text = collect_sse_text(resp).await?;
        extract_action(&text)
    }
}

fn format_user_turn(ctx: &BrainContext) -> String {
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

/// Drain a server-sent-events response, accumulating the `text` field of
/// each `data: {...}` line until `data: [DONE]`. local-ai emits the
/// per-token text fragments this way.
async fn collect_sse_text(resp: reqwest::Response) -> Result<String, String> {
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut assembled = String::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("sse chunk read failed: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].to_string();
            buffer = buffer[idx + 1..].to_string();
            let line = line.trim_end_matches('\r');
            let Some(payload) = line.strip_prefix("data: ") else { continue };
            if payload == "[DONE]" {
                return Ok(assembled);
            }
            // Each payload is a JSON object; we expect {text: "..."} or
            // {error: "..."}. Be tolerant of malformed lines.
            let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else { continue };
            if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
                return Err(format!("local-ai brain error: {err}"));
            }
            if let Some(text) = v.get("text").and_then(|x| x.as_str()) {
                assembled.push_str(text);
            }
        }
    }
    Ok(assembled)
}

/// Find the last well-formed JSON object in `text` that has a `type` field
/// matching one of our action shapes, and deserialize it as AgentAction.
/// Tolerates prose around the JSON (which the brain sometimes emits).
pub fn extract_action(text: &str) -> Result<AgentAction, String> {
    let candidates = scan_json_objects(text);
    if candidates.is_empty() {
        return Err(format!(
            "no JSON action found in brain response (length {}): {}",
            text.len(),
            preview(text, 240)
        ));
    }
    // Walk last-to-first; the action is typically the final block.
    for blob in candidates.iter().rev() {
        match serde_json::from_str::<AgentAction>(blob) {
            Ok(action) => return Ok(action),
            Err(_) => continue,
        }
    }
    Err(format!(
        "found {} JSON blocks but none matched the AgentAction schema. Last block: {}",
        candidates.len(),
        candidates.last().map(|s| preview(s, 240)).unwrap_or_default(),
    ))
}

/// Scan `text` for balanced `{...}` substrings. Naive but robust to prose.
fn scan_json_objects(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut depth = 0_i32;
    let mut start = None;
    let mut in_string = false;
    let mut escape = false;
    for (i, &b) in bytes.iter().enumerate() {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            match b {
                b'\\' => escape = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => {
                if depth == 0 {
                    start = Some(i);
                }
                depth += 1;
            }
            b'}' => {
                if depth > 0 {
                    depth -= 1;
                    if depth == 0 {
                        if let Some(s) = start.take() {
                            if let Ok(slice) = std::str::from_utf8(&bytes[s..=i]) {
                                out.push(slice.to_string());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn preview(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_clean_done_action() {
        let action = extract_action(r#"{"type":"done","reasoning":"goal met"}"#).unwrap();
        match action {
            AgentAction::Done { reasoning } => assert_eq!(reasoning, "goal met"),
            other => panic!("wrong action: {other:?}"),
        }
    }

    #[test]
    fn extracts_click_from_prose_wrapped_json() {
        let txt = r##"Looking at the page, the Download button is clearly the next step.

{"type":"click","selector":"#dl","reasoning":"primary CTA"}

That should take us to the install page."##;
        let action = extract_action(txt).unwrap();
        match action {
            AgentAction::Click { selector, reasoning } => {
                assert_eq!(selector, "#dl");
                assert_eq!(reasoning, "primary CTA");
            }
            other => panic!("wrong action: {other:?}"),
        }
    }

    #[test]
    fn picks_last_valid_block_when_multiple_exist() {
        let txt = r##"
        Earlier I considered: {"note":"not a real action"}
        Now I'll do: {"type":"scroll","delta":600,"reasoning":"see more"}
        "##;
        let action = extract_action(txt).unwrap();
        assert!(matches!(action, AgentAction::Scroll { delta: 600, .. }));
    }

    #[test]
    fn errors_on_no_json() {
        let err = extract_action("I have no idea what to do.").unwrap_err();
        assert!(err.contains("no JSON action found"), "{err}");
    }

    #[test]
    fn errors_on_unknown_action_type() {
        let err = extract_action(r#"{"type":"teleport","reasoning":"hmm"}"#).unwrap_err();
        assert!(err.contains("none matched"), "{err}");
    }

    #[test]
    fn build_request_body_attaches_image_for_codex() {
        let brain = LocalAiBrain::new("codex".into(), None);
        let shot = std::path::PathBuf::from("/tmp/x.png");
        let ctx = BrainContext {
            goal: "g",
            persona: None,
            history: &[],
            url: "u",
            page_title: "t",
            accessibility_tree: "ax",
            screenshot_path: Some(&shot),
        };
        let body = brain.build_request_body(&ctx);
        let parts = body["messages"][0]["content"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["type"], "image");
        assert_eq!(parts[1]["image_path"], "/tmp/x.png");
    }

    #[test]
    fn build_request_body_omits_image_for_claude() {
        let brain = LocalAiBrain::new("claude".into(), None);
        let shot = std::path::PathBuf::from("/tmp/x.png");
        let ctx = BrainContext {
            goal: "g",
            persona: None,
            history: &[],
            url: "u",
            page_title: "t",
            accessibility_tree: "ax",
            screenshot_path: Some(&shot),
        };
        let body = brain.build_request_body(&ctx);
        let parts = body["messages"][0]["content"].as_array().unwrap();
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "text");
    }
}
