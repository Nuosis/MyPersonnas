# Agent Eval Tools

LLM-callable tools for running and writing evals.

## Tool Definitions

### eval_list_scenarios

```typescript
{
  name: "eval_list_scenarios",
  description: "List available eval scenarios by suite",
  parameters: Type.Object({
    suite: Type.Optional(Type.String()),
    tag: Type.Optional(Type.String()),
    format: Type.Optional(Type.Union([Type.Literal("brief"), Type.Literal("full")]))
  })
}
```

**Output:**
```json
{
  "suites": ["auth-flows", "flow-doc", "code-gen"],
  "scenarios": [
    { "id": "auth-flows/TC-AUTH-001", "name": "...", "tags": ["auth", "regression"] },
    ...
  ]
}
```

---

### eval_run

```typescript
{
  name: "eval_run",
  description: "Run one or more eval scenarios",
  parameters: Type.Object({
    scenario: Type.Optional(Type.String()),      // Single or glob pattern
    suite: Type.Optional(Type.String()),        // Full suite
    tags: Type.Optional(Type.Array(Type.String())),
    parallel: Type.Optional(Type.Boolean()),   // Default: false
    params: Type.Optional(Type.Record(Type.String(), Type.Any()))
  })
}
```

**Output:**
```json
{
  "runId": "run-2026-04-25-143022",
  "status": "completed",
  "summary": { "total": 10, "passed": 8, "failed": 2, "score": 0.8 },
  "scenarios": [...]
}
```

---

### eval_report

```typescript
{
  name: "eval_report",
  description: "Generate eval results report",
  parameters: Type.Object({
    runId: Type.Optional(Type.String()),
    suite: Type.Optional(Type.String()),
    format: Type.Optional(Type.Union([Type.Literal("terminal"), Type.Literal("html"), Type.Literal("json")])),
    failedOnly: Type.Optional(Type.Boolean())
  })
}
```

**Output:** Formatted report based on format parameter.

---

### eval_diff

```typescript
{
  name: "eval_diff",
  description: "Compare results between two eval runs",
  parameters: Type.Object({
    runA: Type.String(),
    runB: Type.String()
  })
}
```

**Output:**
```json
{
  "comparing": { "A": "run-...", "B": "run-..." },
  "changes": {
    "TC-AUTH-001": { "before": "pass", "after": "fail" },
    ...
  },
  "summary": { "improved": 2, "regressed": 1, "stable": 7 }
}
```

---

### eval_write_scenario

```typescript
{
  name: "eval_write_scenario",
  description: "Create a new eval scenario",
  parameters: Type.Object({
    suite: Type.String(),
    name: Type.String(),
    description: Type.String(),
    harness: Type.Object({
      type: Type.Union([Type.Literal("chain"), Type.Literal("agent"), Type.Literal("prompt"), Type.Literal("tool")]),
      target: Type.String(),
      params: Type.Optional(Type.Record(Type.String(), Type.Any()))
    }),
    artifacts: Type.Optional(Type.Array(Type.Object({
      path: Type.String(),
      content: Type.String()
    }))),
    conditions: Type.Optional(Type.Object({
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
      setup: Type.Optional(Type.Array(Type.String()))
    }))
  })
}
```

---

### eval_write_eval

```typescript
{
  name: "eval_write_eval",
  description: "Add evals to an existing scenario",
  parameters: Type.Object({
    scenario: Type.String(),  // e.g., "auth-flows"
    evals: Type.Array(Type.Object({
      id: Type.String(),
      name: Type.String(),
      type: Type.Union([Type.Literal("boolean"), Type.Literal("likert"), Type.Literal("formula")]),
      description: Type.Optional(Type.String()),
      assertions: Type.Array(Type.Any())
    }))
  })
}
```

---

## Implementation Notes

### Tool Registration

These tools would be registered by an extension:

```typescript
// In mypi-evals extension
pi.registerTool({
  name: "eval_run",
  parameters: evalRunParams,
  execute: async (toolCallId, params, signal, onUpdate, ctx) => {
    // Load scenario, run harness, score, persist
  }
});
```

### Session Context

Tools should have access to:
- `ctx.cwd` — working directory
- `ctx.model` — current model (for scoring)
- `ctx.ui` — for progress updates

### Persistence

Results stored as JSONL files:
```
evals/results/
├── run-2026-04-25-143022.jsonl
└── ...
```

### UI Integration

During eval_run:
- Update status bar: "Running evals: 3/10"
- Widget shows live progress
- Notify on completion

---

## Extensibility Points

| Point | What | How |
|-------|------|-----|
| Custom scorer | External scoring package | Register via config |
| Custom harness | New execution types | Register via extension |
| Custom format | Report formats | Extensible reporters |

---

## TODO

- [ ] Implement eval extension (mypi-evals)
- [ ] Register tools
- [ ] Wire to UI widget
- [ ] Add storage layer
- [ ] Create first scenario (flow-doc?)
