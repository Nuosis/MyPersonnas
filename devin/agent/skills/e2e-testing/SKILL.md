---
name: e2e-testing
description: "E2E test execution - MUST use run_chain"
triggers: "e2e, playwright, e2e tests, playwright tests, run tests, test suite, test runner"
---

# E2E Test Execution - MANDATORY PATTERN

## CRITICAL: You MUST use run_chain for E2E tests

When user mentions "e2e", "playwright", or related triggers:
- DO NOT use direct bash commands like `npx playwright test`
- DO NOT `cd` to directories and run tests directly
- ALWAYS use the `run_chain` tool with the `playwright-run` chain

---

## MODE DETECTION

**First, determine user intent:**

| Mode | Indicators | Response |
|------|-----------|----------|
| **Planning** | "planning", "discussing", "thinking about", "process", "should we", questions about workflow | Scout → present options → allow conversation to continue |
| **Execution** | "run", "execute", "verify tests", "check the suite" | Scout → present options → user steers → execute |

**If uncertain:** Ask once "Are you ready to execute, or discussing/planning?"

---

## REQUIRED WORKFLOW

### Phase 1: Scout (Always First)
Survey the e2e test directory to understand what exists:
- Find all `*.spec.ts` files in `tests/e2e/`
- Count tests per file
- Identify test names/IDs if available
- Report findings to user

### Phase 2: Present & Steer
Present the scout findings:
```
Found N test files:
1. admin-flows.spec.ts (42 tests)
2. pillar-ui-verify.spec.ts (10 tests)
3. participant-flows.spec.ts (28 tests)
...

Which would you like to run? (all, or specific file[s])
```

### Phase 3: Execute (after steering)

**Correct run_chain syntax:**
```
run_chain({ chain: "playwright-run", task: "run tests on <path to spec file>" })
```

**Examples:**
```javascript
// Run a specific spec file
run_chain({ chain: "playwright-run", task: "run tests on tests/e2e/admin-flows.spec.ts" })

// Run a specific test within a file
run_chain({ chain: "playwright-run", task: "run tests on tests/e2e/admin-flows.spec.ts test TC-AUTH-001" })
```

**Multiple files or tests:**
```
add_task playwright-run "run tests on tests/e2e/admin-flows.spec.ts"
add_task playwright-run "run tests on tests/e2e/pillar-ui-verify.spec.ts"
# Use task mode for parallel execution
```

---

## run_chain SYNTAX

```
run_chain({ chain: "playwright-run", task: "description" })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `chain` | string | Must be `"playwright-run"` |
| `task` | string | Description of what to run |

**The chain is scoped to ONE file or ONE test.**  
For multiple, use task mode with `add_task`.

---

## TASK MODE FOR MULTIPLE

When user wants to run multiple test files:

```
add_task playwright-run "run tests on tests/e2e/admin-flows.spec.ts"
add_task playwright-run "run tests on tests/e2e/pillar-ui-verify.spec.ts"
# Execute all tasks in parallel via task mode
```

**Do NOT try to pass multiple files to one chain invocation.**

---

## IF CHAIN FAILS

1. Report the error
2. Document what chain/task failed on
3. You may then fall back to direct commands IF user approves
4. Report the failure clearly

---

## ANTI-PATTERNS (NEVER DO)

```bash
# WRONG - bypasses chain
cd nextjs-frontend && npx playwright test

# WRONG - runs everything, no steering
npx playwright test

# WRONG - trying to pass multiple files to one chain
run_chain({ chain: "playwright-run", task: "run tests on file1.ts file2.ts" })

# WRONG - wrong chain name
run_chain({ chain: "playwright", task: "..." })  # Use "playwright-run"
```

---

## CORRECT PATTERNS

```javascript
// Single file via chain
run_chain({ chain: "playwright-run", task: "run tests on tests/e2e/admin-flows.spec.ts" })

// Single test via chain
run_chain({ chain: "playwright-run", task: "run tests on tests/e2e/admin-flows.spec.ts test TC-AUTH-001" })

// Multiple via task mode
add_task playwright-run "run tests on tests/e2e/admin-flows.spec.ts"
add_task playwright-run "run tests on tests/e2e/manager-flows.spec.ts"
```

---

## STEERING EXAMPLE

```
User: we're running the e2e test suite

Agent: [mode detected: execution]
  → Scout: find test files in tests/e2e/
  → Present: "Found 6 spec files with 138 tests total"
  → "Which would you like to run? (all, or specific file)"

User: just the pillar-ui-verify suite

Agent: run_chain({ chain: "playwright-run", task: "run tests on tests/e2e/pillar-ui-verify.spec.ts" })
  → Chain executes
  → Report results
```
