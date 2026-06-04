use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command as StdCommand;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyntheticQaTrace {
    pub final_url: String,
    pub page_title: String,
    pub console_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyntheticQaRunResult {
    pub loop_id: String,
    pub route: String,
    pub goal: String,
    pub pass: bool,
    pub notes: String,
    pub screenshot_path: Option<String>,
    pub duration_ms: u64,
    pub trace: SyntheticQaTrace,
    pub error: Option<String>,
}

fn resolve_runner_script() -> Result<PathBuf, String> {
    // Dev / local repo: CARGO_MANIFEST_DIR = apps/desktop/src-tauri
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_script = manifest
        .parent()
        .and_then(|p| p.parent())
        .map(|desktop| desktop.join("scripts").join("run-synthetic-qa.mjs"));
    if let Some(path) = dev_script {
        if path.exists() {
            return Ok(path);
        }
    }
    Err(
        "Synthetic QA runner script not found. Run from the CodeVetter repo with apps/desktop/scripts/run-synthetic-qa.mjs present.".into(),
    )
}

/// Run the first synthetic-user QA loop against a local HTTP app (Playwright).
#[tauri::command]
pub async fn run_synthetic_qa(
    app: tauri::AppHandle,
    base_url: String,
    loop_id: Option<String>,
) -> Result<SyntheticQaRunResult, String> {
    let loop_id = loop_id.unwrap_or_else(|| "codevetter-review-shell".to_string());
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("base_url is required (e.g. http://localhost:1420)".into());
    }

    let script = resolve_runner_script()?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    let run_id = format!(
        "{}-{}",
        loop_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let artifact_dir = app_data.join("synthetic-qa").join(&run_id);
    std::fs::create_dir_all(&artifact_dir).map_err(|e| format!("create artifact dir: {e}"))?;

    let output = StdCommand::new("node")
        .arg(&script)
        .arg(&base_url)
        .arg(&loop_id)
        .arg(&artifact_dir)
        .output()
        .map_err(|e| format!("failed to spawn node runner: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with('{'))
        .ok_or_else(|| {
            let stderr = String::from_utf8_lossy(&output.stderr);
            format!(
                "runner produced no JSON (exit {}). stdout: {} stderr: {}",
                output.status.code().unwrap_or(-1),
                stdout.trim(),
                stderr.trim()
            )
        })?;

    let mut result: SyntheticQaRunResult =
        serde_json::from_str(line).map_err(|e| format!("parse runner JSON: {e} ({line})"))?;

    // Normalize screenshot path to absolute string for the UI
    if let Some(ref p) = result.screenshot_path {
        if !p.is_empty() {
            result.screenshot_path = Some(PathBuf::from(p).to_string_lossy().into_owned());
        }
    }

    if !output.status.success() && result.error.is_none() && !result.pass {
        // Playwright exit 2 = failed assertions; still return structured result
        log::info!(
            "Synthetic QA loop {} finished with exit {:?}",
            loop_id,
            output.status.code()
        );
    }

    Ok(result)
}