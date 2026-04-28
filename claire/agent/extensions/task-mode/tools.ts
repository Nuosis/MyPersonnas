// Task Mode Extension - Tools
// LLM-callable tools for task management

import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Task, TaskPayload, TASK_ENTRY_TYPE } from "./types";
import { createExecutor } from "./executor";

export interface ToolsOptions {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  getTasks: () => Task[];
  setTasks: (tasks: Task[]) => void;
  onTasksChanged: () => void;
  onTaskAdded: (task: Task) => void;
  onStartTask?: (task: Task) => void; // Callback to start task mode
}

interface SessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
  id: string;
  timestamp: number;
}

/**
 * Get all tasks from session entries
 */
export function loadTasksFromSession(ctx: ExtensionContext): Task[] {
  const tasks: Task[] = [];
  // Use getBranch() for current branch only (handles forking correctly)
  const entries = ctx.sessionManager.getBranch();
  
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const e = entry as SessionEntry;
    if (e.customType === TASK_ENTRY_TYPE && e.data) {
      try {
        const task = e.data as Task;
        // Validate task structure
        if (task.id && task.description && task.directory) {
          tasks.push(task);
        }
      } catch {
        // Skip invalid entries
      }
    }
  }
  
  return tasks;
}

/**
 * Persist tasks to session
 */
export function saveTasksToSession(pi: ExtensionAPI, tasks: Task[]): void {
  for (const task of tasks) {
    pi.appendEntry(TASK_ENTRY_TYPE, task);
  }
}

/**
 * Add a new task
 */
export function addTask(
  payload: TaskPayload,
  existingTasks: Task[],
  onTaskAdded?: (task: Task) => void
): Task {
  const task: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    directory: payload.directory,
    description: payload.description,
    successCriteria: payload.successCriteria,
    completionActions: payload.completionActions,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parallelWith: payload.parallelWith,
  };
  
  // Notify (for persistence)
  onTaskAdded?.(task);
  
  return task;
}

/**
 * Register all task-mode tools with the extension
 */
export function registerTools(options: ToolsOptions): void {
  const { pi, getTasks, setTasks, onTasksChanged } = options;

  // Tool: get_tasks - List all tasks
  pi.registerTool({
    name: "get_tasks",
    label: "Get Tasks",
    description: "List all tasks in the task queue with their current status",
    parameters: Type.Object({}),
    async execute() {
      const tasks = getTasks();
      
      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: "No tasks in queue." }],
          details: { tasks: [] },
        };
      }

      const formatted = tasks.map(t => {
        const statusIcon = {
          pending: "⏳",
          in_progress: "🔄",
          completed: "✅",
          failed: "❌",
        }[t.status];
        
        return `${statusIcon} [${t.status}] ${t.id}\n` +
          `  Directory: ${t.directory}\n` +
          `  Description: ${t.description.slice(0, 100)}${t.description.length > 100 ? "..." : ""}\n` +
          `  Created: ${new Date(t.createdAt).toISOString()}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `Tasks (${tasks.length}):\n\n${formatted}` }],
        details: { tasks },
      };
    },
  });

  // Tool: get_current_task - Get the task being worked on
  pi.registerTool({
    name: "get_current_task",
    label: "Get Current Task",
    description: "Get the task currently being worked on",
    parameters: Type.Object({}),
    async execute() {
      const tasks = getTasks();
      const current = tasks.find(t => t.status === "in_progress");
      
      if (!current) {
        return {
          content: [{ type: "text", text: "No task currently in progress." }],
          details: { currentTask: null },
        };
      }

      return {
        content: [{ type: "text", text: `Current task:\n\n` +
          `ID: ${current.id}\n` +
          `Status: ${current.status}\n` +
          `Directory: ${current.directory}\n` +
          `Description: ${current.description}\n` +
          `Success Criteria: ${JSON.stringify(current.successCriteria, null, 2)}\n` +
          `Created: ${new Date(current.createdAt).toISOString()}\n` +
          `Last Attempt: ${current.lastAttempt ? new Date(current.lastAttempt.timestamp).toISOString() : "none"}`
        }],
        details: { currentTask: current },
      };
    },
  });

  // Tool: update_task_status - Manually update task status
  pi.registerTool({
    name: "update_task_status",
    label: "Update Task Status",
    description: "Manually update the status of a task",
    parameters: Type.Object({
      taskId: Type.String({ description: "ID of the task to update" }),
      status: Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("completed"),
        Type.Literal("failed"),
      ], { description: "New status for the task" }),
      report: Type.Optional(Type.String({ description: "Optional report about this update" })),
    }),
    async execute(_toolCallId, params) {
      const tasks = getTasks();
      const taskIndex = tasks.findIndex(t => t.id === params.taskId);
      
      if (taskIndex === -1) {
        return {
          content: [{ type: "text", text: `Task not found: ${params.taskId}` }],
          details: { error: "Task not found" },
          isError: true,
        };
      }

      tasks[taskIndex].status = params.status;
      tasks[taskIndex].updatedAt = Date.now();
      tasks[taskIndex].lastAttempt = {
        timestamp: Date.now(),
        result: params.status === "completed" ? "success" : params.status === "failed" ? "failure" : "review_pending",
        report: params.report,
      };
      
      setTasks(tasks);
      onTasksChanged();
      
      return {
        content: [{ type: "text", text: `Task ${params.taskId} updated to status: ${params.status}` }],
        details: { task: tasks[taskIndex] },
      };
    },
  });

  // Tool: complete_task - Mark task as complete and run completion actions
  pi.registerTool({
    name: "complete_task",
    label: "Complete Task",
    description: "Mark a task as completed and optionally run completion actions",
    parameters: Type.Object({
      taskId: Type.String({ description: "ID of the task to complete" }),
      report: Type.Optional(Type.String({ description: "Report on what was accomplished" })),
      runActions: Type.Optional(Type.Boolean({ description: "Whether to run completion actions (default: true)" })),
    }),
    async execute(_toolCallId, params) {
      const tasks = getTasks();
      const taskIndex = tasks.findIndex(t => t.id === params.taskId);
      
      if (taskIndex === -1) {
        return {
          content: [{ type: "text", text: `Task not found: ${params.taskId}` }],
          details: { error: "Task not found" },
          isError: true,
        };
      }

      const task = tasks[taskIndex];
      const shouldRunActions = params.runActions !== false;
      
      // Run completion actions if specified
      let actionResults = undefined;
      if (shouldRunActions && task.completionActions && task.completionActions.length > 0) {
        const executor = createExecutor({ pi: options.pi });
        actionResults = await executor.runCompletionActions(task, (msg) => {
          options.ctx.ui.setStatus("task-mode", msg);
        });
        options.ctx.ui.setStatus("task-mode", "");
      }

      // Update task status
      task.status = "completed";
      task.updatedAt = Date.now();
      task.lastAttempt = {
        timestamp: Date.now(),
        result: "success",
        report: params.report ?? "Task marked as complete",
      };

      setTasks(tasks);
      onTasksChanged();

      const actionSummary = actionResults 
        ? `\n\nCompletion actions: ${actionResults.map(a => a.success ? "✓" : "✗").join(" ")}`
        : "";

      return {
        content: [{ type: "text", text: `Task ${params.taskId} marked as complete.${actionSummary}` }],
        details: { 
          task,
          completionActionResults: actionResults,
        },
      };
    },
  });

  // Tool: skip_task - Skip current task and move to next
  pi.registerTool({
    name: "skip_task",
    label: "Skip Task",
    description: "Skip the current task (marks as failed) and move to next task",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String({ description: "ID of task to skip (defaults to current)" })),
      reason: Type.Optional(Type.String({ description: "Reason for skipping" })),
    }),
    async execute(_toolCallId, params) {
      const tasks = getTasks();
      const taskId = params.taskId ?? tasks.find(t => t.status === "in_progress")?.id;
      
      if (!taskId) {
        return {
          content: [{ type: "text", text: "No task to skip." }],
          details: { error: "No current task" },
          isError: true,
        };
      }

      const taskIndex = tasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) {
        return {
          content: [{ type: "text", text: `Task not found: ${taskId}` }],
          details: { error: "Task not found" },
          isError: true,
        };
      }

      tasks[taskIndex].status = "pending"; // Reset to pending for later retry
      tasks[taskIndex].updatedAt = Date.now();
      tasks[taskIndex].lastAttempt = {
        timestamp: Date.now(),
        result: "failure",
        report: params.reason ?? "Task skipped",
      };

      setTasks(tasks);
      onTasksChanged();

      return {
        content: [{ type: "text", text: `Task ${taskId} skipped. It remains in the queue for later.` }],
        details: { task: tasks[taskIndex] },
      };
    },
  });

  // Tool: remove_task - Remove a task from the queue
  pi.registerTool({
    name: "remove_task",
    label: "Remove Task",
    description: "Remove a task from the queue (without completing it)",
    parameters: Type.Object({
      taskId: Type.String({ description: "ID of the task to remove" }),
    }),
    async execute(_toolCallId, params) {
      const tasks = getTasks();
      const taskIndex = tasks.findIndex(t => t.id === params.taskId);
      
      if (taskIndex === -1) {
        return {
          content: [{ type: "text", text: `Task not found: ${params.taskId}` }],
          details: { error: "Task not found" },
          isError: true,
        };
      }

      const removed = tasks.splice(taskIndex, 1)[0];
      setTasks(tasks);
      onTasksChanged();

      return {
        content: [{ type: "text", text: `Task ${removed.id} removed from queue.` }],
        details: { removed },
      };
    },
  });

  // Tool: reorder_tasks - Reorder tasks in the queue
  pi.registerTool({
    name: "reorder_tasks",
    label: "Reorder Tasks",
    description: "Reorder tasks by providing a new priority order (first task in array = highest priority)",
    parameters: Type.Object({
      taskIds: Type.Array(Type.String(), { description: "Array of task IDs in desired order" }),
    }),
    async execute(_toolCallId, params) {
      const tasks = getTasks();
      const taskMap = new Map(tasks.map(t => [t.id, t]));
      
      const reordered: Task[] = [];
      for (const id of params.taskIds) {
        const task = taskMap.get(id);
        if (task) {
          reordered.push(task);
          taskMap.delete(id);
        }
      }
      
      // Append any tasks not in the provided list
      for (const task of taskMap.values()) {
        reordered.push(task);
      }

      setTasks(reordered);
      onTasksChanged();

      return {
        content: [{ type: "text", text: `Tasks reordered. New queue:\n${reordered.map((t, i) => `${i + 1}. ${t.id} [${t.status}]`).join("\n")}` }],
        details: { tasks: reordered },
      };
    },
  });

  // Tool: task_help - Get task mode help (useful for external agents)
  pi.registerTool({
    name: "task_help",
    label: "Task Help",
    description: `Get task mode documentation. Call this first if you're an external agent controlling pi.

Use add_task to create tasks. Pi will work on them until success criteria are met.

Tools available: get_tasks, get_current_task, add_task, complete_task, skip_task, remove_task, task_help`,
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{
          type: "text",
          text: `TASK MODE EXTENSION

COMMANDS (interactive only)
  /add_task <json>    Add task to queue
  /tasks              List all tasks
  /task_complete      Mark current complete
  /task_skip          Skip to next
  /task_remove <id>   Remove task
  /clear_tasks        Clear all
  /task_help          Show this help

TOOLS (callable by LLM)
  get_tasks           List all tasks
  get_current_task    Get current task
  add_task            Add new task
  complete_task       Mark complete
  skip_task           Skip current
  remove_task         Remove task
  update_task_status  Update status
  reorder_tasks       Reorder queue

ADDING TASKS FROM EXTERNAL AGENTS

CLI method:
  pi /add_task '{"directory":"...","description":"...","successCriteria":{...}}'

Tool method:
  Call add_task tool with directory, description, successCriteria

DIRECT JSON (auto-detected):
  Paste JSON with directory + description fields

TASK SHAPE
{
  "directory": "/path/to/project",
  "description": "What to do",
  "successCriteria": {
    "gateFile": {
      "path": "npm test",           // File or command
      "args": ["--grep", "auth"],   // Optional args
      "expectExitCode": 0,           // Default 0
      "checkStdout": "passed",      // Optional pattern
      "checkStderr": "ERROR"        // Optional anti-pattern
    },
    "freeText": "User can log in"   // LLM reviews against this
  },
  "completionActions": [
    {"type": "bash", "command": "git commit -m 'done'"}
  ],
  "parallelWith": ["task_abc123"]  // Run with other tasks
}

SUCCESS CRITERIA (pick one)
  gateFile:  Run executable, check exit code (deterministic)
  freeText:  LLM reviews work against description

EXAMPLES

Gate file:
{
  "directory": ".",
  "description": "Tests pass",
  "successCriteria": {
    "gateFile": {"path": "npm test", "expectExitCode": 0}
  }
}

LLM review:
{
  "directory": ".",
  "description": "Fix login bug",
  "successCriteria": {
    "freeText": "User can login with email and password"
  }
}

With completion:
{
  "directory": ".",
  "description": "Deploy",
  "successCriteria": {"gateFile": {"path": "./deploy.sh"}},
  "completionActions": [
    {"type": "bash", "command": "notify-send Done!"}
  ]
}`
        }],
        details: {},
      };
    },
  });

  // Tool: add_task - Add a new task (for LLM to create tasks)
  pi.registerTool({
    name: "add_task",
    label: "Add Task",
    description: `Add a task to make pi work persistently until success criteria are met.

PARAMS:
  directory: Working directory path (required)
  description: What to do (required)
  successCriteriaGateFile: Path to test/command - task succeeds if it exits 0 (optional)
  successCriteriaFreeText: Description of success for LLM to evaluate (optional)
  completionActions: Bash commands to run when task completes (optional)

EXAMPLES:
  add_task(directory="/app", description="Fix login bug", successCriteriaFreeText="User can login")
  add_task(directory=".", description="Tests pass", successCriteriaGateFile="npm test")
  add_task(directory="/app", description="Deploy", successCriteriaGateFile="./deploy.sh", completionActions=[{type:"bash",command:"notify Done"}])`,
    parameters: Type.Object({
      directory: Type.String({ description: "Working directory for the task" }),
      description: Type.String({ description: "Description of what needs to be done" }),
      successCriteriaGateFile: Type.Optional(Type.String({ description: "Path to test file/executable - task succeeds if exit code 0" })),
      successCriteriaFreeText: Type.Optional(Type.String({ description: "Description of success - LLM evaluates if met" })),
      completionActions: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([Type.Literal("bash"), Type.Literal("tool")]),
        command: Type.Optional(Type.String()),
        tool: Type.Optional(Type.String()),
        args: Type.Optional(Type.Record(Type.String(), Type.Any())),
        description: Type.Optional(Type.String()),
      })), { description: "Actions to run on task completion [{type:'bash',command:'git commit'}] " }),
    }),
    async execute(_toolCallId, params) {
      const tasks = getTasks();
      
      const successCriteria: { gateFile?: { path: string }; freeText?: string } = {};
      if (params.successCriteriaGateFile) {
        successCriteria.gateFile = { path: params.successCriteriaGateFile };
      }
      if (params.successCriteriaFreeText) {
        successCriteria.freeText = params.successCriteriaFreeText;
      }

      const newTask = addTask({
        directory: params.directory,
        description: params.description,
        successCriteria,
        completionActions: params.completionActions,
      }, tasks, options.onTaskAdded);

      const wasEmpty = tasks.length === 0; // Before adding
      tasks.push(newTask);
      setTasks(tasks);
      onTasksChanged();

      // Auto-start if this is the first task and task mode not active
      if (wasEmpty && options.onStartTask) {
        options.onStartTask(newTask);
      }

      return {
        content: [{ type: "text", text: `Task added: ${newTask.id}\n${newTask.description}` }],
        details: { task: newTask },
      };
    },
  });

  // Tool: write_tasks - Take natural language and create a task file
  pi.registerTool({
    name: "write_tasks",
    label: "Write Tasks",
    description: `Take natural language task descriptions and create a task file.

INPUT: Directory and comma/newline-separated task list
OUTPUT: Creates temp task file for pi to work on

EXAMPLES:
  write_tasks(directory="/tmp", tasks="letter to Mona saying she's fired, gluten free recipe, Oilers prediction")`,
    parameters: Type.Object({
      directory: Type.String({ description: "Working directory for tasks" }),
      tasks: Type.String({ description: "Tasks as natural language (comma or newline separated)" }),
    }),
    async execute(_toolCallId, params) {
      const delimiters = /[,;\n]|and then|also|finally|next|then /i;
      const taskDescriptions = params.tasks
        .split(delimiters)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 5);
      
      const lines: string[] = [];
      for (let i = 0; i < taskDescriptions.length; i++) {
        const desc = taskDescriptions[i];
        const fileHint = desc.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-').slice(0, 30);
        const filename = `/tmp/task-${Date.now()}-${i}-${fileHint}.txt`;
        
        lines.push(`directory: ${params.directory}`);
        lines.push(`description: ${desc}`);
        lines.push(`successCriteriaGateFile: test -f ${filename} && exit 0`);
        lines.push(`outputFile: ${filename}`);
        
        if (i < taskDescriptions.length - 1) lines.push('---');
      }
      
      const taskFile = `/tmp/pi-tasks-${Date.now()}.txt`;
      
      try {
        const fs = await import('node:fs');
        fs.writeFileSync(taskFile, lines.join('\n'));
      } catch (e) {
        return {
          content: [{ type: "text", text: `Failed: ${e}` }],
          isError: true,
        };
      }
      
      return {
        content: [{ 
          type: "text", 
          text: `Task file: ${taskFile}

${taskDescriptions.length} tasks:
${taskDescriptions.map((d: string, i: number) => `${i + 1}. ${d}`).join('\n')}

To work: pi --session /tmp/tasks.jsonl
Then: "Read ${taskFile}, add tasks, work until done"` 
        }],
        details: { taskFile, tasks: taskDescriptions },
      };
    },
  });
}
