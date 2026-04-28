/**
 * Find Tool Override - Guard against large/hanging find operations
 *
 * Overrides the built-in `find` tool to:
 * 1. Block or warn on searches in home dir or very large directories
 * 2. Add default depth limit to prevent runaway searches
 * 3. Suggest better tools (fd for files, grep for content)
 */

import type { TextContent } from "@mariozechner/pi-ai";
import { type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const MAX_DEPTH = 10;
const DEFAULT_TIMEOUT_MS = 30000;

interface FindArgs {
	pattern: string;
	path?: string;
	limit?: number;
}

function isLargePath(path: string): boolean {
	// Home directory
	if (/^\/Users\/[^\/]+$/.test(path)) return true;
	// Volume root
	if (/^\/Volumes\/[^\/]+\/$/.test(path)) return true;
	// Other large dirs
	if (/^\/[^\/]+\/$/.test(path)) return true;
	return false;
}

function suggestBetter(path: string, pattern: string): string {
	return `
Better alternatives:
- File names: \`fd "${pattern}"\` in a specific subdirectory
- File content: \`grep -r "search-text"\`
- Recent files: \`fd --changed-within 7d\``;
}

/**
 * Get fd path using the same logic as pi's tools-manager
 * First checks ~/.pi/agent/bin/fd, then falls back to PATH lookup
 */
function getFdPath(): string | null {
	const toolsDir = join(homedir(), ".pi", "agent", "bin");
	const localPath = join(toolsDir, "fd");
	
	if (existsSync(localPath)) {
		return localPath;
	}
	
	// Fall back to PATH lookup
	try {
		const result = spawnSync("which", ["fd"], { stdio: "pipe", encoding: "utf-8" });
		if (result.status === 0 && result.stdout?.trim()) {
			return result.stdout.trim();
		}
	} catch {
		// Fall through to return null
	}
	
	return null;
}

function execFd(fdPath: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let child: ReturnType<typeof spawn>;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			process.removeListener("SIGTERM", onSigTerm);
			fn();
		};

		const onSigTerm = () => {
			child?.kill("SIGTERM");
			settle(() => reject(new Error("Operation aborted")));
		};

		process.on("SIGTERM", onSigTerm);

		const timeout = setTimeout(() => {
			child?.kill("SIGKILL");
			settle(() => reject(new Error("TIMEOUT")));
		}, timeoutMs);

		child = spawn(fdPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

		let stderr = "";
		const lines: string[] = [];

		child.stdout?.on("data", (chunk) => {
			for (const line of chunk.toString().split("\n")) {
				const trimmed = line.replace(/\r$/, "").trim();
				if (trimmed) lines.push(trimmed);
			}
		});

		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			settle(() => reject(new Error(`Failed to run fd: ${err.message}`)));
		});

		child.on("close", (code) => {
			clearTimeout(timeout);
			process.removeListener("SIGTERM", onSigTerm);

			if (settled) return;
			settle(() => {
				if (code === 0 || lines.length > 0) {
					resolve(lines.join("\n"));
				} else {
					reject(new Error(stderr.trim() || `fd exited with code ${code}`));
				}
			});
		});
	});
}

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "find",
		label: "find",
		description:
			"Find files by glob pattern. Guards against large directory searches. For file content, use `grep` instead.",
		parameters: findSchema,

		async execute(_toolCallId, args: FindArgs, signal, _onUpdate, ctx) {
			const { pattern, path: searchDir, limit } = args;
			const effectiveLimit = limit ?? 1000;
			const searchPath = searchDir || ".";

			// Resolve to absolute path for checking
			const fullPath = searchPath === "." ? ctx.cwd : searchPath.startsWith("/") ? searchPath : `${ctx.cwd}/${searchPath}`;

			// Guard: block home directory searches
			if (isLargePath(fullPath)) {
				return {
					content: [
						{
							type: "text",
							text: `BLOCKED: Searching "${searchPath}" is not allowed.

This directory is too large and will hang or timeout.

Why: Home directories contain thousands of files across many subdirectories, making searches very slow.

What to do instead:
1. Navigate to a specific project subdirectory: \`cd ~/projects/myapp\`
2. Use \`fd pattern\` in that directory
3. For file content: \`grep -r "text"\` in the specific directory${suggestBetter(searchPath, pattern)}`,
						},
					] as TextContent[],
					details: { blocked: true, reason: "large_directory" },
				};
			}

			// Guard: check if path exists
			if (!existsSync(fullPath)) {
				return {
					content: [{ type: "text", text: `Path not found: ${searchPath}` }] as TextContent[],
					details: { error: true },
				};
			}

			// Get fd path using same logic as pi's tools-manager
			const fdPath = getFdPath();
			if (!fdPath) {
				return {
					content: [{ type: "text", text: "fd is not available. Install it with: brew install fd" }] as TextContent[],
					details: { error: true, reason: "fd_not_found" },
				};
			}

			// Build fd arguments
			const fdArgs = [
				"--glob",
				"--color=never",
				"--hidden",
				"--no-require-git",
				"--max-results",
				String(effectiveLimit),
				`--max-depth`,
				String(MAX_DEPTH),
			];

			// Handle patterns with slashes (need --full-path)
			let effectivePattern = pattern;
			if (pattern.includes("/")) {
				fdArgs.push("--full-path");
				if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
					effectivePattern = `**/${pattern}`;
				}
			}

			fdArgs.push(effectivePattern, fullPath);

			try {
				const output = await execFd(fdPath, fdArgs, ctx.cwd, DEFAULT_TIMEOUT_MS);
				const files = output.trim().split("\n").filter(Boolean);

				if (files.length === 0) {
					return {
						content: [{ type: "text", text: "No files found matching pattern" }] as TextContent[],
						details: {},
					};
				}

				const resultLimitReached = files.length >= effectiveLimit;
				const truncated = files.slice(0, 200);
				const more = files.length > 200 ? `\n... and ${files.length - 200} more` : "";
				const notice = resultLimitReached ? `\n\n[${effectiveLimit} results limit reached]` : "";

				return {
					content: [
						{
							type: "text",
							text: `Found ${files.length} results:\n${truncated.join("\n")}${more}${notice}`,
						},
					] as TextContent[],
					details: { resultLimitReached, tool: "fd" },
				};
			} catch (error: any) {
				if (error.message === "TIMEOUT") {
					return {
						content: [
							{
								type: "text",
								text: `Search timed out after ${DEFAULT_TIMEOUT_MS / 1000}s.

The search took too long. This usually means the directory is too large or the pattern matches too many files.

Suggestions:
1. Use a more specific pattern
2. Search a subdirectory instead of "${searchPath}"
3. Use \`fd --max-depth 3\` to limit depth${suggestBetter(searchPath, pattern)}`,
							},
						] as TextContent[],
						details: { error: true, timeout: true },
					};
				}

				return {
					content: [{ type: "text", text: `Error: ${error.message}` }] as TextContent[],
					details: { error: true },
				};
			}
		},
	});
}