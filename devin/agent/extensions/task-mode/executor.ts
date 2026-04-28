// Task Mode Extension - Executor
// Handles task execution and success criteria evaluation

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Task, TaskAction, TaskCompletionResult } from "./types";

export interface ExecutorOptions {
  pi: ExtensionAPI;
  signal?: AbortSignal;
}

export class TaskExecutor {
  private pi: ExtensionAPI;

  constructor(options: ExecutorOptions) {
    this.pi = options.pi;
  }

  /**
   * Evaluate if a task succeeded based on its success criteria
   * Returns:
   * - { success: true } if gate file passed
   * - { success: false, needsLLMEvaluation: true } if LLM review needed
   * - { success: false } if gate file failed or no criteria
   */
  async evaluateSuccess(
    task: Task,
    workLog: string[]
  ): Promise<{ 
    success: boolean; 
    report: string;
    needsLLMEvaluation?: boolean;
    reviewMessage?: string;
  }> {
    // Check gate file first (deterministic)
    if (task.successCriteria.gateFile) {
      return this.evaluateGateFile(task.successCriteria.gateFile, workLog);
    }

    // No gate file - request LLM evaluation
    if (task.successCriteria.freeText) {
      const evaluation = await this.requestLLMEvaluation(task, workLog);
      return {
        success: false,
        report: "LLM review requested",
        needsLLMEvaluation: true,
        reviewMessage: evaluation.reviewMessage,
      };
    }

    // No success criteria defined - auto-complete
    return {
      success: true,
      report: "No success criteria defined. Task marked as complete by default.",
    };
  }

  /**
   * Run a gate file/test and check results
   */
  private async evaluateGateFile(
    gate: NonNullable<Task["successCriteria"]["gateFile"]>,
    workLog: string[]
  ): Promise<{ success: boolean; report: string }> {
    const args = gate.args?.join(" ") ?? "";
    const cmd = `${gate.path} ${args}`.trim();

    let result: { stdout: string; stderr: string; exitCode: number };

    try {
      result = await this.pi.exec(gate.path, gate.args ?? [], {
        timeout: 60000, // 60 second timeout for tests
      });
    } catch (error) {
      return {
        success: false,
        report: `Gate file execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const { stdout, stderr, exitCode } = result;
    const expectedCode = gate.expectExitCode ?? 0;

    // Check exit code
    if (exitCode !== expectedCode) {
      return {
        success: false,
        report: `Gate file failed: exit code ${exitCode}, expected ${expectedCode}\n` +
          `STDOUT:\n${stdout || "(empty)"}\n` +
          `STDERR:\n${stderr || "(empty)"}`,
      };
    }

    // Check stdout pattern if specified
    if (gate.checkStdout && !stdout.includes(gate.checkStdout)) {
      return {
        success: false,
        report: `Gate file stdout missing expected pattern "${gate.checkStdout}"\n` +
          `Actual stdout:\n${stdout || "(empty)"}`,
      };
    }

    // Check stderr doesn't contain forbidden pattern
    if (gate.checkStderr && stderr.includes(gate.checkStderr)) {
      return {
        success: false,
        report: `Gate file stderr contains forbidden pattern "${gate.checkStderr}"\n` +
          `Actual stderr:\n${stderr || "(empty)"}`,
      };
    }

    return {
      success: true,
      report: `Gate file passed:\n` +
        `  Exit code: ${exitCode}\n` +
        `  STDOUT:\n${stdout || "(empty)"}` +
        (stderr ? `\n  STDERR:\n${stderr}` : ""),
    };
  }

  /**
   * Use LLM to evaluate if task succeeded based on free text criteria.
   * This is called by injecting a review message and waiting for the next turn.
   * Returns a pending state - caller should handle the actual evaluation.
   */
  async requestLLMEvaluation(
    task: Task,
    workLog: string[]
  ): Promise<{ needsResponse: boolean; reviewMessage: string }> {
    const prompt = `Evaluate if the current task is complete.

TASK: ${task.description}
SUCCESS CRITERIA: ${task.successCriteria.freeText}

RECENT WORK:
${workLog.slice(-10).join("\n") || "(no work logged yet)"}

If the task is complete, use the complete_task tool with the task ID: ${task.id}
If not complete, continue working on the task.

Report your evaluation in your response text.`;

    return {
      needsResponse: true,
      reviewMessage: prompt,
    };
  }

  /**
   * Check if the model signaled task completion in its response
   */
  checkForCompletionSignal(messageText: string, taskId: string): boolean {
    const text = messageText.toLowerCase();
    // Look for completion indicators
    return text.includes("task complete") || 
           text.includes("completed task") ||
           text.includes(`${taskId} marked complete`);
  }

  /**
   * Run completion actions for a task
   */
  async runCompletionActions(
    task: Task,
    onProgress?: (msg: string) => void
  ): Promise<TaskCompletionResult["completionActionResults"]> {
    if (!task.completionActions || task.completionActions.length === 0) {
      return [];
    }

    const results: TaskCompletionResult["completionActionResults"] = [];

    for (const action of task.completionActions) {
      onProgress?.(`Running completion action: ${action.description ?? action.type}`);

      try {
        if (action.type === "bash" && action.command) {
          const result = await this.pi.exec(action.command, [], {
            timeout: 30000,
          });
          results.push({
            action,
            success: result.exitCode === 0,
            output: result.stdout,
            error: result.stderr || undefined,
          });
        } else if (action.type === "tool" && action.tool) {
          // For tool actions, we inject a user message to trigger the tool
          // This is a simplified approach - could be enhanced with direct tool calls
          onProgress?.(`Tool action "${action.tool}" would be called with: ${JSON.stringify(action.args)}`);
          results.push({
            action,
            success: true,
            output: `Tool "${action.tool}" queued for execution`,
          });
        }
      } catch (error) {
        results.push({
          action,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Extract text content from message content array
   */
  private extractTextContent(content: unknown[]): string {
    return content
      .filter((c): c is { type: "text"; text: string } => 
        typeof c === "object" && c !== null && "type" in c && (c as any).type === "text"
      )
      .map(c => c.text)
      .join("\n");
  }
}

export function createExecutor(options: ExecutorOptions): TaskExecutor {
  return new TaskExecutor(options);
}
