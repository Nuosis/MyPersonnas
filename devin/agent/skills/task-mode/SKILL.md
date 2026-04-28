---
name: task-mode
description: Persist on tasks until success criteria are met
---

# Task Mode Skill

Use task mode to persist on tasks until they're complete.

## Quick Start

To add tasks and have me work on them:

```
/skill task-mode

Add these tasks:
1. directory: /path/to/project
   description: What to do
   successCriteria: Free text description of what "done" looks like

2. directory: /path/to/project
   description: Another task
   successCriteria: gateFile = "npm test"  (command that must exit 0)
```

## Task Shape

```json
{
  "directory": "/path/to/project",
  "description": "What to do",
  "successCriteria": {
    "gateFile": { "path": "npm test", "expectExitCode": 0 },
    "freeText": "Description of success"
  }
}
```

**gateFile** — Run a command. Task succeeds if exit code is 0.
**freeText** — Describe success. I evaluate against this.

## Example

```
Add this task:
- directory: /Users/me/repos/api
- description: Fix the login bug
- successCriteria: User can log in with email and password
```

I'll work on it until the criteria is met, then report completion.
