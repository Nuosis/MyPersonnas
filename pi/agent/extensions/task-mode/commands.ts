// Task Mode Extension - Commands
// Slash commands for task management

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Task, TaskPayload, TASK_ENTRY_TYPE } from "./types";
import { addTask, saveTasksToSession } from "./tools";

export interface CommandsOptions {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  getTasks: () => Task[];
  setTasks: (tasks: Task[]) => void;
  onTasksChanged: () => void;
  onTaskAdded: (task: Task) => void;
}

/**
 * Register slash commands for task-mode
 */
export function registerCommands(options: CommandsOptions): void {
  const { pi, ctx, getTasks, setTasks, onTasksChanged, onTaskAdded } = options;

  // /add_task - Add a new task
  pi.registerCommand("add_task", {
    description: "Add a task to the task queue",
    getArgumentCompletions: (_prefix) => {
      // No autocomplete for JSON argument
      return null;
    },
    handler: async (args, commandCtx) => {
      // Parse the task payload from arguments
      let payload: TaskPayload;
      
      try {
        // Handle both quoted and unquoted JSON
        const jsonStr = args.trim();
        payload = JSON.parse(jsonStr);
      } catch (error) {
        commandCtx.ui.notify(
          `Invalid task JSON: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
        return;
      }

      // Validate required fields
      if (!payload.directory || typeof payload.directory !== "string") {
        commandCtx.ui.notify("Task must include a 'directory' field", "error");
        return;
      }
      if (!payload.description || typeof payload.description !== "string") {
        commandCtx.ui.notify("Task must include a 'description' field", "error");
        return;
      }
      if (!payload.successCriteria) {
        commandCtx.ui.notify("Task must include 'successCriteria'", "error");
        return;
      }

      // Check if this is parallel with other tasks
      if (payload.parallelWith && Array.isArray(payload.parallelWith)) {
        // Validate referenced tasks exist
        const tasks = getTasks();
        const existingIds = new Set(tasks.map(t => t.id));
        for (const refId of payload.parallelWith) {
          if (!existingIds.has(refId)) {
            commandCtx.ui.notify(`Referenced task not found: ${refId}`, "error");
            return;
          }
        }
      }

      // Create the task
      const tasks = getTasks();
      const newTask = addTask(payload, tasks);
      
      tasks.push(newTask);
      setTasks(tasks);
      onTasksChanged();
      
      // Persist to session
      saveTasksToSession(pi, [newTask]);
      
      // Notify
      commandCtx.ui.notify(
        `Task added: ${newTask.id.slice(0, 12)}...`,
        "success"
      );

      // Trigger task mode if this is the first task
      if (tasks.length === 1) {
        commandCtx.ui.notify(
          "Starting task mode. Use /tasks to view queue.",
          "info"
        );
        
        // Inject a message to start working on the task
        await commandCtx.sendUserMessage(
          `Work on task ${newTask.id}: ${newTask.description}\n` +
          `Directory: ${newTask.directory}\n` +
          `Success criteria: ${JSON.stringify(newTask.successCriteria)}`
        );
      }
    },
  });

  // /tasks - List tasks
  pi.registerCommand("tasks", {
    description: "List all tasks in the queue",
    handler: async (_args, commandCtx) => {
      const tasks = getTasks();
      
      if (tasks.length === 0) {
        commandCtx.ui.notify("No tasks in queue.", "info");
        return;
      }

      const current = tasks.find(t => t.status === "in_progress");
      const pending = tasks.filter(t => t.status === "pending");
      const completed = tasks.filter(t => t.status === "completed");
      const failed = tasks.filter(t => t.status === "failed");

      let summary = `Tasks:\n`;
      summary += `  Current: ${current ? current.id.slice(0, 8) + "..." : "none"}\n`;
      summary += `  Pending: ${pending.length}\n`;
      summary += `  Completed: ${completed.length}\n`;
      summary += `  Failed: ${failed.length}`;

      commandCtx.ui.notify(summary, "info");
    },
  });

  // /task_complete - Mark current task complete
  pi.registerCommand("task_complete", {
    description: "Mark current task as complete",
    handler: async (args, commandCtx) => {
      const tasks = getTasks();
      const current = tasks.find(t => t.status === "in_progress");
      
      if (!current) {
        commandCtx.ui.notify("No task currently in progress.", "warning");
        return;
      }

      // Update task status
      current.status = "completed";
      current.updatedAt = Date.now();
      current.lastAttempt = {
        timestamp: Date.now(),
        result: "success",
        report: args || "Marked complete via /task_complete",
      };

      setTasks(tasks);
      onTasksChanged();

      commandCtx.ui.notify(`Task ${current.id.slice(0, 8)}... marked complete.`, "success");
    },
  });

  // /task_skip - Skip current task
  pi.registerCommand("task_skip", {
    description: "Skip current task and move to next",
    handler: async (args, commandCtx) => {
      const tasks = getTasks();
      const current = tasks.find(t => t.status === "in_progress");
      
      if (!current) {
        commandCtx.ui.notify("No task currently in progress.", "warning");
        return;
      }

      current.status = "pending"; // Reset for later
      current.updatedAt = Date.now();
      current.lastAttempt = {
        timestamp: Date.now(),
        result: "failure",
        report: args || "Skipped via /task_skip",
      };

      setTasks(tasks);
      onTasksChanged();

      commandCtx.ui.notify(`Task ${current.id.slice(0, 8)}... skipped.`, "info");
    },
  });

  // /task_remove - Remove a task
  pi.registerCommand("task_remove", {
    description: "Remove a task from the queue",
    handler: async (args, commandCtx) => {
      const taskId = args.trim();
      if (!taskId) {
        commandCtx.ui.notify("Usage: /task_remove <task_id>", "error");
        return;
      }

      const tasks = getTasks();
      const index = tasks.findIndex(t => t.id === taskId);
      
      if (index === -1) {
        commandCtx.ui.notify(`Task not found: ${taskId}`, "error");
        return;
      }

      tasks.splice(index, 1);
      setTasks(tasks);
      onTasksChanged();

      commandCtx.ui.notify(`Task removed.`, "success");
    },
  });

  // /clear_tasks - Clear all tasks
  pi.registerCommand("clear_tasks", {
    description: "Clear all tasks from the queue",
    handler: async (_args, commandCtx) => {
      const tasks = getTasks();
      
      if (tasks.length === 0) {
        commandCtx.ui.notify("No tasks to clear.", "info");
        return;
      }

      const confirmed = await commandCtx.ui.confirm(
        "Clear Tasks",
        `Remove all ${tasks.length} tasks from the queue?`
      );

      if (!confirmed) {
        return;
      }

      setTasks([]);
      onTasksChanged();

      commandCtx.ui.notify("All tasks cleared.", "success");
    },
  });

  // /task_help - Show task mode help
  pi.registerCommand("task_help", {
    description: "Show task mode help",
    handler: async (_args, commandCtx) => {
      const help = `TASK MODE COMMANDS

/add_task <json>  Add a task to the queue
/tasks             List all tasks
/task_complete     Mark current task complete
/task_skip         Skip current task (reset to pending)
/task_remove <id>  Remove a task
/clear_tasks       Clear all tasks
/task_help         Show this help

TASK TOOLS (LLM-callable)

get_tasks          List all tasks
get_current_task   Get current task
add_task           Add a new task
complete_task      Mark task complete
skip_task          Skip current task
remove_task        Remove a task
update_task_status Update task status
reorder_tasks      Reorder queue

TASK SHAPE
{
  "directory": "/path",
  "description": "What to do",
  "successCriteria": {
    "gateFile": { "path": "npm test" },
    // OR
    "freeText": "Description of success"
  },
  "completionActions": [{ "type": "bash", "command": "git commit" }]
}

EXAMPLES

Gate file success:
/add_task '{"directory":".","description":"Run tests","successCriteria":{"gateFile":{"path":"npm test","expectExitCode":0}}}'

LLM review success:
/add_task '{"directory":".","description":"Fix bug","successCriteria":{"freeText":"User can log in"}}'`;

      commandCtx.ui.notify(help, "info");
    },
  });
}
