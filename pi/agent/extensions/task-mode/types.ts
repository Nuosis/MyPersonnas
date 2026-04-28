// Task Mode Extension Types

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type ActionType = "bash" | "tool";

export interface TaskAction {
  type: ActionType;
  command?: string;      // For bash type
  tool?: string;         // For tool type
  args?: Record<string, unknown>;
  description?: string;  // Human-readable description
}

export interface SuccessCriteria {
  gateFile?: {
    path: string;              // Path to test file or executable
    args?: string[];           // Arguments to pass
    expectExitCode?: number;   // Expected exit code (default: 0)
    checkStdout?: string;      // Optional string that should appear in stdout
    checkStderr?: string;      // Optional string that should NOT appear in stderr
  };
  freeText?: string;           // Free text description for LLM review
}

export interface Task {
  id: string;
  directory: string;            // Working directory
  description: string;         // What to do
  successCriteria: SuccessCriteria;
  completionActions?: TaskAction[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  lastAttempt?: {
    timestamp: number;
    result: "success" | "failure" | "review_pending";
    report?: string;
  };
  parallelWith?: string[];      // IDs of tasks to run in parallel with
}

export interface TaskPayload {
  directory: string;
  description: string;
  successCriteria: SuccessCriteria;
  completionActions?: TaskAction[];
  parallelWith?: string[];
}

export interface TaskCompletionResult {
  taskId: string;
  success: boolean;
  report: string;
  completionActionResults?: Array<{
    action: TaskAction;
    success: boolean;
    output?: string;
    error?: string;
  }>;
}

export const TASK_ENTRY_TYPE = "task-mode:task";
export const COMPLETION_ENTRY_TYPE = "task-mode:completion";
