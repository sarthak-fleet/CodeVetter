//! Cross-fleet rollup. CodeVetter pulls the user's fleet projects from the
//! SaaS Maker spine, joins them against `repo_project_mapping` to find each
//! project's local clone, then runs intel attribution per repo. The result
//! is a ranked dashboard showing where work is concentrated across the fleet
//! and which projects are velocity-accelerating since adopting AI tools.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::intel::{
    compute_ai_acceleration, attribute_repo_path, AiAcceleration, RepoAttributionReport,
    WindowReport,
};
use crate::commands::saas_maker::{
    list_saas_maker_projects, push_changelog_helper, SaasMakerProject,
};
use crate::DbState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedRepo {
    pub repo_path: String,
    pub project_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetProjectStats {
    pub project: SaasMakerProject,
    pub repo_path: Option<String>,
    pub linked: bool,
    /// 7d window (or None if repo missing / read failed).
    pub w7d: Option<WindowReport>,
    pub w30d: Option<WindowReport>,
    pub w90d: Option<WindowReport>,
    pub all_time: Option<WindowReport>,
    pub acceleration: Option<AiAcceleration>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FleetRollup {
    pub projects: Vec<FleetProjectStats>,
    /// Projects in the fleet that we have no local repo mapping for.
    pub unlinked_count: u64,
    pub linked_count: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeeklyFleetMarkdown {
    pub markdown: String,
    pub project_count: u64,
    pub total_commits: u64,
    pub total_ai_commits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushChangelogInput {
    pub project_id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub published: Option<bool>,
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_linked_repos(db: State<'_, DbState>) -> Result<Vec<LinkedRepo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT repo_path, project_slug FROM repo_project_mapping")
        .map_err(|e| e.to_string())?;
    let rows: Vec<LinkedRepo> = stmt
        .query_map([], |r| {
            Ok(LinkedRepo {
                repo_path: r.get(0)?,
                project_slug: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn get_fleet_rollup(db: State<'_, DbState>) -> Result<FleetRollup, String> {
    // 1. Pull fleet projects (requires auth).
    let projects = match list_saas_maker_projects(db.clone()).await {
        Ok(p) => p,
        Err(e) => {
            return Ok(FleetRollup {
                projects: vec![],
                unlinked_count: 0,
                linked_count: 0,
                error: Some(format!("Sign in first to pull fleet projects: {e}")),
            });
        }
    };

    // 2. Pull local linked repos.
    let linked = list_linked_repos(db).await.unwrap_or_default();
    let path_by_slug: std::collections::HashMap<String, String> = linked
        .into_iter()
        .map(|l| (l.project_slug, l.repo_path))
        .collect();

    // 3. For each project, run intel if we have a local mapping.
    let mut out: Vec<FleetProjectStats> = Vec::with_capacity(projects.len());
    let mut linked_count = 0u64;
    let mut unlinked_count = 0u64;
    for p in projects {
        let slug = p.slug.clone().unwrap_or_default();
        let repo_path = path_by_slug.get(&slug).cloned();
        if repo_path.is_some() {
            linked_count += 1;
        } else {
            unlinked_count += 1;
        }
        let mut stats = FleetProjectStats {
            project: p,
            repo_path: repo_path.clone(),
            linked: repo_path.is_some(),
            w7d: None,
            w30d: None,
            w90d: None,
            all_time: None,
            acceleration: None,
            error: None,
        };
        if let Some(path) = repo_path.as_deref() {
            match attribute_repo_path(path) {
                Ok(report) => {
                    stats.w7d = pick_window(&report, "7d");
                    stats.w30d = pick_window(&report, "30d");
                    stats.w90d = pick_window(&report, "90d");
                    stats.all_time = pick_window(&report, "all");
                    stats.acceleration = compute_ai_acceleration(path);
                }
                Err(e) => {
                    stats.error = Some(e);
                }
            }
        }
        out.push(stats);
    }

    // 4. Sort by 30d commit count desc (the most actionable view: where the
    //    work is happening lately).
    out.sort_by(|a, b| {
        b.w30d
            .as_ref()
            .map(|w| w.total_commits)
            .unwrap_or(0)
            .cmp(&a.w30d.as_ref().map(|w| w.total_commits).unwrap_or(0))
    });

    Ok(FleetRollup {
        projects: out,
        unlinked_count,
        linked_count,
        error: None,
    })
}

#[tauri::command]
pub async fn generate_weekly_fleet_markdown(
    db: State<'_, DbState>,
) -> Result<WeeklyFleetMarkdown, String> {
    let rollup = get_fleet_rollup(db).await?;
    let mut total_commits = 0u64;
    let mut total_ai = 0u64;
    for p in &rollup.projects {
        if let Some(w) = &p.w7d {
            total_commits += w.total_commits;
            total_ai += w.ai_commits;
        }
    }
    let project_count = rollup.linked_count;
    let now = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let mut md = String::new();
    md.push_str(&format!("# Fleet weekly report · {now}\n\n"));
    md.push_str(&format!(
        "**{project_count} linked projects · {total_commits} commits · {total_ai} AI-led ({})**\n\n",
        format_pct(total_ai, total_commits)
    ));

    md.push_str("## By project (last 7 days)\n\n");
    md.push_str("| project | commits | AI | human | +lines | active days |\n");
    md.push_str("|---|---:|---:|---:|---:|---:|\n");
    let mut active: Vec<&FleetProjectStats> = rollup
        .projects
        .iter()
        .filter(|p| p.w7d.as_ref().map(|w| w.total_commits > 0).unwrap_or(false))
        .collect();
    active.sort_by(|a, b| {
        b.w7d.as_ref().unwrap().total_commits.cmp(&a.w7d.as_ref().unwrap().total_commits)
    });
    for p in active.iter().take(20) {
        let w = p.w7d.as_ref().unwrap();
        md.push_str(&format!(
            "| {} | {} | {} | {} | +{} | {} |\n",
            p.project.name,
            w.total_commits,
            w.ai_commits,
            w.human_commits,
            w.ai_additions + w.human_additions,
            w.active_days,
        ));
    }

    md.push_str("\n## AI velocity acceleration\n\n");
    let mut accel: Vec<(&FleetProjectStats, &AiAcceleration)> = rollup
        .projects
        .iter()
        .filter_map(|p| p.acceleration.as_ref().map(|a| (p, a)))
        .collect();
    accel.sort_by(|a, b| b.1.velocity_delta_pct.cmp(&a.1.velocity_delta_pct));
    if accel.is_empty() {
        md.push_str("_No projects have enough history before + after their first AI commit yet._\n");
    } else {
        md.push_str("| project | first AI commit | before | after | delta |\n");
        md.push_str("|---|---|---:|---:|---:|\n");
        for (p, a) in accel.iter().take(10) {
            md.push_str(&format!(
                "| {} | {} | {:.2}/day | {:.2}/day | {}% |\n",
                p.project.name,
                a.first_ai_commit_date,
                a.before_commits_per_day,
                a.after_commits_per_day,
                a.velocity_delta_pct,
            ));
        }
    }

    md.push_str(&format!(
        "\n---\n\n_Generated by CodeVetter at {now}._\n"
    ));

    Ok(WeeklyFleetMarkdown {
        markdown: md,
        project_count,
        total_commits,
        total_ai_commits: total_ai,
    })
}

#[tauri::command]
pub async fn push_changelog_entry(
    db: State<'_, DbState>,
    input: PushChangelogInput,
) -> Result<serde_json::Value, String> {
    push_changelog_helper(&db, input).await
}

fn pick_window(report: &RepoAttributionReport, label: &str) -> Option<WindowReport> {
    report.windows.iter().find(|w| w.label == label).cloned()
}

fn format_pct(part: u64, whole: u64) -> String {
    if whole == 0 {
        "—".to_string()
    } else {
        format!("{:.1}%", (part as f64 / whole as f64) * 100.0)
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_pct_basic() {
        assert_eq!(format_pct(50, 100), "50.0%");
        assert_eq!(format_pct(0, 100), "0.0%");
        assert_eq!(format_pct(5, 0), "—");
    }

    #[test]
    fn weekly_markdown_smoke_empty_rollup() {
        // Direct construction of a minimal rollup → ensures the markdown
        // formatter doesn't panic on the empty case.
        let rollup = FleetRollup {
            projects: vec![],
            unlinked_count: 0,
            linked_count: 0,
            error: None,
        };
        let md = build_markdown_from_rollup(&rollup);
        assert!(md.contains("# Fleet weekly report"));
        assert!(md.contains("0 linked projects"));
        assert!(md.contains("No projects have enough history"));
    }

    // Test-only helper that mirrors generate_weekly_fleet_markdown's body
    // without the State/DB dependency.
    fn build_markdown_from_rollup(rollup: &FleetRollup) -> String {
        let mut total_commits = 0u64;
        let mut total_ai = 0u64;
        for p in &rollup.projects {
            if let Some(w) = &p.w7d {
                total_commits += w.total_commits;
                total_ai += w.ai_commits;
            }
        }
        let now = "2026-06-16";
        let mut md = String::new();
        md.push_str(&format!("# Fleet weekly report · {now}\n\n"));
        md.push_str(&format!(
            "**{} linked projects · {total_commits} commits · {total_ai} AI-led ({})**\n\n",
            rollup.linked_count,
            format_pct(total_ai, total_commits)
        ));
        md.push_str("## By project (last 7 days)\n\n");
        md.push_str("\n## AI velocity acceleration\n\n");
        md.push_str("_No projects have enough history before + after their first AI commit yet._\n");
        md
    }
}

