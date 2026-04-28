/**
 * Agent Team — Dispatcher-only orchestrator with grid dashboard
 *
 * The primary Pi agent has NO codebase tools. It can ONLY delegate work
 * to specialist agents via the `dispatch_agent` tool. Each specialist
 * maintains its own Pi session for cross-invocation memory.
 *
 * Loads agent definitions from workers/*.md, .claude/workers/*.md, .pi/workers/*.md.
 * Teams are defined in .pi/workers/teams.yaml or ~/.pi/agent/workers/teams/teams.yaml — on boot a select dialog lets
 * you pick which team to work with. Only team members are available for dispatch.
 *
 * Commands:
 *   /bench                — bench team, work solo
 *   /team help            — show all team commands
 *   /team list            — show available teams
 *   /team <name>          — deploy specific team
 *   /team bench           — same as /bench
 *   /team delete          — delete current team
 *   /team-create <name> <agent1> <agent2> ... — create a new team
 *   /deploy               — show team picker
 *   /deploy <name>        — deploy specific team
 *   /agents-list          — list loaded agents (current team only)
 *   /agents-grid N        — set column count (default 2)
 *
 * Usage: pi -e extensions/agent-team.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, type AutocompleteItem, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	file: string;
}

interface AgentState {
	def: AgentDef;
	status: "idle" | "running" | "done" | "error";
	task: string;
	toolCount: number;
	elapsed: number;
	lastWork: string;
	contextPct: number;
	sessionFile: string | null;
	runCount: number;
	timer?: ReturnType<typeof setInterval>;
}

// ── Display Name Helper ──────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Teams YAML Parser ────────────────────────────

function parseTeamsYaml(raw: string): Record<string, string[]> {
	const teams: Record<string, string[]> = {};
	let current: string | null = null;
	for (const line of raw.split("\n")) {
		const teamMatch = line.match(/^(\S[^:]*):$/);
		if (teamMatch) {
			current = teamMatch[1].trim();
			teams[current] = [];
			continue;
		}
		const itemMatch = line.match(/^\s+-\s+(.+)$/);
		if (itemMatch && current) {
			teams[current].push(itemMatch[1].trim());
		}
	}
	return teams;
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
			file: filePath,
		};
	} catch {
		return null;
	}
}

function scanAgentDirs(cwd: string): AgentDef[] {
	const homedir = process.env.HOME || "";
	const dirs = [
		join(cwd, "workers"),
		join(cwd, ".claude", "workers"),
		join(cwd, ".pi", "workers"),
		join(homedir, ".pi", "agent", "workers"),
		join(homedir, ".pi", "agent", "workers", "teams"),
	];

	const agents: AgentDef[] = [];
	const seen = new Set<string>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".md")) continue;
				const fullPath = resolve(dir, file);
				const def = parseAgentFile(fullPath);
				if (def && !seen.has(def.name.toLowerCase())) {
					seen.add(def.name.toLowerCase());
					agents.push(def);
				}
			}
		} catch {}
	}

	return agents;
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const agentStates: Map<string, AgentState> = new Map();
	let allAgentDefs: AgentDef[] = [];
	let teams: Record<string, string[]> = {};
	let activeTeamName = "";
	let gridCols = 2;
	let widgetCtx: any;
	let sessionDir = "";
	let contextWindow = 0;

	// Shared state file for mode coordination with forge
	const SHARED_STATE_FILE = join(process.env.HOME || "", ".pi", "agent", ".mode-state.json");

	function getSharedMode(): string {
		try {
			if (existsSync(SHARED_STATE_FILE)) {
				return JSON.parse(readFileSync(SHARED_STATE_FILE, "utf-8")).mode || "team";
			}
		} catch {}
		return "team";
	}

	function setSharedMode(mode: string) {
		try {
			writeFileSync(SHARED_STATE_FILE, JSON.stringify({ mode, timestamp: Date.now() }), "utf-8");
		} catch {}
	}

	function loadAgents(cwd: string) {
		sessionDir = join(cwd, ".pi", "agent-sessions");
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		// Load all agent definitions
		allAgentDefs = scanAgentDirs(cwd);

		// Load teams from .pi/workers/teams/teams.yaml and ~/.pi/agent/workers/teams/teams.yaml
		const teamsPaths = [
			join(cwd, ".pi", "workers", "teams", "teams.yaml"),
			join(process.env.HOME || "", ".pi", "agent", "workers", "teams", "teams.yaml"),
		];
		teams = {};
		for (const teamsPath of teamsPaths) {
			if (existsSync(teamsPath)) {
				try {
					const parsed = parseTeamsYaml(readFileSync(teamsPath, "utf-8"));
					teams = { ...teams, ...parsed };
				} catch (e) {
					console.error("[agent-team] Failed to parse", teamsPath, e);
				}
			}
		}

		// If no teams defined, create a default "all" team
		if (Object.keys(teams).length === 0) {
			teams = { all: allAgentDefs.map(d => d.name) };
		}
	}

	function saveTeamsYaml() {
		const teamsPath = join(sessionDir, "..", "workers", "teams", "teams.yaml");
		// Ensure teams directory exists
		const teamsDir = join(sessionDir, "..", "workers", "teams");
		if (!existsSync(teamsDir)) {
			mkdirSync(teamsDir, { recursive: true });
		}
		const lines: string[] = [];
		for (const [name, members] of Object.entries(teams)) {
			lines.push(`${name}:`);
			for (const member of members) {
				lines.push(`  - ${member}`);
			}
			lines.push("");
		}
		try {
			writeFileSync(teamsPath, lines.join("\n"), "utf-8");
		} catch (e) {
			console.error("[agent-team] Failed to save teams.yaml:", e);
		}
	}

	function activateTeam(teamName: string) {
		activeTeamName = teamName;
		const members = teams[teamName] || [];
		const defsByName = new Map(allAgentDefs.map(d => [d.name.toLowerCase(), d]));

		agentStates.clear();
		setSharedMode("team");
		for (const member of members) {
			const def = defsByName.get(member.toLowerCase());
			if (!def) continue;
			const key = def.name.toLowerCase().replace(/\s+/g, "-");
			const sessionFile = join(sessionDir, `${key}.json`);
			agentStates.set(def.name.toLowerCase(), {
				def,
				status: "idle",
				task: "",
				toolCount: 0,
				elapsed: 0,
				lastWork: "",
				contextPct: 0,
				sessionFile: existsSync(sessionFile) ? sessionFile : null,
				runCount: 0,
			});
		}

		// Auto-size grid columns based on team size
		const size = agentStates.size;
		gridCols = size <= 3 ? size : size === 4 ? 2 : 3;
	}

	// ── Grid Rendering ───────────────────────────

	function renderCard(state: AgentState, colWidth: number, theme: any): string[] {
		const w = colWidth - 2;
		const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;

		const statusColor = state.status === "idle" ? "dim"
			: state.status === "running" ? "accent"
			: state.status === "done" ? "success" : "error";
		const statusIcon = state.status === "idle" ? "○"
			: state.status === "running" ? "●"
			: state.status === "done" ? "✓" : "✗";

		const name = displayName(state.def.name);
		const nameStr = theme.fg("accent", theme.bold(truncate(name, w)));
		const nameVisible = Math.min(name.length, w);

		const statusStr = `${statusIcon} ${state.status}`;
		const timeStr = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
		const statusLine = theme.fg(statusColor, statusStr + timeStr);
		const statusVisible = statusStr.length + timeStr.length;

		// Context bar: 5 blocks + percent
		const filled = Math.ceil(state.contextPct / 20);
		const bar = "#".repeat(filled) + "-".repeat(5 - filled);
		const ctxStr = `[${bar}] ${Math.ceil(state.contextPct)}%`;
		const ctxLine = theme.fg("dim", ctxStr);
		const ctxVisible = ctxStr.length;

		const workRaw = state.task
			? (state.lastWork || state.task)
			: state.def.description;
		const workText = truncate(workRaw, Math.min(50, w - 1));
		const workLine = theme.fg("muted", workText);
		const workVisible = workText.length;

		const top = "┌" + "─".repeat(w) + "┐";
		const bot = "└" + "─".repeat(w) + "┘";
		const border = (content: string, visLen: number) =>
			theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - visLen)) + theme.fg("dim", "│");

		return [
			theme.fg("dim", top),
			border(" " + nameStr, 1 + nameVisible),
			border(" " + statusLine, 1 + statusVisible),
			border(" " + ctxLine, 1 + ctxVisible),
			border(" " + workLine, 1 + workVisible),
			theme.fg("dim", bot),
		];
	}

	function updateWidget() {
		if (!widgetCtx) return;

		widgetCtx.ui.setWidget("agent-team", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					if (agentStates.size === 0) {
						text.setText(theme.fg("dim", "No agents found. Add .md files to workers/"));
						return text.render(width);
					}

					const cols = Math.min(gridCols, agentStates.size);
					const gap = 1;
					const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
					const agents = Array.from(agentStates.values());
					const rows: string[][] = [];

					for (let i = 0; i < agents.length; i += cols) {
						const rowAgents = agents.slice(i, i + cols);
						const cards = rowAgents.map(a => renderCard(a, colWidth, theme));

						while (cards.length < cols) {
							cards.push(Array(6).fill(" ".repeat(colWidth)));
						}

						const cardHeight = cards[0].length;
						for (let line = 0; line < cardHeight; line++) {
							rows.push(cards.map(card => card[line] || ""));
						}
					}

					const output = rows.map(cols => cols.join(" ".repeat(gap)));
					text.setText(output.join("\n"));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	// ── Dispatch Agent (returns Promise) ─────────

	function dispatchAgent(
		agentName: string,
		task: string,
		ctx: any,
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		const key = agentName.toLowerCase();
		const state = agentStates.get(key);
		if (!state) {
			return Promise.resolve({
				output: `Agent "${agentName}" not found. Available: ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		if (state.status === "running") {
			return Promise.resolve({
				output: `Agent "${displayName(state.def.name)}" is already running. Wait for it to finish.`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		state.status = "running";
		state.task = task;
		state.toolCount = 0;
		state.elapsed = 0;
		state.lastWork = "";
		state.runCount++;
		updateWidget();

		const startTime = Date.now();
		state.timer = setInterval(() => {
			state.elapsed = Date.now() - startTime;
			updateWidget();
		}, 1000);

		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "openrouter/google/gemini-3-flash-preview";

		// Session file for this agent
		const agentKey = state.def.name.toLowerCase().replace(/\s+/g, "-");
		const agentSessionFile = join(sessionDir, `${agentKey}.json`);

		// Build args — first run creates session, subsequent runs resume
		// Workers get task-mode extension for task management
		const args = [
			"--mode", "json",
			"-p",
			"-e", ".pi/agent/extensions/task-mode/index.ts",
			"--model", model,
			"--tools", state.def.tools,
			"--thinking", "off",
			"--append-system-prompt", state.def.systemPrompt + "\n\n## Task Mode\nWhen given multiple tasks, use the add_task tool to queue ALL tasks, then work through them one by one.\nOn task completion, use complete_task to mark done. When ALL tasks are complete, use clear_tasks to wipe the queue.\nKeep the task UI active so the lead agent can see progress.",
			"--session", agentSessionFile,
		];

		// Continue existing session if we have one
		if (state.sessionFile) {
			args.push("-c");
		}

		args.push(task);

		// DEBUG: Log command
		const cmdStr = args.join(" ");
		try { writeFileSync("/tmp/pi-agent-team-debug.txt", `CMD: pi ${cmdStr}\n`, "utf-8"); } catch {}

		const textChunks: string[] = [];

		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			});

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
						} else if (event.type === "tool_execution_start") {
							state.toolCount++;
							updateWidget();
						} else if (event.type === "message_end") {
							const msg = event.message;
							if (msg?.usage && contextWindow > 0) {
								state.contextPct = ((msg.usage.input || 0) / contextWindow) * 100;
								updateWidget();
							}
						} else if (event.type === "agent_end") {
							const msgs = event.messages || [];
							const last = [...msgs].reverse().find((m: any) => m.role === "assistant");
							if (last?.usage && contextWindow > 0) {
								state.contextPct = ((last.usage.input || 0) / contextWindow) * 100;
								updateWidget();
							}
						}
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			const errLines: string[] = [];
			proc.stderr!.on("data", (d: string) => errLines.push(d));

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

				clearInterval(state.timer);
				state.elapsed = Date.now() - startTime;
				state.status = code === 0 ? "done" : "error";

				// Mark session file as available for resume
				if (code === 0) {
					state.sessionFile = agentSessionFile;
				}

				const full = textChunks.join("");
				const errOutput = errLines.join("").trim();
				const combined = errOutput ? `STDOUT:\n${full}\n\nSTDERR:\n${errOutput}` : full;
				state.lastWork = full.split("\n").filter((l: string) => l.trim()).pop() || errOutput || "";
				updateWidget();

				ctx.ui.notify(
					`${displayName(state.def.name)} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : "error"
				);

				resolve({
					output: combined,
					exitCode: code ?? 1,
					elapsed: state.elapsed,
				});
			});

			proc.on("error", (err) => {
				clearInterval(state.timer);
				state.status = "error";
				const errOutput = errLines.join("").trim();
				state.lastWork = `Error: ${err.message}${errOutput ? "\n" + errOutput : ""}`;
				updateWidget();
				resolve({
					output: `Error spawning agent: ${err.message}\n${errOutput}`,
					exitCode: 1,
					elapsed: Date.now() - startTime,
				});
			});
		});
	}

	// ── dispatch_agent Tool (registered at top level) ──

	pi.registerTool({
		name: "dispatch_agent",
		label: "Dispatch Agent",
		description: "Dispatch a task to a specialist agent. The agent will execute the task and return the result. Use the system prompt to see available agent names.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent name (case-insensitive)" }),
			task: Type.String({ description: "Task description for the agent to execute" }),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { agent, task } = params as { agent: string; task: string };

			try {
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: `Dispatching to ${agent}...` }],
						details: { agent, task, status: "dispatching" },
					});
				}

				const result = await dispatchAgent(agent, task, ctx);

				const truncated = result.output.length > 8000
					? result.output.slice(0, 8000) + "\n\n... [truncated]"
					: result.output;

				const status = result.exitCode === 0 ? "done" : "error";
				const summary = `[${agent}] ${status} in ${Math.round(result.elapsed / 1000)}s`;

				return {
					content: [{ type: "text", text: `${summary}\n\n${truncated}` }],
					details: {
						agent,
						task,
						status,
						elapsed: result.elapsed,
						exitCode: result.exitCode,
						fullOutput: result.output,
					},
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `Error dispatching to ${agent}: ${err?.message || err}` }],
					details: { agent, task, status: "error", elapsed: 0, exitCode: 1, fullOutput: "" },
				};
			}
		},

		renderCall(args, theme) {
			const agentName = (args as any).agent || "?";
			const task = (args as any).task || "";
			const preview = task.length > 60 ? task.slice(0, 57) + "..." : task;
			return new Text(
				theme.fg("toolTitle", theme.bold("dispatch_agent ")) +
				theme.fg("accent", agentName) +
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

			// Streaming/partial result while agent is still running
			if (options.isPartial || details.status === "dispatching") {
				return new Text(
					theme.fg("accent", `● ${details.agent || "?"}`) +
					theme.fg("dim", " working..."),
					0, 0,
				);
			}

			const icon = details.status === "done" ? "✓" : "✗";
			const color = details.status === "done" ? "success" : "error";
			const elapsed = typeof details.elapsed === "number" ? Math.round(details.elapsed / 1000) : 0;
			const header = theme.fg(color, `${icon} ${details.agent}`) +
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

	// ── Commands ─────────────────────────────────

	pi.registerCommand("agents-team", {
		description: "Select a team to work with",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;
			const teamNames = Object.keys(teams);
			if (teamNames.length === 0) {
				ctx.ui.notify("No teams defined. Create .pi/workers/teams.yaml or ~/.pi/agent/workers/teams/teams.yaml", "warning");
				return;
			}

			const options = teamNames.map(name => {
				const members = teams[name].map(m => displayName(m));
				return `${name} — ${members.join(", ")}`;
			});

			const choice = await ctx.ui.select("Select Team", options);
			if (choice === undefined) return;

			const idx = options.indexOf(choice);
			const name = teamNames[idx];
			activateTeam(name);
			updateWidget();
			ctx.ui.setStatus("agent-team", `Team: ${name} (${agentStates.size})`);
			ctx.ui.notify(`Team: ${name} — ${Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ")}`, "info");
		},
	});

	pi.registerCommand("agents-list", {
		description: "List all loaded agents",
		handler: async (_args, _ctx) => {
			widgetCtx = _ctx;
			const names = Array.from(agentStates.values())
				.map(s => {
					const session = s.sessionFile ? "resumed" : "new";
					return `${displayName(s.def.name)} (${s.status}, ${session}, runs: ${s.runCount}): ${s.def.description}`;
				})
				.join("\n");
			_ctx.ui.notify(names || "No agents loaded", "info");
		},
	});

	pi.registerCommand("agents-grid", {
		description: "Set grid columns: /agents-grid <1-6>",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items = ["1", "2", "3", "4", "5", "6"].map(n => ({
				value: n,
				label: `${n} columns`,
			}));
			const filtered = items.filter(i => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : items;
		},
		handler: async (args, _ctx) => {
			widgetCtx = _ctx;
			const n = parseInt(args?.trim() || "", 10);
			if (n >= 1 && n <= 6) {
				gridCols = n;
				_ctx.ui.notify(`Grid set to ${gridCols} columns`, "info");
				updateWidget();
			} else {
				_ctx.ui.notify("Usage: /agents-grid <1-6>", "error");
			}
		},
	});

	// ── Team Bench / Deploy Commands ──────────────

	pi.registerCommand("bench", {
		description: "Bench the team — hide dashboard and work solo",
		handler: async (_args, ctx) => {
			if (!activeTeamName) {
				ctx.ui.notify("Already on bench (no team active).", "info");
				return;
			}
			const benched = activeTeamName;
			activeTeamName = "";
			agentStates.clear();
			ctx.ui.setWidget("agent-team", undefined);
			ctx.ui.setStatus("agent-team", null);
			setSharedMode("bench");
			ctx.ui.notify("[STOP] Benched team \"" + benched + "\". You're on your own now.", "info");
		},
	});

	pi.registerCommand("team", {
		description: "Team management: /team help, list, <name>, bench, create",
		handler: async (args, ctx) => {
			const subcmd = (args || "").trim().toLowerCase();

			// /team help
			if (subcmd === "help" || subcmd === "--help" || subcmd === "-h") {
				ctx.ui.notify(
					"Team Commands:\n\n" +
					"/bench          — bench current team, work solo\n" +
					"/team list      — show all teams\n" +
					"/team bench     — same as /bench\n" +
					"/team <name>    — deploy a team\n" +
					"/team delete    — delete current team\n" +
					"/team-create    — create a new team\n\n" +
					"Teams: .pi/workers/teams.yaml or ~/.pi/agent/workers/teams/teams.yaml\n" +
					"Agents: .md files in agents/ subdirs",
					"info"
				);
				return;
			}

			// /team list
			if (subcmd === "list" || subcmd === "") {
				const teamNames = Object.keys(teams);
				if (teamNames.length === 0) {
					ctx.ui.notify("No teams defined. Create .pi/workers/teams.yaml or ~/.pi/agent/workers/teams/teams.yaml", "warning");
					return;
				}
				const activeSuffix = activeTeamName ? " (active: " + activeTeamName + ")" : " (no team active)";
				const listLines: string[] = [];
				for (const name of teamNames) {
					const members = teams[name].map(m => displayName(m)).join(", ");
					const marker = name === activeTeamName ? " ← current" : "";
					listLines.push("• " + name + marker + "\n  " + members);
				}
				ctx.ui.notify("Available teams" + activeSuffix + ":\n\n" + listLines.join("\n\n") + "\n\n/deploy <name> to activate", "info");
				return;
			}

			// /bench
			if (subcmd === "bench") {
				if (!activeTeamName) {
					ctx.ui.notify("Already on bench.", "info");
					return;
				}
				const benched = activeTeamName;
				activeTeamName = "";
				agentStates.clear();
				ctx.ui.setWidget("agent-team", undefined);
				ctx.ui.setStatus("agent-team", null);
				ctx.ui.notify("[STOP] Benched team \"" + benched + "\". You're solo.", "info");
				return;
			}

			// /team delete
			if (subcmd === "delete") {
				if (!activeTeamName) {
					ctx.ui.notify("No team is currently active to delete.", "info");
					return;
				}
				delete teams[activeTeamName];
				saveTeamsYaml();
				ctx.ui.notify("Deleted team \"" + activeTeamName + "\".", "info");
				agentStates.clear();
				activeTeamName = "";
				ctx.ui.setWidget("agent-team", undefined);
				ctx.ui.setStatus("agent-team", null);
				return;
			}

			// Unknown command
			ctx.ui.notify("Unknown command. /team help for available commands.", "warning");
		},
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items = ["list", "bench", "delete", "help"].map(n => ({ value: n, label: n }));
			const filtered = items.filter(i => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : items;
		},
	});

	pi.registerCommand("team-create", {
		description: "Create a new team: /team-create <name> <agent1> <agent2> ...",
		handler: async (args, ctx) => {
			const parts = (args || "").trim().split(/\s+/);
			if (parts.length < 2 || parts[0] === "") {
				const agentsList = allAgentDefs.map(a => a.name).join(", ");
				ctx.ui.notify(
					"Usage: /team-create <name> <agent1> <agent2> ...\n\n" +
					"Example: /team-create myteam scout worker reviewer\n\n" +
					"Available agents:\n  " + agentsList,
					"info"
				);
				return;
			}

			const teamName = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
			const agentNames = parts.slice(1);

			// Verify agents exist
			const agentLowerMap = new Map(allAgentDefs.map(a => [a.name.toLowerCase(), a.name]));
			const validAgents: string[] = [];
			const invalid: string[] = [];

			for (const name of agentNames) {
				const matched = agentLowerMap.get(name.toLowerCase());
				if (matched) {
					validAgents.push(matched);
				} else {
					invalid.push(name);
				}
			}

			if (invalid.length > 0) {
				ctx.ui.notify("Unknown agents: " + invalid.join(", ") + ". /agents-list to see available.", "warning");
			}

			if (validAgents.length === 0) {
				ctx.ui.notify("No valid agents provided.", "error");
				return;
			}

			teams[teamName] = validAgents;
			saveTeamsYaml();

			const memberList = validAgents.join(", ");
			ctx.ui.notify(
				"[OK] Created team \"" + teamName + "\" with " + validAgents.length + " members:\n" +
				"  " + memberList + "\n\n" +
				"Use /team " + teamName + " to deploy",
				"success"
			);
		},
	});

	pi.registerCommand("deploy", {
		description: "Deploy a team: /deploy <name> (or just /deploy to pick)",
		handler: async (args, ctx) => {
			const teamName = (args || "").trim().toLowerCase();

			if (!teamName) {
				// Show picker
				const teamNames = Object.keys(teams);
				if (teamNames.length === 0) {
					ctx.ui.notify("No teams defined. Create .pi/workers/teams.yaml or ~/.pi/agent/workers/teams/teams.yaml", "warning");
					return;
				}
				const options = teamNames.map(name => {
					const members = teams[name].map(m => displayName(m)).join(", ");
					return `${name} — ${members}`;
				});
				const choice = await ctx.ui.select("Deploy Team", options);
				if (choice === undefined) return;
				const idx = options.indexOf(choice);
				const name = teamNames[idx];
				activateTeam(name);
				widgetCtx = ctx;
				updateWidget();
				ctx.ui.setStatus("agent-team", `Team: ${name}`);
				ctx.ui.notify("[DEPLOY] Deployed team \"" + name + "\" with " + agentStates.size + " members", "success");
				return;
			}

			// Deploy by name
			if (teams[teamName]) {
				activateTeam(teamName);
				widgetCtx = ctx;
				updateWidget();
				ctx.ui.setStatus("agent-team", `Team: ${teamName}`);
				ctx.ui.notify("[DEPLOY] Deployed team \"" + teamName + "\" with " + agentStates.size + " members", "success");
				return;
			}

			ctx.ui.notify("Unknown team \"" + teamName + "\". /team list to see available.", "warning");
		},
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const teamNames = Object.keys(teams);
			const items = teamNames.map(n => ({ value: n, label: n }));
			const filtered = items.filter(i => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : items;
		},
	});

	// ── System Prompt Override ───────────────────

	pi.on("before_agent_start", async (_event, _ctx) => {
		// Build dynamic agent catalog from active team only
		const agentCatalog = Array.from(agentStates.values())
			.map(s => `### ${displayName(s.def.name)}\n**Dispatch as:** \`${s.def.name}\`\n${s.def.description}\n**Tools:** ${s.def.tools}`)
			.join("\n\n");

		const teamMembers = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");

		return {
			systemPrompt: `You are a dispatcher agent. You coordinate specialist agents to accomplish tasks.
You do NOT have direct access to the codebase. You MUST delegate all work through
agents using the dispatch_agent tool.

## Active Team: ${activeTeamName}
Members: ${teamMembers}
You can ONLY dispatch to agents listed below. Do not attempt to dispatch to agents outside this team.

## How to Work
- Analyze the user's request and break it into clear sub-tasks
- Choose the right agent(s) for each sub-task
- **CRITICAL: When dispatching a worker, give them ALL tasks they will need to complete in ONE call**
- Workers will use task mode to manage and complete tasks one by one
- Do NOT dispatch again to same worker while they have pending tasks
- Review results after worker completes all tasks, then dispatch follow-up agents if needed
- If a task fails, try a different agent or adjust the task description
- Summarize the outcome for the user

## Rules
- NEVER try to read, write, or execute code directly — you have no such tools
- ALWAYS use dispatch_agent to get work done
- **Give ALL tasks to a worker in ONE dispatch — workers persist until all tasks done**
- You can chain agents: use scout to explore, then builder to implement
- Keep tasks focused — but comprehensive enough for the worker to complete autonomously

## Agents

${agentCatalog}`,
		};
	});

	// ── Session Start ────────────────────────────

	pi.on("session_start", async (_event, _ctx) => {
		// Clear widgets from previous session
		if (widgetCtx) {
			widgetCtx.ui.setWidget("agent-team", undefined);
		}
		widgetCtx = _ctx;
		contextWindow = _ctx.model?.contextWindow || 0;

		// Wipe old agent session files so subagents start fresh
		const sessDir = join(_ctx.cwd, ".pi", "agent-sessions");
		if (existsSync(sessDir)) {
			for (const f of readdirSync(sessDir)) {
				if (f.endsWith(".json")) {
					try { unlinkSync(join(sessDir, f)); } catch {}
				}
			}
		}

		// Check shared mode — don't activate team if forge is active
		const mode = getSharedMode();
		if (mode === "forge") {
			return; // Stay inactive, forge will handle its own activation
		}

		loadAgents(_ctx.cwd);

		// Default to first team — use /agents-team to switch
		const teamNames = Object.keys(teams);
		if (teamNames.length > 0) {
			activateTeam(teamNames[0]);
		}

		// Lock down to dispatcher-only (tool already registered at top level)
		pi.setActiveTools(["dispatch_agent"]);

		_ctx.ui.setStatus("agent-team", `Team: ${activeTeamName} (${agentStates.size})`);
		const members = Array.from(agentStates.values()).map(s => displayName(s.def.name)).join(", ");
		_ctx.ui.notify(
			`Team: ${activeTeamName} (${members})\n` +
			`Team sets loaded from: .pi/workers/teams.yaml and ~/.pi/agent/workers/teams/teams.yaml\n\n` +
			`/agents-team          Select a team\n` +
			`/agents-list          List active agents and status\n` +
			`/agents-grid <1-6>    Set grid column count`,
			"info",
		);
		updateWidget();

		// Footer: model | team | context bar
		_ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = _ctx.model?.id || "no-model";
				const usage = _ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", activeTeamName);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}
