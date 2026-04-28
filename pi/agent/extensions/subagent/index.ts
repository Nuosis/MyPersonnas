/**
 * Unified Subagent Extension
 * 
 * Fire-and-forget background agents with live widgets, session persistence,
 * parallel/chain execution, and optional task-mode success criteria.
 * 
 * Commands:
 *   /sub <task>         - spawn a background subagent
 *   /subcont <id> <msg> - continue an existing subagent's conversation
 *   /subrm <id>         - remove a subagent
 *   /subclear           - clear all subagents
 * 
 * Tool: subagent with modes single/parallel/chain and optional persistUntil
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { type AgentConfig, type AgentScope, discoverAgents, loadSkills } from "./agents.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

// ── Types ──────────────────────────────────────────────────────────────

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	step?: number;
	stopReason?: string;
	errorMessage?: string;
}

interface PersistUntil {
	gateFile?: { path: string; expectExitCode?: number };
	freeText?: string;
}

interface SubState {
	id: number;
	status: "running" | "done" | "error";
	task: string;
	textChunks: string[];
	toolCount: number;
	elapsed: number;
	sessionFile: string;
	turnCount: number;
	proc?: ChildProcess;
	
	// Optional task-mode
	persistUntil?: PersistUntil;
	persistAttempts?: number;
	
	// For multi-agent modes
	mode?: "single" | "parallel" | "chain";
	results?: SingleResult[];
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	results: SingleResult[];
	taskId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: UsageStats,
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => p.startsWith(os.homedir()) 
		? `~${p.slice(os.homedir().length)}` : p;

	switch (toolName) {
		case "bash": {
			const cmd = ((args.command as string) || "...").slice(0, 60);
			return themeFg("muted", "$ ") + themeFg("toolOutput", cmd);
		}
		case "read": {
			const raw = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "read ") + themeFg("accent", shortenPath(raw));
		}
		case "write": {
			const raw = (args.file_path || args.path || "...") as string;
			const lines = ((args.content as string) || "").split("\n").length;
			return themeFg("muted", "write ") + themeFg("accent", shortenPath(raw)) + 
				(lines > 1 ? themeFg("dim", ` (${lines} lines)`) : "");
		}
		case "edit": {
			const raw = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(raw));
		}
		default: {
			const preview = JSON.stringify(args).slice(0, 50);
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

// ── Success Criteria Evaluation ─────────────────────────────────────────

async function evaluateSuccess(
	persistUntil: PersistUntil,
	messages: Message[],
	ctx: any,
): Promise<{ success: boolean; report: string }> {
	if (persistUntil.gateFile) {
		const { path: cmd, expectExitCode = 0 } = persistUntil.gateFile;
		try {
			const { execSync } = await import("node:child_process");
			const result = execSync(cmd, { encoding: "utf-8", timeout: 300000 });
			const success = true;
			return { success, report: `Gate file passed: exit code 0` };
		} catch (err: any) {
			const actualCode = err.status ?? 1;
			if (actualCode === expectExitCode) {
				return { success: true, report: `Gate file passed: exit code ${actualCode}` };
			}
			return { success: false, report: `Gate file failed: exit ${actualCode}, expected ${expectExitCode}` };
		}
	}
	
	if (persistUntil.freeText) {
		// For freeText, we inject a review message for the agent to evaluate
		return { success: false, report: `needs_review:${persistUntil.freeText}` };
	}
	
	return { success: false, report: "No success criteria defined" };
}

// ── Session File Helpers ────────────────────────────────────────────────

function makeSessionFile(id: number): string {
	const dir = path.join(os.homedir(), ".pi", "agent", "sessions", "subagents");
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, `subagent-${id}-${Date.now()}.jsonl`);
}

// ── Main Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const agents = new Map<number, SubState>();
	let nextId = 1;
	let widgetCtx: ExtensionContext | null = null;

	// Update all live widgets
	function updateWidgets() {
		if (!widgetCtx) return;

		for (const [id, state] of Array.from(agents.entries())) {
			const key = `sub-${id}`;
			widgetCtx.ui.setWidget(key, (_tui: any, theme: any) => {
				const container = new Container();
				const borderFn = (s: string) => theme.fg("dim", s);

				container.addChild(new Text("", 0, 0));
				container.addChild(new DynamicBorder(borderFn));
				const content = new Text("", 1, 0);
				container.addChild(content);
				container.addChild(new DynamicBorder(borderFn));

				return {
					render(width: number): string[] {
						const statusColor = state.status === "running" ? "accent"
							: state.status === "done" ? "success" : "error";
						const statusIcon = state.status === "running" ? "●"
							: state.status === "done" ? "✓" : "✗";

						const taskPreview = state.task.length > 40
							? state.task.slice(0, 37) + "..."
							: state.task;

						const turnLabel = state.turnCount > 1
							? theme.fg("dim", ` · Turn ${state.turnCount}`)
							: "";

						const modeLabel = state.mode && state.mode !== "single"
							? theme.fg("muted", ` [${state.mode}]`)
							: "";

						const lines = [
							theme.fg(statusColor, `${statusIcon} Subagent #${state.id}`) + turnLabel + modeLabel,
							theme.fg("dim", `  ${taskPreview}`),
							theme.fg("dim", `  (${Math.round(state.elapsed / 1000)}s) | Tools: ${state.toolCount}`),
						];

						const fullText = state.textChunks.join("");
						const lastLine = fullText.split("\n").filter(l => l.trim()).pop() || "";
						if (lastLine) {
							const trimmed = lastLine.length > width - 10
								? lastLine.slice(0, width - 13) + "..."
								: lastLine;
							lines.push(theme.fg("muted", `  ${trimmed}`));
						}

						content.setText(lines.join("\n"));
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
				};
			});
		}
	}

	// Process JSON line from subagent stdout
	function processLine(state: SubState, line: string) {
		if (!line.trim()) return;
		try {
			const event = JSON.parse(line);
			
			if (event.type === "message_update") {
				const delta = event.assistantMessageEvent;
				if (delta?.type === "text_delta") {
					state.textChunks.push(delta.delta || "");
					updateWidgets();
				}
			} else if (event.type === "tool_execution_start") {
				state.toolCount++;
				updateWidgets();
			} else if (event.type === "message_end" && event.message) {
				const msg = event.message as Message;
				if (msg.role === "assistant" && msg.usage) {
					// Track usage if needed
				}
			}
		} catch {}
	}

	// Spawn a subagent process
	function spawnAgent(
		state: SubState,
		prompt: string,
		agent: AgentConfig,
		cwd: string,
		ctx: any,
		originalTask?: string,
	): Promise<void> {
		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "openrouter/google/gemini-3-flash-preview";

		return new Promise<void>((resolve) => {
			const args = [
				"--mode", "json",
				"-p",
				"--session", state.sessionFile,
				"--no-extensions",
				"--model", model,
				"--tools", agent.tools?.join(",") || "read,bash,grep,find,ls",
				"--thinking", "off",
				prompt,
			];

			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			});

			state.proc = proc;

			const startTime = Date.now();
			const timer = setInterval(() => {
				state.elapsed = Date.now() - startTime;
				updateWidgets();
			}, 1000);

			let buffer = "";

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(state, line);
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", (chunk: string) => {
				if (chunk.trim()) {
					state.textChunks.push(chunk);
					updateWidgets();
				}
			});

			proc.on("close", async (code) => {
				if (buffer.trim()) processLine(state, buffer);
				clearInterval(timer);
				state.elapsed = Date.now() - startTime;
				state.status = code === 0 ? "done" : "error";
				state.proc = undefined;
				updateWidgets();

				// Check persistUntil success criteria
				if (state.persistUntil && state.status === "done") {
					const messages: Message[] = [];
					// Reconstruct messages from textChunks for evaluation
					const result = state.textChunks.join("");
					
					const evalResult = await evaluateSuccess(state.persistUntil, messages, ctx);
					
					if (!evalResult.success && evalResult.report.startsWith("needs_review:")) {
						// Continue for review - not done yet
						state.persistAttempts = (state.persistAttempts || 0) + 1;
						if (state.persistAttempts < 10) {
							state.status = "running";
							updateWidgets();
							// Continue the conversation
							const reviewText = evalResult.report.slice(12);
							const continuePrompt = `Evaluate: ${reviewText}\n\nDid you accomplish this? If yes, respond with "COMPLETE: <brief summary>". If not, describe what remains.`;
							spawnAgent(state, continuePrompt, agent, cwd, ctx, originalTask);
							return;
						}
					}
				}

				const finalOutput = state.textChunks.join("");
				ctx.ui.notify(
					`Subagent #${state.id} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : "error"
				);

				// Inject result as follow-up message
				pi.sendMessage({
					customType: "subagent-result",
					content: `Subagent #${state.id}${state.turnCount > 1 ? ` (Turn ${state.turnCount})` : ""} finished "${originalTask || state.task}" in ${Math.round(state.elapsed / 1000)}s.\n\nResult:\n${finalOutput.slice(0, 8000)}${finalOutput.length > 8000 ? "\n\n... [truncated]" : ""}`,
					display: true,
				}, { deliverAs: "followUp", triggerTurn: true });

				resolve();
			});

			proc.on("error", (err) => {
				clearInterval(timer);
				state.status = "error";
				state.proc = undefined;
				state.textChunks.push(`Error: ${err.message}`);
				updateWidgets();
				resolve();
			});
		});
	}

	// ── Run Single Agent (returns messages for tool result) ──────────────

	async function runSingleAgentSync(
		cwd: string,
		agent: AgentConfig,
		task: string,
	): Promise<SingleResult> {
		const model = "openrouter/google/gemini-3-flash-preview";
		const args = ["--mode", "json", "-p", "--no-session"];
		if (agent.model) args.push("--model", agent.model);
		if (agent.tools?.length) args.push("--tools", agent.tools.join(","));

		let tmpPromptDir: string | null = null;
		let tmpPromptPath: string | null = null;

		const result: SingleResult = {
			agent: agent.name,
			agentSource: agent.source as "user" | "project" | "unknown",
			task,
			exitCode: 0,
			messages: [],
			stderr: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		};

		try {
			let systemPrompt = agent.systemPrompt.trim();
			if (agent.skills?.length) {
				const skillContent = loadSkills(agent.skills, cwd);
				if (skillContent) systemPrompt += `\n\n${skillContent}`;
			}

			if (systemPrompt) {
				const tmp = await writePromptToTempFile(agent.name, systemPrompt);
				tmpPromptDir = tmp.dir;
				tmpPromptPath = tmp.filePath;
				args.push("--append-system-prompt", tmpPromptPath);
			}

			args.push(`Task: ${task}`);

			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let buffer = "";

			await new Promise<void>((resolve) => {
				proc.stdout!.on("data", (data) => {
					buffer += data.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const event = JSON.parse(line);
							if (event.type === "message_end" && event.message) {
								const msg = event.message as Message;
								result.messages.push(msg);
								if (msg.role === "assistant") {
									result.usage.turns++;
									if (msg.usage) {
										result.usage.input += msg.usage.input || 0;
										result.usage.output += msg.usage.output || 0;
										result.usage.cacheRead += msg.usage.cacheRead || 0;
										result.usage.cacheWrite += msg.usage.cacheWrite || 0;
										result.usage.cost += msg.usage.cost?.total || 0;
									}
								}
							}
						} catch {}
					}
				});

				proc.stderr!.on("data", (data) => {
					result.stderr += data.toString();
				});

				proc.on("close", (code) => {
					if (buffer.trim()) {
						try {
							const event = JSON.parse(buffer);
							if (event.type === "message_end" && event.message) {
								result.messages.push(event.message as Message);
							}
						} catch {}
					}
					result.exitCode = code ?? 0;
					resolve();
				});

				proc.on("error", () => {
					result.exitCode = 1;
					resolve();
				});
			});
		} finally {
			if (tmpPromptPath) try { fs.unlinkSync(tmpPromptPath); } catch {}
			if (tmpPromptDir) try { fs.rmdirSync(tmpPromptDir); } catch {}
		}

		return result;
	}

	// ── Parallel Execution ──────────────────────────────────────────────

	async function runParallel(
		cwd: string,
		agents: AgentConfig[],
		tasks: Array<{ agent: string; task: string; cwd?: string }>,
	): Promise<SingleResult[]> {
		const results: SingleResult[] = [];
		let nextIndex = 0;

		await new Promise<void>((resolve) => {
			const workers = new Array(MAX_CONCURRENCY).fill(null).map(async () => {
				while (true) {
					const index = nextIndex++;
					if (index >= tasks.length) break;

					const t = tasks[index];
					const agent = agents.find(a => a.name === t.agent);
					
					if (!agent) {
						results[index] = {
							agent: t.agent,
							agentSource: "unknown",
							task: t.task,
							exitCode: 1,
							messages: [],
							stderr: `Unknown agent: ${t.agent}`,
							usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
						};
						continue;
					}

					results[index] = await runSingleAgentSync(t.cwd ?? cwd, agent, t.task);
				}
				
				// Check if all done
				if (nextIndex >= tasks.length) resolve();
			});
		});

		return results;
	}

	// ── Chain Execution ──────────────────────────────────────────────────

	async function runChain(
		cwd: string,
		agents: AgentConfig[],
		chain: Array<{ agent: string; task: string; cwd?: string }>,
	): Promise<SingleResult[]> {
		const results: SingleResult[] = [];
		let previousOutput = "";

		for (let i = 0; i < chain.length; i++) {
			const step = chain[i];
			const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

			const agent = agents.find(a => a.name === step.agent);
			if (!agent) {
				results.push({
					agent: step.agent,
					agentSource: "unknown",
					task: step.task,
					exitCode: 1,
					messages: [],
					stderr: `Unknown agent: ${step.agent}`,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					step: i + 1,
				});
				break;
			}

			const result = await runSingleAgentSync(step.cwd ?? cwd, agent, taskWithContext);
			result.step = i + 1;
			results.push(result);

			if (result.exitCode !== 0) break;
			previousOutput = getFinalOutput(result.messages);
		}

		return results;
	}

	// ── /sub command ────────────────────────────────────────────────────

	pi.registerCommand("sub", {
		description: "Spawn a background subagent: /sub <task>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const task = args?.trim();
			if (!task) {
				ctx.ui.notify("Usage: /sub <task>", "error");
				return;
			}

			// Discover agents
			const discovery = discoverAgents(ctx.cwd, "user");
			const agentConfigs = discovery.agents;
			
			// Simple agent selection - use first available or worker
			const agentName = "worker";
			const agent = agentConfigs.find(a => a.name === agentName) || agentConfigs[0];
			
			if (!agent) {
				ctx.ui.notify("No agents available. Create agents in ~/.pi/agent/agents/", "error");
				return;
			}

			const id = nextId++;
			const state: SubState = {
				id,
				status: "running",
				task,
				textChunks: [],
				toolCount: 0,
				elapsed: 0,
				sessionFile: makeSessionFile(id),
				turnCount: 1,
				mode: "single",
			};
			agents.set(id, state);
			updateWidgets();

			// Fire-and-forget
			spawnAgent(state, task, agent, ctx.cwd, ctx);
		},
	});

	// ── /subcont command ────────────────────────────────────────────────

	pi.registerCommand("subcont", {
		description: "Continue a subagent's conversation: /subcont <id> <prompt>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const trimmed = args?.trim() ?? "";
			const spaceIdx = trimmed.indexOf(" ");
			if (spaceIdx === -1) {
				ctx.ui.notify("Usage: /subcont <id> <prompt>", "error");
				return;
			}

			const num = parseInt(trimmed.slice(0, spaceIdx), 10);
			const prompt = trimmed.slice(spaceIdx + 1).trim();

			if (isNaN(num) || !prompt) {
				ctx.ui.notify("Usage: /subcont <id> <prompt>", "error");
				return;
			}

			const state = agents.get(num);
			if (!state) {
				ctx.ui.notify(`No subagent #${num} found. Use /sub to create one.`, "error");
				return;
			}

			if (state.status === "running") {
				ctx.ui.notify(`Subagent #${num} is still running — wait for it to finish.`, "warning");
				return;
			}

			// Resume with same session
			state.status = "running";
			state.task = prompt;
			state.textChunks = [];
			state.elapsed = 0;
			state.turnCount++;

			const discovery = discoverAgents(ctx.cwd, "user");
			const agentConfigs = discovery.agents;
			const agentName = "worker";
			const agent = agentConfigs.find(a => a.name === agentName) || agentConfigs[0];

			if (!agent) {
				ctx.ui.notify("No agents available.", "error");
				return;
			}

			updateWidgets();
			ctx.ui.notify(`Continuing Subagent #${num} (Turn ${state.turnCount})…`, "info");
			spawnAgent(state, prompt, agent, ctx.cwd, ctx);
		},
	});

	// ── /subrm command ──────────────────────────────────────────────────

	pi.registerCommand("subrm", {
		description: "Remove a subagent: /subrm <id>",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			const num = parseInt(args?.trim() ?? "", 10);
			if (isNaN(num)) {
				ctx.ui.notify("Usage: /subrm <id>", "error");
				return;
			}

			const state = agents.get(num);
			if (!state) {
				ctx.ui.notify(`No subagent #${num} found.`, "error");
				return;
			}

			if (state.proc && state.status === "running") {
				state.proc.kill("SIGTERM");
				ctx.ui.notify(`Subagent #${num} killed and removed.`, "warning");
			} else {
				ctx.ui.notify(`Subagent #${num} removed.`, "info");
			}

			ctx.ui.setWidget(`sub-${num}`, undefined);
			agents.delete(num);
		},
	});

	// ── /subclear command ──────────────────────────────────────────────

	pi.registerCommand("subclear", {
		description: "Clear all subagents",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			let killed = 0;
			for (const [id, state] of Array.from(agents.entries())) {
				if (state.proc && state.status === "running") {
					state.proc.kill("SIGTERM");
					killed++;
				}
				ctx.ui.setWidget(`sub-${id}`, undefined);
			}

			const total = agents.size;
			agents.clear();
			nextId = 1;

			const msg = total === 0
				? "No subagents to clear."
				: `Cleared ${total} subagent${total !== 1 ? "s" : ""}${killed > 0 ? ` (${killed} killed)` : ""}.`;
			ctx.ui.notify(msg, total === 0 ? "info" : "success");
		},
	});

	// ── /sublist command ────────────────────────────────────────────────

	pi.registerCommand("sublist", {
		description: "List all subagents",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (agents.size === 0) {
				ctx.ui.notify("No active subagents.", "info");
				return;
			}

			const options = Array.from(agents.values()).map(s =>
				`#${s.id} [${s.status.toUpperCase()}] (Turn ${s.turnCount}) - ${s.task}`
			);

			const choice = await ctx.ui.select("Subagents:", options);
			if (choice) {
				const idx = parseInt(choice.slice(1).split(" ")[0], 10);
				const state = agents.get(idx);
				if (state) {
					const output = state.textChunks.join("").slice(0, 500);
					ctx.ui.notify(`Subagent #${idx}:\n${output || "(no output yet)"}`, "info");
				}
			}
		},
	});

	// ── subagent tool (fire-and-forget with optional sync modes) ────────

	const TaskItem = Type.Object({
		agent: Type.String(),
		task: Type.String(),
		cwd: Type.Optional(Type.String()),
	});

	const ChainItem = Type.Object({
		agent: Type.String(),
		task: Type.String(),
		cwd: Type.Optional(Type.String()),
	});

	const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
		description: 'Agent scope: "user" (default) or "both" for project-local agents',
	});

	const PersistUntilSchema = Type.Object({
		gateFile: Type.Optional(Type.Object({
			path: Type.String(),
			expectExitCode: Type.Optional(Type.Number()),
		})),
		freeText: Type.Optional(Type.String()),
	});

	const SubagentParams = Type.Object({
		agent: Type.Optional(Type.String()),
		task: Type.Optional(Type.String()),
		tasks: Type.Optional(Type.Array(TaskItem)),
		chain: Type.Optional(Type.Array(ChainItem)),
		agentScope: Type.Optional(AgentScopeSchema),
		background: Type.Optional(Type.Boolean({ description: "Run in background, return immediately" })),
		persistUntil: Type.Optional(PersistUntilSchema),
		cwd: Type.Optional(Type.String()),
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate to subagents with modes: single (agent+task), parallel (tasks), chain (sequential with {previous}).",
			"Use background:true for fire-and-forget, or omit for synchronous execution.",
			"Use persistUntil with gateFile or freeText for task-mode persistence.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			widgetCtx = ctx;
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agentConfigs = discovery.agents;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);

			// Background mode - fire and forget
			if (params.background) {
				const mode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
				const task = params.task || "";

				const id = nextId++;
				const state: SubState = {
					id,
					status: "running",
					task: hasSingle ? task : (hasChain ? `${params.chain!.length} chain steps` : `${params.tasks!.length} parallel tasks`),
					textChunks: [],
					toolCount: 0,
					elapsed: 0,
					sessionFile: makeSessionFile(id),
					turnCount: 1,
					mode: mode as "single" | "parallel" | "chain",
					persistUntil: params.persistUntil,
				};
				agents.set(id, state);
				updateWidgets();

				// Fire-and-forget
				if (hasSingle) {
					const agent = agentConfigs.find(a => a.name === params.agent) || agentConfigs[0];
					if (agent) spawnAgent(state, params.task!, agent, params.cwd ?? ctx.cwd, ctx, params.task);
				} else if (hasTasks && params.tasks) {
					// Parallel background - spawn each
					for (const t of params.tasks) {
						const a = agentConfigs.find(ag => ag.name === t.agent) || agentConfigs[0];
						if (a) {
							const sid = nextId++;
							const s: SubState = {
								id: sid,
								status: "running",
								task: t.task,
								textChunks: [],
								toolCount: 0,
								elapsed: 0,
								sessionFile: makeSessionFile(sid),
								turnCount: 1,
								mode: "parallel",
							};
							agents.set(sid, s);
							updateWidgets();
							spawnAgent(s, t.task, a, t.cwd ?? params.cwd ?? ctx.cwd, ctx);
						}
					}
				} else if (hasChain && params.chain) {
					// Chain background - run first step, will continue
					const step = params.chain[0];
					const a = agentConfigs.find(ag => ag.name === step.agent) || agentConfigs[0];
					if (a) {
						state.task = step.task;
						spawnAgent(state, step.task, a, step.cwd ?? params.cwd ?? ctx.cwd, ctx);
					}
				}

				return {
					content: [{ type: "text", text: `Subagent #${id} spawned in background. Use /subcont ${id} to continue.` }],
				};
			}

			// Sync mode
			if (hasChain) {
				const results = await runChain(params.cwd ?? ctx.cwd, agentConfigs, params.chain!);
				const successCount = results.filter(r => r.exitCode === 0).length;
				const lastResult = results[results.length - 1];
				
				return {
					content: [{ type: "text", text: getFinalOutput(lastResult?.messages || []) || "(no output)" }],
					details: { mode: "chain", agentScope, results } as SubagentDetails,
				};
			}

			if (hasTasks) {
				if (params.tasks!.length > MAX_PARALLEL_TASKS) {
					return { content: [{ type: "text", text: `Too many tasks (${params.tasks!.length}). Max: ${MAX_PARALLEL_TASKS}` }] };
				}
				const results = await runParallel(params.cwd ?? ctx.cwd, agentConfigs, params.tasks!);
				const successCount = results.filter(r => r.exitCode === 0).length;
				
				const summaries = results.map(r => {
					const output = getFinalOutput(r.messages).slice(0, 100);
					return `[${r.agent}] ${r.exitCode === 0 ? "✓" : "✗"}: ${output || "(no output)"}`;
				});
				
				return {
					content: [{ type: "text", text: `${successCount}/${results.length} succeeded:\n${summaries.join("\n")}` }],
					details: { mode: "parallel", agentScope, results } as SubagentDetails,
				};
			}

			if (hasSingle) {
				const agent = agentConfigs.find(a => a.name === params.agent);
				if (!agent) {
					const available = agentConfigs.map(a => a.name).join(", ") || "none";
					return { content: [{ type: "text", text: `Unknown agent: ${params.agent}. Available: ${available}` }] };
				}

				const result = await runSingleAgentSync(params.cwd ?? ctx.cwd, agent, params.task!);
				const isError = result.exitCode !== 0;
				
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: { mode: "single", agentScope, results: [result] } as SubagentDetails,
					isError,
				};
			}

			return { content: [{ type: "text", text: "Provide agent+task, tasks[], or chain[]" }] };
		},

		renderCall(args, theme) {
			const mode = args.chain?.length ? "chain" : args.tasks?.length ? "parallel" : "single";
			const label = args.agent || (args.chain?.length ? `${args.chain.length} steps` : args.tasks?.length ? `${args.tasks.length} tasks` : "...");
			
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", mode) +
				theme.fg("muted", ` ${label}`),
				0, 0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as SubagentDetails | undefined;
			
			if (details?.results?.length) {
				const r = details.results[0];
				const icon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
				const output = getFinalOutput(r.messages);
				const preview = expanded ? output : output.slice(0, 200);
				
				return new Text(
					`${icon} ${theme.fg("accent", r.agent)}: ${theme.fg("muted", preview)}${output.length > 200 ? theme.fg("dim", "...") : ""}`,
					0, 0,
				);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

	// ── Session lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx;
		for (const [id, state] of Array.from(agents.entries())) {
			if (state.proc && state.status === "running") {
				state.proc.kill("SIGTERM");
			}
			ctx.ui.setWidget(`sub-${id}`, undefined);
		}
		agents.clear();
		nextId = 1;
	});

	pi.on("session_shutdown", async () => {
		for (const [, state] of agents) {
			if (state.proc && state.status === "running") {
				state.proc.kill("SIGTERM");
			}
		}
	});
}