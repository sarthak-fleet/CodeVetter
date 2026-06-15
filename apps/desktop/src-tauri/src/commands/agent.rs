//! Tauri command surface for the live browser agent.

use tauri::AppHandle;

use crate::agent::{run_agent_task, AgentRunInput, AgentRunResult};

#[tauri::command]
pub async fn agent_run_task(
    app: AppHandle,
    input: AgentRunInput,
) -> Result<AgentRunResult, String> {
    run_agent_task(app, input).await
}
