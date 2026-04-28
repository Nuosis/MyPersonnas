// Task Mode Extension - Main Entry Point
// Persist on tasks until success criteria are met

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Task } from "./types";
import { TASK_ENTRY_TYPE } from "./types";
import { loadTasksFromSession, saveTasksToSession } from "./tools";
import { registerTools } from "./tools";
import { registerCommands } from "./commands";
import { createExecutor, TaskExecutor } from "./executor";
import { createNotifier, TaskNotifier } from "./notifier";

interface SessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
  id: string;
  timestamp: number;
}

export default function taskModeExtension(pi: ExtensionAPI): void {
  // In-memory task store
  let tasks: Task[] = [];
  
  // Work log for success evaluation
  let workLog: string[] = [];
  
  // Executor and notifier instances
  let executor: TaskExecutor | null = null;
  let notifier: TaskNotifier | null = null;

  // Track if we're in task mode (agent should work on tasks)
  let taskModeActive = false;

  /**
   * Save tasks to session
   */
  const persistTasks = () => {
    // Note: pi.appendEntry adds to session file
    // We don't need to call this on every change since tasks are in memory
    // and restored from session on load
  };

  /**
   * Get pending/in-progress tasks
   */
  const getActiveTasks = (): Task[] => {
    return tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  };

  /**
   * Get the next task to work on (FIFO)
   */
  const getNextTask = (): Task | null => {
    // Check for parallel tasks first
    const inProgress = tasks.find(t => t.status === "in_progress");
    if (inProgress?.parallelWith) {
      // Return all parallel tasks
      const parallelTasks = tasks.filter(t => 
        inProgress.parallelWith!.includes(t.id) || t.id === inProgress.id
      );
      // Only start if all are pending
      if (parallelTasks.every(t => t.status === "pending")) {
        return parallelTasks[0]; // Return first, executor handles parallel set
      }
    }
    
    // Sequential: find first pending task
    return tasks.find(t => t.status === "pending") ?? null;
  };

  /**
   * Start working on a task
   */
  const startTask = async (ctx: ExtensionContext, task: Task) => {
    if (!executor || !notifier) return;

    task.status = "in_progress";
    task.updatedAt = Date.now();
    
    notifier.notifyTaskStart(task);
    workLog = []; // Reset work log for new task

    // Inject task context into the agent
    const parallelInfo = task.parallelWith 
      ? `\n\nNote: This task should run in parallel with: ${task.parallelWith.join(", ")}`
      : "";

    // Use pi.sendUserMessage (available in ExtensionContext) not ctx.sendUserMessage (ExtensionCommandContext only)
    try {
      pi.sendUserMessage(
        `[TASK MODE] Working on task:\n` +
        `ID: ${task.id}\n` +
        `Directory: ${task.directory}\n` +
        `Description: ${task.description}${parallelInfo}\n\n` +
        `Success Criteria:\n${formatSuccessCriteria(task.successCriteria)}\n\n` +
        `Run tools in ${task.directory}. When done, use complete_task tool to mark it complete.`,
        { deliverAs: "steer" }
      );
    } catch (e) {
      // In print/non-interactive mode, sendUserMessage may not work - that's ok
      console.log(`[task-mode] Task ${task.id} started (${task.directory})`);
    }
  };

  /**
   * Format success criteria for display
   */
  const formatSuccessCriteria = (criteria: Task["successCriteria"]): string => {
    if (criteria.gateFile) {
      return `Gate file: ${criteria.gateFile.path}\n` +
        `Expected exit code: ${criteria.gateFile.expectExitCode ?? 0}`;
    }
    if (criteria.freeText) {
      return criteria.freeText;
    }
    return "(no criteria defined)";
  };

  /**
   * Evaluate if current task is complete
   */
  const evaluateTaskCompletion = async (
    ctx: ExtensionContext, 
    task: Task,
    messageText?: string
  ): Promise<boolean> => {
    if (!executor || !notifier) return false;

    const result = await executor.evaluateSuccess(task, workLog);
    
    if (result.success) {
      // Task succeeded - run completion actions and move on
      const completionResults = await executor.runCompletionActions(task);
      
      task.status = "completed";
      task.updatedAt = Date.now();
      task.lastAttempt = {
        timestamp: Date.now(),
        result: "success",
        report: result.report,
      };

      await notifier.notifyTaskComplete({
        taskId: task.id,
        success: true,
        report: result.report,
        completionActionResults: completionResults,
      });

      // Move to next task or conclude
      const nextTask = getNextTask();
      if (nextTask) {
        await startTask(ctx, nextTask);
      } else {
        // All done
        const completed = tasks.filter(t => t.status === "completed").length;
        const failed = tasks.filter(t => t.status === "failed").length;
        await notifier.notifyAllComplete(completed, failed);
        taskModeActive = false;
      }
      return true;
    }
    
    // Check if LLM evaluation needed
    if (result.needsLLMEvaluation && result.reviewMessage) {
      // Inject review request - let model decide in next turn
      pi.sendUserMessage(result.reviewMessage, { deliverAs: "steer" });
      task.lastAttempt = {
        timestamp: Date.now(),
        result: "review_pending",
        report: "Waiting for LLM to evaluate completion",
      };
      return false;
    }
    
    // Check if model signaled completion in its response
    if (messageText && executor.checkForCompletionSignal(messageText, task.id)) {
      // Mark as complete (model signaled it)
      const completionResults = await executor.runCompletionActions(task);
      
      task.status = "completed";
      task.updatedAt = Date.now();
      task.lastAttempt = {
        timestamp: Date.now(),
        result: "success",
        report: "Marked complete by model",
      };

      await notifier.notifyTaskComplete({
        taskId: task.id,
        success: true,
        report: "Model confirmed completion",
        completionActionResults: completionResults,
      });

      // Move to next task
      const nextTask = getNextTask();
      if (nextTask) {
        await startTask(ctx, nextTask);
      } else {
        const completed = tasks.filter(t => t.status === "completed").length;
        const failed = tasks.filter(t => t.status === "failed").length;
        await notifier.notifyAllComplete(completed, failed);
        taskModeActive = false;
      }
      return true;
    }

    // Task not complete yet - continue working
    task.lastAttempt = {
      timestamp: Date.now(),
      result: "review_pending",
      report: result.report,
    };
    
    notifier.notifyProgress(task.id, `Task not yet complete: ${result.report.slice(0, 50)}...`);
    return false;
  };

  /**
   * Restore tasks from session on startup
   */
  const restoreTasks = (ctx: ExtensionContext) => {
    const sessionTasks = loadTasksFromSession(ctx);
    if (sessionTasks.length > 0) {
      tasks = sessionTasks;
      console.log(`[task-mode] Restored ${tasks.length} tasks from session`);
    }
  };

  // Initialize on session start
  pi.on("session_start", async (event, ctx) => {
    // Create executor and notifier
    executor = createExecutor({ pi });
    notifier = createNotifier({ ctx, getTasks: () => tasks });

    // Restore tasks from session
    restoreTasks(ctx);

    // Register tools
    registerTools({
      pi,
      ctx,
      getTasks: () => tasks,
      setTasks: (newTasks) => { tasks = newTasks; },
      onTasksChanged: () => {
        // Could trigger UI update here
      },
      onTaskAdded: (task) => {
        // Persist task to session
        pi.appendEntry(TASK_ENTRY_TYPE, task);
      },
      onStartTask: (task) => {
        // Mark task mode as active - actual start will happen on next turn_end
        taskModeActive = true;
        console.log(`[task-mode] Task ${task.id} queued for work`);
      },
    });

    // Register commands
    registerCommands({
      pi,
      ctx,
      getTasks: () => tasks,
      setTasks: (newTasks) => { tasks = newTasks; },
      onTasksChanged: () => {},
      onTaskAdded: (task) => {
        // Persist new task
        pi.appendEntry(TASK_ENTRY_TYPE, task);
      },
    });

    // If we have pending tasks, start working
    const activeTasks = getActiveTasks();
    if (activeTasks.length > 0) {
      taskModeActive = true;
      const nextTask = getNextTask();
      if (nextTask) {
        ctx.ui.notify(`Resuming ${activeTasks.length} task(s)...`, "info");
        await startTask(ctx, nextTask);
      }
    }
  });

  // Log tool results to work log
  pi.on("tool_result", async (event, ctx) => {
    const currentTask = tasks.find(t => t.status === "in_progress");
    if (!currentTask) return;

    // Add to work log
    const logEntry = `[${new Date().toISOString()}] ${event.toolName}: ${
      typeof event.content === 'string' 
        ? event.content.slice(0, 200) 
        : JSON.stringify(event.content).slice(0, 200)
    }`;
    workLog.push(logEntry);
  });

  // Evaluate task completion at end of each turn
  pi.on("turn_end", async (event, ctx) => {
    // Check if we need to start a new task
    if (taskModeActive) {
      const inProgressTask = tasks.find(t => t.status === "in_progress");
      if (!inProgressTask) {
        // No task in progress - check if we should start one
        const nextTask = getNextTask();
        if (nextTask) {
          await startTask(ctx, nextTask);
          return;
        }
      }
    }

    const currentTask = tasks.find(t => t.status === "in_progress");
    if (!currentTask || !taskModeActive) return;

    // Extract message text from the turn
    const messageText = event.message?.content
      ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
      ?.map(c => c.text)
      ?.join("\n") ?? "";

    await evaluateTaskCompletion(ctx, currentTask, messageText);
  });

  // On agent end, do final evaluation
  pi.on("agent_end", async (event, ctx) => {
    const currentTask = tasks.find(t => t.status === "in_progress");
    if (!currentTask || !taskModeActive) return;

    // Extract message text
    const messageText = event.messages?.[event.messages.length - 1]?.content
      ?.filter((c): c is { type: "text"; text: string } => c.type === "text")
      ?.map(c => c.text)
      ?.join("\n") ?? "";

    // Final evaluation before concluding
    await evaluateTaskCompletion(ctx, currentTask, messageText);
  });

  // Handle user input - check if it looks like a task payload or natural language
  pi.on("input", async (event, ctx) => {
    const text = event.text.trim();
    const lower = text.toLowerCase();

    // Check for task help requests
    if (lower === "task help" || lower === "tasks help" || lower === "help tasks" || lower === "/task_help") {
      return { action: "transform", text: "call task_help tool" };
    }

    // Check for task list requests
    if (lower === "show tasks" || lower === "list tasks" || lower === "what tasks" || lower === "/tasks") {
      return { action: "transform", text: "call get_tasks tool" };
    }

    // Check if input looks like a task payload (starts with { or [ and contains key fields)
    if ((text.startsWith("{") || text.startsWith("[")) && 
        (text.includes('"directory"') || text.includes("directory"))) {
      try {
        const payload = JSON.parse(text);
        if (payload.directory && payload.description) {
          return { action: "transform", text: `/add_task ${text}` };
        }
      } catch {
        // Not valid JSON, let it pass through
      }
    }

    // Natural language task patterns
    const taskPatterns = [
      { pattern: /^(?:add|create|new)\s+(?:a\s+)?task/i, extract: "extract task from natural language" },
      { pattern: /^(?:work on|do|complete)\s+(?:task|this)/i, extract: "call get_current_task" },
    ];

    for (const { pattern } of taskPatterns) {
      if (pattern.test(text)) {
        // For now, pass through - would need more sophisticated parsing
        break;
      }
    }

    return { action: "continue" };
  });

  // Before agent starts, inject task context
  pi.on("before_agent_start", async (event, ctx) => {
    const currentTask = tasks.find(t => t.status === "in_progress");
    const pendingTasks = tasks.filter(t => t.status === "pending");
    
    // If we have tasks, remind about task mode tools
    if (tasks.length > 0 && !taskModeActive) {
      const systemAddition = `

TASK MODE AVAILABLE: Use these tools to manage persistent tasks.

TASKS IN QUEUE: ${tasks.length} (${tasks.filter(t => t.status === "completed").length} done, ${tasks.filter(t => t.status === "in_progress").length} in progress, ${pendingTasks.length} pending)

To add tasks: use add_task tool with {directory, description, successCriteria}
To check status: use get_tasks or get_current_task tool
To complete: use complete_task tool when success criteria are met

Task success criteria: Use gateFile (run command, check exit 0) OR freeText (describe success for LLM to evaluate)`;
      
      return {
        systemPrompt: event.systemPrompt + systemAddition
      };
    }
    
    if (!currentTask || !taskModeActive) return;

    // Active task context
    return {
      systemPrompt: event.systemPrompt + "\n\n" +
        `[TASK MODE ACTIVE] Work on this task until success criteria are met.\n` +
        `Directory: ${currentTask.directory}\n` +
        `Task: ${currentTask.description}\n` +
        `Success: ${formatSuccessCriteria(currentTask.successCriteria)}\n` +
        `Use complete_task tool when done. Use get_tasks to see queue.`
    };
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    if (notifier) {
      notifier.clearProgress();
    }
  });

  console.log("[task-mode] Extension loaded");
}

/**
 * Print task mode help to stdout (for external agents)
 */
export function getTaskModeHelp(): string {
  return `TASK MODE HELP

Add tasks to make pi work persistently until success criteria are met.

QUICK START
  1. Add a task: call add_task tool or pi /add_task
  2. Pi works on it until criteria met
  3. Get notified on completion

TOOLS (call via LLM tool interface)
  get_tasks          - List all tasks
  get_current_task   - Get task being worked on
  add_task           - Add a new task
  complete_task      - Mark task complete
  skip_task          - Skip current task
  remove_task        - Remove a task
  update_task_status - Update task status
  task_help          - This help

TASK SHAPE
{
  "directory": "/path/to/project",
  "description": "What to do",
  "successCriteria": {
    "gateFile": {"path": "npm test", "expectExitCode": 0},
    "freeText": "User can log in"      // LLM reviews against this
  },
  "completionActions": [{"type": "bash", "command": "git commit"}],
  "parallelWith": ["task_abc123"]
}

ADD TASK EXAMPLES

# Gate file (deterministic)
add_task(directory=".", description="Tests pass", successCriteria={"gateFile": {"path": "npm test"}})

# LLM review (flexible)
add_task(directory=".", description="Fix login", successCriteria={"freeText": "User can login"})

# With completion action
add_task(directory=".", description="Deploy", successCriteria={"gateFile": {"path": "./deploy.sh"}}, completionActions=[{"type": "bash", "command": "notify Done"}])
`;
}
