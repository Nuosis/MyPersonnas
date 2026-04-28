---
name: extra-pi
description: Extend established Pi capabilities with built-in evaluation. Use when adding new agent features, tools, commands, or skills that need evals.
---

# Extra Pi - Capability Extension with Evaluation

Use this skill when **extending an established agent's capabilities** in a way that can be evaluated.

## Core Concept

**Build evals BEFORE you build the feature.**

This is TDD for agents:
1. Define what "done" looks like (X→Y contract)
2. Write the eval that proves it
3. **Review evals with eval-reviewer (REQUIRED GATE)**
4. Build the capability
5. Run the eval
6. Verify

If you don't know how you'll evaluate it, you don't know what "done" means.

## When to Use

This skill triggers when the user wants to:
- Add a new capability to an agent
- Create a new skill, extension, tool, or command
- Extend an existing tool or command
- Write tests for agent behavior
- Benchmark agent performance
- Evaluate a specific feature

**NOT for:** Creating new agents from scratch (use `/skill bake-pi` for that)

## Trigger Phrases

- "add capability"
- "extend agent"
- "add feature"
- "write eval for"
- "write test for"
- "benchmark"
- "evaluate agent"
- "test capability"
- "eval this"
- "add to the agent"

## Process

### 1. Define the Capability Contract

Before writing any code, define:

> When a user does **X**, the agent should **Y**.

- **X** = the input, trigger, situation
- **Y** = expected behavior, output, effect

**If unclear, ask:**
- "What input triggers this capability?"
- "What should the agent do in response?"
- "What does success look like?"

### 2. Write Evals First (TDD for Agents)

Write the eval BEFORE implementing:

```yaml
# evals/scenarios/<capability>/
- id: "CAP-001"
  name: "Descriptive name of expected behavior"
  type: "boolean"  # or "likert", "formula"
  assertions:
    - check: "output.contains"
      equals: "expected result"
```

**Why evals first:**
- Forces clear success criteria
- Prevents scope creep
- Provides regression protection
- Makes "done" measurable

### 3. Review Evals with eval-reviewer Agent (REQUIRED GATE)

**After writing evals, run the eval-reviewer agent to validate:**

- **Format conformity** — assertions match supported types
- **X→Y clarity** — contract is explicit, pass/fail is clear
- **Internal validity** — same condition → consistent results
- **External validity** — different conditions → detectible differences
- **Controls** — baseline properly controlled
- **Reliability** — results will replicate

**Required gate:**
```
eval_review({ scenario: "<capability>" })
```

Use eval-reviewer agent:
1. Read the scenario.yaml and eval files
2. Check against review criteria
3. Output: APPROVED | NEEDS_WORK | FRAMEWORK_GAP

Only proceed if **APPROVED**:
- **NEEDS_WORK** → fix evals first, re-review
- **FRAMEWORK_GAP** → flag for bake-pi/extra-pi framework review

### 4. Implement the Capability

Build the feature to pass the eval:
- Extension, tool, command, or skill
- Keep scope tight
- Follow existing patterns

### 5. Run Evals

```javascript
eval_run({ scenario: "<capability>/<eval-id>" })
```

### 6. Verify and Iterate

- If eval passes → done
- If eval fails → fix implementation, not the eval
- If eval was wrong → fix eval, then implementation

## Connection to Other Skills

```
/skill bake-pi     → Design new agents (contract, objectives, patterns)
/skill extra-pi    → Extend existing agents (capability + evals)
/skill agent-eval  → Run and manage evals
eval-reviewer      → Validate evals (REQUIRED GATE after writing)
```

**Flow:**
1. `/make devin` → `/init` → create persona
2. `/skill bake-pi` → define what Devin should be
3. Build Devin
4. Later: `/skill extra-pi` → add capability with evals
5. **eval-reviewer** → validate evals (REQUIRED GATE)
6. `/skill agent-eval` → run evals to verify

## Example

**User says:** "Add a capability to delete files with confirmation"

**Your response (guided by this skill):**

1. **Clarify contract:**
   - X: User asks to delete a file
   - Y: Agent should confirm before deleting, then delete

2. **Write evals first:**
   ```yaml
   - id: "DELETE-001"
     name: "Requests confirmation before delete"
     type: "boolean"
     assertions:
       - check: "output.contains"
         pattern: "Are you sure"
   
   - id: "DELETE-002"
     name: "Does not delete without confirmation"
     type: "boolean"
     assertions:
       - check: "tool_called"
         equals: false
   ```

3. **Run eval-reviewer agent** (REQUIRED GATE)

4. **Implement the capability** (confirm tool, extension)

5. **Run evals**
   ```
   eval_run({ scenario: "delete-confirm/DELETE-001" })
   ```

## Anti-Patterns

- **Eval-free capability:** "I'll write the feature first, add tests later" → skip
- **Skip eval-review:** "evals look fine, let's run them" → eval-reviewer is REQUIRED
- **Vague success:** "It should work well" → define X→Y
- **Scope creep:** Adding features beyond the eval scope
- **Eval gaming:** Weakening eval to make implementation pass

## Skill Frontmatter Requirements

When writing skills, the header is required:

```yaml
---
name: skill-name           # lowercase, hyphenated
description: One line describing when this skill triggers and what it does.
---
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | lowercase, hyphenated, no spaces |
| `description` | Yes | triggers + purpose in one line |

**Example:**
```yaml
---
name: my-capability
description: Use when user mentions X. Handles Y workflow.
---
```

## Reference Docs

- Eval tools: `@~/.pi/agent/skills/agent-eval/TOOLS.md`
- Eval extension: `@~/.pi/agent/extensions/mypi-evals/`
- HOW_TO_BAKE: `@~/.pi/docs/HOW_TO_BAKE_YOUR_PI.md`
