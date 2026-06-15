//! Live browser agent: drives a real Chrome page via chromiumoxide, asks
//! a "brain" (currently LocalAiBrain → local-ai HTTP gateway) for the next
//! action at each step, executes it, and emits per-step events back to the
//! frontend until the goal is reached or the budget is exhausted.

pub mod brain;
pub mod browser;
pub mod local_server;
pub mod prompts;
pub mod runner;
pub mod types;

pub use runner::run_agent_task;
pub use types::{AgentRunInput, AgentRunResult};
