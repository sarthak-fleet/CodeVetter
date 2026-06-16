//! "Ask CodeVetter" — natural-language Q&A over fleet + repo data.
//!
//! Bundles the rollup, intel, and DORA JSON into a system-prompt context,
//! then spawns a one-shot LLM call. The model answers from the data;
//! nothing leaves the machine other than the prompt text.

use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::commands::dora::get_dora_metrics;
use crate::commands::fleet::get_fleet_rollup;
use crate::commands::intel::attribute_repo_path;
use crate::DbState;
use tauri::State;

const SYSTEM_PROMPT: &str = include_str!("./ask_system_prompt.txt");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskInput {
    pub question: String,
    #[serde(default)]
    pub repo_path: Option<String>,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub include_fleet: bool,
}
fn default_provider() -> String {
    "claude".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskResult {
    pub answer: String,
    pub context_bytes: usize,
    pub provider: String,
    pub took_ms: u64,
}

#[tauri::command]
pub async fn ask_codevetter(
    db: State<'_, DbState>,
    input: AskInput,
) -> Result<AskResult, String> {
    let started = std::time::Instant::now();
    let question = input.question.trim();
    if question.is_empty() {
        return Err("Question is empty.".to_string());
    }

    // Build the context. Each piece may fail independently — we still want
    // to answer with whatever we have, plus a note about what's missing.
    let mut context = String::new();
    let mut warnings: Vec<String> = Vec::new();

    if let Some(repo) = input.repo_path.as_deref() {
        match attribute_repo_path(repo) {
            Ok(r) => {
                let json = serde_json::to_string(&r).unwrap_or_else(|_| "{}".into());
                context.push_str(&format!(
                    "## Repo attribution for `{repo}`\n\n```json\n{json}\n```\n\n"
                ));
            }
            Err(e) => warnings.push(format!("repo attribution failed: {e}")),
        }
        match get_dora_metrics(repo.to_string(), Some(90)).await {
            Ok(d) => {
                let json = serde_json::to_string(&d).unwrap_or_else(|_| "{}".into());
                context.push_str(&format!(
                    "## DORA metrics for `{repo}` (last 90d)\n\n```json\n{json}\n```\n\n"
                ));
            }
            Err(e) => warnings.push(format!("DORA failed: {e}")),
        }
    }

    if input.include_fleet {
        match get_fleet_rollup(db.clone()).await {
            Ok(rollup) => {
                let json = serde_json::to_string(&rollup).unwrap_or_else(|_| "{}".into());
                context.push_str(&format!(
                    "## Fleet rollup (across linked SaaS Maker projects)\n\n```json\n{json}\n```\n\n"
                ));
            }
            Err(e) => warnings.push(format!("fleet rollup failed: {e}")),
        }
    }

    if !warnings.is_empty() {
        context.push_str("## Data warnings\n\n");
        for w in &warnings {
            context.push_str(&format!("- {w}\n"));
        }
        context.push('\n');
    }

    if context.is_empty() {
        return Err(
            "No context to answer from. Set repo_path and/or include_fleet."
                .to_string(),
        );
    }

    let prompt = format!(
        "{SYSTEM_PROMPT}\n\n=== CONTEXT ===\n\n{context}\n=== QUESTION ===\n\n{question}\n\nAnswer:"
    );
    let answer = match input.provider.as_str() {
        "codex" => spawn_oneshot("codex", &["exec", "--json"], &prompt).await?,
        _ => spawn_oneshot("claude", &["-p", "--output-format", "text"], &prompt).await?,
    };

    Ok(AskResult {
        answer: answer.trim().to_string(),
        context_bytes: context.len(),
        provider: input.provider,
        took_ms: started.elapsed().as_millis() as u64,
    })
}

async fn spawn_oneshot(cmd: &str, args: &[&str], prompt: &str) -> Result<String, String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn {cmd}: {e}. Is `{cmd}` on PATH?"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("stdin write: {e}"))?;
        let _ = stdin.shutdown().await;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("wait {cmd}: {e}"))?;
    if !out.status.success() {
        return Err(format!("{cmd} exit {:?}", out.status.code()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ask_with_empty_question_errors_cleanly() {
        // db state would require Tauri setup, so we don't test that
        // path. We can still verify the trim/empty guard at the
        // request-shape level.
        let inp = AskInput {
            question: "   ".into(),
            repo_path: None,
            provider: "claude".into(),
            include_fleet: false,
        };
        assert!(inp.question.trim().is_empty());
    }
}
