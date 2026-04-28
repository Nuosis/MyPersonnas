# Task Mode Extension

Persist on tasks until success criteria are met.

## Overview

This extension makes pi work on tasks persistently until they're complete. It:
- Maintains a task queue with FIFO ordering
- Evaluates success via gate files (deterministic) or LLM review
- Runs completion actions when tasks succeed
- Supports parallel task execution

## Task Shape

```typescript
interface Task {
  id: string;
  directory: string;           // Working directory
  description: string;         // What to do
  successCriteria: {
    gateFile?: {               // Deterministic: run file, check exit code
      path: string;
      args?: string[];
      expectExitCode?: number;
      checkStdout?: string;
      checkStderr?: string;
    };
    freeText?: string;         // LLM review: description of success
  };
  completionActions?: Action[]; // Run on success
  parallelWith?: string[];      // Task IDs to run in parallel with
  status: "pending" | "in_progress" | "completed" | "failed";
}
```

## Adding Tasks

### Via CLI (external agent)
```bash
pi /add_task '{"directory": "/path/to/project", "description": "Fix the login bug", "successCriteria": {"freeText": "User can log in with email and password"}}'
```

### Via JSON payload
Paste this directly as a message:
```json
{
  "directory": "/path/to/project",
  "description": "Fix the login bug",
  "successCriteria": {
    "gateFile": {
      "path": "npm test",
      "expectExitCode": 0
    }
  }
}
```

### Via tool
The LLM can call `add_task` tool directly.

## Commands

| Command | Description |
|---------|-------------|
| `/add_task <json>` | Add a task to the queue |
| `/tasks` | List all tasks with status |
| `/task_complete` | Mark current task complete |
| `/task_skip` | Skip current task (reset to pending) |
| `/task_remove <id>` | Remove a task |
| `/clear_tasks` | Clear all tasks |
| `/task_help` | Show help |

## Tools (LLM-callable)

| Tool | Description |
|------|-------------|
| `get_tasks` | List all tasks |
| `get_current_task` | Get task being worked on |
| `add_task` | Add a new task |
| `complete_task` | Mark task complete |
| `skip_task` | Skip current task |
| `remove_task` | Remove a task |
| `update_task_status` | Update task status |
| `reorder_tasks` | Reorder task queue |
| `task_help` | Get help info (useful for external agents) |

## Success Criteria

1. **Gate file (deterministic)**: Path to test file or command
   - Exit code checked (default: 0)
   - Optional stdout pattern check
   - Optional stderr anti-pattern check

2. **Free text (LLM review)**: Description for model to evaluate
   - Model reviews work against criteria
   - Model marks complete when satisfied

## Parallel Execution

Add `parallelWith` array to run tasks simultaneously:

```json
{
  "directory": "/path/to/project",
  "description": "Update dependencies",
  "parallelWith": ["task_abc123", "task_xyz789"]
}
```

All tasks in the parallel set start together and are evaluated together.

## Persistence

Tasks persist within a session (survive reload). New session (`/new`) clears tasks.

## Example Usage

```bash
# Add a task
pi /add_task '{"directory": "/Users/me/repos/api", "description": "Add user authentication", "successCriteria": {"gateFile": {"path": "npm test", "args": ["--grep", "auth"], "expectExitCode": 0}}, "completionActions": [{"type": "bash", "command": "git add -A && git commit -m \"Add auth\"", "description": "Commit changes"}]}'
```

## External Agents

For external LLMs controlling pi:

1. **Get help**: Call the `task_help` tool
2. **Add tasks**: Call the `add_task` tool or use `pi /add_task` CLI
3. **Check status**: Call `get_tasks` or `get_current_task`
4. **Complete tasks**: Call `complete_task` with task ID

Tasks persist in the session - once added, pi will work on them until complete.
