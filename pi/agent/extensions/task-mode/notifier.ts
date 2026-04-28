// Task Mode Extension - Notifier
// Handles sending completion notifications with rich TUI

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Task, TaskCompletionResult } from "./types";
import { createFooterRenderer, createCurrentTaskWidget, mapTaskStatus, TaskListComponent } from "./ui";

export interface NotifierOptions {
  ctx: ExtensionContext;
  getTasks: () => Task[];
  listTitle?: string;
}

export class TaskNotifier {
  private ctx: ExtensionContext;
  private getTasks: () => Task[];

  constructor(options: NotifierOptions) {
    this.ctx = options.ctx;
    this.getTasks = options.getTasks;
    this.setupUI();
  }

  private setupUI(): void {
    // Set up persistent footer with task list
    const footerRenderer = createFooterRenderer(this.getTasks);
    this.ctx.ui.setFooter(footerRenderer);

    // Set up current task widget (shows "WORKING ON #N" below editor)
    const widgetRenderer = createCurrentTaskWidget(this.getTasks);
    if (widgetRenderer) {
      this.ctx.ui.setWidget("task-mode-current", widgetRenderer, { placement: "belowEditor" });
    }
  }

  /**
   * Notify that a task has been completed
   */
  async notifyTaskComplete(result: TaskCompletionResult): Promise<void> {
    const success = result.success;
    const task = this.getTasks().find(t => t.id === result.taskId);
    if (!task) return;

    const statusText = success ? "completed" : "failed";
    const desc = task.description.length > 60
      ? task.description.slice(0, 57) + "..."
      : task.description;

    let message = success
      ? `✅ #${result.taskId} ${statusText}: ${desc}\n${result.report}`
      : `❌ #${result.taskId} ${statusText}: ${desc}\n${result.report}`;

    if (result.completionActionResults?.length) {
      message += "\n\nCompletion actions:";
      for (const ar of result.completionActionResults) {
        const icon = ar.success ? "✓" : "✗";
        message += `\n  ${icon} ${ar.action.description ?? ar.action.type}`;
        if (ar.error) message += ` (${ar.error})`;
      }
    }

    this.ctx.ui.notify(message, success ? "success" : "error");
    this.refreshUI();
  }

  /**
   * Notify that all tasks are complete
   */
  async notifyAllComplete(completed: number, failed: number): Promise<void> {
    const emoji = failed === 0 ? "🎉" : "⚠️";
    this.ctx.ui.notify(
      `${emoji} All tasks done — ${completed} completed, ${failed} failed`,
      failed === 0 ? "success" : "warning"
    );
    this.refreshUI();
  }

  /**
   * Notify that work has started on a task
   */
  async notifyTaskStart(task: Task): Promise<void> {
    const desc = task.description.length > 60
      ? task.description.slice(0, 57) + "..."
      : task.description;

    this.ctx.ui.notify(`▶️ Starting: #${task.id} ${desc}`, "info");
    this.ctx.ui.setStatus("task-mode", `▶ #${task.id}: ${desc}`);
    this.refreshUI();
  }

  /**
   * Notify task progress
   */
  async notifyProgress(taskId: string, message: string): Promise<void> {
    const task = this.getTasks().find(t => t.id === taskId);
    if (task) {
      const desc = task.description.length > 40
        ? task.description.slice(0, 37) + "..."
        : task.description;
      this.ctx.ui.setStatus("task-mode", `▶ #${taskId}: ${desc} — ${message.slice(0, 30)}`);
    }
  }

  /**
   * Clear progress notification
   */
  async clearProgress(): Promise<void> {
    const tasks = this.getTasks();
    const inProgress = tasks.filter(t => t.status === "in_progress");
    if (inProgress.length > 0) {
      const t = inProgress[0];
      const desc = t.description.length > 40 ? t.description.slice(0, 37) + "..." : t.description;
      this.ctx.ui.setStatus("task-mode", `▶ #${t.id}: ${desc}`);
    } else {
      this.ctx.ui.setStatus("task-mode", "Task Mode");
    }
    this.refreshUI();
  }

  /**
   * Refresh UI elements
   */
  private refreshUI(): void {
    // Re-set footer to trigger refresh
    const footerRenderer = createFooterRenderer(this.getTasks);
    this.ctx.ui.setFooter(footerRenderer);

    // Re-set widget
    const widgetRenderer = createCurrentTaskWidget(this.getTasks);
    if (widgetRenderer) {
      this.ctx.ui.setWidget("task-mode-current", widgetRenderer, { placement: "belowEditor" });
    }
  }

  /**
   * Show interactive task list overlay
   */
  async showTaskList(): Promise<void> {
    if (!this.ctx.hasUI) return;

    await this.ctx.ui.custom<void>((tui, theme, _kb, done) => {
      return new TaskListComponent(this.getTasks(), theme, () => done());
    });
  }
}

export function createNotifier(options: NotifierOptions): TaskNotifier {
  return new TaskNotifier(options);
}