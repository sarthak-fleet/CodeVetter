use crate::db::queries::{self, LocalReviewInput, ActivityInput};
use crate::talk;
use crate::DbState;
use serde::Deserialize;
use serde_json::{json, Value};
use std::process::Command as StdCommand;
use tauri::{Emitter, Manager, State};

/// Resolve a CLI binary (e.g. "claude", "gemini") to an absolute path.
///
/// Tauri apps on macOS don't always inherit the user's shell PATH — especially
/// when launched outside a terminal — so `StdCommand::new("claude")` can fail
/// with ENOENT even though the user has it installed. This helper walks the
/// usual user-install locations (asdf shims, bun, pnpm, npm global, homebrew,
/// `~/.local/bin`) and returns the first match. Falls back to the bare name
/// so the existing PATH lookup still runs if none match.
fn resolve_cli_path(name: &str) -> String {
    // First, honor PATH if it works
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    // Common user-install locations not always in PATH of GUI-launched apps
    if let Ok(home) = std::env::var("HOME") {
        let fallbacks = [
            format!("{home}/.local/bin/{name}"),
            format!("{home}/.bun/bin/{name}"),
            format!("{home}/.asdf/shims/{name}"),
            format!("{home}/Library/pnpm/{name}"),
            format!("{home}/.nvm/versions/node/current/bin/{name}"),
            format!("/opt/homebrew/bin/{name}"),
            format!("/usr/local/bin/{name}"),
        ];
        for c in fallbacks {
            if std::path::Path::new(&c).is_file() {
                return c;
            }
        }
    }

    // Give up — let Command::new fail with its usual error
    name.to_string()
}

fn read_repo_conventions(repo_path: &str) -> String {
    const BUDGET: usize = 16 * 1024;
    let candidates = ["CLAUDE.md", "agents.md", "AGENTS.md"];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut parts: Vec<String> = Vec::new();
    let mut budget = BUDGET;

    for name in candidates {
        let path = std::path::Path::new(repo_path).join(name);
        if !path.is_file() {
            continue;
        }
        let key = name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        let trimmed = content.trim();
        if trimmed.is_empty() {
            continue;
        }
        let take = trimmed.len().min(budget);
        if take == 0 {
            break;
        }
        let mut end = take;
        while end > 0 && !trimmed.is_char_boundary(end) {
            end -= 1;
        }
        if end == 0 {
            break;
        }
        let slice = &trimmed[..end];
        parts.push(format!("### {name}\n{slice}"));
        budget = budget.saturating_sub(end);
        if budget == 0 {
            break;
        }
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!(
            "\nRepo conventions (authoritative — findings that contradict these should be dropped):\n{}\n",
            parts.join("\n\n")
        )
    }
}

/// Look up the latest talk for this project and prepend it as context if fresh enough.
fn maybe_prepend_talk_context(
    conn: &rusqlite::Connection,
    project_path: &str,
    prompt: &str,
) -> String {
    if let Ok(Some(t)) = queries::get_latest_talk_for_project(conn, project_path) {
        // Check staleness
        if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&t.created_at) {
            let age = chrono::Utc::now().signed_duration_since(created);
            if age.num_seconds() <= talk::STALENESS_SECS {
                let context = talk::render_talk_for_prompt(&t);
                return format!("{context}\n\n{prompt}");
            }
        }
    }
    prompt.to_string()
}

/// Finding shape received from the frontend (review-core running in webview).
#[derive(Debug, Deserialize)]
pub struct ReviewFindingInput {
    pub severity: String,
    pub title: String,
    pub summary: String,
    pub suggestion: Option<String>,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    pub line: Option<i64>,
    pub confidence: Option<f64>,
    pub fingerprint: Option<String>,
}

/// Get the git diff for a local repository.
/// Returns the diff text and changed file list for the frontend to feed into review-core.
#[tauri::command]
pub async fn get_local_diff(
    repo_path: String,
    diff_range: Option<String>,
) -> Result<Value, String> {
    // Run git diff
    let mut cmd = StdCommand::new("git");
    cmd.arg("diff");
    if let Some(ref range) = diff_range {
        cmd.arg(range);
    }
    cmd.current_dir(&repo_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git diff: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {stderr}"));
    }

    let diff_text = String::from_utf8_lossy(&output.stdout).to_string();

    // Get changed file list
    let name_status_output = StdCommand::new("git")
        .args(["diff", "--name-status"])
        .args(diff_range.as_deref().map(|r| vec![r]).unwrap_or_default())
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("git diff --name-status failed: {e}"))?;

    let files: Vec<Value> = String::from_utf8_lossy(&name_status_output.stdout)
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, '\t').collect();
            if parts.len() == 2 {
                let status = match parts[0] {
                    "A" => "added",
                    "M" => "modified",
                    "D" => "removed",
                    "R" => "renamed",
                    _ => "modified",
                };
                Some(json!({"path": parts[1], "status": status}))
            } else {
                None
            }
        })
        .collect();

    Ok(json!({
        "diff": diff_text,
        "files": files,
        "empty": diff_text.trim().is_empty(),
    }))
}

/// Save review results from the frontend (review-core running in webview).
/// The frontend calls review-core + ai-gateway-client, then sends findings here for persistence.
#[tauri::command]
pub async fn save_review(
    db: State<'_, DbState>,
    repo_path: Option<String>,
    source_label: String,
    review_type: String,
    repo_full_name: Option<String>,
    pr_number: Option<i64>,
    score: f64,
    findings: Vec<ReviewFindingInput>,
    review_action: Option<String>,
    summary_markdown: Option<String>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Create review record
    let input = LocalReviewInput {
        review_type: Some(review_type),
        source_label: Some(source_label.clone()),
        repo_path: repo_path.clone(),
        repo_full_name,
        pr_number,
        agent_used: Some("review-core".to_string()),
        status: Some("completed".to_string()),
    };

    let review_id = queries::create_local_review(&conn, &input)
        .map_err(|e| e.to_string())?;

    // Insert findings
    for f in &findings {
        queries::insert_review_finding(
            &conn,
            &crate::db::queries::LocalReviewFindingInput {
                review_id: review_id.clone(),
                severity: f.severity.clone(),
                title: f.title.clone(),
                summary: f.summary.clone(),
                suggestion: f.suggestion.clone(),
                file_path: f.file_path.clone(),
                line: f.line,
                confidence: f.confidence,
                fingerprint: f.fingerprint.clone(),
            },
        )
        .map_err(|e| e.to_string())?;
    }

    // Update review with score and completion
    queries::update_local_review(
        &conn,
        &review_id,
        &crate::db::queries::LocalReviewUpdate {
            status: Some("completed".to_string()),
            score_composite: Some(score),
            findings_count: Some(findings.len() as i64),
            review_action,
            summary_markdown,
            error_message: None,
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    )
    .map_err(|e| e.to_string())?;

    // Log activity
    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: None,
            event_type: Some("review_completed".to_string()),
            summary: Some(format!(
                "Review completed for {}: score={:.0}, {} findings",
                source_label, score, findings.len()
            )),
            metadata: Some(json!({"review_id": review_id}).to_string()),
        },
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "review_id": review_id,
        "status": "completed",
        "score": score,
        "findings_count": findings.len(),
    }))
}

/// Get a single review with all its findings.
#[tauri::command]
pub async fn get_review(db: State<'_, DbState>, id: String) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (review, findings) =
        queries::get_local_review_with_findings(&conn, &id).map_err(|e| e.to_string())?;
    Ok(json!({
        "review": review,
        "findings": findings,
    }))
}

/// Run a code review via a CLI agent (claude or gemini).
///
/// 1. Gets the git diff for the given range
/// 2. Builds a review prompt and spawns the agent CLI
/// 3. Parses the JSON response, computes score, persists findings
/// 4. Returns review_id, score, findings, and summary
#[tauri::command]
pub async fn run_cli_review(
    db: State<'_, DbState>,
    repo_path: String,
    diff_range: String,
    project_description: String,
    change_description: String,
    agent: Option<String>,
) -> Result<Value, String> {
    let agent = agent.unwrap_or_else(|| "claude".to_string());
    let start_time = std::time::Instant::now();

    // 1. Get the diff
    let mut cmd = StdCommand::new("git");
    cmd.arg("diff").arg(&diff_range).current_dir(&repo_path);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git diff: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git diff failed: {stderr}"));
    }

    let raw_diff = String::from_utf8_lossy(&output.stdout).to_string();

    if raw_diff.trim().is_empty() {
        return Err("Empty diff — nothing to review".to_string());
    }

    const MAX_DIFF_BYTES: usize = 100 * 1024;
    let was_truncated = raw_diff.len() > MAX_DIFF_BYTES;
    let mut diff_text = raw_diff;
    if was_truncated {
        let mut end = MAX_DIFF_BYTES;
        while end > 0 && !diff_text.is_char_boundary(end) {
            end -= 1;
        }
        diff_text.truncate(end);
        diff_text.push_str("\n\n[DIFF TRUNCATED at 100KB — see file list above for the full change surface]");
    }

    let changed_files: Vec<String> = StdCommand::new("git")
        .args(["diff", "--name-only", &diff_range])
        .current_dir(&repo_path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let files_section = if changed_files.is_empty() {
        String::new()
    } else {
        let listed = changed_files
            .iter()
            .map(|f| format!("- {f}"))
            .collect::<Vec<_>>()
            .join("\n");
        let header = if was_truncated {
            format!(
                "\nFiles changed in this range ({} total — diff below was truncated to 100KB, use your file-read tools to inspect any not fully shown):\n{}\n",
                changed_files.len(),
                listed
            )
        } else {
            format!(
                "\nFiles changed in this range ({} total):\n{}\n",
                changed_files.len(),
                listed
            )
        };
        header
    };

    let blast_summary = crate::commands::blast_radius::compute_blast_radius(&repo_path, &diff_range)
        .ok()
        .as_ref()
        .and_then(crate::commands::blast_radius::summarize_for_prompt)
        .unwrap_or_default();

    let blast_section = if blast_summary.is_empty() {
        String::new()
    } else {
        format!("\n{blast_summary}\n")
    };

    let conventions_section = read_repo_conventions(&repo_path);

    let base_prompt = format!(
        r#"You are a senior code reviewer for an experienced engineer. Find *real* issues — security holes, correctness bugs, regression risk, broken contracts. Skip style nitpicks and speculative concerns.

Project: {project_description}
Change: {change_description}
{conventions_section}{files_section}{blast_section}
How to review:
1. Read the diff carefully. You have file-read tools — use them when a finding's validity depends on context the diff doesn't show (callers, tests, related files, imports, prior implementation).
2. Verify each potential issue against the actual code before reporting. If you cannot cite specific lines that prove the problem, drop the finding — or, if the signal is real but unverified, lower confidence honestly instead of hiding the uncertainty.
3. Use the blast-radius data above to weight severity: a behavior change to a symbol with 6+ callers should be at least medium severity unless the change is provably backward-compatible.
4. Skip nitpicks (formatting, naming preference, missing comments) unless they will cause real bugs or break a workflow.
5. Repo conventions above are authoritative. Drop findings that contradict them.

Output format:

Think through the review first (you may use tools and write reasoning notes). Then output **exactly one** ```json fenced block as the very LAST thing in your response, matching this shape. Do not emit any other ```json fenced blocks anywhere — examples in your reasoning should be unfenced or use a different language tag.

JSON shape (literal text, not a fenced example):
{{"findings":[{{"severity":"critical|high|medium|low","title":"...","summary":"... — include the specific lines that prove the problem","suggestion":"...","filePath":"...","line":42,"confidence":0.9}}],"score":75,"summary":"Overall assessment","talk":{{"files_read":["src/file.ts"],"files_modified":[],"actions_summary":"What you reviewed and found","unfinished_work":null,"key_decisions":"Important observations about the code","recommended_next_steps":"What should happen next"}}}}

Rules:
- severity must be one of: critical, high, medium, low
- confidence is 0.0-1.0 — be honest; downgrade rather than overclaim
- line is optional (null if unknown); filePath relative to repo root
- score is 0-100 (100 = perfect)
- Each finding's `summary` must reference the specific line(s) or symbol(s) that prove the problem
- The "talk" object captures context for the next review/fix run — populate `files_read` with anything you actually opened

Diff:
{diff_text}"#
    );

    // Inject previous talk context if available
    let prompt = {{
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let p = maybe_prepend_talk_context(&conn, &repo_path, &base_prompt);
        drop(conn);
        p
    }};

    // 4. Spawn the CLI agent
    let cli_cmd = match agent.as_str() {
        "gemini" => "gemini",
        _ => "claude",
    };
    let cli_path = resolve_cli_path(cli_cmd);

    let cli_output = StdCommand::new(&cli_path)
        .args(["-p", &prompt])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to spawn {cli_cmd} (resolved to {cli_path}): {e}"))?;

    if !cli_output.status.success() {
        let stderr = String::from_utf8_lossy(&cli_output.stderr);
        return Err(format!("{cli_cmd} failed: {stderr}"));
    }

    let raw_output = String::from_utf8_lossy(&cli_output.stdout).to_string();

    // 5. Extract JSON from the output (may be wrapped in markdown code blocks)
    let json_str = extract_json_from_output(&raw_output)
        .ok_or_else(|| format!("Could not find JSON in {cli_cmd} output"))?;

    let parsed: Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse JSON: {e}"))?;

    // 6. Extract findings
    let findings_val = parsed
        .get("findings")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let summary = parsed
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("Review completed")
        .to_string();

    // 7. Compute score from findings if AI didn't return one
    let score: f64 = parsed
        .get("score")
        .and_then(|v| v.as_f64())
        .unwrap_or_else(|| {
            let mut s: f64 = 100.0;
            for f in &findings_val {
                let sev = f
                    .get("severity")
                    .and_then(|v| v.as_str())
                    .unwrap_or("low");
                s += match sev {
                    "critical" => -20.0,
                    "high" => -10.0,
                    "medium" => -5.0,
                    "low" => -2.0,
                    _ => -1.0,
                };
            }
            s.max(0.0)
        });

    // 8. Persist the review
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let source_label = format!("cli:{agent}:{diff_range}");

    let input = LocalReviewInput {
        review_type: Some("cli".to_string()),
        source_label: Some(source_label.clone()),
        repo_path: Some(repo_path.clone()),
        repo_full_name: None,
        pr_number: None,
        agent_used: Some(agent.clone()),
        status: Some("completed".to_string()),
    };

    let review_id =
        queries::create_local_review(&conn, &input).map_err(|e| e.to_string())?;

    for f in &findings_val {
        let severity = f
            .get("severity")
            .and_then(|v| v.as_str())
            .unwrap_or("medium")
            .to_string();
        let title = f
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();
        let f_summary = f
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let suggestion = f
            .get("suggestion")
            .and_then(|v| v.as_str())
            .map(String::from);
        let file_path = f
            .get("filePath")
            .and_then(|v| v.as_str())
            .map(String::from);
        let line = f.get("line").and_then(|v| v.as_i64());
        let confidence = f.get("confidence").and_then(|v| v.as_f64());

        queries::insert_review_finding(
            &conn,
            &crate::db::queries::LocalReviewFindingInput {
                review_id: review_id.clone(),
                severity,
                title,
                summary: f_summary,
                suggestion,
                file_path,
                line,
                confidence,
                fingerprint: None,
            },
        )
        .map_err(|e| e.to_string())?;
    }

    // Update review with score and completion
    queries::update_local_review(
        &conn,
        &review_id,
        &crate::db::queries::LocalReviewUpdate {
            status: Some("completed".to_string()),
            score_composite: Some(score),
            findings_count: Some(findings_val.len() as i64),
            review_action: None,
            summary_markdown: Some(summary.clone()),
            error_message: None,
            completed_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    )
    .map_err(|e| e.to_string())?;

    // 9. Log activity
    queries::log_activity(
        &conn,
        &ActivityInput {
            agent_id: None,
            event_type: Some("cli_review_completed".to_string()),
            summary: Some(format!(
                "CLI review ({agent}) for {}: score={:.0}, {} findings",
                source_label,
                score,
                findings_val.len()
            )),
            metadata: Some(json!({"review_id": review_id}).to_string()),
        },
    )
    .map_err(|e| e.to_string())?;

    let duration_ms = start_time.elapsed().as_millis() as u64;

    // 10. Capture talk for handover
    let talk_input = talk::build_talk_from_review(
        &agent,
        &repo_path,
        &base_prompt,
        &raw_output,
        &parsed,
        Some(&review_id),
        Some(duration_ms as i64),
        None,
    );
    let talk_id = queries::insert_agent_talk(&conn, &talk_input)
        .map_err(|e| log::warn!("Failed to save talk: {e}"))
        .ok();

    // 11. Return result
    Ok(json!({
        "review_id": review_id,
        "score": score,
        "findings": findings_val,
        "summary": summary,
        "agent": agent,
        "duration_ms": duration_ms,
        "diff_range": diff_range,
        "findings_count": findings_val.len(),
        "talk_id": talk_id,
    }))
}

/// Create a git worktree for running fixes in isolation.
/// Returns `(worktree_path, branch_name)` on success, or `None` to fall back to the main repo.
fn create_fix_worktree(repo_path: &str) -> Option<(String, String)> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let branch_name = format!("codevetter/fix-{timestamp}");
    let worktree_dir = format!("{repo_path}/.codevetter-worktrees/{branch_name}");

    // Ensure the parent directory exists
    let parent = std::path::Path::new(&worktree_dir).parent()?;
    std::fs::create_dir_all(parent).ok()?;

    // Add .codevetter-worktrees to git's local exclude (not .gitignore)
    let exclude_path = format!("{repo_path}/.git/info/exclude");
    let exclude_entry = ".codevetter-worktrees";
    if let Ok(contents) = std::fs::read_to_string(&exclude_path) {
        if !contents.lines().any(|l| l.trim() == exclude_entry) {
            let mut new_contents = contents;
            if !new_contents.ends_with('\n') {
                new_contents.push('\n');
            }
            new_contents.push_str(exclude_entry);
            new_contents.push('\n');
            let _ = std::fs::write(&exclude_path, new_contents);
        }
    } else {
        // exclude file doesn't exist or can't be read — try to create it
        let _ = std::fs::create_dir_all(format!("{repo_path}/.git/info"));
        let _ = std::fs::write(&exclude_path, format!("{exclude_entry}\n"));
    }

    // Create branch from HEAD
    let branch_output = StdCommand::new("git")
        .args(["branch", &branch_name])
        .current_dir(repo_path)
        .output()
        .ok()?;
    if !branch_output.status.success() {
        return None;
    }

    // Create worktree
    let wt_output = StdCommand::new("git")
        .args(["worktree", "add", &worktree_dir, &branch_name])
        .current_dir(repo_path)
        .output()
        .ok()?;
    if !wt_output.status.success() {
        // Clean up the branch we created
        let _ = StdCommand::new("git")
            .args(["branch", "-D", &branch_name])
            .current_dir(repo_path)
            .output();
        return None;
    }

    Some((worktree_dir, branch_name))
}

/// Fix one or more review findings by sending them to a CLI agent.
/// Creates a git worktree so fixes happen in isolation (not in the user's working directory).
#[tauri::command]
pub async fn fix_findings(
    app: tauri::AppHandle,
    repo_path: String,
    findings: Vec<Value>,
    agent: Option<String>,
) -> Result<Value, String> {
    let agent = agent.unwrap_or_else(|| "claude".to_string());
    let start_time = std::time::Instant::now();

    // Try to create a worktree for isolated fixes; fall back to main repo on failure
    let worktree_info = create_fix_worktree(&repo_path);
    let (work_dir, _using_worktree) = match &worktree_info {
        Some((wt_path, _)) => (wt_path.clone(), true),
        None => (repo_path.clone(), false),
    };

    // Build fix prompt
    let mut issues = String::new();
    for (i, f) in findings.iter().enumerate() {
        let severity = f.get("severity").and_then(|v| v.as_str()).unwrap_or("medium");
        let title = f.get("title").and_then(|v| v.as_str()).unwrap_or("Issue");
        let summary = f.get("summary").and_then(|v| v.as_str()).unwrap_or("");
        let suggestion = f.get("suggestion").and_then(|v| v.as_str()).unwrap_or("");
        let file_path = f.get("filePath").and_then(|v| v.as_str()).unwrap_or("unknown");
        let line = f.get("line").and_then(|v| v.as_i64());

        issues.push_str(&format!("\n{}. [{severity}] {title}\n", i + 1));
        issues.push_str(&format!("   File: {file_path}"));
        if let Some(l) = line {
            issues.push_str(&format!(":{l}"));
        }
        issues.push_str(&format!("\n   Problem: {summary}\n"));
        if !suggestion.is_empty() {
            issues.push_str(&format!("   Fix: {suggestion}\n"));
        }
    }

    let base_fix_prompt = format!(
        "Fix the following code review issues by editing the files directly. Use your tools to read and write the actual source files. Do NOT just describe the changes — actually make the edits. Make the minimal changes needed. Do not refactor unrelated code.\n{issues}"
    );

    // Inject previous talk context if available
    let prompt = {
        let db_state = app.state::<DbState>();
        let result = if let Ok(conn) = db_state.0.lock() {
            maybe_prepend_talk_context(&conn, &repo_path, &base_fix_prompt)
        } else {
            base_fix_prompt.clone()
        };
        result
    };

    let cli_cmd = match agent.as_str() {
        "gemini" => "gemini",
        _ => "claude",
    };
    let cli_path = resolve_cli_path(cli_cmd);

    // Spawn in a blocking thread so we don't block the Tauri event loop
    let app_handle = app.clone();
    let work_dir_clone = work_dir.clone();
    let cli_path_clone = cli_path.clone();
    let (stdout, _success, duration_ms) = tokio::task::spawn_blocking(move || {
        let mut child = StdCommand::new(&cli_path_clone)
            .args(["-p", &prompt])
            .current_dir(&work_dir_clone)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn {cli_cmd} (resolved to {cli_path_clone}): {e}"))?;

        let mut stdout_text = String::new();
        if let Some(stdout_pipe) = child.stdout.take() {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout_pipe);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        let _ = app_handle.emit("fix-progress", &l);
                        stdout_text.push_str(&l);
                        stdout_text.push('\n');
                    }
                    Err(_) => break,
                }
            }
        }

        let status = child.wait().map_err(|e| format!("Process wait failed: {e}"))?;
        let elapsed = start_time.elapsed().as_millis() as u64;

        if !status.success() {
            let stderr_text = child.stderr.map(|mut s| {
                let mut buf = String::new();
                use std::io::Read;
                let _ = s.read_to_string(&mut buf);
                buf
            }).unwrap_or_default();
            return Err(format!("{cli_cmd} fix failed: {stderr_text}"));
        }

        Ok::<_, String>((stdout_text, true, elapsed))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    // Get the git diff to show what changed (compare against HEAD in worktree)
    let diff_output = StdCommand::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&work_dir)
        .output()
        .ok();

    let diff_text = diff_output
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Get list of changed files
    let changed_output = StdCommand::new("git")
        .args(["diff", "HEAD", "--name-status"])
        .current_dir(&work_dir)
        .output()
        .ok();

    let changed_files: Vec<Value> = changed_output
        .as_ref()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, '\t').collect();
            if parts.len() == 2 {
                Some(json!({"status": parts[0], "path": parts[1]}))
            } else {
                None
            }
        })
        .collect();

    // Truncate agent output for display (max 5KB)
    let agent_output = if stdout.len() > 5000 {
        format!("{}...\n[truncated]", &stdout[..5000])
    } else {
        stdout
    };

    let mut result = json!({
        "success": true,
        "agent": agent,
        "duration_ms": duration_ms,
        "output_length": agent_output.len(),
        "findings_fixed": findings.len(),
        "diff": diff_text,
        "changed_files": changed_files,
        "agent_output": agent_output,
    });

    // Add worktree info if we used one
    if let Some((wt_path, branch)) = &worktree_info {
        result["worktree_path"] = json!(wt_path);
        result["worktree_branch"] = json!(branch);
        result["using_worktree"] = json!(true);
    } else {
        result["using_worktree"] = json!(false);
    }

    // Capture talk for handover
    let modified_paths: Vec<String> = changed_files
        .iter()
        .filter_map(|f| f.get("path").and_then(|p| p.as_str()).map(String::from))
        .collect();
    let talk_input = talk::build_talk_from_fix(
        &agent,
        &repo_path,
        &base_fix_prompt,
        &agent_output,
        &modified_paths,
        None,
        Some(duration_ms as i64),
        Some(0),
        None,
    );
    if let Ok(db_conn) = app.state::<DbState>().0.lock() {
        if let Ok(tid) = queries::insert_agent_talk(&db_conn, &talk_input) {
            result["talk_id"] = json!(tid);
        }
    }

    Ok(result)
}

/// Merge fixes from a worktree branch back into the main repo.
/// Commits changes in the worktree, merges the branch, then cleans up.
#[tauri::command]
pub async fn merge_fix(
    repo_path: String,
    worktree_branch: String,
    worktree_path: String,
) -> Result<Value, String> {
    // 1. Commit all changes in the worktree
    let add_output = StdCommand::new("git")
        .args(["add", "-A"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to stage changes: {e}"))?;
    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(format!("git add failed: {stderr}"));
    }

    let commit_output = StdCommand::new("git")
        .args(["commit", "-m", "fix: resolve code review findings"])
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to commit: {e}"))?;
    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        // If there's nothing to commit, that's okay — the agent may not have changed anything
        if !stderr.contains("nothing to commit") {
            return Err(format!("git commit failed: {stderr}"));
        }
    }

    // 2. Merge the branch into the main repo
    let merge_output = StdCommand::new("git")
        .args(["merge", &worktree_branch, "--no-ff", "-m", "fix: merge code review fixes"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to merge: {e}"))?;
    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        return Err(format!("git merge failed: {stderr}"));
    }

    // 3. Remove the worktree
    let _ = StdCommand::new("git")
        .args(["worktree", "remove", &worktree_path, "--force"])
        .current_dir(&repo_path)
        .output();

    // 4. Delete the branch
    let _ = StdCommand::new("git")
        .args(["branch", "-D", &worktree_branch])
        .current_dir(&repo_path)
        .output();

    Ok(json!({
        "success": true,
        "merged": true,
    }))
}

/// Discard fixes by removing the worktree and deleting the branch.
#[tauri::command]
pub async fn discard_fix(
    repo_path: String,
    worktree_branch: String,
    worktree_path: String,
) -> Result<Value, String> {
    // 1. Remove the worktree
    let wt_output = StdCommand::new("git")
        .args(["worktree", "remove", &worktree_path, "--force"])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {e}"))?;
    if !wt_output.status.success() {
        let stderr = String::from_utf8_lossy(&wt_output.stderr);
        return Err(format!("git worktree remove failed: {stderr}"));
    }

    // 2. Delete the branch
    let branch_output = StdCommand::new("git")
        .args(["branch", "-D", &worktree_branch])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to delete branch: {e}"))?;
    if !branch_output.status.success() {
        let stderr = String::from_utf8_lossy(&branch_output.stderr);
        return Err(format!("git branch -D failed: {stderr}"));
    }

    Ok(json!({
        "success": true,
        "discarded": true,
    }))
}

/// Revert specific files to their git HEAD state.
#[tauri::command]
pub async fn revert_files(
    repo_path: String,
    files: Vec<String>,
) -> Result<Value, String> {
    let mut reverted = Vec::new();
    let mut failed = Vec::new();

    for file in &files {
        let output = StdCommand::new("git")
            .args(["checkout", "HEAD", "--", file])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to run git checkout: {e}"))?;

        if output.status.success() {
            reverted.push(file.clone());
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            failed.push(json!({"file": file, "error": stderr}));
        }
    }

    Ok(json!({
        "reverted": reverted,
        "failed": failed,
    }))
}

/// Public re-export for `unpack.rs` (and any future module) — same logic, no
/// duplication.
pub fn extract_json_from_output_pub(output: &str) -> Option<String> {
    extract_json_from_output(output)
}

/// Public re-export of `resolve_cli_path` for sibling command modules.
pub fn resolve_cli_path_pub(name: &str) -> String {
    resolve_cli_path(name)
}

fn extract_json_from_output(output: &str) -> Option<String> {
    let mut last_fenced: Option<String> = None;
    let mut cursor = 0;
    while let Some(rel) = output[cursor..].find("```json") {
        let start = cursor + rel + 7;
        if let Some(end_rel) = output[start..].find("```") {
            let candidate = output[start..start + end_rel].trim();
            if serde_json::from_str::<Value>(candidate).is_ok() {
                last_fenced = Some(candidate.to_string());
            }
            cursor = start + end_rel + 3;
        } else {
            break;
        }
    }
    if let Some(found) = last_fenced {
        return Some(found);
    }

    let mut last_bare: Option<String> = None;
    let mut cursor = 0;
    while let Some(rel) = output[cursor..].find("```\n") {
        let start = cursor + rel + 4;
        if let Some(end_rel) = output[start..].find("```") {
            let candidate = output[start..start + end_rel].trim();
            if serde_json::from_str::<Value>(candidate).is_ok() {
                last_bare = Some(candidate.to_string());
            }
            cursor = start + end_rel + 3;
        } else {
            break;
        }
    }
    if let Some(found) = last_bare {
        return Some(found);
    }

    let mut depth = 0i32;
    let mut json_start: Option<usize> = None;
    let mut last_raw: Option<String> = None;
    for (i, ch) in output.char_indices() {
        match ch {
            '{' => {
                if depth == 0 {
                    json_start = Some(i);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(start) = json_start {
                        let candidate = &output[start..=i];
                        if serde_json::from_str::<Value>(candidate).is_ok() {
                            last_raw = Some(candidate.to_string());
                        }
                    }
                    json_start = None;
                }
            }
            _ => {}
        }
    }
    last_raw
}

/// List reviews with pagination and optional repo filter.
#[tauri::command]
pub async fn list_reviews(
    db: State<'_, DbState>,
    limit: Option<i64>,
    offset: Option<i64>,
    repo_path: Option<String>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let reviews = queries::list_local_reviews_filtered(
        &conn,
        limit.unwrap_or(50),
        offset.unwrap_or(0),
        repo_path.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "reviews": reviews }))
}
