---
name: build-chain
description: Guide for spec'ing a new Pi agent chain workflow
triggers:
  - "build a new chain"
  - "forge a chain"
  - "create chain spec"
tools:
  - read
  - write
  - edit
---

# Build Chain Spec

When spec'ing a chain, you need to define:

## 1. Intentions/Context
- **Purpose**: What workflow does this chain execute?
- **Trigger**: What invokes this chain? (manual, tool call, another agent)
- **Output**: What does the chain produce?
- **Owner**: Who owns this chain?

## 2. Decisions to Articulate
- **Agents**: Which agents in each step?
- **Data flow**: How does output from step N become input to step N+1?
  - Use `$ORIGINAL` for original user request
  - Use `$INPUT` for previous step output
  - Use `$PREV` for chain_stop results
- **Error handling**: What happens if a step fails? Use `chain_stop` with:
  - received: what was asked to check/do
  - did: what checks/actions ran
  - issues: what failed and how to fix
  - status: "blocked" (waiting) or "error" (broke)
- **Branching**: Any conditional paths?
- **Output markers**: Does the chain emit structured output? (`__READY__:{}`)

## 3. Required Files & Locations
```
workers/chains/
└── {name}.yaml        # Chain definition
```

## 4. Chain Format (YAML)

```yaml
{chain-name}:
  description: "{what this chain does}"
  steps:
    - agent: {agent-name-1}
      prompt: |
        [Instructions for first agent - what to do with $ORIGINAL, $INPUT]
        
    - agent: {agent-name-2}
      prompt: |
        [Instructions for second agent - reads $INPUT from previous step]
        Only proceed if {condition}. If not, use chain_stop.
        
        Extract from $INPUT:
        - field1: description
        - field2: description
        
        Do work...
        
        Output result for next step or final output.
```

## 5. Special Markers

- `$ORIGINAL` — original request that triggered the chain
- `$INPUT` — output from previous step (JSON or structured text)
- `$PREV` — result from chain_stop (if previous step stopped)
- `__READY__:{"file":"path","frontend":"url","backend":"url"}__` — ready marker with context
- `chain_stop` — call to halt chain with error/blocked status

## 6. How to Eval
- Happy path test: input X → expected output Y
- Error path test: input that triggers chain_stop
- Partial failure: one step fails, chain handles gracefully

## Output Structure

Create a spec file at `specs/chain/{name}/SPEC.md`:

```markdown
# Chain: {name}

## Intentions
- Purpose: ...
- Trigger: ...
- Owner: ...

## Decisions
- Steps: [ordered list with agents]
- Data flow: ...
- Error handling: ...

## Chain Definition
[Full YAML]

## How to Eval
- Test 1: ...
- Test 2: ...
```

## Chain Discovery

Chains are discovered from:
- `~/.pi/agent/workers/chains/` (user-level)
- Project `.pi/chains/` (project-level)

Chains are invoked via:
- `/chain {name}` command
- `chain_run` tool
- `agent-chain` extension