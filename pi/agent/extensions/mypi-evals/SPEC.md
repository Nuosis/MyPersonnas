# MyPI Evals Extension

## Overview

Run agent evals using scenarios with extensible scoring. The harness loads scenario artifacts, executes the agent/chain/prompt under test, and scores outcomes against defined evals.

## Core Concepts

### Scenario
An artifact + conditions that recreates a specific situation to test.

```
scenarios/
├── auth-flows/
│   ├── scenario.yaml          # Scenario definition
│   ├── artifacts/            # Files, mocks, fixtures
│   ├── conditions/           # Env vars, setup scripts
│   └── evals/                # Outcome definitions
│
├── code-gen/
└── planning/
```

### Scenario Definition (scenario.yaml)
```yaml
name: "auth-flows"
description: "Authentication flow test suite"
version: "1.0"

artifacts:
  files:
    - path: "app/auth/login.ts"
      content: "..."
  mocks:
    - endpoint: "/auth/login"
      response: { status: 200, body: { token: "test" } }

conditions:
  env:
    API_BASE_URL: "http://localhost:8080"
  setup:
    - command: "npm run seed-test-users"

harness:
  type: "chain"              # chain | agent | prompt | tool | command
  target: "playwright-run"
  params:
    file: "tests/e2e/auth-flows.spec.ts"

evals:
  - id: "TC-AUTH-001"
    name: "Valid credentials login"
    type: "boolean"          # boolean | likert | formula
    expected:
      tool: "curl"
      path: "/auth/login"
      method: "POST"
    assertions:
      - check: "response.status"
        equals: 200
      - check: "response.body.token"
        exists: true

  - id: "TC-AUTH-002"
    name: "Invalid credentials rejected"
    type: "likert"
    scale: [0, 1, 2, 3]
    description: "How well the system rejects bad creds"
    assertions:
      - check: "response.status"
        in: [401, 403]
```

### Eval Types

| Type | Description | Example |
|------|-------------|---------|
| `boolean` | Pass/fail | `assert(response.status == 401)` |
| `likert` | Scale rating | `0=broken, 3=perfect` |
| `formula` | Computed score | `score = matches / total * 100` |

### Harness Types

| Type | Description |
|------|-------------|
| `chain` | Run a chain via `run_chain` |
| `agent` | Spawn subagent with prompt |
| `prompt` | Direct prompt evaluation |
| `tool` | Test single tool in isolation |
| `command` | Run slash command |

## Architecture

```
mypi-evals/
├── index.ts              # Extension entry point, registers commands
├── harness/
│   ├── runner.ts         # Scenario runner
│   ├── executor.ts       # Agent/chain execution
│   └── scorer.ts         # Outcome evaluation
├── ui/
│   ├── widget.ts         # Live progress widget
│   ├── reporter.ts       # Report generation
│   └── dialogs.ts        # Interactive dialogs
├── storage/
│   ├── results.ts        # Result persistence
│   └── history.ts        # Historical comparison
└── scenarios/
    └── ...               # Scenario definitions
```

## Commands

| Command | Description |
|---------|-------------|
| `/eval <scenario>` | Run single scenario |
| `/eval-all <suite>` | Run full eval suite |
| `/eval-list` | List available scenarios |
| `/eval-report` | View results report |
| `/eval-diff` | Compare with previous run |

## UI Components

### Widget: Live Eval Progress
```
┌─ EVAL: auth-flows ──────────────────────── 2/10 (20%) ─┐
│ ○ TC-AUTH-001  ✓ PASS                               │
│ ● TC-AUTH-002  ⟳ running...                      12s │
│ ○ TC-AUTH-003  ● pending                            │
│ ○ TC-AUTH-004  ● pending                            │
└──────────────────────────────────────────────────────┘
```

### Widget: Current Output Stream
```
Agent: Validating credentials...
Tool: curl -X POST http://localhost:8080/auth/login
  → 200 OK (145ms)
  
Checking assertions...
  ✓ response.status == 200
  ✓ response.body.token exists
```

### Report Dialog
```
# Eval Results: auth-flows

## Summary
| Metric        | Value  |
|--------------|--------|
| Total        | 10     |
| Passed       | 8      |
| Failed       | 2      |
| Score        | 80%    |

## Failed (2)

### TC-AUTH-003: Invalid creds not blocked
- Expected: 401
- Got: 200
- Severity: HIGH

### TC-AUTH-007: Password reset broken
- Expected: email sent
- Got: timeout
- Severity: MEDIUM

[View Details] [Re-run Failed] [Export] [Dismiss]
```

## Result Format

```json
{
  "suite": "auth-flows",
  "runId": "run-2026-04-25-143022",
  "timestamp": "2026-04-25T14:30:22Z",
  "duration": 45200,
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 2,
    "score": 0.8
  },
  "scenarios": [
    {
      "id": "TC-AUTH-001",
      "name": "Valid credentials login",
      "status": "passed",
      "duration": 1203,
      "score": 1.0,
      "details": {
        "toolCalls": [...],
        "assertions": [
          { "check": "response.status", "expected": 200, "actual": 200, "passed": true },
          ...
        ]
      }
    }
  ],
  "artifacts": {
    "traces": "evals/results/run-xxx/traces/",
    "screenshots": "evals/results/run-xxx/screenshots/"
  }
}
```

## Storage

Results stored in:
```
evals/
├── results/
│   ├── run-2026-04-25-143022.json
│   └── run-2026-04-25-150045.json
├── history/
│   └── auth-flows/
│       ├── latest.json        # Symlink to most recent
│       └── timeline.json      # All runs over time
└── scenarios/
```

## Extensibility

### Custom Scorers
Register external scoring packages:

```typescript
pi.evals.registerScorer("lm-evals", {
  command: "python -m lm_evals.scorer",
  inputFormat: "json",
  outputFormat: "json"
});
```

### Custom Harnesses
```typescript
pi.evals.registerHarness("playwright", {
  execute: async (scenario, ctx) => {
    // Playwright-specific execution
  }
});
```

## Integration Points

- **Task Mode:** Evals can use task-mode for parallel scenario runs
- **Agent Chain:** Harness can invoke chains as test targets
- **Subagent:** Evals use subagent for complex scoring
- **Storage:** Results integrate with session storage
