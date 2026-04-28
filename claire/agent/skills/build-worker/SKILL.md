---
name: build-worker
description: Guide for spec'ing a new Pi worker agent for task execution
triggers:
  - "build a worker"
  - "forge a worker"
  - "create worker spec"
  - "build task agent"
tools:
  - read
  - write
  - edit
---

# Build Worker Spec

When spec'ing a task-execution worker, you need to define:

## 1. Intentions/Context
- **Purpose**: What specific task does this worker execute?
- **Trigger**: How does work arrive? (queue, tool call, chain step, team dispatch)
- **Owner**: Who owns/maintains this worker?
- **Parent**: Does it belong to a team or chain?

## 2. Decisions to Articulate
- **Task scope**: Single responsibility, bounded task
- **Tools**: What does it need? (read, write, bash, grep, etc.)
- **Input format**: How does work arrive?
  - From queue (read tasks.md)
  - From tool call params
  - From chain step $INPUT
  - From team dispatch
- **Output format**: What does it produce?
  - Structured results for next step
  - Verification test output
  - Commit messages
- **Error handling**: How does it report failures?
- **Collaboration**: Does it interact with other workers?

## 3. Required Files & Locations
```
workers/
└── {name}.md          # Worker definition file
```

## 4. Worker Definition Format

```markdown
---
name: {worker-name}
description: {one-line description}
tools: {comma-separated tools}
model: {optional provider/model}
---

# {Worker Name}

[System prompt defining the worker's role, task interface, and behavior]

## Task Interface
- Input: How work arrives (queue format, tool params, chain input)
- Output: Structured result format
- Error handling: How failures are reported

## Workflow
[Step-by-step instructions for executing tasks]

## Output Format
[If the worker produces structured output for next step]
```

## 5. How to Eval
- Task completion tests
- Verification test success/failure
- Error handling tests
- Output format validation

## Output Structure

Create a spec file at `specs/worker/{name}/SPEC.md`:

```markdown
# Worker: {name}

## Intentions
- Purpose: ...
- Trigger: ...
- Owner: ...
- Parent: ...

## Task Interface
- Input format: ...
- Output format: ...

## Tools
- [list]

## Workflow
[Steps to execute]

## Collaboration
- Team/chain it belongs to: ...
- Other workers it interacts with: ...

## How to Eval
- Test 1: ...
- Test 2: ...

## Files
- `workers/{name}.md`
```

## Worker Discovery

Workers are discovered from:
- `~/.pi/agent/workers/` (user-level)
- Project `.pi/workers/` (project-level)

Workers are invoked via:
- `subagent` tool
- Chain step agents
- Team dispatch
- `BackgroundTaskManager`