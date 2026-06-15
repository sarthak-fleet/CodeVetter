//! System prompts + action-schema instructions for the agent brain.
//! The brain is told to emit exactly one JSON object describing the
//! next action; the runner parses it into AgentAction.

const ACTION_SCHEMA: &str = r#"Return your next action as a single JSON object on its own line with no
prose around it. Action shapes:

  { "type": "click",   "selector": "css-or-text-selector", "reasoning": "..." }
  { "type": "type",    "selector": "css-selector", "text": "what to type", "reasoning": "..." }
  { "type": "key",     "key": "Enter|Tab|Escape|...", "reasoning": "..." }
  { "type": "scroll",  "delta": 600, "reasoning": "..." }
  { "type": "goto",    "url": "https://...", "reasoning": "..." }
  { "type": "done",    "reasoning": "goal completed because ..." }
  { "type": "give_up", "reasoning": "stuck because ..." }

Selectors: prefer a stable CSS selector visible in the accessibility tree
(e.g. button[aria-label='Download'], a[href*='pricing']). If none is
obvious, fall back to a text= prefix (text=Download for macOS)."#;

pub fn system_prompt_for_goal(goal: &str, persona: Option<&str>) -> String {
    let persona_block = match persona {
        Some(p) if !p.trim().is_empty() => format!("\n\nPersona:\n{}\n", p.trim()),
        _ => String::new(),
    };
    format!(
        "You are CodeVetter's live browser agent. You drive a real Chrome \
         page step by step to accomplish a goal a user gave you. You see \
         the page through its accessibility tree (and, when available, a \
         screenshot). You pick exactly one action per turn.\
         \n\nGoal:\n{goal}\
         {persona_block}\
         \n\n{ACTION_SCHEMA}\
         \n\nReturn `done` as soon as the goal is unambiguously met; \
         return `give_up` if you've been stuck for several steps with no progress."
    )
}
