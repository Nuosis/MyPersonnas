// Task Mode UI Components
// Footer widget, current task display, and /tasks overlay

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { Task } from "./types";

// ── Status helpers ─────────────────────────────────────────────────────

export type TaskDisplayStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

const STATUS_ICON: Record<TaskDisplayStatus, string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
  failed: "✗",
  skipped: "⊘",
};

const STATUS_LABEL: Record<TaskDisplayStatus, string> = {
  pending: "pending",
  in_progress: "in progress",
  completed: "done",
  failed: "failed",
  skipped: "skipped",
};

export function mapTaskStatus(status: Task["status"]): TaskDisplayStatus {
  switch (status) {
    case "pending": return "pending";
    case "in_progress": return "in_progress";
    case "completed": return "completed";
    case "failed": return "failed";
    case "skipped": return "skipped";
    default: return "pending";
  }
}

// ── Task List Overlay Component ─────────────────────────────────────

export class TaskListComponent {
  private tasks: Task[];
  private theme: Theme;
  private onClose: () => void;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(tasks: Task[], theme: Theme, onClose: () => void) {
    this.tasks = tasks;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onClose();
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];
    const th = this.theme;

    // Header
    lines.push("");
    const heading = th.fg("accent", " Task Mode ");
    const headingLen = 11;
    lines.push(truncateToWidth(
      th.fg("borderMuted", "─".repeat(3)) + heading +
      th.fg("borderMuted", "─".repeat(Math.max(0, width - 3 - headingLen))),
      width,
    ));
    lines.push("");

    // Summary counts
    const pending = this.tasks.filter((t) => t.status === "pending").length;
    const inProgress = this.tasks.filter((t) => t.status === "in_progress").length;
    const completed = this.tasks.filter((t) => t.status === "completed").length;
    const failed = this.tasks.filter((t) => t.status === "failed").length;
    const skipped = this.tasks.filter((t) => t.status === "skipped").length;

    lines.push(truncateToWidth(
      "  " +
      th.fg("accent", `${inProgress} active`) + th.fg("dim", "  ") +
      th.fg("success", `${completed} done`) + th.fg("dim", "  ") +
      th.fg("muted", `${pending} pending`) +
      (failed > 0 ? th.fg("dim", "  ") + th.fg("error", `${failed} failed`) : "") +
      (skipped > 0 ? th.fg("dim", "  ") + th.fg("dim", `${skipped} skipped`) : ""),
      width,
    ));
    lines.push("");

    if (this.tasks.length === 0) {
      lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks. Use add_task to create tasks.")}`, width));
    } else {
      for (const task of this.tasks) {
        const status = mapTaskStatus(task.status);
        const icon = task.status === "completed"
          ? th.fg("success", STATUS_ICON.completed)
          : task.status === "in_progress"
            ? th.fg("accent", STATUS_ICON.in_progress)
            : task.status === "failed"
              ? th.fg("error", STATUS_ICON.failed)
              : task.status === "skipped"
                ? th.fg("dim", STATUS_ICON.skipped)
                : th.fg("dim", STATUS_ICON.pending);

        const id = th.fg("accent", `#${task.id}`);
        const text = task.status === "completed"
          ? th.fg("dim", truncateToWidth(task.description, 60))
          : task.status === "in_progress"
            ? th.fg("success", truncateToWidth(task.description, 60))
            : task.status === "failed"
              ? th.fg("error", truncateToWidth(task.description, 60))
              : th.fg("muted", truncateToWidth(task.description, 60));

        const dir = th.fg("dim", truncateToWidth(` [${task.directory}]`, 30));

        lines.push(truncateToWidth(`  ${icon} ${id} ${text}${dir}`, width));
      }
    }

    lines.push("");
    lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

// ── Footer renderer factory ─────────────────────────────────────────

export function createFooterRenderer(
  getTasks: () => Task[],
  listTitle?: string
): (tui: any, theme: Theme, footerData: any) => { dispose: () => void; invalidate: () => void; render: (width: number) => string[] } {
  return (tui: any, theme: Theme, footerData: any) => {
    const unsub = footerData.onBranchChange?.(() => tui.requestRender());

    return {
      dispose: () => { unsub?.(); },
      invalidate() {},
      render(width: number): string[] {
        const tasks = getTasks();
        const pending = tasks.filter((t) => t.status === "pending").length;
        const inProgress = tasks.filter((t) => t.status === "in_progress").length;
        const completed = tasks.filter((t) => t.status === "completed").length;
        const failed = tasks.filter((t) => t.status === "failed").length;
        const total = tasks.length;

        if (total === 0) {
          const title = listTitle ? theme.fg("accent", ` ${listTitle} `) : theme.fg("dim", " Task Mode ");
          return [truncateToWidth(title + theme.fg("muted", "no tasks"), width, "")];
        }

        // Line 1: title + progress bar
        const title = listTitle ? theme.fg("accent", ` ${listTitle} `) : theme.fg("accent", " Tasks ");
        const progressBar = theme.fg("warning", "[") +
          theme.fg("success", `${completed}`) +
          theme.fg("dim", "/") +
          theme.fg("accent", `${total}`) +
          theme.fg("warning", "]");

        const left = title + progressBar;
        const right =
          theme.fg("dim", STATUS_ICON.pending + " ") + theme.fg("muted", `${pending}`) +
          theme.fg("dim", "  ") +
          theme.fg("accent", STATUS_ICON.in_progress + " ") + theme.fg("accent", `${inProgress}`) +
          theme.fg("dim", "  ") +
          theme.fg("success", STATUS_ICON.completed + " ") + theme.fg("success", `${completed}`) +
          (failed > 0 ? theme.fg("dim", "  ") + theme.fg("error", STATUS_ICON.failed + " " + failed) : "");

        const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
        const line1 = truncateToWidth(left + pad + right, width, "");

        if (total === 0) return [line1];

        // Task rows: in_progress first, then recent completed, max 5
        const activeTasks = tasks.filter((t) => t.status === "in_progress");
        const doneTasks = tasks.filter((t) => t.status === "completed").reverse();
        const visible = [...activeTasks, ...doneTasks].slice(0, 5);
        const remaining = total - visible.length;

        const rows = visible.map((t) => {
          const icon = t.status === "completed"
            ? theme.fg("success", STATUS_ICON.completed)
            : t.status === "in_progress"
              ? theme.fg("accent", STATUS_ICON.in_progress)
              : theme.fg("dim", STATUS_ICON.pending);
          const text = t.status === "completed"
            ? theme.fg("dim", truncateToWidth(t.description, 50))
            : t.status === "in_progress"
              ? theme.fg("success", truncateToWidth(t.description, 50))
              : theme.fg("muted", truncateToWidth(t.description, 50));
          return truncateToWidth(` ${icon} #${t.id} ${text}`, width, "");
        });

        if (remaining > 0) {
          rows.push(truncateToWidth(` ${theme.fg("dim", `  +${remaining} more`)}`, width, ""));
        }

        return [line1, ...rows];
      },
    };
  };
}

// ── Widget renderer factory ──────────────────────────────────────────

export function createCurrentTaskWidget(
  getTasks: () => Task[]
): (tui: any, theme: Theme) => { render: (width: number) => string[]; invalidate: () => void } | undefined {
  return (tui, theme) => {
    const container = new Container();
    const borderFn = (s: string) => theme.fg("dim", s);

    container.addChild(new Text("", 0, 0));
    container.addChild(new DynamicBorder(borderFn));
    const content = new Text("", 1, 0);
    container.addChild(content);
    container.addChild(new DynamicBorder(borderFn));

    return {
      render(width: number): string[] {
        const tasks = getTasks();
        const current = tasks.find((t) => t.status === "in_progress");

        if (!current) return [];

        const line =
          theme.fg("accent", STATUS_ICON.in_progress + " ") +
          theme.fg("dim", "WORKING ON  ") +
          theme.fg("accent", `#${current.id}`) +
          theme.fg("dim", "  ") +
          theme.fg("success", truncateToWidth(current.description, Math.max(20, width - 30)));

        content.setText(truncateToWidth(line, width - 4));
        return container.render(width);
      },
      invalidate() { container.invalidate(); },
    };
  };
}

// ── Task completed notification component ───────────────────────────

export function renderTaskComplete(
  task: Task,
  success: boolean,
  report: string,
  theme: Theme
): string[] {
  const lines: string[] = [];
  const status = mapTaskStatus(task.status);
  const icon = success ? theme.fg("success", "✅") : theme.fg("error", "❌");
  const statusText = success ? theme.fg("success", "completed") : theme.fg("error", "failed");

  lines.push(truncateToWidth(
    ` ${icon} ${theme.fg("accent", `#${task.id}`)} ${statusText}: ${theme.fg("muted", truncateToWidth(task.description, 60))}`,
    80,
  ));

  if (report && report !== "No success criteria defined. Task marked as complete by default.") {
    lines.push(truncateToWidth(`   ${theme.fg("dim", truncateToWidth(report, 70))}`, 80));
  }

  return lines;
}