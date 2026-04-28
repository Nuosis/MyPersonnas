# Pi-inator: Self-Evolving Agent System

> Vision for a self-improving agent system where a planner can forge workers on demand, workers execute with focus, and a manager orchestrates the whole thing.

## Core Concept

The Pi-inator is a **meta-orchestration system** where agents can create other agents. A planning agent with forge access can design and spec new workers, which are then deployed by a manager and executed by task-focused workers.

```
Manager (head agent)
├── todo          → tracks goals, progress, next steps
├── run_chain     → execute chain + auto-cleanup
│
├── Planner Worker (forge-capable on demand)
│   └── forge tool → loads ALL experts → produces worker specs
│
└── Workers (task-focused, spawned on demand)
    └── task skills → sequential execution, no distractions
```

## Key Insight: Tool vs Command

**`/forge`** (command) → loads selected experts based on forge.yaml
**`forge`** (tool) → loads ALL experts, full capability

When planner invokes `forge` as tool, it gets access to all expert knowledge to spec anything needed.

## Architecture Components

### 1. Manager (Head Agent)

**Purpose:** Meta-orchestrator. Stays at 30,000ft view.

**Capabilities:**
- `todo` - tracks cross-chain goals, progress, what's next
- `run_chain` - execute chain, auto-deactivate on completion

**Questions:**
- Should todo persist across sessions or stay ephemeral?
- Does manager review all specs before worker creation?

### 2. Planner Worker (Forge-Capable)

**Purpose:** Identifies gaps, designs solutions, specs workers.

**Trigger:** Manager assigns "design a worker for X" task

**Flow:**
1. Load forge tool (loads ALL 5 experts)
2. Read relevant build skill
3. Query experts in parallel
4. Synthesize SPEC.md
5. Submit for manager review

**Questions:**
- Does planner write directly to `workers/{name}.md`?
- Or does manager approve specs first?
- Can planner spawn workers directly or always through manager?

### 3. Workers (Task-Focused)

**Purpose:** Single-responsibility execution. No distractions.

**Capabilities:**
- Task management skills (sequential execution)
- Gate-file evaluation for success criteria
- Clear input/output interfaces

**Questions:**
- Can workers spawn subagents? Or is that manager-only?
- What happens when a worker encounters an unexpected task?

### 4. Forge Tool

**When invoked as tool:**
- Loads ALL 5 experts (not just selected few from forge.yaml)
- Available for planner to query anytime
- Tool interface allows programmatic spec generation

**Questions:**
- Filter experts by what's being spec'd?
- Or always load all for flexibility?

### 5. Chain Management

**`run_chain` tool pattern:**
1. Execute chain steps
2. Aggregate results
3. Auto-deactivate chain (cleanup)
4. Report to manager

**Questions:**
- Explicit deactivate or auto-timeout?
- What if chain partially fails?

## Data Flow

```
todo: "We need a worker that does X"
    ↓
Planner loads forge tool
    ↓
Query experts → Synthesize SPEC
    ↓
Manager reviews SPEC
    ↓
Worker created → tasks assigned
    ↓
Worker executes (task skills)
    ↓
Results → Manager → todo updated
    ↓
Next todo item or chain execution
```

## The Loop

```
Goal identified
    ↓
forge (tool) → SPEC
    ↓
Review → Create/Update worker
    ↓
Assign tasks (sequential via task skills)
    ↓
Execute → Verify
    ↓
Report → Update todo
    ↓
Repeat or move to next goal
```

## Questions to Resolve

### Forge Behavior
1. Should forge tool load ALL experts or filter by context?
2. Does planner write specs directly or submit for review?
3. Can planner spawn workers or only design them?

### Worker Lifecycle
4. Are workers persistent or spawned per-task?
5. Can workers spawn subagents?
6. What is the worker input interface? (queue, tool params, chain input)

### Manager Authority
7. Does manager need to approve all spec creation?
8. Can manager directly execute without planner?
9. What's the manager → planner → worker command chain?

### Todo System
10. Persist todo across sessions?
11. Todo = goals + progress, or also includes active chains?
12. Can todo items be shared across agents?

### Chain Behavior
13. Auto-cleanup on success? On failure? On timeout?
14. What if chain partially succeeds?

## Risks & Concerns

### Unwieldy Complexity
- Too many layers could make behavior unpredictable
- Hard to trace where decisions originate
- Risk of infinite recursion (planner specs planner?)

### Consistency Challenges
- Different workers might behave differently
- Spec quality varies based on expert availability
- Manager could become bottleneck

### Mitigation Strategy
- Build slowly: start with manager + planner only
- Add workers incrementally as needed
- Keep chain logic simple initially
- Focus on predictability over power

## Phased Implementation

### Phase 1: Foundation
- Keep current forge setup
- Add `todo` capability to manager
- Test manager ↔ planner interaction

### Phase 2: Tool Enable
- Expose forge as tool (not just command)
- Planner loads all experts on-demand
- Spec flow: planner → manager → filesystem

### Phase 3: Worker Spawn
- Manager creates workers from specs
- Workers have task skills
- Task execution without distraction

### Phase 4: Chain Integration
- `run_chain` tool for manager
- Auto-cleanup on chain completion
- Chain → results → todo update

### Phase 5: Self-Evolution
- Planner identifies gaps autonomously
- Worker spawns workers (with manager approval?)
- System improves itself

## File Structure

```
.pi/
├── agent/
│   ├── workers/           # Worker definitions
│   │   ├── planner.md       # Planner worker
│   │   ├── scout.md
│   │   ├── worker.md
│   │   └── ...
│   ├── skills/
│   │   ├── build-worker/   # Build skills
│   │   ├── build-chain/
│   │   ├── build-extension/
│   │   ├── build-skill/
│   │   └── task-mode/      # Task execution skills
│   ├── specs/
│   │   ├── worker/         # SPEC.md files
│   │   ├── chain/
│   │   ├── extension/
│   │   ├── skill/
│   │   └── implemented/
│   ├── chains/             # Chain definitions
│   └── prompts/
│       └── frg-orchestrator.md
├── docs/
│   └── pi-inator.md        # This file
└── extensions/
    ├── agent-forge.ts
    ├── agent-team.ts
    └── agent-chain.ts
```

## Success Criteria

A working Pi-inator should:
1. Manager can assign "design X" and get a valid SPEC
2. Planner can forge workers on demand
3. Workers execute tasks without meta-distraction
4. Chains run and cleanup automatically
5. Todo tracks progress across sessions
6. System remains predictable and debuggable

---

*"Build towards it slowly. Power without predictability is dangerous."*