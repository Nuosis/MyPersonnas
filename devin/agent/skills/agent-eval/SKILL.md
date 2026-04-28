---
name: agent-eval
description: Run and write evals for agentic systems. Use when user mentions eval, evaluation, test agent, benchmark, or writing test cases.
---

# Agent Eval Skill

Use this skill when the user mentions **eval**, **evaluation**, **test agent**, **benchmark**, or similar. This skill explains how to run and write evals for agentic systems.

> **Context:** Evals are part of the agent creation workflow described in `docs/HOW_TO_BAKE_YOUR_PI.md`. The full flow: contract → objectives → scenarios → evals. For the earlier stages, use `/skill bake-pi`. This skill handles the eval-writing phase.

## Tool Suite

The eval system provides these LLM-callable tools:

| Tool | Purpose |
|------|---------|
| `eval_list_scenarios` | List available eval scenarios |
| `eval_run` | Run one or more scenarios |
| `eval_report` | Generate a results report |
| `eval_diff` | Compare results between runs |
| `eval_write_scenario` | Create a new scenario |
| `eval_write_eval` | Add evals to an existing scenario |
| `eval_review` | Review evals before running (REQUIRED GATE) |

---

## Where Evals Fit

```
Agent Design Flow (HOW_TO_BAKE):
1. Define objectives     → what the agent must achieve
2. Define scenarios       → situations that test those objectives
3. Write evals           → outcomes that validate scenarios
4. Review evals          → eval_review tool (REQUIRED GATE)
5. Run evals            → agent-eval tools

This skill handles: Step 3 (write) and Step 5 (run)
```

Evals validate that the agent performs as designed. They test the scenarios defined during agent design, not independently invented tests.

---

## Running Evals

### REQUIRED GATE: eval_review First

**Call eval_review EXACTLY ONCE per eval review session. Do not re-call after making changes.**

The eval_review tool must be the FIRST tool call, before any other action:

```javascript
// Review a scenario - MUST be called ONLY ONCE
eval_review({ scenario: "personality-dimensions" })
```

**Workflow:**

1. Call `eval_review({ scenario: "..." })` — FIRST and ONLY call
2. If **APPROVED** → eval is ready to run
3. If **NEEDS_WORK** → report the issues to the user, do NOT re-run eval_review yourself
4. If **FRAMEWORK_GAP** → flag for framework review, do NOT re-run

**DO NOT re-call eval_review after making changes.** This creates a review loop that never ends.

If you made changes based on NEEDS_WORK feedback, report to the user instead: "I've made the following changes based on the review feedback. The eval is now ready for you to run `eval_review` again if you'd like me to re-check."

**Wrong order (do NOT do this):**
1. Call eval_review → get NEEDS_WORK
2. Make changes
3. Call eval_review again ← THIS CREATES A LOOP

**Correct order:**
1. Call `eval_review({ scenario: "..." })` — FIRST and ONLY
2. Report status and issues to user
3. Wait for user to ask you to re-review

**Output:**
```markdown
# Eval Review: {scenario_name}

## Status
{APPROVED | NEEDS_WORK | FRAMEWORK_GAP}

## Issues (must fix before running)
{...}

## Suggestions (optional)
{...}
```

**Only run evals if status is APPROVED.**

### Interactive: Scenario Selector

```
/skill agent-eval

This opens the scenario picker where you can:
- Browse scenarios by suite
- Select individual tests to run
- Filter by tag (e.g., "auth", "code-gen")
- Preview scenario before running
```

**Prompt the user:**
```
Which evals would you like to run?
- All scenarios in a suite
- Specific scenario by ID
- Tagged subset (e.g., "regression")
```

### Direct Run

For programmatic use:

```javascript
// Run single scenario
eval_run({ scenario: "auth-flows/TC-AUTH-001" })

// Run multiple
eval_run({ scenario: "auth-flows/TC-AUTH-*", parallel: true })

// Run full suite
eval_run({ suite: "auth-flows" })

// Run with custom params
eval_run({ scenario: "planning/simple-task", params: { model: "claude-opus" } })
```

---

## Writing Evals

### First: Ensure Contract Clarity

Before writing evals, the agent's contract must be clear. If it's not, help define it first.

**The contract question:**
> When a user does **X**, the agent should **Y**.

- **X** = the input, trigger, or situation that activates the agent
- **Y** = the expected behavior, output, or effect

**If the user says "write an eval for X" and X is vague:**
1. Ask: "What is the scenario that should trigger this eval?"
2. Clarify: "What input causes the agent to act? What should it do?"
3. If no contract exists, either:
   - Point to bake-pi skill: `/skill bake-pi` (full flow: contract → objectives → scenarios → evals)
   - Or help draft a minimal contract inline

**Minimal contract for eval writing:**
```
Trigger (X): When the user [specific input or situation]
Effect (Y): The agent should [specific behavior or output]
```

Without this mapping, evals lack clear pass/fail criteria.


### Second: Link to Agent Design

When the contract is clear, connect evals to the larger agent design:

1. **Reference the agent contract** — what objectives is this eval validating?
2. **Tie to scenarios** — which scenario(s) does this eval test?
3. **Define assertions** — what specific behaviors prove success?

See `docs/HOW_TO_BAKE_YOUR_PI.md` for the full agent design flow.

---

### When User Says: "write an eval for X"

The user wants a new eval for a specific feature, chain, or behavior. Guide the agent:

1. **Identify the scope**
   - What agent/chain/tool is under test?
   - What inputs should be tested?
   - What outputs constitute success?

2. **Link to agent design**
   - Which objective from the agent contract does this eval validate?
   - Which scenario(s) does it test?

3. **Create scenario structure**
   ```
   evals/scenarios/<suite>/
   ├── scenario.yaml      # Definition
   ├── artifacts/        # Test files, fixtures
   └── evals/           # Outcome definitions
   ```

4. **Define the harness**
   - What runs the test? (chain, agent, prompt, tool)
   - What params are passed?
   - What setup is needed?

5. **Write the evals**
   - Boolean: pass/fail assertions
   - Likert: scale-based assessment
   - Formula: computed scoring

6. **Register in suite**
   - Add to scenario.yaml
   - Tag appropriately

### Example: Writing an Eval for flow-doc Chain

**User says:** "We need to write an eval to test the flow-doc chain"

**Your response (guided by this skill):**

1. First, understand what flow-doc does (from agent contract)
2. Identify test cases tied to scenarios:
   - Happy path: scan → write → test → review
   - Edge: empty codebase
   - Edge: missing docs directory
   - Regression: existing docs not overwritten

3. Create scenario:
   ```bash
   mkdir -p evals/scenarios/flow-doc/
   # Create scenario.yaml with harness targeting flow-doc chain
   ```

4. Write eval definitions in evals/ subdir or inline

5. **Run eval_review to validate** before running

6. Register and run

**Key questions to answer:**
- What is the input? (repo path, scope filter)
- What is the expected output? (docs created, correct content)
- How do we score it? (file exists, content matches, structure correct)

---

## Scenario Format

```yaml
name: "flow-doc"
description: "flow-doc chain evaluation suite"
version: "1.0"

harness:
  type: "chain"
  target: "flow-doc"
  params:
    scope: "newhire endpoints"

evals:
  - id: "FLOW-DOC-001"
    name: "Creates component index"
    description: "flow-doc should create docs/flows/component-index.md"
    type: "boolean"
    assertions:
      - check: "file_exists"
        path: "docs/flows/component-index.md"
      - check: "file_contains"
        pattern: "## Flows"

  - id: "FLOW-DOC-002"
    name: "Documents core flows"
    type: "likert"
    scale: [0, 1, 2, 3]
    description: "Coverage of core business flows"
    assertions:
      - check: "flow_count"
        min: 5
      - check: "mermaid_diagrams"
        min: 3
```

---

## Eval Types

| Type | Use When | Score |
|------|----------|-------|
| `boolean` | Definite pass/fail | 0 or 1 |
| `likert` | Graded quality | 0-3 scale |
| `formula` | Computed metric | `matches/total * 100` |

---

## Reporting

### Generate Report

```javascript
eval_report({ 
  suite: "flow-doc",
  format: "terminal"  // terminal | html | json
})
```

### Diff Runs

```javascript
eval_diff({
  runA: "run-2026-04-25-143022",
  runB: "run-2026-04-25-150045"
})
```

### Key Metrics

- **Score:** Overall pass rate (0-1)
- **Severity:** Impact of failures
- **Trend:** Improvement/degradation over time
- **Coverage:** What % of scenarios tested

---

## Tips

- **Parallel runs:** Use `parallel: true` for faster suites
- **Scoped testing:** Limit scope for faster feedback during dev
- **Regression only:** Tag scenarios for quick regression runs
- **Custom params:** Override harness params per-run for experimentation
- **Tie to objectives:** Each eval should validate a specific objective from the agent contract
- **Always review first:** Use `eval_review` before running new or modified evals

---

## Triggers

This skill triggers on: `eval`, `evaluation`, **test agent**, **benchmark**, **run evals**, **write eval**, **create test case**, **review eval**

---

## Complete Skill Flow

```
/skill bake-pi     → Design new agents
      ↓
/skill extra-pi    → Extend with capability + evals
      ↓
eval_review         → Validate evals (REQUIRED GATE)
      ↓
/skill agent-eval  → Run evals
```

See `@~/.pi/agent/agents/eval-reviewer.md` for full review criteria.
