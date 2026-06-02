//! Repo Unpacked — whole-repository system briefs.
//!
//! Two-pass pipeline:
//!   1. Deterministic scanner builds a repo inventory (entrypoints, manifests,
//!      stack, language counts, top dirs, README/docs).
//!   2. Synthesis prompt is sent to the configured CLI agent (claude/gemini).
//!      Returns five sections — system_map, feature_catalog, behavior_traces,
//!      risk_map, agent_handoff — every claim is required to cite at least
//!      one source file path that exists in the inventory.
//!
//! Result rows live in `repo_unpacked_reports`. Inventory is stored alongside
//! the synthesised brief so the UI can re-render without re-paying LLM cost.

use crate::db::queries;
use crate::DbState;
use serde::{Deserialize, Serialize};
#[allow(unused_imports)]
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use tauri::State;

const ALWAYS_SKIP: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "__pycache__",
    ".next",
    ".turbo",
    ".vercel",
    ".cache",
    "dist",
    "build",
    "out",
    "coverage",
    ".pnpm-store",
    "vendor",
    ".venv",
    "venv",
    ".gradle",
    ".idea",
    ".vscode",
    ".DS_Store",
];

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "icns", "bmp", "tiff",
    "mp4", "mov", "webm", "mp3", "wav", "ogg", "flac",
    "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
    "pdf", "psd", "ai", "sketch", "fig",
    "exe", "dll", "so", "dylib", "bin", "wasm", "o", "a", "lib",
    "ttf", "otf", "woff", "woff2", "eot",
    "lock", "min.js", "min.css",
];

const MAX_FILES: usize = 4000;
const MAX_FILE_BYTES: u64 = 1_000_000; // 1 MB — skip generated/blob-ish files
const README_PREVIEW_BYTES: usize = 8 * 1024;

// ─── Public types (mirrored on the TS side) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LanguageCount {
    pub language: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ManifestSummary {
    pub path: String,
    pub kind: String, // package.json | cargo.toml | pyproject.toml | go.mod | gemfile | composer.json | tauri.conf.json | other
    pub name: Option<String>,
    pub version: Option<String>,
    pub dependencies: Vec<String>,
    pub scripts: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EntrypointHint {
    pub path: String,
    pub kind: String, // bin | server | desktop | web | script | config | docs
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocFile {
    pub path: String,
    pub bytes: u64,
    pub preview: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirSummary {
    pub path: String,
    pub file_count: usize,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoInventory {
    pub repo_path: String,
    pub repo_name: String,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub files_scanned: usize,
    pub files_skipped: usize,
    pub bytes_scanned: u64,
    pub max_files_hit: bool,
    pub languages: Vec<LanguageCount>,
    pub manifests: Vec<ManifestSummary>,
    pub entrypoints: Vec<EntrypointHint>,
    pub top_level_dirs: Vec<DirSummary>,
    pub docs: Vec<DocFile>,
    pub config_files: Vec<String>,
    pub stack_tags: Vec<String>,
    pub all_files: Vec<String>,
    pub ignored_dirs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportClaim {
    pub claim: String,
    pub sources: Vec<String>, // file paths (optionally with #Lstart-end)
    pub kind: Option<String>, // "evidence" | "inference"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportSection {
    pub title: String,
    pub summary: String,
    pub claims: Vec<ReportClaim>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct UnpackReport {
    pub system_map: Option<ReportSection>,
    pub feature_catalog: Option<ReportSection>,
    pub data_flow: Option<ReportSection>,
    pub behavior_traces: Option<ReportSection>,
    pub testing_signals: Option<ReportSection>,
    pub risk_map: Option<ReportSection>,
    pub extension_points: Option<ReportSection>,
    pub agent_handoff: Option<ReportSection>,
    pub agent_prompt: Option<String>,
    pub overview: Option<String>,
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_repo_inventory(repo_path: String) -> Result<Value, String> {
    let inv = build_inventory(&repo_path)?;
    Ok(serde_json::to_value(&inv).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn generate_unpack_report(
    db: State<'_, DbState>,
    repo_path: String,
    agent: Option<String>,
) -> Result<Value, String> {
    let agent = agent.unwrap_or_else(|| "claude".to_string());
    let started = std::time::Instant::now();

    let inventory = build_inventory(&repo_path)?;
    let inventory_json = serde_json::to_string(&inventory).map_err(|e| e.to_string())?;

    let report_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO repo_unpacked_reports
             (id, repo_path, repo_name, commit_sha, status, agent_used,
              inventory_json, files_scanned, files_skipped, bytes_scanned,
              started_at, created_at)
             VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            rusqlite::params![
                report_id,
                inventory.repo_path,
                inventory.repo_name,
                inventory.commit_sha,
                agent,
                inventory_json,
                inventory.files_scanned as i64,
                inventory.files_skipped as i64,
                inventory.bytes_scanned as i64,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let prompt = build_synthesis_prompt(&inventory);

    let cli_cmd = match agent.as_str() {
        "gemini" => "gemini",
        _ => "claude",
    };
    let cli_path = crate::commands::review::resolve_cli_path_pub(cli_cmd);

    let cli_output = StdCommand::new(&cli_path)
        .args(["-p", &prompt])
        .current_dir(&repo_path)
        .output();

    let cli_output = match cli_output {
        Ok(o) => o,
        Err(e) => {
            mark_failed(
                &db,
                &report_id,
                &format!("Failed to spawn {cli_cmd} ({cli_path}): {e}"),
                started.elapsed().as_millis() as i64,
            );
            return Err(format!("Failed to spawn {cli_cmd}: {e}"));
        }
    };

    if !cli_output.status.success() {
        let stderr = String::from_utf8_lossy(&cli_output.stderr).to_string();
        mark_failed(
            &db,
            &report_id,
            &format!("{cli_cmd} failed: {stderr}"),
            started.elapsed().as_millis() as i64,
        );
        return Err(format!("{cli_cmd} failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&cli_output.stdout).to_string();
    let json_str = match crate::commands::review::extract_json_from_output_pub(&raw) {
        Some(s) => s,
        None => {
            mark_failed(
                &db,
                &report_id,
                "Could not find JSON in agent output",
                started.elapsed().as_millis() as i64,
            );
            return Err("Could not find JSON in agent output".to_string());
        }
    };

    let parsed: Value = match serde_json::from_str(&json_str) {
        Ok(v) => v,
        Err(e) => {
            mark_failed(
                &db,
                &report_id,
                &format!("Failed to parse JSON: {e}"),
                started.elapsed().as_millis() as i64,
            );
            return Err(format!("Failed to parse JSON: {e}"));
        }
    };

    let report = normalize_report(&parsed, &inventory);
    let report_json = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    let runtime_ms = started.elapsed().as_millis() as i64;
    let model = parsed
        .get("model")
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| Some(format!("cli:{cli_cmd}")));

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE repo_unpacked_reports
             SET status = 'completed', report_json = ?1, runtime_ms = ?2,
                 model_used = ?3, completed_at = ?4
             WHERE id = ?5",
            rusqlite::params![
                report_json,
                runtime_ms,
                model,
                chrono::Utc::now().to_rfc3339(),
                report_id,
            ],
        )
        .map_err(|e| e.to_string())?;

        queries::log_activity(
            &conn,
            &queries::ActivityInput {
                agent_id: None,
                event_type: Some("repo_unpacked_completed".to_string()),
                summary: Some(format!(
                    "Repo Unpacked brief generated for {}: {} files",
                    inventory.repo_name, inventory.files_scanned
                )),
                metadata: Some(json!({"report_id": report_id}).to_string()),
            },
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(json!({
        "report_id": report_id,
        "status": "completed",
        "runtime_ms": runtime_ms,
        "report": report,
        "inventory": inventory,
    }))
}

#[tauri::command]
pub async fn list_repo_unpack_reports(
    db: State<'_, DbState>,
    repo_path: Option<String>,
    limit: Option<i64>,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(50);

    let rows: Vec<Value> = if let Some(path) = repo_path {
        let mut stmt = conn
            .prepare(
                "SELECT id, repo_path, repo_name, commit_sha, status, error_message,
                        agent_used, model_used, files_scanned, files_skipped, runtime_ms,
                        cost_usd, started_at, completed_at, created_at
                 FROM repo_unpacked_reports
                 WHERE repo_path = ?1
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map(rusqlite::params![path, limit], row_to_summary)
            .map_err(|e| e.to_string())?;
        iter.filter_map(Result::ok).collect()
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, repo_path, repo_name, commit_sha, status, error_message,
                        agent_used, model_used, files_scanned, files_skipped, runtime_ms,
                        cost_usd, started_at, completed_at, created_at
                 FROM repo_unpacked_reports
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let iter = stmt
            .query_map(rusqlite::params![limit], row_to_summary)
            .map_err(|e| e.to_string())?;
        iter.filter_map(Result::ok).collect()
    };

    Ok(json!({ "reports": rows }))
}

#[tauri::command]
pub async fn get_repo_unpack_report(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let row = conn
        .query_row(
            "SELECT id, repo_path, repo_name, commit_sha, status, error_message,
                    agent_used, model_used, inventory_json, report_json,
                    files_scanned, files_skipped, bytes_scanned, runtime_ms,
                    cost_usd, started_at, completed_at, created_at
             FROM repo_unpacked_reports
             WHERE id = ?1",
            rusqlite::params![id],
            |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "repo_path": r.get::<_, String>(1)?,
                    "repo_name": r.get::<_, String>(2)?,
                    "commit_sha": r.get::<_, Option<String>>(3)?,
                    "status": r.get::<_, String>(4)?,
                    "error_message": r.get::<_, Option<String>>(5)?,
                    "agent_used": r.get::<_, Option<String>>(6)?,
                    "model_used": r.get::<_, Option<String>>(7)?,
                    "inventory_json": r.get::<_, Option<String>>(8)?,
                    "report_json": r.get::<_, Option<String>>(9)?,
                    "files_scanned": r.get::<_, i64>(10)?,
                    "files_skipped": r.get::<_, i64>(11)?,
                    "bytes_scanned": r.get::<_, i64>(12)?,
                    "runtime_ms": r.get::<_, Option<i64>>(13)?,
                    "cost_usd": r.get::<_, Option<f64>>(14)?,
                    "started_at": r.get::<_, Option<String>>(15)?,
                    "completed_at": r.get::<_, Option<String>>(16)?,
                    "created_at": r.get::<_, String>(17)?,
                }))
            },
        )
        .map_err(|e| format!("Report not found: {e}"))?;

    Ok(row)
}

#[tauri::command]
pub async fn delete_repo_unpack_report(
    db: State<'_, DbState>,
    id: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let n = conn
        .execute(
            "DELETE FROM repo_unpacked_reports WHERE id = ?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    Ok(json!({ "deleted": n > 0 }))
}

#[tauri::command]
pub async fn export_repo_unpack_report(
    db: State<'_, DbState>,
    id: String,
    format: String,
) -> Result<Value, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (repo_name, report_json, inventory_json, created_at, agent_used, model_used) = conn
        .query_row(
            "SELECT repo_name, report_json, inventory_json, created_at,
                    agent_used, model_used
             FROM repo_unpacked_reports WHERE id = ?1",
            rusqlite::params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .map_err(|e| format!("Report not found: {e}"))?;

    let report: UnpackReport = report_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let inventory: Option<RepoInventory> = inventory_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());

    let body = render_markdown(&repo_name, &created_at, agent_used.as_deref(), model_used.as_deref(), &report, inventory.as_ref());

    let content = match format.as_str() {
        "html" => render_html(&repo_name, &body),
        _ => body,
    };

    Ok(json!({ "content": content, "format": format }))
}

// ─── Inventory builder (deterministic) ──────────────────────────────────────

pub fn build_inventory(repo_path: &str) -> Result<RepoInventory, String> {
    let root = PathBuf::from(repo_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {repo_path}"));
    }

    let repo_name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());

    let (commit_sha, branch, remote_url) = read_git_metadata(&root);

    let ignore_patterns = parse_gitignore(&root);

    let mut all_files: Vec<(String, u64)> = Vec::new();
    let mut files_skipped: usize = 0;
    let mut bytes_scanned: u64 = 0;
    let mut max_files_hit = false;
    let mut ignored_dirs: Vec<String> = Vec::new();

    walk(
        &root,
        &root,
        0,
        12,
        &ignore_patterns,
        &mut all_files,
        &mut files_skipped,
        &mut bytes_scanned,
        &mut max_files_hit,
        &mut ignored_dirs,
    );

    // Languages
    let mut lang_map: HashMap<&'static str, (usize, u64)> = HashMap::new();
    for (path, size) in &all_files {
        if let Some(lang) = language_for_path(path) {
            let entry = lang_map.entry(lang).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += size;
        }
    }
    let mut languages: Vec<LanguageCount> = lang_map
        .into_iter()
        .map(|(language, (files, bytes))| LanguageCount {
            language: language.to_string(),
            files,
            bytes,
        })
        .collect();
    languages.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    // Manifests
    let mut manifests: Vec<ManifestSummary> = Vec::new();
    for (path, _) in &all_files {
        if let Some(m) = parse_manifest(&root, path) {
            manifests.push(m);
        }
    }

    // Docs (README + docs/ + agents.md + AGENTS.md + CLAUDE.md + ARCHITECTURE.md)
    let mut docs: Vec<DocFile> = Vec::new();
    for (path, size) in &all_files {
        let lower = path.to_lowercase();
        let is_doc = lower == "readme.md"
            || lower == "readme"
            || lower == "agents.md"
            || lower == "claude.md"
            || lower == "architecture.md"
            || lower == "contributing.md"
            || lower == "license"
            || lower == "license.md"
            || lower.starts_with("docs/")
            || lower.starts_with("documentation/");
        if is_doc && lower.ends_with(".md") || lower == "readme" {
            let abs = root.join(path);
            let preview = read_first_bytes(&abs, README_PREVIEW_BYTES);
            docs.push(DocFile {
                path: path.clone(),
                bytes: *size,
                preview,
            });
        }
    }
    docs.sort_by(|a, b| a.path.cmp(&b.path));
    docs.truncate(40);

    // Top-level dirs
    let mut top_dir_map: HashMap<String, (usize, u64)> = HashMap::new();
    for (path, size) in &all_files {
        if let Some(top) = path.split('/').next() {
            if path.contains('/') {
                let entry = top_dir_map.entry(top.to_string()).or_insert((0, 0));
                entry.0 += 1;
                entry.1 += size;
            }
        }
    }
    let mut top_level_dirs: Vec<DirSummary> = top_dir_map
        .into_iter()
        .map(|(path, (file_count, bytes))| DirSummary {
            path,
            file_count,
            bytes,
        })
        .collect();
    top_level_dirs.sort_by(|a, b| b.file_count.cmp(&a.file_count));

    // Config files (interesting top-level)
    let config_files: Vec<String> = all_files
        .iter()
        .filter_map(|(p, _)| {
            let basename = Path::new(p)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let lower = basename.to_lowercase();
            let interesting = matches!(
                lower.as_str(),
                "tsconfig.json"
                    | "vite.config.ts"
                    | "vite.config.js"
                    | "next.config.js"
                    | "next.config.mjs"
                    | "tailwind.config.js"
                    | "tailwind.config.ts"
                    | "playwright.config.ts"
                    | "vitest.config.ts"
                    | "jest.config.js"
                    | "eslint.config.js"
                    | ".eslintrc.json"
                    | ".prettierrc"
                    | "dockerfile"
                    | "docker-compose.yml"
                    | "docker-compose.yaml"
                    | ".env.example"
                    | "wrangler.toml"
                    | "wrangler.jsonc"
                    | "fly.toml"
                    | "vercel.json"
                    | "netlify.toml"
                    | "tauri.conf.json"
                    | "renovate.json"
                    | "turbo.json"
                    | "pnpm-workspace.yaml"
                    | "lerna.json"
                    | ".github/workflows"
            );
            if interesting && !p.contains('/') {
                Some(p.clone())
            } else {
                None
            }
        })
        .collect();

    // Stack tags
    let stack_tags = infer_stack(&all_files, &manifests);

    // Entrypoints
    let entrypoints = infer_entrypoints(&all_files, &manifests, &stack_tags);

    let path_strings: Vec<String> = all_files.iter().map(|(p, _)| p.clone()).collect();

    let inventory = RepoInventory {
        repo_path: repo_path.to_string(),
        repo_name,
        commit_sha,
        branch,
        remote_url,
        files_scanned: all_files.len(),
        files_skipped,
        bytes_scanned,
        max_files_hit,
        languages,
        manifests,
        entrypoints,
        top_level_dirs,
        docs,
        config_files,
        stack_tags,
        all_files: path_strings,
        ignored_dirs,
    };

    Ok(inventory)
}

fn read_git_metadata(root: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let sha = StdCommand::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let branch = StdCommand::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let remote = StdCommand::new("git")
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    (sha, branch, remote)
}

#[allow(clippy::too_many_arguments)]
fn walk(
    root: &Path,
    dir: &Path,
    depth: u32,
    max_depth: u32,
    ignore_patterns: &[GlobPattern],
    out: &mut Vec<(String, u64)>,
    skipped: &mut usize,
    bytes_scanned: &mut u64,
    max_files_hit: &mut bool,
    ignored_dirs: &mut Vec<String>,
) {
    if depth > max_depth || *max_files_hit {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if *max_files_hit {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if ALWAYS_SKIP.contains(&name.as_str()) {
            if path.is_dir() {
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                if !ignored_dirs.contains(&rel) {
                    ignored_dirs.push(rel);
                }
            }
            continue;
        }

        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if is_ignored(&rel, path.is_dir(), ignore_patterns) {
            if path.is_dir() && !ignored_dirs.contains(&rel) {
                ignored_dirs.push(rel.clone());
            } else {
                *skipped += 1;
            }
            continue;
        }

        if path.is_dir() {
            walk(
                root,
                &path,
                depth + 1,
                max_depth,
                ignore_patterns,
                out,
                skipped,
                bytes_scanned,
                max_files_hit,
                ignored_dirs,
            );
        } else if path.is_file() {
            // Skip binary/heavy files
            if is_binary_path(&rel) {
                *skipped += 1;
                continue;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size > MAX_FILE_BYTES {
                *skipped += 1;
                continue;
            }
            *bytes_scanned += size;
            out.push((rel, size));
            if out.len() >= MAX_FILES {
                *max_files_hit = true;
                return;
            }
        }
    }
}

fn is_binary_path(rel: &str) -> bool {
    let lower = rel.to_lowercase();
    if lower.ends_with(".lock")
        || lower.ends_with("-lock.json")
        || lower.ends_with("pnpm-lock.yaml")
        || lower.ends_with("yarn.lock")
        || lower.ends_with("cargo.lock")
        || lower.ends_with("poetry.lock")
        || lower.ends_with(".min.js")
        || lower.ends_with(".min.css")
    {
        return true;
    }
    let ext = Path::new(&lower)
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    BINARY_EXTS.contains(&ext.as_str())
}

fn language_for_path(path: &str) -> Option<&'static str> {
    let ext = Path::new(path)
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    Some(match ext.as_str() {
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "rs" => "Rust",
        "py" => "Python",
        "go" => "Go",
        "rb" => "Ruby",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "c" | "h" => "C",
        "cpp" | "cc" | "hpp" | "cxx" => "C++",
        "cs" => "C#",
        "php" => "PHP",
        "ex" | "exs" => "Elixir",
        "erl" => "Erlang",
        "scala" => "Scala",
        "lua" => "Lua",
        "vue" => "Vue",
        "svelte" => "Svelte",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "scss" | "sass" => "Sass",
        "sql" => "SQL",
        "sh" | "bash" | "zsh" => "Shell",
        "md" | "mdx" => "Markdown",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "toml" => "TOML",
        _ => return None,
    })
}

fn read_first_bytes(path: &Path, limit: usize) -> String {
    use std::io::Read;
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let mut buf = vec![0u8; limit];
    let n = file.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    String::from_utf8_lossy(&buf).to_string()
}

fn parse_manifest(root: &Path, rel: &str) -> Option<ManifestSummary> {
    let basename = Path::new(rel)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
        .to_lowercase();

    // Only top-level + apps/*/ + packages/*/ to avoid noise
    let depth = rel.matches('/').count();
    if depth > 3 {
        return None;
    }

    let abs = root.join(rel);
    match basename.as_str() {
        "package.json" => parse_package_json(&abs, rel),
        "cargo.toml" => parse_cargo_toml(&abs, rel),
        "pyproject.toml" => parse_pyproject(&abs, rel),
        "go.mod" => parse_go_mod(&abs, rel),
        "gemfile" => Some(ManifestSummary {
            path: rel.to_string(),
            kind: "gemfile".to_string(),
            name: None,
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        }),
        "composer.json" => Some(ManifestSummary {
            path: rel.to_string(),
            kind: "composer.json".to_string(),
            name: None,
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        }),
        "tauri.conf.json" => Some(ManifestSummary {
            path: rel.to_string(),
            kind: "tauri.conf.json".to_string(),
            name: None,
            version: None,
            dependencies: Vec::new(),
            scripts: Vec::new(),
        }),
        _ => None,
    }
}

fn parse_package_json(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let name = v.get("name").and_then(|x| x.as_str()).map(String::from);
    let version = v.get("version").and_then(|x| x.as_str()).map(String::from);

    let mut deps: Vec<String> = Vec::new();
    for key in &["dependencies", "devDependencies", "peerDependencies"] {
        if let Some(map) = v.get(*key).and_then(|x| x.as_object()) {
            for k in map.keys() {
                deps.push(k.to_string());
            }
        }
    }
    deps.sort();
    deps.dedup();
    deps.truncate(80);

    let scripts: Vec<String> = v
        .get("scripts")
        .and_then(|x| x.as_object())
        .map(|m| m.keys().take(40).cloned().collect())
        .unwrap_or_default();

    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "package.json".to_string(),
        name,
        version,
        dependencies: deps,
        scripts,
    })
}

fn parse_cargo_toml(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let mut name: Option<String> = None;
    let mut version: Option<String> = None;
    let mut deps: Vec<String> = Vec::new();
    let mut in_deps = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_deps = trimmed == "[dependencies]"
                || trimmed == "[dev-dependencies]"
                || trimmed == "[build-dependencies]"
                || trimmed.starts_with("[target.");
            if !in_deps {
                continue;
            }
            continue;
        }
        if !in_deps {
            if let Some(rest) = trimmed.strip_prefix("name") {
                if let Some(v) = parse_toml_string_value(rest) {
                    name = Some(v);
                }
            }
            if let Some(rest) = trimmed.strip_prefix("version") {
                if let Some(v) = parse_toml_string_value(rest) {
                    version = Some(v);
                }
            }
        } else {
            if let Some(eq_idx) = trimmed.find('=') {
                let dep = trimmed[..eq_idx].trim().trim_matches('"').to_string();
                if !dep.is_empty() && !dep.starts_with('#') {
                    deps.push(dep);
                }
            }
        }
    }
    deps.sort();
    deps.dedup();
    deps.truncate(80);
    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "cargo.toml".to_string(),
        name,
        version,
        dependencies: deps,
        scripts: Vec::new(),
    })
}

fn parse_toml_string_value(rest: &str) -> Option<String> {
    let after_eq = rest.split_once('=')?.1.trim();
    let unquoted = after_eq.trim_matches('"').trim_matches('\'');
    if unquoted.is_empty() {
        None
    } else {
        Some(unquoted.to_string())
    }
}

fn parse_pyproject(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let mut name = None;
    let mut version = None;
    let mut deps: Vec<String> = Vec::new();
    let mut in_deps = false;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_deps = trimmed.contains("dependencies");
            continue;
        }
        if !in_deps {
            if let Some(rest) = trimmed.strip_prefix("name") {
                if let Some(v) = parse_toml_string_value(rest) {
                    name = Some(v);
                }
            }
            if let Some(rest) = trimmed.strip_prefix("version") {
                if let Some(v) = parse_toml_string_value(rest) {
                    version = Some(v);
                }
            }
        } else if let Some(dep) = trimmed.split_whitespace().next() {
            let cleaned = dep.trim_matches('"').trim_matches(',').to_string();
            if !cleaned.is_empty() {
                deps.push(cleaned);
            }
        }
    }
    deps.truncate(80);
    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "pyproject.toml".to_string(),
        name,
        version,
        dependencies: deps,
        scripts: Vec::new(),
    })
}

fn parse_go_mod(abs: &Path, rel: &str) -> Option<ManifestSummary> {
    let raw = fs::read_to_string(abs).ok()?;
    let mut name = None;
    let mut deps: Vec<String> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("module ") {
            name = Some(rest.trim().to_string());
        }
        if trimmed.starts_with("require ") || trimmed.starts_with('\t') {
            if let Some(dep) = trimmed.split_whitespace().nth(0) {
                if dep != "require" && !dep.starts_with("//") {
                    deps.push(dep.to_string());
                }
            }
        }
    }
    deps.sort();
    deps.dedup();
    deps.truncate(80);
    Some(ManifestSummary {
        path: rel.to_string(),
        kind: "go.mod".to_string(),
        name,
        version: None,
        dependencies: deps,
        scripts: Vec::new(),
    })
}

fn infer_stack(files: &[(String, u64)], manifests: &[ManifestSummary]) -> Vec<String> {
    let mut tags: Vec<&'static str> = Vec::new();
    let names: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();

    let has = |needle: &str| names.iter().any(|p| p == &needle);
    let has_in = |needle: &str| names.iter().any(|p| p.contains(needle));

    if has("tauri.conf.json") || has_in("src-tauri/") {
        tags.push("Tauri");
    }
    if manifests.iter().any(|m| m.dependencies.contains(&"react".to_string())) {
        tags.push("React");
    }
    if manifests.iter().any(|m| m.dependencies.contains(&"vue".to_string())) {
        tags.push("Vue");
    }
    if manifests.iter().any(|m| m.dependencies.contains(&"svelte".to_string())) {
        tags.push("Svelte");
    }
    if manifests.iter().any(|m| m.dependencies.contains(&"next".to_string())) {
        tags.push("Next.js");
    }
    if manifests.iter().any(|m| m.dependencies.contains(&"vite".to_string()))
        || has("vite.config.ts")
        || has("vite.config.js")
    {
        tags.push("Vite");
    }
    if manifests.iter().any(|m| m.dependencies.contains(&"tailwindcss".to_string()))
        || has("tailwind.config.ts")
        || has("tailwind.config.js")
    {
        tags.push("Tailwind");
    }
    if manifests.iter().any(|m| m.dependencies.iter().any(|d| d == "drizzle-orm")) {
        tags.push("Drizzle");
    }
    if manifests.iter().any(|m| m.dependencies.iter().any(|d| d == "@cloudflare/workers-types"))
        || has("wrangler.toml")
        || has("wrangler.jsonc")
    {
        tags.push("Cloudflare Workers");
    }
    if manifests.iter().any(|m| m.kind == "cargo.toml") {
        tags.push("Rust");
    }
    if manifests.iter().any(|m| m.kind == "go.mod") {
        tags.push("Go");
    }
    if manifests.iter().any(|m| m.kind == "pyproject.toml") {
        tags.push("Python");
    }
    if manifests.iter().any(|m| m.dependencies.iter().any(|d| d == "@playwright/test")) {
        tags.push("Playwright");
    }
    if manifests.iter().any(|m| m.dependencies.iter().any(|d| d == "vitest")) {
        tags.push("Vitest");
    }
    if has(".github/workflows") || has_in(".github/workflows/") {
        tags.push("GitHub Actions");
    }
    if has("Dockerfile") || has("docker-compose.yml") || has("docker-compose.yaml") {
        tags.push("Docker");
    }
    if has("vercel.json") {
        tags.push("Vercel");
    }
    if has("netlify.toml") {
        tags.push("Netlify");
    }
    if has("fly.toml") {
        tags.push("Fly.io");
    }

    tags.sort();
    tags.dedup();
    tags.into_iter().map(String::from).collect()
}

fn infer_entrypoints(
    files: &[(String, u64)],
    manifests: &[ManifestSummary],
    stack_tags: &[String],
) -> Vec<EntrypointHint> {
    let mut hits: Vec<EntrypointHint> = Vec::new();
    let names: Vec<&str> = files.iter().map(|(p, _)| p.as_str()).collect();
    let push_if = |hits: &mut Vec<EntrypointHint>, path: &str, kind: &str, reason: &str| {
        if names.contains(&path) {
            hits.push(EntrypointHint {
                path: path.to_string(),
                kind: kind.to_string(),
                reason: reason.to_string(),
            });
        }
    };

    push_if(&mut hits, "README.md", "docs", "Repository readme");
    push_if(&mut hits, "AGENTS.md", "docs", "Agent instructions");
    push_if(&mut hits, "agents.md", "docs", "Agent instructions");
    push_if(&mut hits, "CLAUDE.md", "docs", "Claude instructions");
    push_if(&mut hits, ".env.example", "config", "Required env vars");

    // Common code entrypoints (existence checked across full file list)
    let candidates = [
        ("src/main.rs", "bin", "Rust binary entrypoint"),
        ("src/lib.rs", "bin", "Rust library entrypoint"),
        ("src/index.ts", "web", "TS entrypoint"),
        ("src/index.tsx", "web", "TSX entrypoint"),
        ("src/main.ts", "web", "Vite/TS entrypoint"),
        ("src/main.tsx", "web", "Vite/React entrypoint"),
        ("src/App.tsx", "web", "React root component"),
        ("src/App.vue", "web", "Vue root component"),
        ("pages/_app.tsx", "web", "Next.js Pages Router"),
        ("app/page.tsx", "web", "Next.js App Router"),
        ("app/layout.tsx", "web", "Next.js root layout"),
        ("server.ts", "server", "Server entrypoint"),
        ("server.js", "server", "Server entrypoint"),
        ("worker.ts", "server", "Cloudflare worker"),
        ("workerd.ts", "server", "Cloudflare worker"),
        ("index.html", "web", "Static html shell"),
        ("manage.py", "script", "Django manage.py"),
        ("main.py", "script", "Python entrypoint"),
        ("app.py", "script", "Flask app"),
    ];
    for (path, kind, reason) in candidates {
        push_if(&mut hits, path, kind, reason);
    }

    // Walk every file looking for nested entrypoints (apps/*/src/main.tsx etc.)
    for (p, _) in files {
        if p.ends_with("src/main.rs") && p != "src/main.rs" {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "bin".to_string(),
                reason: "Rust binary entrypoint".to_string(),
            });
        }
        if p.ends_with("src-tauri/tauri.conf.json") {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "desktop".to_string(),
                reason: "Tauri config".to_string(),
            });
        }
        if p.ends_with("src/main.tsx") && p != "src/main.tsx" {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "web".to_string(),
                reason: "Vite React entrypoint".to_string(),
            });
        }
        if p.ends_with("src/App.tsx") && p != "src/App.tsx" {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "web".to_string(),
                reason: "React root".to_string(),
            });
        }
        if p.ends_with("vite.config.ts") || p.ends_with("vite.config.js") {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "config".to_string(),
                reason: "Vite config".to_string(),
            });
        }
        if p.ends_with("playwright.config.ts") {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "config".to_string(),
                reason: "Playwright e2e config".to_string(),
            });
        }
        if p.ends_with(".github/workflows/ci.yml")
            || p.ends_with(".github/workflows/release.yml")
            || (p.starts_with(".github/workflows/") && p.ends_with(".yml"))
        {
            hits.push(EntrypointHint {
                path: p.clone(),
                kind: "config".to_string(),
                reason: "GitHub Actions workflow".to_string(),
            });
        }
    }

    // Manifest-based: package.json scripts → "scripts" entrypoint
    for m in manifests {
        if m.kind == "package.json" && !m.scripts.is_empty() {
            let preview: Vec<String> = m.scripts.iter().take(8).cloned().collect();
            hits.push(EntrypointHint {
                path: m.path.clone(),
                kind: "config".to_string(),
                reason: format!("npm scripts: {}", preview.join(", ")),
            });
        }
    }

    // Stack hint nudges
    if stack_tags.contains(&"Tauri".to_string()) {
        for (p, _) in files {
            if p.ends_with("src-tauri/src/main.rs") {
                hits.push(EntrypointHint {
                    path: p.clone(),
                    kind: "desktop".to_string(),
                    reason: "Tauri Rust backend".to_string(),
                });
            }
        }
    }

    // De-dup by path
    let mut seen = std::collections::HashSet::new();
    hits.retain(|h| seen.insert(h.path.clone()));
    hits.truncate(60);
    hits
}

// ─── Synthesis prompt ───────────────────────────────────────────────────────

fn build_synthesis_prompt(inv: &RepoInventory) -> String {
    let mut buf = String::new();
    buf.push_str(
        "You are CodeVetter Repo Unpacked. You will produce a deep, evidence-backed system brief \
for the repo described below. The inventory I've assembled is only the skeleton — your job is to \
INVESTIGATE the repo using your file-read and search tools, then synthesise a rich brief grounded \
in what you actually read. Return ONLY valid JSON (no markdown fences, no commentary).\n\n",
    );

    buf.push_str("Investigation requirements (do these before writing claims):\n");
    buf.push_str("- Open and read at least 12 source files. Prioritise: every listed entrypoint, the top 3 manifests, the largest source files in the top dirs, all notable configs, and any docs that describe architecture.\n");
    buf.push_str("- Walk at least 3 user-visible flows end-to-end (e.g. \"startup\", \"primary action\", \"persistence path\") by reading the relevant files in sequence.\n");
    buf.push_str("- Inspect tests if present. Note framework, what is covered, what isn't.\n");
    buf.push_str("- Look for security-sensitive code paths (auth, secrets, IPC, shell-out, network, file IO outside repo root).\n");
    buf.push_str("- Look for extension points (registries, plugin systems, command tables, routers, factory functions).\n\n");

    buf.push_str("Required JSON shape:\n");
    buf.push_str(r#"{
  "overview": "2-4 sentence elevator pitch grounded in what you actually read — what the system does, who it's for, what's distinctive.",
  "system_map": {
    "summary": "3-6 sentences naming entrypoints, the request/event flow at the highest level, runtime boundaries, storage, and key external integrations.",
    "claims": [{"claim":"...","sources":["src/main.rs","apps/desktop/src/App.tsx"],"kind":"evidence"}]
  },
  "feature_catalog":   { "summary": "...", "claims": [...] },
  "data_flow":         { "summary": "...", "claims": [...] },
  "behavior_traces":   { "summary": "...", "claims": [...] },
  "testing_signals":   { "summary": "...", "claims": [...] },
  "risk_map":          { "summary": "...", "claims": [...] },
  "extension_points":  { "summary": "...", "claims": [...] },
  "agent_handoff":     { "summary": "...", "claims": [...] },
  "agent_prompt": "Reusable prompt block (300-700 words) future agents can paste in to onboard. Include stack, key files, conventions, danger zones, and a short 'how to make a safe change here' recipe."
}"#);
    buf.push_str("\n\nRules:\n");
    buf.push_str("- Every claim MUST list at least one `sources` file path that EXISTS in the file list below. Multi-file claims are encouraged — cite 2-4 sources where appropriate.\n");
    buf.push_str("- You may append `#Lstart-end` to a source path to point at a specific line range you read (e.g. `src/main.rs#L42-58`).\n");
    buf.push_str("- Use `kind: \"evidence\"` when sources directly support the claim. Use `kind: \"inference\"` only when reading between the lines; mark such claims clearly and use them sparingly (<20% of claims).\n");
    buf.push_str("- Do not invent files. If you cannot cite a file, omit the claim.\n");
    buf.push_str("- Target 8-15 claims per section. Each claim should be concrete and load-bearing — name functions, commands, files, env vars, types. Avoid vague restatements.\n");
    buf.push_str("- Each section summary should be 3-6 sentences. Do not pad — say something an experienced engineer wouldn't already know from skimming the repo for 30 seconds.\n\n");
    buf.push_str("Section briefs:\n");
    buf.push_str("- system_map: entrypoints, modules, runtime boundaries (process/thread/IPC), storage layer (schema names, table names if you read them), external integrations, build/test commands, deployment shape.\n");
    buf.push_str("- feature_catalog: every user-facing feature — routes, screens, CLI subcommands, Tauri/Rust commands, jobs, APIs, provider integrations. For each: where it's implemented (path), and any flag/toggle gating it.\n");
    buf.push_str("- data_flow: how data moves through the system end-to-end. Input boundaries → transforms → state owners → output boundaries. Where state lives (memory, SQLite tables, files, KV). Sync vs async hops.\n");
    buf.push_str("- behavior_traces: ordered walk-throughs of important flows (startup, primary action, persistence, settings load, update/release). Name the functions called in order.\n");
    buf.push_str("- testing_signals: test framework(s), which directories hold tests, what's covered vs uncovered, fixtures/mocks used, CI integration. If there are no tests, say so plainly and point at the highest-leverage missing test.\n");
    buf.push_str("- risk_map: security-sensitive paths, untested critical flows, fragile coupling, dead/legacy code, hidden flags, stale docs, blast-radius hotspots, places where a small change would silently break something else.\n");
    buf.push_str("- extension_points: where new code is meant to plug in — registries, command tables, plugin/provider interfaces, route lists, factory functions, config schemas. For each, name the file and the shape of the contract.\n");
    buf.push_str("- agent_handoff: conventions (naming, lint rules, formatting), safe edit boundaries (\"changing X almost always also requires Y\"), important files an agent must read before making changes, recommended tests to run, known traps.\n");
    buf.push_str("- agent_prompt: a copy-pasteable handoff prompt summarising the project for future agents. Should let a fresh agent be productive without re-reading the repo.\n");
    buf.push_str("\n");

    buf.push_str(&format!("Repo: {}\n", inv.repo_name));
    if let Some(sha) = &inv.commit_sha {
        buf.push_str(&format!("Commit: {}\n", sha));
    }
    if let Some(branch) = &inv.branch {
        buf.push_str(&format!("Branch: {}\n", branch));
    }
    if let Some(remote) = &inv.remote_url {
        buf.push_str(&format!("Remote: {}\n", remote));
    }
    buf.push_str(&format!(
        "Files scanned: {} (skipped {} binary/oversized/ignored)\n",
        inv.files_scanned, inv.files_skipped
    ));
    if inv.max_files_hit {
        buf.push_str(&format!(
            "(file walk stopped at MAX_FILES={MAX_FILES} — large repo)\n"
        ));
    }
    buf.push_str(&format!("Stack tags: {}\n", inv.stack_tags.join(", ")));

    buf.push_str("\nLanguages (top 10 by bytes):\n");
    for l in inv.languages.iter().take(10) {
        buf.push_str(&format!("  - {} — {} files, {} bytes\n", l.language, l.files, l.bytes));
    }

    buf.push_str("\nTop-level dirs:\n");
    for d in inv.top_level_dirs.iter().take(20) {
        buf.push_str(&format!("  - {}/ — {} files, {} bytes\n", d.path, d.file_count, d.bytes));
    }

    buf.push_str("\nManifests:\n");
    for m in &inv.manifests {
        buf.push_str(&format!(
            "  - {} ({}{}{})\n",
            m.path,
            m.name.as_deref().unwrap_or(""),
            m.version
                .as_deref()
                .map(|v| format!(" v{v}"))
                .unwrap_or_default(),
            if !m.scripts.is_empty() {
                format!(" scripts={}", m.scripts.join(","))
            } else {
                String::new()
            }
        ));
        if !m.dependencies.is_empty() {
            buf.push_str(&format!(
                "      deps: {}\n",
                m.dependencies.iter().take(40).cloned().collect::<Vec<_>>().join(", ")
            ));
        }
    }

    buf.push_str("\nLikely entrypoints:\n");
    for e in &inv.entrypoints {
        buf.push_str(&format!("  - {} [{}] — {}\n", e.path, e.kind, e.reason));
    }

    if !inv.config_files.is_empty() {
        buf.push_str("\nNotable configs:\n");
        for c in &inv.config_files {
            buf.push_str(&format!("  - {}\n", c));
        }
    }

    if !inv.docs.is_empty() {
        buf.push_str("\nDocs (truncated previews):\n");
        for d in inv.docs.iter().take(8) {
            buf.push_str(&format!("---- {} ----\n", d.path));
            buf.push_str(d.preview.as_str());
            buf.push_str("\n");
        }
    }

    buf.push_str("\nFile list (truncated to fit):\n");
    let max_files_in_prompt = 1500usize;
    for p in inv.all_files.iter().take(max_files_in_prompt) {
        buf.push_str(p);
        buf.push('\n');
    }
    if inv.all_files.len() > max_files_in_prompt {
        buf.push_str(&format!(
            "... ({} more files omitted from prompt — they exist in the inventory)\n",
            inv.all_files.len() - max_files_in_prompt
        ));
    }

    buf
}

// ─── Report normalization (validate citations) ──────────────────────────────

fn normalize_report(parsed: &Value, inv: &RepoInventory) -> UnpackReport {
    let known_paths: std::collections::HashSet<&str> =
        inv.all_files.iter().map(|s| s.as_str()).collect();

    let take_section = |key: &str, title: &str| -> Option<ReportSection> {
        let v = parsed.get(key)?;
        let summary = v
            .get("summary")
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string();
        let claims = v
            .get("claims")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        let claim = c.get("claim").and_then(|x| x.as_str())?.to_string();
                        let kind = c
                            .get("kind")
                            .and_then(|x| x.as_str())
                            .map(String::from);
                        let sources = c
                            .get("sources")
                            .and_then(|x| x.as_array())
                            .map(|src| {
                                src.iter()
                                    .filter_map(|s| s.as_str())
                                    .filter(|s| {
                                        let path_only = s.split('#').next().unwrap_or(s);
                                        known_paths.contains(path_only)
                                    })
                                    .map(String::from)
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        if sources.is_empty() {
                            return None;
                        }
                        Some(ReportClaim {
                            claim,
                            sources,
                            kind,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if summary.is_empty() && claims.is_empty() {
            None
        } else {
            Some(ReportSection {
                title: title.to_string(),
                summary,
                claims,
            })
        }
    };

    UnpackReport {
        system_map: take_section("system_map", "System Map"),
        feature_catalog: take_section("feature_catalog", "Feature Catalog"),
        data_flow: take_section("data_flow", "Data Flow"),
        behavior_traces: take_section("behavior_traces", "Behavior Traces"),
        testing_signals: take_section("testing_signals", "Testing Signals"),
        risk_map: take_section("risk_map", "Risk Map"),
        extension_points: take_section("extension_points", "Extension Points"),
        agent_handoff: take_section("agent_handoff", "Agent Handoff Pack"),
        agent_prompt: parsed
            .get("agent_prompt")
            .and_then(|v| v.as_str())
            .map(String::from),
        overview: parsed
            .get("overview")
            .and_then(|v| v.as_str())
            .map(String::from),
    }
}

// ─── Export helpers ─────────────────────────────────────────────────────────

fn render_markdown(
    repo_name: &str,
    created_at: &str,
    agent: Option<&str>,
    model: Option<&str>,
    report: &UnpackReport,
    inventory: Option<&RepoInventory>,
) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Repo Unpacked — {}\n\n", repo_name));
    out.push_str(&format!("_Generated: {}", created_at));
    if let Some(a) = agent {
        out.push_str(&format!(" · agent: {}", a));
    }
    if let Some(m) = model {
        out.push_str(&format!(" · model: {}", m));
    }
    out.push_str("_\n\n");

    if let Some(o) = &report.overview {
        out.push_str(&format!("> {}\n\n", o));
    }

    if let Some(inv) = inventory {
        out.push_str(&format!(
            "**Stack:** {}\n\n",
            if inv.stack_tags.is_empty() {
                "—".to_string()
            } else {
                inv.stack_tags.join(", ")
            }
        ));
        out.push_str(&format!(
            "**Files scanned:** {} ({} skipped, {} bytes)\n\n",
            inv.files_scanned, inv.files_skipped, inv.bytes_scanned
        ));
    }

    let render_section = |out: &mut String, sec: &Option<ReportSection>| {
        let Some(sec) = sec else { return };
        out.push_str(&format!("## {}\n\n", sec.title));
        if !sec.summary.is_empty() {
            out.push_str(&format!("{}\n\n", sec.summary));
        }
        for c in &sec.claims {
            let kind_marker = match c.kind.as_deref() {
                Some("inference") => " _(inference)_",
                _ => "",
            };
            out.push_str(&format!("- {}{}\n", c.claim, kind_marker));
            if !c.sources.is_empty() {
                let srcs: Vec<String> = c
                    .sources
                    .iter()
                    .map(|s| format!("`{}`", s))
                    .collect();
                out.push_str(&format!("  - sources: {}\n", srcs.join(", ")));
            }
        }
        out.push('\n');
    };

    render_section(&mut out, &report.system_map);
    render_section(&mut out, &report.feature_catalog);
    render_section(&mut out, &report.data_flow);
    render_section(&mut out, &report.behavior_traces);
    render_section(&mut out, &report.testing_signals);
    render_section(&mut out, &report.risk_map);
    render_section(&mut out, &report.extension_points);
    render_section(&mut out, &report.agent_handoff);

    if let Some(prompt) = &report.agent_prompt {
        out.push_str("## Agent Handoff Prompt\n\n");
        out.push_str("```text\n");
        out.push_str(prompt);
        out.push_str("\n```\n");
    }

    out
}

fn render_html(repo_name: &str, markdown_body: &str) -> String {
    // Minimal static HTML — no external assets so the export is self-contained.
    let escaped = markdown_body
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Repo Unpacked — {repo_name}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 920px; margin: 2.5rem auto; padding: 0 1.5rem; color: #1f2128; background: #fafafa; }}
  pre {{ background: #f1f3f5; padding: 1rem; overflow-x: auto; font-size: 0.85rem; border-radius: 4px; white-space: pre-wrap; }}
  code {{ background: #eef0f3; padding: 0.05rem 0.35rem; border-radius: 3px; font-size: 0.85rem; }}
  h1, h2, h3 {{ font-weight: 600; }}
</style>
</head>
<body>
<pre>{escaped}</pre>
</body>
</html>"#
    )
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

fn mark_failed(db: &State<'_, DbState>, id: &str, msg: &str, runtime_ms: i64) {
    if let Ok(conn) = db.0.lock() {
        let _ = conn.execute(
            "UPDATE repo_unpacked_reports
             SET status='failed', error_message=?1, runtime_ms=?2,
                 completed_at=?3
             WHERE id=?4",
            rusqlite::params![msg, runtime_ms, chrono::Utc::now().to_rfc3339(), id],
        );
    }
}

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, String>(0)?,
        "repo_path": r.get::<_, String>(1)?,
        "repo_name": r.get::<_, String>(2)?,
        "commit_sha": r.get::<_, Option<String>>(3)?,
        "status": r.get::<_, String>(4)?,
        "error_message": r.get::<_, Option<String>>(5)?,
        "agent_used": r.get::<_, Option<String>>(6)?,
        "model_used": r.get::<_, Option<String>>(7)?,
        "files_scanned": r.get::<_, i64>(8)?,
        "files_skipped": r.get::<_, i64>(9)?,
        "runtime_ms": r.get::<_, Option<i64>>(10)?,
        "cost_usd": r.get::<_, Option<f64>>(11)?,
        "started_at": r.get::<_, Option<String>>(12)?,
        "completed_at": r.get::<_, Option<String>>(13)?,
        "created_at": r.get::<_, String>(14)?,
    }))
}

// ─── Gitignore patterns (mirrors files.rs but kept local) ───────────────────

struct GlobPattern {
    pattern: String,
    negated: bool,
    dir_only: bool,
}

fn parse_gitignore(root: &Path) -> Vec<GlobPattern> {
    let path = root.join(".gitignore");
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let mut pattern = line.to_string();
            let negated = pattern.starts_with('!');
            if negated {
                pattern = pattern[1..].to_string();
            }
            let dir_only = pattern.ends_with('/');
            if dir_only {
                pattern = pattern.trim_end_matches('/').to_string();
            }
            Some(GlobPattern { pattern, negated, dir_only })
        })
        .collect()
}

fn is_ignored(rel: &str, is_dir: bool, patterns: &[GlobPattern]) -> bool {
    let mut ignored = false;
    let name = Path::new(rel)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    for pat in patterns {
        if pat.dir_only && !is_dir {
            continue;
        }
        if simple_glob_match(&pat.pattern, rel, &name) {
            ignored = !pat.negated;
        }
    }
    ignored
}

fn simple_glob_match(pattern: &str, rel: &str, name: &str) -> bool {
    if pattern.contains('/') {
        let pattern = pattern.trim_start_matches('/');
        return path_match(pattern, rel);
    }
    path_match(pattern, name)
}

fn path_match(pattern: &str, text: &str) -> bool {
    if pattern == "**" {
        return true;
    }
    if let Some(ext) = pattern.strip_prefix("*.") {
        return text.ends_with(&format!(".{ext}"));
    }
    if pattern.starts_with('*') && !pattern.contains('/') {
        return text.ends_with(&pattern[1..]);
    }
    if pattern == text {
        return true;
    }
    if text.starts_with(pattern) && text[pattern.len()..].starts_with('/') {
        return true;
    }
    false
}
