/**
 * Agent Chain — Sequential pipeline orchestrator
 *
 * Runs opinionated, repeatable agent workflows. Chains are defined in
 * .pi/agent/agent-chain.yaml (local) with fallback to — each chain is a sequence of agent steps
 * with prompt templates. The user's original prompt flows into step 1,
 * the output becomes $INPUT for step 2's prompt template, and so on.
 * $ORIGINAL is always the user's original prompt.
 *
 * The primary Pi agent has NO codebase tools — it can ONLY kick off the
 * pipeline via the `run_chain` tool. On boot you select a chain; the
 * agent decides when to run it based on the user's prompt.
 *
 * Agents maintain session context within a Pi session — re-running the
 * chain lets each agent resume where it left off.
 *
 * Commands:
 *   /chain             — switch active chain
 *   /chain-list        — list all available chains
 *   /chain-exit        — exit the active chain
 *   /chain-stop        — user-initiated stop (asks for reason)
 *   /chain-history     — show recent runs (SQLite)
 *   /chain-run <id>    — view run details
 *   /chain-preserve <id> — preserve run from auto-purge
 *   /chain-search <q>  — search runs by input
 *
 * Usage: pi -e extensions/agent-chain.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { 
	startRun, completeRun, startStep, completeStep, 
	preserveRun, unpreserveRun, listRuns, searchRuns, getRun, getRunSteps,
	purgeOldRuns
} from "../workers/chains/chain-db.ts";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface ChainStep {
	agent: string;
	prompt: string;
}

interface ChainDef {
	name: string;
	description: string;
	steps: ChainStep[];
}

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
}

interface StepState {
	agent: string;
	status: "pending" | "running" | "done" | "error" | "stopped";
	elapsed: number;
	lastWork: string;
}

interface ChainStopReport {
	received: string;
	did: string;
	issues: string;
	status: "success" | "blocked" | "error";
}

// Special markers for agent communication
const CHAIN_STOP_MARKER = "__CHAIN_STOP__";
const CHAIN_STOP_END = "__CHAIN_STOP_END__";
const READY_MARKER = "__READY__:";
const READY_MARKER_END = "__";

// ── Display Name Helper ──────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Chain YAML Parser ────────────────────────────

function parseChainYaml(raw: string): ChainDef[] {
	const chains: ChainDef[] = [];
	let current: ChainDef | null = null;
	let currentStep: ChainStep | null = null;

	for (const line of raw.split("\n")) {
		// Chain name: top-level key
		const chainMatch = line.match(/^(\S[^:]*):$/);
		if (chainMatch) {
			if (current && currentStep) {
				current.steps.push(currentStep);
				currentStep = null;
			}
			current = { name: chainMatch[1].trim(), description: "", steps: [] };
			chains.push(current);
			continue;
		}

		// Chain description
		const descMatch = line.match(/^\s+description:\s+(.+)$/);
		if (descMatch && current && !currentStep) {
			let desc = descMatch[1].trim();
			if ((desc.startsWith('"') && desc.endsWith('"')) ||
				(desc.startsWith("'") && desc.endsWith("'"))) {
				desc = desc.slice(1, -1);
			}
			current.description = desc;
			continue;
		}

		// Usage comment block (multi-line: # Usage: followed by indented lines)
		if (line.trim() === "# Usage:" && current && !currentStep) {
			const lines = raw.split("\n");
			const startIdx = lines.indexOf(line);
			const usageLines: string[] = [];
			for (let i = startIdx + 1; i < lines.length; i++) {
				const l = lines[i];
				// Empty lines are ok
				if (l.trim() === "") { usageLines.push(""); continue; }
				// Stop at non-indented comment block or chain
				if (l.match(/^[^#\s]/) || (l.trim().startsWith("#") && !l.trim().startsWith("# "))) break;
				// Grab indented content (strip leading # if present)
				const content = l.replace(/^\s+/, "").replace(/^#\s*/, "");
				if (content.trim()) usageLines.push(content);
				else usageLines.push(""); // preserve empty lines
			}
			if (usageLines.length > 0 && usageLines.some(l => l.trim())) {
				if (!current.description) current.description = "";
				current.description += (current.description ? "\n\n" : "") + "Usage:\n" + usageLines.join("\n");
			}
			continue;
		}

		// Examples comment block (multi-line: # Examples: followed by indented lines)
		if (line.trim() === "# Examples:" && current && !currentStep) {
			const lines = raw.split("\n");
			const startIdx = lines.indexOf(line);
			const examplesLines: string[] = [];
			for (let i = startIdx + 1; i < lines.length; i++) {
				const l = lines[i];
				if (l.trim() === "") { examplesLines.push(""); continue; }
				if (l.match(/^[^#\s]/) || (l.trim().startsWith("#") && !l.trim().startsWith("# "))) break;
				const content = l.replace(/^\s+/, "").replace(/^#\s*/, "");
				if (content.trim()) examplesLines.push(content);
				else examplesLines.push("");
			}
			if (examplesLines.length > 0 && examplesLines.some(l => l.trim())) {
				if (!current.description) current.description = "";
				current.description += (current.description ? "\n\n" : "") + "Examples:\n" + examplesLines.join("\n");
			}
			continue;
		}

		// "steps:" label — skip
		if (line.match(/^\s+steps:\s*$/) && current) {
			continue;
		}

		// Step agent line
		const agentMatch = line.match(/^\s+-\s+agent:\s+(.+)$/);
		if (agentMatch && current) {
			if (currentStep) {
				current.steps.push(currentStep);
			}
			currentStep = { agent: agentMatch[1].trim(), prompt: "" };
			continue;
		}

		// Step prompt line
		const promptMatch = line.match(/^\s+prompt:\s+(.+)$/);
		if (promptMatch && currentStep) {
			let prompt = promptMatch[1].trim();
			if ((prompt.startsWith('"') && prompt.endsWith('"')) ||
				(prompt.startsWith("'") && prompt.endsWith("'"))) {
				prompt = prompt.slice(1, -1);
			}
			prompt = prompt.replace(/\\n/g, "\n");
			currentStep.prompt = prompt;
			continue;
		}
	}

	if (current && currentStep) {
		current.steps.push(currentStep);
	}

	return chains;
}

// ── Frontmatter Parser ───────────────────────────

function parseAgentFile(filePath: string): AgentDef | null {
	try {
		const raw = readFileSync(filePath, "utf-8");
		const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;

		const frontmatter: Record<string, string> = {};
		for (const line of match[1].split("\n")) {
			const idx = line.indexOf(":");
			if (idx > 0) {
				frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
			}
		}

		if (!frontmatter.name) return null;

		return {
			name: frontmatter.name,
			description: frontmatter.description || "",
			tools: frontmatter.tools || "read,grep,find,ls",
			systemPrompt: match[2].trim(),
		};
	} catch {
		return null;
	}
}

function scanAgentDirs(cwd: string): Map<string, AgentDef> {
	const homedir = process.env.HOME || "";
	const dirs = [
		join(cwd, "workers"),
		join(cwd, ".claude", "workers"),
		join(cwd, ".pi", "workers"),
		join(homedir, ".pi", "agent", "workers"),
	];

	const agents = new Map<string, AgentDef>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".md")) continue;
				const fullPath = resolve(dir, file);
				const def = parseAgentFile(fullPath);
				if (def && !agents.has(def.name.toLowerCase())) {
					agents.set(def.name.toLowerCase(), def);
				}
			}
		} catch {}
	}

	return agents;
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let allAgents: Map<string, AgentDef> = new Map();
	let chains: ChainDef[] = [];
	let activeChain: ChainDef | null = null;
	let widgetCtx: any;
	let sessionDir = "";
	const agentSessions: Map<string, string | null> = new Map();

	// Per-step state for the active chain
	let stepStates: StepState[] = [];
	let pendingReset = false;
	let chainHalted = false;
	let chainHaltReport: ChainStopReport | null = null;
	let userHaltReason: string | null = null;

	function loadChains(cwd: string) {
		sessionDir = join(cwd, ".pi", "agent-sessions");
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		allAgents = scanAgentDirs(cwd);

		agentSessions.clear();
		for (const [key] of allAgents) {
			const sessionFile = join(sessionDir, `chain-${key}.json`);
			agentSessions.set(key, existsSync(sessionFile) ? sessionFile : null);
		}

		// Load chains from ~/.pi/agent/agents/chains/agent-chain.yaml
		const homedir = process.env.HOME || "";
		const chainPath = join(homedir, ".pi", "agent", "workers", "chains", "agent-chain.yaml");

		if (existsSync(chainPath)) {
			try {
				chains = parseChainYaml(readFileSync(chainPath, "utf-8"));
			} catch {
				chains = [];
			}
		} else {
			chains = [];
		}
	}

	function activateChain(chain: ChainDef) {
		activeChain = chain;
		stepStates = chain.steps.map(s => ({
			agent: s.agent,
			status: "pending" as const,
			elapsed: 0,
			lastWork: "",
		}));
		// Skip widget re-registration if reset is pending — let before_agent_start handle it
		if (!pendingReset) {
			updateWidget();
		}
	}

	// ── Card Rendering ──────────────────────────

	function renderCard(state: StepState, colWidth: number, theme: any): string[] {
		const w = colWidth - 2;
		const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;

		const statusColor = state.status === "pending" ? "dim"
			: state.status === "running" ? "accent"
			: state.status === "done" ? "success"
			: state.status === "stopped" ? "warning"
			: "error";
		const statusIcon = state.status === "pending" ? "○"
			: state.status === "running" ? "●"
			: state.status === "done" ? "✓"
			: state.status === "stopped" ? "⏸"
			: "✗";

		const name = displayName(state.agent);
		const nameStr = theme.fg("accent", theme.bold(truncate(name, w)));
		const nameVisible = Math.min(name.length, w);

		const statusStr = `${statusIcon} ${state.status}`;
		const timeStr = state.status !== "pending" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
		const statusLine = theme.fg(statusColor, statusStr + timeStr);
		const statusVisible = statusStr.length + timeStr.length;

		const workRaw = state.lastWork || "";
		const workText = workRaw ? truncate(workRaw, Math.min(50, w - 1)) : "";
		const workLine = workText ? theme.fg("muted", workText) : theme.fg("dim", "—");
		const workVisible = workText ? workText.length : 1;

		const top = "┌" + "─".repeat(w) + "┐";
		const bot = "└" + "─".repeat(w) + "┘";
		const border = (content: string, visLen: number) =>
			theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - visLen)) + theme.fg("dim", "│");

		return [
			theme.fg("dim", top),
			border(" " + nameStr, 1 + nameVisible),
			border(" " + statusLine, 1 + statusVisible),
			border(" " + workLine, 1 + workVisible),
			theme.fg("dim", bot),
		];
	}

	function updateWidget() {
		if (!widgetCtx) return;

		widgetCtx.ui.setWidget("agent-chain", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					if (!activeChain || stepStates.length === 0) {
						text.setText(theme.fg("dim", "No chain active. Use /chain to select one."));
						return text.render(width);
					}

					const arrowWidth = 5; // " ──▶ "
					const cols = stepStates.length;
					const totalArrowWidth = arrowWidth * (cols - 1);
					const colWidth = Math.max(12, Math.floor((width - totalArrowWidth) / cols));
					const arrowRow = 2; // middle of 5-line card (0-indexed)

					const cards = stepStates.map(s => renderCard(s, colWidth, theme));
					const cardHeight = cards[0].length;
					const outputLines: string[] = [];

					for (let line = 0; line < cardHeight; line++) {
						let row = cards[0][line];
						for (let c = 1; c < cols; c++) {
							if (line === arrowRow) {
								row += theme.fg("dim", " ──▶ ");
							} else {
								row += " ".repeat(arrowWidth);
							}
							row += cards[c][line];
						}
						outputLines.push(row);
					}

					text.setText(outputLines.join("\n"));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	// ── Run Agent (subprocess) ──────────────────

	function runAgent(
		agentDef: AgentDef,
		task: string,
		stepIndex: number,
		ctx: any,
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "openrouter/google/gemini-3-flash-preview";

		const agentKey = agentDef.name.toLowerCase().replace(/\s+/g, "-");
		const agentSessionFile = join(sessionDir, `chain-${agentKey}.json`);
		const hasSession = agentSessions.get(agentKey);

		const args = [
			"--mode", "json",
			"-p",
			"--no-extensions",
			"--model", model,
			"--tools", agentDef.tools,
			"--thinking", "off",
			"--append-system-prompt", agentDef.systemPrompt,
			"--session", agentSessionFile,
		];

		if (hasSession) {
			args.push("-c");
		}

		args.push(task);

		const textChunks: string[] = [];
		const startTime = Date.now();
		const state = stepStates[stepIndex];

		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			});

			const timer = setInterval(() => {
				state.elapsed = Date.now() - startTime;
				updateWidget();
			}, 1000);

			let buffer = "";

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") {
								textChunks.push(delta.delta || "");
								const full = textChunks.join("");
								const last = full.split("\n").filter((l: string) => l.trim()).pop() || "";
								state.lastWork = last;
								updateWidget();
							}
						}
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", () => {});

			proc.on("close", (code) => {
				if (buffer.trim()) {
					try {
						const event = JSON.parse(buffer);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") textChunks.push(delta.delta || "");
						}
					} catch {}
				}

				clearInterval(timer);
				const elapsed = Date.now() - startTime;
				state.elapsed = elapsed;
				const output = textChunks.join("");
				state.lastWork = output.split("\n").filter((l: string) => l.trim()).pop() || "";

				if (code === 0) {
					agentSessions.set(agentKey, agentSessionFile);
				}

				resolve({ output, exitCode: code ?? 1, elapsed });
			});

			proc.on("error", (err) => {
				clearInterval(timer);
				resolve({
					output: `Error spawning agent: ${err.message}`,
					exitCode: 1,
					elapsed: Date.now() - startTime,
				});
			});
		});
	}

	// ── Chain Stop Helpers ──────────────────────

	function formatChainStopReport(
		stepNum: number,
		totalSteps: number,
		agentName: string,
		report: ChainStopReport
	): string {
		const statusIcon = report.status === "success" ? "✓" : report.status === "blocked" ? "⏸" : "✗";
		const statusLabel = report.status.charAt(0).toUpperCase() + report.status.slice(1);

		return `⏹ Chain halted at step ${stepNum}/${totalSteps} (${displayName(agentName)})
${statusIcon} Status: ${statusLabel}

## What I Received
${report.received}

## What I Did
${report.did}

## Issue${report.issues ? "s" : ""}
${report.issues || "(none — graceful stop requested)"}
`;
	}

	function parseChainStopMarker(output: string): ChainStopReport | null {
		const match = output.match(new RegExp(`${CHAIN_STOP_MARKER}([\\s\\S]*?)${CHAIN_STOP_END}`));
		if (!match) return null;
		try {
			return JSON.parse(match[1]);
		} catch {
			return null;
		}
	}

	// ── Run Chain (sequential pipeline) ─────────

	async function runChain(
		task: string,
		ctx: any,
	): Promise<{ output: string; success: boolean; elapsed: number; runId?: number }> {
		if (!activeChain) {
			return { output: "No chain active", success: false, elapsed: 0 };
		}

		const chainStart = Date.now();

		// Start DB logging
		let runId: number | null = null;
		try {
			runId = startRun(activeChain.name, task);
		} catch (e) {
			console.error("[chain] Failed to start DB run:", e);
		}

		// Reset all steps to pending
		stepStates = activeChain.steps.map(s => ({
			agent: s.agent,
			status: "pending" as const,
			elapsed: 0,
			lastWork: "",
		}));
		updateWidget();

		let input = task;
		const originalPrompt = task;

		for (let i = 0; i < activeChain.steps.length; i++) {
			const step = activeChain.steps[i];
			stepStates[i].status = "running";
			updateWidget();

			const resolvedPrompt = step.prompt
				.replace(/\$INPUT/g, input)
				.replace(/\$ORIGINAL/g, originalPrompt);

			const agentDef = allAgents.get(step.agent.toLowerCase());
			if (!agentDef) {
				stepStates[i].status = "error";
				stepStates[i].lastWork = `Agent "${step.agent}" not found`;
				updateWidget();
				return {
					output: `Error at step ${i + 1}: Agent "${step.agent}" not found. Available: ${Array.from(allAgents.keys()).join(", ")}`,
					success: false,
					elapsed: Date.now() - chainStart,
				};
			}

			// Start step DB logging
			let stepId: number | null = null;
			try {
				stepId = startStep(runId!, i, step.agent, resolvedPrompt.slice(0, 10000));
			} catch (e) {
				console.error("[chain] Failed to start DB step:", e);
			}

			const result = await runAgent(agentDef, resolvedPrompt, i, ctx);

			if (result.exitCode !== 0) {
				// Check for chain stop marker in output
				const stopMatch = result.output.match(
					new RegExp(`${CHAIN_STOP_MARKER}([\\s\\S]*?)${CHAIN_STOP_END}`)
				);
				if (stopMatch) {
					try {
						const report = JSON.parse(stopMatch[1]) as ChainStopReport;
						chainHalted = true;
						chainHaltReport = report;
						stepStates[i].status = "stopped";
						updateWidget();
						if (stepId) { try { completeStep(stepId, result.output.slice(0, 50000), "stopped", result.elapsed); } catch (e) {} }
						if (runId) { try { completeRun(runId, "stopped", Date.now() - chainStart); } catch (e) {} }
						return {
							output: formatChainStopReport(i + 1, activeChain.steps.length, step.agent, report),
							success: false,
							elapsed: Date.now() - chainStart,
							halted: true,
							haltReport: report,
							runId,
						};
					} catch {
						// Invalid JSON, treat as error
					}
				}

				stepStates[i].status = "error";
				updateWidget();
				return {
					output: `Error at step ${i + 1} (${step.agent}): ${result.output}`,
					success: false,
					elapsed: Date.now() - chainStart,
				};
			}

			stepStates[i].status = "done";
			if (stepId) { try { completeStep(stepId, result.output.slice(0, 50000), "done", result.elapsed); } catch (e) {} }
			updateWidget();

			// Extract __READY__ marker data if present (health-check success)
			const readyMatch = result.output.match(new RegExp(`${READY_MARKER}([\\s\\S]*?)${READY_MARKER_END}`));
			if (readyMatch && i < activeChain.steps.length - 1) {
				// Parse ready data and prepend to input for next step
				try {
					const readyData = JSON.parse(readyMatch[1]);
					const readyText = `__READY__:${JSON.stringify(readyData)}__\n\n`;
					input = readyText + result.output;
				} catch {
					input = result.output;
				}
			} else {
				input = result.output;
			}
		}
		if (runId) { try { completeRun(runId, "done", Date.now() - chainStart); } catch (e) {} }
		return { output: input, success: true, elapsed: Date.now() - chainStart, runId };
	}

	// ── run_chain Tool ──────────────────────────

	pi.registerTool({
		name: "run_chain",
		label: "Run Chain",
		description: "Execute the active agent chain pipeline. Each step runs sequentially — output from one step feeds into the next. Agents maintain session context across runs.",
		parameters: Type.Object({
			chain: Type.Optional(Type.String({ description: "Chain name to run (overrides active chain)" })),
			task: Type.String({ description: "The task/prompt for the chain to process" }),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { chain: chainName, task } = params as { chain?: string; task: string };
			// If chain name provided, find and activate that chain (even if activeChain is already set)
			if (chainName) {
				const found = chains.find(c => c.name.toLowerCase() === chainName.toLowerCase());
				if (found) {
					activateChain(found);
				} else {
					return {
						content: [{ type: "text", text: `Chain "${chainName}" not found. Available: ${chains.map(c => c.name).join(", ")}` }],
						details: { chain: chainName, task, status: "error" },
					};
				}
			}

			if (!activeChain) {
				return {
					content: [{ type: "text", text: "No chain active. Use /chain to activate one or pass chain parameter." }],
					details: { chain: chainName, task, status: "error" },
				};
			}

			if (onUpdate) {
				onUpdate({
					content: [{ type: "text", text: `Starting chain: ${activeChain?.name}...` }],
					details: { chain: activeChain?.name, task, status: "running" },
				});
			}

			const result = await runChain(task, ctx);

			const truncated = result.output.length > 8000
				? result.output.slice(0, 8000) + "\n\n... [truncated]"
				: result.output;

			const isHalted = (result as any).halted === true;
			const status = result.success ? "done" : isHalted ? "stopped" : "error";
			const summary = `[chain:${activeChain?.name}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

			return {
				content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
				details: {
					chain: activeChain?.name,
					task,
					status,
					elapsed: result.elapsed,
					fullOutput: result.output,
				},
			};
		},

		renderCall(args, theme) {
			const task = (args as any).task || "";
			const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
			return new Text(
				theme.fg("toolTitle", theme.bold("run_chain ")) +
				theme.fg("accent", activeChain?.name || "?") +
				theme.fg("dim", " — ") +
				theme.fg("muted", preview),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (options.isPartial || details.status === "running") {
				return new Text(
					theme.fg("accent", `● ${details.chain || "chain"}`) +
					theme.fg("dim", " running..."),
					0, 0,
				);
			}

			const statusIcon = details.status === "done" ? "✓"
				: details.status === "stopped" ? "⏸"
				: "✗";
			const statusColor = details.status === "done" ? "success"
				: details.status === "stopped" ? "warning"
				: "error";
			const elapsed = typeof details.elapsed === "number" ? Math.round(details.elapsed / 1000) : 0;
			const header = theme.fg(statusColor, `${statusIcon} ${details.chain}`) +
				theme.fg("dim", ` ${elapsed}s`);

			if (options.expanded && details.fullOutput) {
				const output = details.fullOutput.length > 4000
					? details.fullOutput.slice(0, 4000) + "\n... [truncated]"
					: details.fullOutput;
				return new Text(header + "\n" + theme.fg("muted", output), 0, 0);
			}

			return new Text(header, 0, 0);
		},
	});

	// ── chain_stop Tool ─────────────────────────

	pi.registerTool({
		name: "chain_stop",
		label: "Stop Chain",
		description: "Gracefully halt the chain with a structured report. Agents use this instead of returning partial results or erroring out.",
		parameters: Type.Object({
			received: Type.String({ description: "$ORIGINAL or $INPUT — what started this step" }),
			did: Type.String({ description: "What this agent did before stopping" }),
			issues: Type.Optional(Type.String({ description: "What went wrong or why stopping" })),
			status: Type.Union([
				Type.Literal("success"),
				Type.Literal("blocked"),
				Type.Literal("error"),
			], { description: "success=completed but stop, blocked=waiting on something, error=hit an error" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { received, did, issues, status } = params as {
				received: string;
				did: string;
				issues?: string;
				status: "success" | "blocked" | "error";
			};

			const report: ChainStopReport = { received, did, issues: issues || "", status };
			chainHalted = true;
			chainHaltReport = report;

			// Mark current step as stopped
			if (activeChain && stepStates.length > 0) {
				const currentStep = stepStates.find(s => s.status === "running");
				if (currentStep) {
					currentStep.status = "stopped";
					currentStep.lastWork = issues || "Chain stopped by agent";
					updateWidget();
				}
			}

			// Return special output that will be parsed by runChain
			const markerOutput = `__CHAIN_STOP__:${JSON.stringify(report)}__CHAIN_STOP_END__`;

			return {
				content: [{ type: "text", text: markerOutput }],
				details: { chain: activeChain?.name, status: "stopped", halted: true, haltReport: report },
			};
		},

		renderCall(args, theme) {
			const { received, status } = args as any;
			const preview = received?.length > 40 ? received.slice(0, 37) + "..." : (received || "");
			return new Text(
				theme.fg("toolTitle", theme.bold("chain_stop ")) +
				theme.fg("warning", status || "blocked") +
				theme.fg("dim", " — ") +
				theme.fg("muted", preview),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (details?.haltReport) {
				const { status, issues } = details.haltReport;
				return new Text(
					theme.fg("warning", "⏸ chain_stop ") +
					theme.fg("accent", status) +
					theme.fg("dim", " — ") +
					theme.fg("muted", issues?.slice(0, 50) || "no issues"),
					0, 0,
				);
			}
			return new Text(theme.fg("warning", "⏸ chain_stop"), 0, 0);
		},
	});

	// ── Commands ─────────────────────────────────

	pi.registerCommand("chain", {
		description: "Switch active chain",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (chains.length === 0) {
				ctx.ui.notify("No chains defined in .pi/agents/agent-chain.yaml", "warning");
				return;
			}

			const options = chains.map(c => {
				const steps = c.steps.map(s => displayName(s.agent)).join(" → ");
				const desc = c.description ? ` — ${c.description}` : "";
				return `${c.name}${desc} (${steps})`;
			});

			const choice = await ctx.ui.select("Select Chain", options);
			if (choice === undefined) return;

			const idx = options.indexOf(choice);
			activateChain(chains[idx]);
			const flow = chains[idx].steps.map(s => displayName(s.agent)).join(" → ");
			ctx.ui.setStatus("agent-chain", `Chain: ${chains[idx].name} (${chains[idx].steps.length} steps)`);
			ctx.ui.notify(
				`Chain: ${chains[idx].name}\n${chains[idx].description}\n${flow}`,
				"info",
			);
		},
	});

	pi.registerCommand("chain-list", {
		description: "List all available chains",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			if (chains.length === 0) {
				ctx.ui.notify("No chains defined in .pi/agents/agent-chain.yaml", "warning");
				return;
			}

			const list = chains.map(c => {
				const desc = c.description ? `  ${c.description}` : "";
				const steps = c.steps.map((s, i) =>
					`  ${i + 1}. ${displayName(s.agent)}`
				).join("\n");
				return `${c.name}:${desc ? "\n" + desc : ""}\n${steps}`;
			}).join("\n\n");

			ctx.ui.notify(list, "info");
		},
	});

	pi.registerCommand("chain-exit", {
		description: "Exit the active chain",
		handler: async (_args, ctx) => {
			if (!activeChain) {
				ctx.ui.notify("No chain is currently active.", "info");
				return;
			}
			const name = activeChain.name;
			activeChain = null;
			stepStates = [];
			ctx.ui.setStatus("agent-chain", null);
			ctx.ui.notify(`Exited chain: ${name}`, "info");
		},
	});

	pi.registerCommand("chain-stop", {
		description: "User-initiated chain stop — ask why before stopping",
		handler: async (_args, ctx) => {
			if (!activeChain) {
				ctx.ui.notify("No chain is currently active.", "info");
				return;
			}

			// Ask user why they're stopping
			const reason = await ctx.ui.input("Why are you stopping the chain?");
			userHaltReason = reason || "(no reason provided)";

			const currentStep = stepStates.find(s => s.status === "running");
			const stepName = currentStep ? displayName(currentStep.agent) : "unknown";
			const stepNum = stepStates.filter(s => s.status === "done").length + 1;

			// Mark current step as stopped
			if (currentStep) {
				currentStep.status = "stopped";
				currentStep.lastWork = `User stopped: ${userHaltReason}`;
				updateWidget();
			}

			ctx.ui.notify(
				`⏹ Chain stopped by user at step ${stepNum}/${activeChain.steps.length}\n\n` +
				`Reason: ${userHaltReason}\n\n` +
				`Would you like to: resume from here, abort entirely, or investigate?`,
				"warning",
			);
		},
	});

	pi.registerCommand("chain-history", {
		description: "Show recent chain runs",
		handler: async (_args, ctx) => {
			try {
				const runs = listRuns(15);
				if (runs.length === 0) {
					ctx.ui.notify("No chain runs found.", "info");
					return;
				}

				const lines = runs.map(r => {
					const icon = r.status === "done" ? "✓" : r.status === "error" ? "✗" : "⏸";
					const preserved = r.preserved ? " ⭐" : "";
					const elapsed = r.total_elapsed_ms ? ` (${Math.round(r.total_elapsed_ms / 1000)}s)` : "";
					const input = r.original_input.length > 50 ? r.original_input.slice(0, 47) + "..." : r.original_input;
					return `[${r.id}] ${icon} ${r.chain_name}${elapsed}${preserved}\n     ${input}`;
				});
				ctx.ui.notify(
					"Recent runs:\n\n" + lines.join("\n\n") +
					"\n\n/chain-run <id> — view details\n/chain-preserve <id> — preserve (or just /chain-preserve for last run)",
					"info",
				);

				ctx.ui.notify(
					"Recent chain runs:\n\n" + lines.join("\n\n") +
					"\n\nUse /chain-run <id> to view details",
					"info",
				);
			} catch (e) {
				ctx.ui.notify(`Failed to load history: ${e}`, "error");
			}
		},
	});

	pi.registerCommand("chain-run", {
		description: "View details of a chain run",
		handler: async (args, ctx) => {
			const runId = parseInt(args || "", 10);
			if (!runId || isNaN(runId)) {
				// Try to show last run
				try {
					const lastRun = getRun(null);
					if (!lastRun) {
						ctx.ui.notify("No chain runs found.", "info");
						return;
					}
					const steps = getRunSteps(lastRun.id!);
					displayRun(ctx, lastRun, steps);
				} catch (e) {
					ctx.ui.notify(`Failed: ${e}`, "error");
				}
				return;
			}

			try {
				const run = getRun(runId);
				if (!run) {
					ctx.ui.notify(`Run #${runId} not found.`, "warning");
					return;
				}
				const steps = getRunSteps(runId);
				displayRun(ctx, run, steps);
			} catch (e) {
				ctx.ui.notify(`Failed: ${e}`, "error");
			}
		},
	});

	pi.registerCommand("chain-preserve", {
		description: "Preserve last run or specific run from auto-purge",
		handler: async (args, ctx) => {
			let runId = parseInt(args || "", 10);

			// If no ID provided, use last run
			if (!runId || isNaN(runId)) {
				try {
					const lastRun = getRun(null);
					if (!lastRun) {
						ctx.ui.notify("No chain runs found.", "info");
						return;
					}
					runId = lastRun.id!;
				} catch (e) {
					ctx.ui.notify(`Failed: ${e}`, "error");
					return;
				}
			}

			try {
				preserveRun(runId);
				ctx.ui.notify(`⭐ Preserved run #${runId} (won't be auto-purged).`, "success");
			} catch (e) {
				ctx.ui.notify(`Failed: ${e}`, "error");
			}
		},
	});

	pi.registerCommand("chain-search", {
		description: "Search chain runs by input text",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify("Usage: /chain-search <query>", "warning");
				return;
			}
			try {
				const runs = searchRuns(args.trim(), 10);
				if (runs.length === 0) {
					ctx.ui.notify(`No runs found matching "${args}"`, "info");
					return;
				}
				const lines = runs.map(r => {
					const icon = r.status === "done" ? "✓" : r.status === "error" ? "✗" : "⏸";
					return `[${r.id}] ${icon} ${r.chain_name}: ${r.original_input.slice(0, 50)}...`;
				});
				ctx.ui.notify(`Found ${runs.length} run(s):\n\n` + lines.join("\n"), "info");
			} catch (e) {
				ctx.ui.notify(`Search failed: ${e}`, "error");
			}
		},
	});

	// Helper to display a run
	function displayRun(ctx: any, run: any, steps: any[]) {
		const icon = run.status === "done" ? "✓" : run.status === "error" ? "✗" : "⏸";
		const elapsed = run.total_elapsed_ms ? ` (${Math.round(run.total_elapsed_ms / 1000)}s)` : "";
		const preserved = run.preserved ? " ⭐" : "";

		let msg = `${icon} Run #${run.id}: ${run.chain_name}${elapsed}${preserved}\n`;
		msg += `Started: ${run.started_at}\n`;
		msg += `Input: ${run.original_input.slice(0, 200)}${run.original_input.length > 200 ? "..." : ""}\n\n`;

		for (const step of steps) {
			const stepIcon = step.status === "done" ? "✓" : step.status === "error" ? "✗" : "⏸";
			const stepElapsed = step.elapsed_ms ? ` (${Math.round(step.elapsed_ms / 1000)}s)` : "";
			msg += `${stepIcon} Step ${step.step_index + 1}: ${step.agent_name}${stepElapsed}\n`;
			if (step.step_output) {
				msg += `   Output: ${step.step_output.slice(0, 100)}${step.step_output.length > 100 ? "..." : ""}\n`;
			}
		}

		msg += `\nUse /chain-preserve ${run.id} to preserve this run.`;
		ctx.ui.notify(msg, "info");
	}

	// ── System Prompt Override ───────────────────

	pi.on("before_agent_start", async (_event, _ctx) => {
		// Force widget reset on first turn after /new
		if (pendingReset && activeChain) {
			pendingReset = false;
			widgetCtx = _ctx;
			stepStates = activeChain.steps.map(s => ({
				agent: s.agent,
				status: "pending" as const,
				elapsed: 0,
				lastWork: "",
			}));
			updateWidget();
		}

		if (!activeChain) return {};

		const flow = activeChain.steps.map(s => displayName(s.agent)).join(" → ");
		const desc = activeChain.description ? `\n${activeChain.description}` : "";

		// Build pipeline steps summary
		const steps = activeChain.steps.map((s, i) => {
			const agentDef = allAgents.get(s.agent.toLowerCase());
			const agentDesc = agentDef?.description || "";
			return `${i + 1}. **${displayName(s.agent)}** — ${agentDesc}`;
		}).join("\n");

		// Build full agent catalog (like agent-team.ts)
		const seen = new Set<string>();
		const agentCatalog = activeChain.steps
			.filter(s => {
				const key = s.agent.toLowerCase();
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.map(s => {
				const agentDef = allAgents.get(s.agent.toLowerCase());
				if (!agentDef) return `### ${displayName(s.agent)}\nAgent not found.`;
				return `### ${displayName(agentDef.name)}\n${agentDef.description}\n**Tools:** ${agentDef.tools}\n**Role:** ${agentDef.systemPrompt}`;
			})
			.join("\n\n");

		return {
			systemPrompt: `You are an agent with a sequential pipeline called "${activeChain.name}" at your disposal.${desc}
You have full access to your own tools AND the run_chain tool to delegate to your team.

## Active Chain: ${activeChain.name}
Flow: ${flow}

${steps}

## Agent Details

${agentCatalog}

## When to Use run_chain
- Significant work: new features, refactors, multi-file changes, anything non-trivial
- Tasks that benefit from the full pipeline: planning, building, reviewing
- When you want structured, multi-agent collaboration on a problem

## When to Work Directly
- Simple one-off commands: reading a file, checking status, listing contents
- Quick lookups, small edits, answering questions about the codebase
- Anything you can handle in a single step without needing the pipeline

## How run_chain Works
- Pass a clear task description to run_chain
- Each step's output feeds into the next step as $INPUT
- Agents maintain session context — they remember previous work within this session
- You can run the chain multiple times with different tasks if needed
- After the chain completes, review the result and summarize for the user

## Guidelines
- Use your judgment — if it's quick, just do it; if it's real work, run the chain
- Keep chain tasks focused and clearly described
- You can mix direct work and chain runs in the same conversation`,
		};
	});

	// ── Session Start ───────────────────────────

	pi.on("session_start", async (_event, _ctx) => {
		applyExtensionDefaults(import.meta.url, _ctx);
		// Clear widget with both old and new ctx — one of them will be valid
		if (widgetCtx) {
			widgetCtx.ui.setWidget("agent-chain", undefined);
		}
		_ctx.ui.setWidget("agent-chain", undefined);
		widgetCtx = _ctx;

		// Reset execution state — widget re-registration deferred to before_agent_start
		stepStates = [];
		activeChain = null;
		pendingReset = true;

		// Wipe chain session files — reset agent context on /new and launch
		const sessDir = join(_ctx.cwd, ".pi", "agent-sessions");
		if (existsSync(sessDir)) {
			for (const f of readdirSync(sessDir)) {
				if (f.startsWith("chain-") && f.endsWith(".json")) {
					try { unlinkSync(join(sessDir, f)); } catch {}
				}
			}
		}

		// Reload chains + clear agentSessions map (all agents start fresh)
		loadChains(_ctx.cwd);

		if (chains.length === 0) {
			_ctx.ui.notify("No chains found in .pi/agent/agent-chain.yaml", "warning");
			return;
		}

		// Show chain list on startup (but don't auto-activate)
		const list = chains.map(c => {
			const desc = c.description ? `  ${c.description}` : "";
			const steps = c.steps.map((s, i) =>
				`  ${i + 1}. ${displayName(s.agent)}`
			).join("\n");
			return `${c.name}:${desc ? "\n" + desc : ""}\n${steps}`;
		}).join("\n\n");

		_ctx.ui.notify(
			`Available chains (use /chain <name> to activate):\n\n${list}`,
			"info",
		);

		// Footer: model | chain name | context bar
		_ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = _ctx.model?.id || "no-model";
				const usage = _ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const chainLabel = activeChain
					? theme.fg("accent", activeChain.name)
					: theme.fg("dim", "no chain");

				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					chainLabel;
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}
