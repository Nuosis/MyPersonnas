---
name: bake-pi
description: Helps design new pi agents, extensions, skills, prompts, and workflows. Use when setting up agents, pipelines, multi-agent systems, or any extension to the Pi harness.
---

# Bake Pi - Extension Design Skill

Use this skill when helping Marcus design new agents, set up agent workflows, or evaluate agent architecture decisions.

## Core Doctrine

Any extension to Pi (agent, extension, skill, prompt, tool, command) should be designed, not just thrown together.


**Pattern selection order:**
1. Single primary agent (default - start here)
2. Pipeline (when stages are naturally separable)
3. Swarm (only when parallelism is clearly warranted)

If you cannot explain why concurrent agents are needed, default to single agent.

## Trigger Phrases

When **creating new agents from scratch** or designing new workflows:

- "bake a new pi"
- "setup an agent"
- "new project agent"
- "agent architecture"
- "agent design"
- "multi-agent"
- "agent workflow"
- "new persona"

**For creating skills, extensions, or tools, use `/skill extra-pi`**

## Design Steps

When asked to help design an agent:

### 1. Clarify the Job
- What is the agent *actually* for?
- Specific, bounded, outcome-oriented?
- One job or multiple?

### 2. Choose the Lightest Pattern

| Pattern | Use When |
|---------|----------|
| **Single Agent** | Most things. One accountable author. |
| **Advisor (Pi-Pi)** | Need domain experts advising primary builder |
| **Pipeline** | Clear separable stages (planner→builder→reviewer) |
| **Swarm** | Parallel exploration, multiple valid paths, justified parallelism |

### 3. Define the Contract
- **Objectives:** What success looks like
- **Non-goals:** What it explicitly does NOT do
- **Scenarios:** Key situations and expected behaviors
- **Evals:** How to know it's working → Use `/skill agent-eval` to write and run evals

### 4. Check for Anti-Patterns
- Bloated prompts mixing policy + runtime + behavior
- Too many objectives in one agent
- Vague role definitions
- Fake agency (sounds powerful, undefined role)
- Swarm when single agent would suffice

## Reference Docs

- Full guide: `@~/.pi/docs/HOW_TO_BAKE_YOUR_PI.md`
- Pi docs: `@~/.pi/docs/PI.md`
- Pi patterns: `@~/.pi/docs/pi-patterns`
- Examples: `/Users/devflow/repos/pi-vs-claude-code`

## Skill Flow

```
/skill bake-pi   → Design new agents from scratch
/skill extra-pi  → Create extensions, skills, tools, prompts, or add evals to existing agents
/skill agent-eval → Run and manage evals
/skill error-solving → Debug issues systematically
```

**Typical flow:**
1. `/make <name>` → `/init` → create persona
2. `/skill bake-pi` → define what this agent should be
3. Build the agent
4. Need a new skill/extension/tool? → `/skill extra-pi`
5. Bug to debug? → `/skill error-solving`
6. Later: `/skill agent-eval` → run evals to verify

## Example Conversation Starters

- "I need an agent that reviews code"
- "Help me set up a researcher → writer pipeline"
- "Should I use a swarm for this?"
- "Audit my existing agent design"
- "Write an extension to do X"
- "Add a skill for Y"
- "Create a new tool for Z"

## Pi Config Locations

When setting up a new project agent:
- `.pi/agents/` - agent definitions
- `.pi/extensions/` - custom tools
- `.pi/skills/` - specialized capabilities
- `.pi/prompts/` - reusable prompt templates
- `.pi/AGENTS.md` - project instructions (auto-loaded)
- `.pi/settings.json` - project settings

Global config lives in `~/.pi/agent/` and is inherited.
