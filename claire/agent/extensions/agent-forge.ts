/**
 * Forge — Meta-agent that builds Pi agents
 *
 * A team of domain-specific research experts (extensions, themes, skills,
 * settings, TUI) operate in PARALLEL to gather documentation and patterns.
 * The primary agent synthesizes their findings and WRITES the actual files.
 *
 * Each expert fetches fresh Pi documentation via firecrawl on first query.
 * Experts are read-only researchers. The primary agent is the only writer.
 *
 * Commands:
 *   /forge          — activate forge and pick an item to build
 *   /forge-exit     — close forge, clear experts, deploy your team
 *   /experts          — list available experts and their status
 *   /experts-grid N   — set dashboard column count (default 3)
 *
 * Usage: pi -e extensions/forge.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface ExpertDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	file: string;
}

interface ExpertState {
	def: ExpertDef;
	status: "idle" | "researching" | "done" | "error";
	question: string;
	elapsed: number;
	lastLine: string;
	queryCount: number;
	timer?: ReturnType<typeof setInterval>;
}

interface ForgeSection {
	name: string;
	description: string;
	structure: string[];
}

interface ForgeOutput {
	type: "md" | "yaml" | "json" | "ts";
	body: string;
}

interface ForgeDestination {
	path: string;
	filename: string;
}

interface ForgeItem {
	name: string;
	description: string;
	experts: string[];
	sections: ForgeSection[];
	output: ForgeOutput;
	destination: ForgeDestination;
}

// ── Helpers ──────────────────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function parseAgentFile(filePath: string): ExpertDef | null {
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

// ── Expert card colors ────────────────────────────
// Each expert gets a unique hue: bg fills the card interior,
// br is the matching border foreground (brighter shade of same hue).
const EXPERT_COLORS: Record<string, { bg: string; br: string }> = {
	"agent-expert":      { bg: "\x1b[48;2;20;30;75m",  br: "\x1b[38;2;70;110;210m"  }, // navy
	"config-expert":     { bg: "\x1b[48;2;18;65;30m",  br: "\x1b[38;2;55;175;90m"   }, // forest
	"ext-expert":        { bg: "\x1b[48;2;80;18;28m",  br: "\x1b[38;2;210;65;85m"   }, // crimson
	"keybinding-expert": { bg: "\x1b[48;2;50;22;85m",  br: "\x1b[38;2;145;80;220m"  }, // violet
	"prompt-expert":     { bg: "\x1b[48;2;80;55;12m",  br: "\x1b[38;2;215;150;40m"  }, // amber
	"skill-expert":      { bg: "\x1b[48;2;12;65;75m",  br: "\x1b[38;2;40;175;195m"  }, // teal
	"theme-expert":      { bg: "\x1b[48;2;80;18;62m",  br: "\x1b[38;2;210;55;160m"  }, // rose
	"tui-expert":        { bg: "\x1b[48;2;28;42;80m",  br: "\x1b[38;2;85;120;210m"  }, // slate
	"cli-expert":        { bg: "\x1b[48;2;60;80;20m",  br: "\x1b[38;2;160;210;55m"  }, // olive/lime
};
const FG_RESET = "\x1b[39m";
const BG_RESET = "\x1b[49m";

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const experts: Map<string, ExpertState> = new Map();
	let gridCols = 3;
	let widgetCtx: any;
	let forgeActive = false;
	let forgeItems: Map<string, ForgeItem> = new Map();
	let activeForgeItem: ForgeItem | null = null;

	// Shared state for coordination with agent-team
	const SHARED_STATE_FILE = join(process.env.HOME || "", ".pi", "agent", ".mode-state.json");

	function setSharedMode(mode: string) {
		try {
			writeFileSync(SHARED_STATE_FILE, JSON.stringify({ mode, timestamp: Date.now() }), "utf-8");
		} catch {}
	}

	interface ForgeListItem {
		name: string;
		label: string;
		description: string;
	}

	function loadForgeItems(): ForgeListItem[] {
		const homedir = process.env.HOME || "";
		const forgeYamlPath = join(homedir, ".pi", "agent", "workers", "forge", "forge.yaml");
		forgeItems.clear();

		if (!existsSync(forgeYamlPath)) return [];

		try {
			const raw = readFileSync(forgeYamlPath, "utf-8");
			const lines = raw.split("\n");
			let inForgeList = false;
			let inItemConfig = false;
			let currentItemName: string | null = null;
			let currentSection: string | null = null;
			let itemConfig: any = {};
			const forgeList: ForgeListItem[] = [];

			// Temp storage for forge-list parsing
			let listItemName: string | null = null;
			let listItem: any = {};

			for (const line of lines) {
				// Skip empty lines and comments
				if (!line.trim() || line.trim().startsWith("#")) continue;


				// Start of forge-list section
				if (line.trim() === "forge-list:") {
					inForgeList = true;
					inItemConfig = false;
					continue;
				}

				// Top-level key (not indented) - this ends any section and starts an item
				if (line.match(/^\w+:/)) {
					// Save previous item config if it exists
					if (inItemConfig && currentItemName && itemConfig.experts && itemConfig.experts.length > 0) {
						forgeItems.set(currentItemName, itemConfig);
						console.log("[forge] Saved:", currentItemName);
					}
					// If we were in forge-list, save any pending item first
					if (inForgeList && listItemName) {
						forgeList.push({ name: listItemName, label: listItem.label || listItemName, description: listItem.description || "" });
						listItemName = null;
						listItem = {};
					}
					inForgeList = false;
					inItemConfig = true;
					const match = line.match(/^(\w+):/);
					if (match) {
						currentItemName = match[1];
						itemConfig = { name: currentItemName, description: "", experts: [], sections: [], output: { type: "md", template: "" }, destination: { path: "", filename: "" } };
					}
					currentSection = null;
					continue;
				}

				// Parse forge-list entries
				if (inForgeList) {
					const nameMatch = line.match(/^\s+-\s+name:\s*(\w+)/);
					if (nameMatch) {
						listItemName = nameMatch[1];
						listItem = { name: listItemName };
						continue;
					}
					const labelMatch = line.match(/^\s+label:\s*"?([^"]+)/);
					if (labelMatch && listItemName) {
						listItem.label = labelMatch[1].trim();
						continue;
					}
					const descMatch = line.match(/^\s+description:\s*"?([^"]+)/);
					if (descMatch && listItemName) {
						listItem.description = descMatch[1].trim();
						forgeList.push({ name: listItemName, label: listItem.label || listItemName, description: listItem.description });
						listItemName = null;
						listItem = {};
					}
					continue;
				}

				// Parse full item configs
				if (inItemConfig && currentItemName) {
					if (line.match(/^\s+experts:/)) {
						currentSection = "experts";
						console.log("[forge] Found experts section for", currentItemName);
					} else if (line.match(/^\s+sections:/)) {
						currentSection = "sections";
					} else if (line.match(/^\s+output:/)) {
						currentSection = "output";
					} else if (line.match(/^\s+destination:/)) {
						currentSection = "destination";
					} else if (line.match(/^\s+-\s+(\S+)/) && currentSection === "experts") {
						const m = line.match(/^\s+-\s+(\S+)/);
						if (m) {
							itemConfig.experts.push(m[1]);
							console.log("[forge] Added expert:", m[1]);
						}
					} else if (line.match(/^\s+type:/) && currentItemName && currentSection === "output") {
						itemConfig.output.type = line.split(":")[1].trim() as any;
					} else if (line.match(/^\s+path:/) && currentItemName && currentSection === "destination") {
						itemConfig.destination.path = line.split(":")[1].trim();
					} else if (line.match(/^\s+filename:/) && currentItemName && currentSection === "destination") {
						itemConfig.destination.filename = line.split(":")[1].trim();
					} else if (line.match(/^\s+description:/) && currentItemName && !currentSection) {
						itemConfig.description = line.split(":")[1].trim();
					} else if (line.match(/^\s+-\s+name:/) && currentItemName && currentSection === "sections") {
						itemConfig.sections.push({ name: line.split("name:")[1].trim(), description: "", fields: [] });
					} else if (line.match(/^\s+description:/) && currentItemName && currentSection === "sections") {
						const lastSection = itemConfig.sections[itemConfig.sections.length - 1];
						if (lastSection) lastSection.description = line.split(":")[1].trim();
					} else if (line.trim() && currentItemName && currentSection === "output" && line.startsWith("    ")) {
						itemConfig.output.template += line.replace(/^\s{4}/, "") + "\n";
					}
				}
			}

			// Save last item config
			if (inItemConfig && currentItemName && itemConfig.experts && itemConfig.experts.length > 0) {
				forgeItems.set(currentItemName, itemConfig);
			}

			return forgeList;
		} catch (e) {
			console.error("[forge] Failed to load forge.yaml:", e);
			return [];
		}
	}

	function debugForgeYaml() {
		const homedir = process.env.HOME || "";
		const forgeYamlPath = join(homedir, ".pi", "agent", "workers", "forge", "forge.yaml");
		if (!existsSync(forgeYamlPath)) {
			console.log("[forge-debug] YAML not found at:", forgeYamlPath);
			return;
		}
		console.log("[forge-debug] YAML found at:", forgeYamlPath);
		console.log("[forge-debug] forgeItems after load:", Array.from(forgeItems.keys()));
		console.log("[forge-debug] agent item experts:", forgeItems.get("agent")?.experts);
	}

	function loadExpertsForItem(item: ForgeItem) {
		const homedir = process.env.HOME || "";
		const forgeDir = join(homedir, ".pi", "agent", "workers", "forge");
		experts.clear();

		for (const expertName of item.experts) {
			const expertFile = join(forgeDir, expertName + ".md");
			if (existsSync(expertFile)) {
				const def = parseAgentFile(expertFile);
				if (def) {
					experts.set(def.name.toLowerCase(), {
						def,
						status: "idle",
						question: "",
						elapsed: 0,
						lastLine: "",
						queryCount: 0,
					});
				}
			}
		}
	}

	function loadExperts(cwd: string) {
		// Forge experts live in their own dedicated directory
		const homedir = process.env.HOME || "";
		const forgeDir = join(homedir, ".pi", "agent", "workers", "forge");

		experts.clear();

		if (!existsSync(forgeDir)) return;
		try {
			for (const file of readdirSync(forgeDir)) {
				if (!file.endsWith(".md")) continue;
				if (file === "frg-orchestrator.md") continue;
				const fullPath = resolve(forgeDir, file);
				const def = parseAgentFile(fullPath);
				if (def) {
					const key = def.name.toLowerCase();
					if (!experts.has(key)) {
						experts.set(key, {
							def,
							status: "idle",
							question: "",
							elapsed: 0,
							lastLine: "",
							queryCount: 0,
						});
					}
				}
			}
		} catch {}
	}

	// ── Grid Rendering ───────────────────────────

	function renderCard(state: ExpertState, colWidth: number, theme: any): string[] {
		const w = colWidth - 2;
		const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;

		const statusColor = state.status === "idle" ? "dim"
			: state.status === "researching" ? "accent"
			: state.status === "done" ? "success" : "error";
		const statusIcon = state.status === "idle" ? "○"
			: state.status === "researching" ? "◉"
			: state.status === "done" ? "✓" : "✗";

		const name = displayName(state.def.name);
		const nameStr = theme.fg("accent", theme.bold(truncate(name, w)));
		const nameVisible = Math.min(name.length, w);

		const statusStr = `${statusIcon} ${state.status}`;
		const timeStr = state.status !== "idle" ? ` ${Math.round(state.elapsed / 1000)}s` : "";
		const queriesStr = state.queryCount > 0 ? ` (${state.queryCount})` : "";
		const statusLine = theme.fg(statusColor, statusStr + timeStr + queriesStr);
		const statusVisible = statusStr.length + timeStr.length + queriesStr.length;

		const workRaw = state.question || state.def.description;
		const workText = truncate(workRaw, Math.min(50, w - 1));
		const workLine = theme.fg("muted", workText);
		const workVisible = workText.length;

		const lastRaw = state.lastLine || "";
		const lastText = truncate(lastRaw, Math.min(50, w - 1));
		const lastLineRendered = lastText ? theme.fg("dim", lastText) : theme.fg("dim", "—");
		const lastVisible = lastText ? lastText.length : 1;

		const colors = EXPERT_COLORS[state.def.name];
		const bg  = colors?.bg ?? "";
		const br  = colors?.br ?? "";
		const bgr = bg ? BG_RESET : "";
		const fgr = br ? FG_RESET : "";

		// br colors the box-drawing characters; bg fills behind them so the
		// full card — top line, side bars, bottom line — is one solid block.
		const bord = (s: string) => bg + br + s + bgr + fgr;

		const top = "┌" + "─".repeat(w) + "┐";
		const bot = "└" + "─".repeat(w) + "┘";

		// bg fills the inner content area; re-applied before padding to ensure
		// the full row is colored even if theme.fg uses a full ANSI reset inside.
		const border = (content: string, visLen: number) => {
			const pad = " ".repeat(Math.max(0, w - visLen));
			return bord("│") + bg + content + bg + pad + bgr + bord("│");
		};

		return [
			bord(top),
			border(" " + nameStr, 1 + nameVisible),
			border(" " + statusLine, 1 + statusVisible),
			border(" " + workLine, 1 + workVisible),
			border(" " + lastLineRendered, 1 + lastVisible),
			bord(bot),
		];
	}

	function updateWidget() {
		if (!widgetCtx) return;

		if (!forgeActive) {
			widgetCtx.ui.setWidget("forge-grid", undefined);
			return;
		}

		widgetCtx.ui.setWidget("forge-grid", (_tui: any, theme: any) => {

			return {
				render(width: number): string[] {
					if (experts.size === 0) {
						return ["", theme.fg("dim", "  No experts found. Add agent .md files to ~/.pi/agent/workers/forge/")];
					}

					const cols = Math.min(gridCols, experts.size);
					const gap = 1;
					// avoid Text component's ANSI-width miscounting by returning raw lines
					const colWidth = Math.floor((width - gap * (cols - 1)) / cols) - 1;
					const allExperts = Array.from(experts.values());

					const lines: string[] = [""]; // top margin

					for (let i = 0; i < allExperts.length; i += cols) {
						const rowExperts = allExperts.slice(i, i + cols);
						const cards = rowExperts.map(e => renderCard(e, colWidth, theme));

						while (cards.length < cols) {
							cards.push(Array(6).fill(" ".repeat(colWidth)));
						}

						const cardHeight = cards[0].length;
						for (let line = 0; line < cardHeight; line++) {
							lines.push(cards.map(card => card[line] || "").join(" ".repeat(gap)));
						}
					}

					return lines;
				},
				invalidate() {},
			};
		});
	}

	// ── Query Expert ─────────────────────────────

	function queryExpert(
		expertName: string,
		question: string,
		ctx: any,
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		const key = expertName.toLowerCase();
		const state = experts.get(key);
		if (!state) {
			return Promise.resolve({
				output: `Expert "${expertName}" not found. Available: ${Array.from(experts.values()).map(s => s.def.name).join(", ")}`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		if (state.status === "researching") {
			return Promise.resolve({
				output: `Expert "${displayName(state.def.name)}" is already researching. Wait for it to finish.`,
				exitCode: 1,
				elapsed: 0,
			});
		}

		state.status = "researching";
		state.question = question;
		state.elapsed = 0;
		state.lastLine = "";
		state.queryCount++;
		updateWidget();

		const startTime = Date.now();
		state.timer = setInterval(() => {
			state.elapsed = Date.now() - startTime;
			updateWidget();
		}, 1000);

		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "openrouter/google/gemini-3-flash-preview";

		const args = [
			"--mode", "json",
			"-p",
			"--no-session",
			"--no-extensions",
			"--model", model,
			"--tools", state.def.tools,
			"--thinking", "off",
			"--append-system-prompt", state.def.systemPrompt,
			question,
		];

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
								state.lastLine = last;
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

				clearInterval(state.timer);
				state.elapsed = Date.now() - startTime;
				state.status = code === 0 ? "done" : "error";

				const full = textChunks.join("");
				state.lastLine = full.split("\n").filter((l: string) => l.trim()).pop() || "";
				updateWidget();

				ctx.ui.notify(
					`${displayName(state.def.name)} ${state.status} in ${Math.round(state.elapsed / 1000)}s`,
					state.status === "done" ? "success" : "error"
				);

				resolve({
					output: full,
					exitCode: code ?? 1,
					elapsed: state.elapsed,
				});
			});

			proc.on("error", (err) => {
				clearInterval(state.timer);
				state.status = "error";
				state.lastLine = `Error: ${err.message}`;
				updateWidget();
				resolve({
					output: `Error spawning expert: ${err.message}`,
					exitCode: 1,
					elapsed: Date.now() - startTime,
				});
			});
		});
	}

	// ── query_experts Tool (parallel) ───────────

	pi.registerTool({
		name: "query_experts",
		label: "Query Experts",
		description: `Query one or more Pi domain experts IN PARALLEL. All experts run simultaneously as concurrent subprocesses.

Pass an array of queries — each with an expert name and a specific question. All experts start at the same time and their results are returned together.

Available experts:
- agent-expert: Agent definitions — .md personas, teams.yaml, orchestration
- config-expert: Configuration — settings.json, providers, models, keybindings, themes, CLI, env vars
- ext-expert: Extensions & TUI — tools, events, commands, components, widgets, keyboard input
- skill-expert: Skills & prompts — SKILL.md format, /template invocation, prompt templates
- eval-expert: Eval system — write scenarios, run evals, review results, harness params

Ask specific questions about what you need to BUILD. Each expert will return documentation excerpts, code patterns, and implementation guidance.`,

		parameters: Type.Object({
			queries: Type.Array(
				Type.Object({
					expert: Type.String({
						description: "Expert name: ext-expert, theme-expert, skill-expert, config-expert, tui-expert, prompt-expert, or agent-expert",
					}),
					question: Type.String({
						description: "Specific question about what you need to build. Include context about the target component.",
					}),
				}),
				{ description: "Array of expert queries to run in parallel" },
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { queries } = params as { queries: { expert: string; question: string }[] };

			if (!queries || queries.length === 0) {
				return {
					content: [{ type: "text", text: "No queries provided." }],
					details: { results: [], status: "error" },
				};
			}

			const names = queries.map(q => displayName(q.expert)).join(", ");
			if (onUpdate) {
				onUpdate({
					content: [{ type: "text", text: `Querying ${queries.length} experts in parallel: ${names}` }],
					details: { queries, status: "researching", results: [] },
				});
			}

			// Launch ALL experts concurrently — allSettled so one failure
			// never discards results from the others
			const settled = await Promise.allSettled(
				queries.map(async ({ expert, question }) => {
					const result = await queryExpert(expert, question, ctx);
					const truncated = result.output.length > 12000
						? result.output.slice(0, 12000) + "\n\n... [truncated — ask follow-up for more]"
						: result.output;
					const status = result.exitCode === 0 ? "done" : "error";
					return {
						expert,
						question,
						status,
						elapsed: result.elapsed,
						exitCode: result.exitCode,
						output: truncated,
						fullOutput: result.output,
					};
				}),
			);

			const results = settled.map((s, i) =>
				s.status === "fulfilled"
					? s.value
					: {
						expert: queries[i].expert,
						question: queries[i].question,
						status: "error" as const,
						elapsed: 0,
						exitCode: 1,
						output: `Error: ${(s.reason as any)?.message || s.reason}`,
						fullOutput: "",
					},
			);

			// Build combined response
			const sections = results.map(r => {
				const icon = r.status === "done" ? "✓" : "✗";
				return `## [${icon}] ${displayName(r.expert)} (${Math.round(r.elapsed / 1000)}s)\n\n${r.output}`;
			});

			return {
				content: [{ type: "text", text: sections.join("\n\n---\n\n") }],
				details: {
					results,
					status: results.every(r => r.status === "done") ? "done" : "partial",
				},
			};
		},

		renderCall(args, theme) {
			const queries = (args as any).queries || [];
			const names = queries.map((q: any) => displayName(q.expert || "?")).join(", ");
			return new Text(
				theme.fg("toolTitle", theme.bold("query_experts ")) +
				theme.fg("accent", `${queries.length} parallel`) +
				theme.fg("dim", " — ") +
				theme.fg("muted", names),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details?.results) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (options.isPartial || details.status === "researching") {
				const count = details.queries?.length || "?";
				return new Text(
					theme.fg("accent", `◉ ${count} experts`) +
					theme.fg("dim", " researching in parallel..."),
					0, 0,
				);
			}

			const lines = (details.results as any[]).map((r: any) => {
				const icon = r.status === "done" ? "✓" : "✗";
				const color = r.status === "done" ? "success" : "error";
				const elapsed = typeof r.elapsed === "number" ? Math.round(r.elapsed / 1000) : 0;
				return theme.fg(color, `${icon} ${displayName(r.expert)}`) +
					theme.fg("dim", ` ${elapsed}s`);
			});

			const header = lines.join(theme.fg("dim", " · "));

			if (options.expanded && details.results) {
				const expanded = (details.results as any[]).map((r: any) => {
					const output = r.fullOutput
						? (r.fullOutput.length > 4000 ? r.fullOutput.slice(0, 4000) + "\n... [truncated]" : r.fullOutput)
						: r.output || "";
					return theme.fg("accent", `── ${displayName(r.expert)} ──`) + "\n" + theme.fg("muted", output);
				});
				return new Text(header + "\n\n" + expanded.join("\n\n"), 0, 0);
			}

			return new Text(header, 0, 0);
		},
	});

	// ── Commands ─────────────────────────────────

	pi.registerCommand("forge", {
		description: "Activate Pi Forge agent builder",
		handler: async (_args, ctx) => {
			widgetCtx = ctx;

			// Bench any active team
			ctx.ui.setWidget("agent-team", undefined);
			ctx.ui.setStatus("agent-team", null);
			setSharedMode("forge");

			// Load forge items and show picker
			const forgeList = loadForgeItems();

			if (forgeList.length === 0) {
				ctx.ui.notify("No forge items found in forge.yaml", "warning");
				return;
			}

			const options = forgeList.map(item => item.label + " — " + item.description);

			const choice = await ctx.ui.select("What do you want to forge?", options);
			if (choice === undefined) {
				return;
			}

			const idx = options.indexOf(choice);
			const selectedItem = forgeList[idx];
			const itemName = selectedItem.name;
			const item = forgeItems.get(itemName);

			if (!item) {
				ctx.ui.notify("Item config not found: " + itemName + " | Available: " + Array.from(forgeItems.keys()).join(", "), "error");
				return;
			}

			activeForgeItem = item;

			// Load experts for this item
			loadExpertsForItem(item);
			forgeActive = true;
			updateWidget();

			const expertNames = Array.from(experts.values()).map(s => displayName(s.def.name)).join(", ");
			ctx.ui.setStatus("forge", `Forge: ${itemName}`);
			ctx.ui.notify(
				`[FORGE] ${itemName}\n` +
				`${item.description}\n\n` +
				`Experts loaded: ${expertNames}\n\n` +
				`Read build skill → query experts → create SPEC\n` +
				`Skills: ~/.pi/agent/skills/build-{type}/SKILL.md\n` +
				`Specs: ~/.pi/agent/specs/{type}/{name}/SPEC.md\n\n` +
				`Describe what you want to build.`,
				"info",
			);
		},
	});

	pi.registerCommand("experts", {
		description: "List available Pi Forge experts and their status",
		handler: async (_args, _ctx) => {
			widgetCtx = _ctx;
			const lines = Array.from(experts.values())
				.map(s => `${displayName(s.def.name)} (${s.status}, queries: ${s.queryCount}): ${s.def.description}`)
				.join("\n");
			_ctx.ui.notify(lines || "No experts loaded", "info");
		},
	});

	pi.registerCommand("experts-grid", {
		description: "Set expert grid columns: /experts-grid <1-5>",
		handler: async (args, _ctx) => {
			widgetCtx = _ctx;
			const n = parseInt(args?.trim() || "", 10);
			if (n >= 1 && n <= 5) {
				gridCols = n;
				_ctx.ui.notify(`Grid set to ${gridCols} columns`, "info");
				updateWidget();
			} else {
				_ctx.ui.notify("Usage: /experts-grid <1-5>", "error");
			}
		},
	});

	pi.registerCommand("forge-exit", {
		description: "Close the forge, clearing experts and widget to deploy team",
		handler: async (_args, ctx) => {
			// Clear all expert timers and state
			for (const expert of experts.values()) {
				if (expert.timer) {
					clearInterval(expert.timer);
				}
			}
			experts.clear();
			forgeActive = false;
			activeForgeItem = null;

			// Clear the widget
			ctx.ui.setWidget("forge-grid", undefined);
			ctx.ui.setStatus("forge", null);

			ctx.ui.notify(
				"[FORGE] Exited. Experts cleared.\n" +
				"Use /forge to re-activate or run your team.",
				"info"
			);
		},
	});

	// ── System Prompt ────────────────────────────

	pi.on("before_agent_start", async (_event, _ctx) => {
		const expertCatalog = Array.from(experts.values())
			.map(s => `### ${displayName(s.def.name)}\n**Query as:** \`${s.def.name}\`\n${s.def.description}`)
			.join("\n\n");

		const expertNames = Array.from(experts.values()).map(s => displayName(s.def.name)).join(", ");

		const orchestratorPath = join(process.env.HOME || "", ".pi", "agent", "prompts", "frg-orchestrator.md");
		let systemPrompt = "";
		try {
			const raw = readFileSync(orchestratorPath, "utf-8");
			const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
			const template = match ? match[2].trim() : raw;
			
			systemPrompt = template
				.replace("{{EXPERT_COUNT}}", experts.size.toString())
				.replace("{{EXPERT_NAMES}}", expertNames)
				.replace("{{EXPERT_CATALOG}}", expertCatalog);
		} catch (err) {
			systemPrompt = "Error: Could not load frg-orchestrator.md. Make sure it exists in ~/.pi/agent/prompts/.";
		}

		return { systemPrompt };
	});

	// ── Session Start ────────────────────────────

	pi.on("session_start", async (_event, _ctx) => {
		applyExtensionDefaults(import.meta.url, _ctx);
		if (widgetCtx) {
			widgetCtx.ui.setWidget("forge-grid", undefined);
		}
		widgetCtx = _ctx;
		forgeActive = false;

		// Custom footer - only shows when forge is active
		_ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = _ctx.model?.id || "no-model";
				const usage = _ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const active = Array.from(experts.values()).filter(e => e.status === "researching").length;
				const done = Array.from(experts.values()).filter(e => e.status === "done").length;

				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", "Pi Forge");
				const mid = active > 0
					? theme.fg("accent", ` ◉ ${active} researching`)
					: done > 0
					? theme.fg("success", ` ✓ ${done} done`)
					: "";
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(mid) - visibleWidth(right)));

				return [truncateToWidth(left + mid + pad + right, width)];
			},
		}));
	});
}
