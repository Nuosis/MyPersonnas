# Bake Pi - Agent Design Skill

Use this skill when helping Marcus design new agents, set up agent workflows, or evaluate agent architecture decisions.

## Core Doctrine

**Pattern selection order:**
1. Single primary agent (default - start here)
2. Pipeline (when stages are naturally separable)
3. Swarm (only when parallelism is clearly warranted)

If you cannot explain why concurrent agents are needed, default to single agent.

## Trigger Phrases

- "bake a new pi"
- "setup an agent"
- "new project agent"
- "agent architecture"
- "agent design"
- "multi-agent"
- "agent workflow"

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
- **Evals:** How to know it's working

### 4. Check for Anti-Patterns
- Bloated prompts mixing policy + runtime + behavior
- Too many objectives in one agent
- Vague role definitions
- Fake agency (sounds powerful, undefined role)
- Swarm when single agent would suffice

## Reference Docs

- Full guide: `@~/.pi/docs/HOW_TO_BAKE_YOUR_PI.md`
- Pi docs: `@~/.pi/docs/PI.md`
- Examples: `/Users/devflow/repos/pi-vs-claude-code`

## Example Conversation Starters

- "I need an agent that reviews code"
- "Help me set up a researcher → writer pipeline"
- "Should I use a swarm for this?"
- "Audit my existing agent design"

## Pi Config Locations

When setting up a new project agent:
- `.pi/agents/` - agent definitions
- `.pi/extensions/` - custom tools
- `.pi/skills/` - specialized capabilities
- `.pi/prompts/` - reusable prompt templates
- `.pi/AGENTS.md` - project instructions (auto-loaded)
- `.pi/settings.json` - project settings

Global config lives in `~/.pi/agent/` and is inherited.
