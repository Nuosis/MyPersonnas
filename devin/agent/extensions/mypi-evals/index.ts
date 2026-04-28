/**
 * MyPI Evals Extension
 * 
 * Agent evaluation framework with scenarios, harness, and scoring.
 * 
 * Tools:
 *   eval_list_scenarios  - List available scenarios
 *   eval_run            - Run one or more scenarios
 *   eval_report         - Generate results report
 *   eval_diff           - Compare two runs
 *   eval_write_scenario - Create new scenario
 *   eval_write_eval     - Add evals to scenario
 * 
 * Commands:
 *   /eval <scenario>    - Run single scenario
 *   /eval-all <suite>   - Run full suite
 *   /eval-list          - List scenarios
 *   /eval-report        - View report
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync as _fs_appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import yaml from "yaml";

// ─── Types ────────────────────────────────────────────────────

interface Assertion {
  check: string;
  equals?: any;
  exists?: boolean;
  in?: any[];
  min?: number;
  max?: number;
  pattern?: string;
}

interface Eval {
  id: string;
  name: string;
  type: "boolean" | "likert" | "formula";
  description?: string;
  scale?: number[];
  assertions: Assertion[];
}

interface Harness {
  type: "chain" | "agent" | "prompt" | "tool" | "command";
  target: string;
  params?: Record<string, any>;
}

interface Scenario {
  name: string;
  description: string;
  version: string;
  harness: Harness;
  evals: Eval[];
  artifacts?: {
    files?: { path: string; content: string }[];
    mocks?: { endpoint: string; response: any }[];
  };
  conditions?: {
    env?: Record<string, string>;
    setup?: string[];
  };
  tags?: string[];
}

interface EvalResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "error" | "skipped";
  duration: number;
  score: number;
  error?: string;
  assertions: {
    check: string;
    expected: any;
    actual: any;
    passed: boolean;
  }[];
}

interface RunResult {
  runId: string;
  timestamp: string;
  suite: string;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    score: number;
  };
  results: EvalResult[];
}

// ─── Storage ─────────────────────────────────────────────────

function getStorageDir(cwd: string): string {
  return join(cwd, ".pi", "evals");
}

function getResultsDir(cwd: string): string {
  return join(getStorageDir(cwd), "results");
}

function getHistoryDir(cwd: string): string {
  return join(getStorageDir(cwd), "history");
}

function getScenariosDir(cwd: string): string {
  return join(getStorageDir(cwd), "scenarios");
}

function ensureDirs(cwd: string): void {
  const dirs = [getStorageDir(cwd), getResultsDir(cwd), getHistoryDir(cwd), getScenariosDir(cwd)];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

// ─── DEBUG: Track cwd at registration vs execution ──────────────────────

function listScenarios(cwd: string, suite?: string): { suites: string[]; scenarios: any[] } {
  const scenariosDir = getScenariosDir(cwd);
  const suites: string[] = [];
  const scenarios: any[] = [];
  
  if (!existsSync(scenariosDir)) return { suites, scenarios };
  
  for (const suiteName of readdirSync(scenariosDir)) {
    const suitePath = join(scenariosDir, suiteName);
    if (!existsSync(suitePath) || !statSync(suitePath).isDirectory()) continue;
    if (!readdirSync(suitePath).some(f => f.includes("scenario.yaml"))) continue;
    
    suites.push(suiteName);
    
    if (!suite || suite === suiteName) {
      const scenarioFile = join(suitePath, "scenario.yaml");
      if (existsSync(scenarioFile)) {
        const content = readFileSync(scenarioFile, "utf-8");
        const scenario = parseScenarioYaml(content);
        for (const evalItem of scenario.evals || []) {
          scenarios.push({
            id: `${suiteName}/${evalItem.id}`,
            name: evalItem.name,
            suite: suiteName,
            tags: scenario.tags || [],
            description: evalItem.description || evalItem.name,
          });
        }
      }
    }
  }
  
  return { suites, scenarios };
}

function parseScenarioYaml(content: string): Scenario {
  try {
    const parsed = yaml.parse(content);
    return {
      name: parsed.name || "",
      description: parsed.description || "",
      version: parsed.version || "1.0",
      harness: parsed.harness || { type: "prompt", target: "" },
      evals: Array.isArray(parsed.evals) ? parsed.evals : [],
      artifacts: parsed.artifacts,
      conditions: parsed.conditions,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    } as Scenario;
  } catch (err) {
    console.error("YAML parse error:", err);
    return { name: "", description: "", version: "1.0", harness: { type: "prompt", target: "" }, evals: [] };
  }
}

// ─── Scorer ──────────────────────────────────────────────────

function scoreEval(evalItem: Eval, output: any): EvalResult {
  const assertions: EvalResult["assertions"] = [];
  let passed = true;
  let score = 1.0;
  
  for (const assertion of evalItem.assertions) {
    let actual: any = undefined;
    let assertionPassed = false;
    
    // Navigate output by check path (e.g., "response.status")
    const parts = assertion.check.split(".");
    let value: any = output;
    for (const part of parts) {
      value = value?.[part];
    }
    actual = value;
    
    if (assertion.equals !== undefined) {
      assertionPassed = actual === assertion.equals;
    } else if (assertion.exists !== undefined) {
      assertionPassed = assertion.exists ? actual !== undefined : actual === undefined;
    } else if (assertion.in !== undefined) {
      assertionPassed = assertion.in.includes(actual);
    } else if (assertion.min !== undefined) {
      assertionPassed = actual >= assertion.min;
    } else if (assertion.max !== undefined) {
      assertionPassed = actual <= assertion.max;
    } else if (assertion.pattern !== undefined) {
      assertionPassed = String(actual).includes(assertion.pattern);
    } else {
      assertionPassed = actual !== undefined;
    }
    
    assertions.push({
      check: assertion.check,
      expected: assertion.equals || assertion.exists || assertion.in || assertion.min || assertion.pattern,
      actual,
      passed: assertionPassed,
    });
    
    if (!assertionPassed) passed = false;
  }
  
  if (evalItem.type === "likert" && evalItem.scale) {
    // Default to middle of scale if passed, bottom if failed
    score = passed ? (evalItem.scale[evalItem.scale.length - 1] || 1) : (evalItem.scale[0] || 0);
    score = score / (evalItem.scale[evalItem.scale.length - 1] || 1); // Normalize to 0-1
  } else {
    score = passed ? 1 : 0;
  }
  
  return {
    id: evalItem.id,
    name: evalItem.name,
    status: passed ? "passed" : "failed",
    duration: output.duration || 0,
    score,
    assertions,
  };
}

// ─── Executor ─────────────────────────────────────────────────

async function executeHarness(harness: Harness, ctx: any): Promise<any> {
  const startTime = Date.now();
  
  switch (harness.type) {
    case "prompt": {
      // Direct prompt evaluation - spawn subagent with prompt as task
      return await runSubagent(harness.target, ctx.cwd);
    }
    
    case "chain": {
      // Run a chain via run_chain - spawn subagent that calls run_chain
      const chainPrompt = `Use run_chain to execute the "${harness.target}" chain with task: ${JSON.stringify(harness.params || {})}`;
      return await runSubagent(chainPrompt, ctx.cwd);
    }
    
    case "agent": {
      // Spawn named agent
      const agentPrompt = `${harness.target}\n\n${JSON.stringify(harness.params || {})}`;
      return await runSubagent(agentPrompt, ctx.cwd);
    }
    
    case "command": {
      // Run slash command directly
      return await runCommand(harness.target, ctx.cwd);
    }
    
    case "tool": {
      // Test single tool - spawn agent with specific tool usage
      const toolPrompt = `Test the "${harness.target}" tool with these params: ${JSON.stringify(harness.params || {})}`;
      return await runSubagent(toolPrompt, ctx.cwd);
    }
    
    default:
      return { error: `Unknown harness type: ${harness.type}` };
  }
}

function runSubagent(prompt: string, cwd: string): Promise<any> {
  return new Promise((resolve) => {
    const args = [
      "--mode", "json",
      "-p",
      "--no-extensions",
      "--model", "MiniMax-M2.7",
      "--thinking", "off",
    ];
    
    const proc = spawn("pi", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    
    let stdout = "";
    let buffer = "";
    
    proc.stdout?.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "message_update") {
            const delta = event.assistantMessageEvent;
            if (delta?.type === "text_delta") stdout += delta.delta || "";
          } else if (event.type === "agent_end") {
            stdout += JSON.stringify(event.messages || []);
          }
        } catch {}
      }
    });
    
    proc.on("close", () => {
      resolve({ output: stdout, duration: 0 });
    });
    
    proc.on("error", (err) => {
      resolve({ output: "", error: err.message });
    });
    
    proc.stdin?.write(prompt + "\n");
    proc.stdin?.end();
  });
}

function runCommand(command: string, cwd: string): Promise<any> {
  return new Promise((resolve) => {
    const proc = spawn(command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    
    proc.stdout?.on("data", (chunk) => { stdout += chunk; });
    proc.stderr?.on("data", (chunk) => { stderr += chunk; });
    
    proc.on("close", (code) => {
      resolve({ output: stdout, error: code === 0 ? undefined : stderr, duration: 0 });
    });
  });
}

// ─── Runner ─────────────────────────────────────────────────

async function runScenario(scenarioName: string, cwd: string, ctx: any): Promise<RunResult> {
  const scenariosDir = getScenariosDir(cwd);
  const scenarioPath = join(scenariosDir, scenarioName, "scenario.yaml");
  
  if (!existsSync(scenarioPath)) {
    throw new Error(`Scenario not found: ${scenarioName}`);
  }
  
  const content = readFileSync(scenarioPath, "utf-8");
  const scenario = parseScenarioYaml(content);
  
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const startTime = Date.now();
  const results: EvalResult[] = [];
  
  for (let i = 0; i < scenario.evals.length; i++) {
    const evalItem = scenario.evals[i];
    
    // Update UI
    ctx.ui.setStatus("mypi-evals", `Running ${scenarioName}/${evalItem.id} (${i + 1}/${scenario.evals.length})`);
    
    try {
      const output = await executeHarness(scenario.harness, ctx);
      const result = scoreEval(evalItem, output);
      results.push(result);
    } catch (err) {
      results.push({
        id: evalItem.id,
        name: evalItem.name,
        status: "error",
        duration: 0,
        score: 0,
        error: String(err),
        assertions: [],
      });
    }
  }
  
  const duration = Date.now() - startTime;
  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status === "failed").length;
  
  return {
    runId,
    timestamp: new Date().toISOString(),
    suite: scenarioName,
    duration,
    summary: {
      total: results.length,
      passed,
      failed,
      skipped: results.filter(r => r.status === "skipped").length,
      score: results.length > 0 ? passed / results.length : 0,
    },
    results,
  };
}

async function runSuite(suiteName: string, cwd: string, ctx: any, parallel: boolean = false): Promise<RunResult[]> {
  const scenariosDir = getScenariosDir(cwd);
  const suitePath = join(scenariosDir, suiteName);
  
  if (!existsSync(suitePath)) {
    throw new Error(`Suite not found: ${suiteName}`);
  }
  
  const results: RunResult[] = [];
  
  const scenarioDirs = readdirSync(suitePath).filter(f => {
    const subPath = join(suitePath, f);
    if (!statSync(subPath).isDirectory()) return false;
    const sf = join(subPath, "scenario.yaml");
    return existsSync(sf);
  });
  
  if (parallel) {
    // Run all scenarios in parallel
    const promises = scenarioDirs.map(dir => runScenario(`${suiteName}/${dir}`, cwd, ctx));
    const allResults = await Promise.all(promises);
    results.push(...allResults);
  } else {
    // Run sequentially
    for (const dir of scenarioDirs) {
      const result = await runScenario(`${suiteName}/${dir}`, cwd, ctx);
      results.push(result);
    }
  }
  
  return results;
}

// ─── Report ──────────────────────────────────────────────────

function formatReport(result: RunResult, format: "terminal" | "html" | "json" = "terminal"): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  
  const passed = result.summary.passed;
  const failed = result.summary.failed;
  const score = Math.round(result.summary.score * 100);
  
  let report = `\`\`\`\n`;
  report += `# Eval Results: ${result.suite}\n\n`;
  report += `## Summary\n`;
  report += `| Metric  | Value |\n|--------|-------|\n`;
  report += `| Total   | ${result.summary.total}    |\n`;
  report += `| Passed  | ${passed}      |\n`;
  report += `| Failed  | ${failed}      |\n`;
  report += `| Score   | ${score}%    |\n\n`;
  
  if (failed > 0) {
    report += `## Failed (${failed})\n\n`;
    for (const r of result.results.filter(r => r.status === "failed")) {
      report += `### ${r.id}: ${r.name}\n`;
      for (const a of r.assertions.filter(a => !a.passed)) {
        report += `- **${a.check}**: expected \`${a.expected}\`, got \`${a.actual}\`\n`;
      }
      report += `\n`;
    }
  }
  
  report += `## All Results\n\n`;
  for (const r of result.results) {
    const icon = r.status === "passed" ? "✓" : r.status === "failed" ? "✗" : "?";
    report += `${icon} ${r.id} (${r.score.toFixed(2)})\n`;
  }
  report += `\`\`\`\n`;
  
  return report;
}

// ─── Persistence ────────────────────────────────────────────

function saveResult(result: RunResult, cwd: string): void {
  const resultsDir = getResultsDir(cwd);
  const filePath = join(resultsDir, `${result.runId}.json`);
  
  ensureDirs(cwd);
  writeFileSync(filePath, JSON.stringify(result, null, 2), "utf-8");
  
  // Update history
  const historyDir = join(getHistoryDir(cwd), result.suite);
  ensureDirs(cwd);
  
  const latestPath = join(historyDir, "latest.json");
  const timelinePath = join(historyDir, "timeline.jsonl");
  
  writeFileSync(latestPath, JSON.stringify(result), "utf-8");
  appendFileSync(timelinePath, JSON.stringify(result) + "\n", "utf-8");
}

function appendFileSync(path: string, content: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  writeFileSync(path, existing + content, "utf-8");
}

function loadResult(runId: string, cwd: string): RunResult | null {
  const filePath = join(getResultsDir(cwd), `${runId}.json`);
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf-8")) : null;
}

function listRuns(cwd: string, suite?: string): { runs: any[] } {
  const resultsDir = getResultsDir(cwd);
  if (!existsSync(resultsDir)) return { runs: [] };
  
  const runs: any[] = [];
  for (const file of readdirSync(resultsDir)) {
    if (!file.endsWith(".json")) continue;
    const result = JSON.parse(readFileSync(join(resultsDir, file), "utf-8"));
    if (!suite || result.suite === suite) {
      runs.push({
        runId: result.runId,
        suite: result.suite,
        timestamp: result.timestamp,
        score: result.summary.score,
        total: result.summary.total,
        passed: result.summary.passed,
        failed: result.summary.failed,
      });
    }
  }
  
  return { runs: runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)) };
}

// ─── Widget ──────────────────────────────────────────────────

let widgetLines: string[] = [];
let widgetUpdateFn: any = null;

function updateWidget(ctx: any, state: { current: string; progress: number; total: number; results: any[] }) {
  const w = 60;
  const name = state.current.padEnd(20);
  const pct = state.total > 0 ? Math.round(state.progress / state.total * 100) : 0;
  
  widgetLines = [
    `┌─ EVAL: ${name} ${state.progress}/${state.total} (${pct}%) ${"─".repeat(Math.max(0, w - 35 - name.length))}┐`,
    ...state.results.slice(-8).map(r => {
      const icon = r.status === "passed" ? "✓" : r.status === "failed" ? "✗" : r.status === "running" ? "⟳" : "○";
      return `│ ${icon} ${r.id.padEnd(20)} ${r.status.padEnd(10)} ${r.score?.toFixed(2) || ""}    │`;
    }),
    `└${"─".repeat(w)}┘`,
  ];
  
  if (widgetUpdateFn) widgetUpdateFn();
}

function createWidget(ctx: any) {
  ctx.ui.setWidget("mypi-evals", (_tui: any, theme: any) => {
    return {
      render(width: number): string[] {
        const text = new Text(widgetLines.join("\n"), 0, 1);
        return text.render(width);
      },
      invalidate() {
        widgetUpdateFn = _tui;
      },
    };
  });
}

// ─── Extension ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── eval_list_scenarios ─────────────────────────────────────
  
  pi.registerTool({
    name: "eval_list_scenarios",
    label: "List Eval Scenarios",
    description: "List available eval scenarios by suite",
    parameters: Type.Object({
      suite: Type.Optional(Type.String()),
      tag: Type.Optional(Type.String()),
      format: Type.Optional(Type.Union([Type.Literal("brief"), Type.Literal("full")])),
    }),
    
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      const result = listScenarios(cwd, params.suite);
      
      if (params.format === "full") {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }
      
      const lines = [`**Available Suites:**\n${result.suites.join(", ")}`];
      if (result.scenarios.length > 0) {
        lines.push(`\n**Scenarios:**`);
        for (const s of result.scenarios) {
          lines.push(`- ${s.id}: ${s.name}`);
        }
      }
      
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
      };
    },
  });
  
  // ── eval_run ───────────────────────────────────────────────
  
  pi.registerTool({
    name: "eval_run",
    label: "Run Evals",
    description: "Run one or more eval scenarios",
    parameters: Type.Object({
      scenario: Type.Optional(Type.String()),
      suite: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      parallel: Type.Optional(Type.Boolean()),
      params: Type.Optional(Type.Record(Type.String(), Type.Any())),
    }),
    
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const cwd = ctx.cwd;
      ensureDirs(cwd);
      
      if (params.suite) {
        // Run full suite
        const results = await runSuite(params.suite, cwd, ctx, params.parallel || false);
        
        for (const result of results) {
          saveResult(result, cwd);
        }
        
        // Aggregate
        const totalPassed = results.reduce((sum, r) => sum + r.summary.passed, 0);
        const totalFailed = results.reduce((sum, r) => sum + r.summary.failed, 0);
        const total = results.reduce((sum, r) => sum + r.summary.total, 0);
        
        return {
          content: [{
            type: "text",
            text: `Suite "${params.suite}" complete.\n\nTotal: ${total}, Passed: ${totalPassed}, Failed: ${totalFailed}, Score: ${Math.round(totalPassed / total * 100)}%`,
          }],
          details: { results, summary: { total, passed: totalPassed, failed: totalFailed, score: totalPassed / total } },
        };
      } else if (params.scenario) {
        // Run single scenario
        const result = await runScenario(params.scenario, cwd, ctx);
        saveResult(result, cwd);
        
        return {
          content: [{ type: "text", text: formatReport(result) }],
          details: result,
        };
      }
      
      return {
        content: [{ type: "text", text: "Specify scenario or suite to run" }],
        details: {},
      };
    },
  });
  
  // ── eval_report ─────────────────────────────────────────────
  
  pi.registerTool({
    name: "eval_report",
    label: "Eval Report",
    description: "Generate eval results report",
    parameters: Type.Object({
      runId: Type.Optional(Type.String()),
      suite: Type.Optional(Type.String()),
      format: Type.Optional(Type.Union([Type.Literal("terminal"), Type.Literal("html"), Type.Literal("json")])),
      failedOnly: Type.Optional(Type.Boolean()),
    }),
    
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      
      if (params.runId) {
        const result = loadResult(params.runId, cwd);
        if (!result) {
          return { content: [{ type: "text", text: `Run not found: ${params.runId}` }], details: {} };
        }
        
        const report = formatReport(result, params.format || "terminal");
        return { content: [{ type: "text", text: report }], details: result };
      }
      
      // List recent runs
      const { runs } = listRuns(cwd, params.suite);
      const lines = ["**Recent Runs:**\n"];
      for (const run of runs.slice(0, 10)) {
        const score = Math.round(run.score * 100);
        lines.push(`- ${run.runId} (${run.suite}): ${score}% - ${run.timestamp}`);
      }
      
      return { content: [{ type: "text", text: lines.join("\n") }], details: { runs } };
    },
  });
  
  // ── eval_diff ───────────────────────────────────────────────
  
  pi.registerTool({
    name: "eval_diff",
    label: "Diff Evals",
    description: "Compare results between two eval runs",
    parameters: Type.Object({
      runA: Type.String(),
      runB: Type.String(),
    }),
    
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const resultA = loadResult(params.runA, cwd);
      const resultB = loadResult(params.runB, cwd);
      
      if (!resultA || !resultB) {
        return { content: [{ type: "text", text: "One or both runs not found" }], details: {} };
      }
      
      const changes: any = {};
      const scoreA = resultA.summary.score;
      const scoreB = resultB.summary.score;
      
      for (const rA of resultA.results) {
        const rB = resultB.results.find(r => r.id === rA.id);
        if (rB) {
          if (rA.status !== rB.status) {
            changes[rA.id] = { before: rA.status, after: rB.status };
          }
        }
      }
      
      const improved = Object.values(changes).filter((c: any) => c.before === "failed" && c.after === "passed").length;
      const regressed = Object.values(changes).filter((c: any) => c.before === "passed" && c.after === "failed").length;
      
      let text = `## Diff: ${params.runA} vs ${params.runB}\n\n`;
      text += `| Run | Score |\n|-----|-------|\n`;
      text += `| ${params.runA} | ${Math.round(scoreA * 100)}% |\n`;
      text += `| ${params.runB} | ${Math.round(scoreB * 100)}% |\n\n`;
      text += `| Change | Count |\n|-------|-------|\n`;
      text += `| Improved | ${improved} |\n`;
      text += `| Regressed | ${regressed} |\n`;
      
      if (Object.keys(changes).length > 0) {
        text += `\n**Changed:**\n`;
        for (const [id, change] of Object.entries(changes)) {
          const c = change as any;
          text += `- ${id}: ${c.before} → ${c.after}\n`;
        }
      }
      
      return { content: [{ type: "text", text }], details: { changes, summary: { improved, regressed } } };
    },
  });
  
  // ── eval_write_scenario ─────────────────────────────────────
  
  pi.registerTool({
    name: "eval_write_scenario",
    label: "Write Scenario",
    description: "Create a new eval scenario",
    parameters: Type.Object({
      suite: Type.String(),
      name: Type.String(),
      description: Type.String(),
      harness: Type.Object({
        type: Type.Union([Type.Literal("chain"), Type.Literal("agent"), Type.Literal("prompt"), Type.Literal("tool"), Type.Literal("command")]),
        target: Type.String(),
        params: Type.Optional(Type.Record(Type.String(), Type.Any())),
      }),
      evals: Type.Optional(Type.Array(Type.Any())),
    }),
    
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const scenariosDir = getScenariosDir(cwd);
      const scenarioDir = join(scenariosDir, params.suite);
      const scenarioFile = join(scenarioDir, "scenario.yaml");
      
      ensureDirs(cwd);
      mkdirSync(scenarioDir, { recursive: true });
      
      let yaml = `name: "${params.suite}"\n`;
      yaml += `description: "${params.description}"\n`;
      yaml += `version: "1.0"\n\n`;
      yaml += `harness:\n`;
      yaml += `  type: ${params.harness.type}\n`;
      yaml += `  target: ${params.harness.target}\n`;
      
      if (params.harness.params) {
        yaml += `  params:\n`;
        for (const [key, val] of Object.entries(params.harness.params)) {
          yaml += `    ${key}: ${JSON.stringify(val)}\n`;
        }
      }
      
      if (params.evals && params.evals.length > 0) {
        yaml += `\nevals:\n`;
        for (const evalItem of params.evals) {
          yaml += `  - id: ${evalItem.id}\n`;
          yaml += `    name: ${evalItem.name}\n`;
          yaml += `    type: ${evalItem.type || "boolean"}\n`;
          if (evalItem.description) yaml += `    description: ${evalItem.description}\n`;
          if (evalItem.assertions) {
            yaml += `    assertions:\n`;
            for (const a of evalItem.assertions) {
              yaml += `      - check: ${a.check}\n`;
              if (a.equals !== undefined) yaml += `        equals: ${a.equals}\n`;
              if (a.exists !== undefined) yaml += `        exists: ${a.exists}\n`;
            }
          }
        }
      }
      
      writeFileSync(scenarioFile, yaml, "utf-8");
      
      return {
        content: [{ type: "text", text: `Created scenario: ${params.suite}\n\nFile: ${scenarioFile}` }],
        details: { path: scenarioFile },
      };
    },
  });
  
  // ── eval_write_eval ────────────────────────────────────────
  
  pi.registerTool({
    name: "eval_write_eval",
    label: "Write Eval",
    description: "Add evals to an existing scenario",
    parameters: Type.Object({
      scenario: Type.String(),
      evals: Type.Array(Type.Any()),
    }),
    
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const scenariosDir = getScenariosDir(cwd);
      const scenarioFile = join(scenariosDir, params.scenario, "scenario.yaml");
      
      if (!existsSync(scenarioFile)) {
        return { content: [{ type: "text", text: `Scenario not found: ${params.scenario}` }], details: {} };
      }
      
      const content = readFileSync(scenarioFile, "utf-8");
      let yaml = content;
      
      for (const evalItem of params.evals) {
        yaml += `\n  - id: ${evalItem.id}\n`;
        yaml += `    name: ${evalItem.name}\n`;
        yaml += `    type: ${evalItem.type || "boolean"}\n`;
        if (evalItem.description) yaml += `    description: ${evalItem.description}\n`;
        if (evalItem.assertions) {
          yaml += `    assertions:\n`;
          for (const a of evalItem.assertions) {
            yaml += `      - check: ${a.check}\n`;
            if (a.equals !== undefined) yaml += `        equals: ${a.equals}\n`;
            if (a.exists !== undefined) yaml += `        exists: ${a.exists}\n`;
          }
        }
      }
      
      writeFileSync(scenarioFile, yaml, "utf-8");
      
      return {
        content: [{ type: "text", text: `Added ${params.evals.length} evals to ${params.scenario}` }],
        details: {},
      };
    },
  });
  
  // ── eval_review ────────────────────────────────────────────
  
  pi.registerTool({
    name: "eval_review",
    label: "Review Evals",
    description: "Review evals for format, validity, and consistency. Run before running new or modified evals.",
    parameters: Type.Object({
      scenario: Type.String(),  // e.g., "personality-dimensions"
      suite: Type.Optional(Type.String()),
    }),
    
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const scenariosDir = getScenariosDir(cwd);
      const scenarioPath = params.suite 
        ? join(scenariosDir, params.suite, params.scenario)
        : join(scenariosDir, params.scenario);
      
      const scenarioFile = join(scenarioPath, "scenario.yaml");
      
      if (!existsSync(scenarioFile)) {
        return { 
          content: [{ type: "text", text: `Scenario not found: ${params.scenario}` }], 
          details: { status: "ERROR" } 
        };
      }
      
      // Read scenario files for review
      const scenarioContent = readFileSync(scenarioFile, "utf-8");
      
      // Build review prompt for eval-reviewer agent
      const reviewPrompt = `You are an eval-reviewer. Review the following eval scenario for:
1. Format conformity - assertions match supported types
2. X→Y clarity - contract is explicit, pass/fail is clear
3. Internal validity - same condition = consistent results
4. External validity - different conditions = detectible differences
5. Controls - baseline properly controlled
6. Reliability - results will replicate

## Scenario File:
\`\`\`yaml
${scenarioContent}
\`\`\`

## Output Format:
\`\`\`markdown
# Eval Review: {scenario_name}

## Status
{APPROVED | NEEDS_WORK | FRAMEWORK_GAP}

## Issues (must fix before running)
{list of blocking issues}

## Suggestions (optional)
{list of non-blocking suggestions}

## Framework Gaps (recommend to bake-pi/extra-pi)
{issues requiring framework changes}
\`\`\`

Start your review now.`;
      
      // Spawn eval-reviewer agent
      const agentFile = join(homedir(), ".pi", "agent", "agents", "eval-reviewer.md");
      const agentPrompt = existsSync(agentFile) ? readFileSync(agentFile, "utf-8") : "";
      
      const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
        const proc = spawn("pi", [
          "--mode", "json",
          "-p",
          "--no-extensions",
          "--model", "MiniMax-M2.7",
          "--thinking", "off",
          "--append-system-prompt", agentPrompt,
          "--session", "/dev/null",
        ], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
        });
        
        let stdout = "";
        let stderr = "";
        let buffer = "";
        
        proc.stdout?.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "message_update") {
                const delta = event.assistantMessageEvent;
                if (delta?.type === "text_delta") stdout += delta.delta || "";
              }
            } catch {}
          }
        });
        
        proc.stderr?.on("data", (chunk: string) => { stderr += chunk; });
        
        proc.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
        proc.on("error", (err) => resolve({ exitCode: 1, stdout: "", stderr: err.message }));
        
        proc.stdin?.write(reviewPrompt + "\n");
        proc.stdin?.end();
      });
      
      // Parse status from output
      let status = "NEEDS_WORK";
      if (result.stdout.includes("## Status")) {
        const statusMatch = result.stdout.match(/## Status\s*\n\s*(APPROVED|NEEDS_WORK\|FRAMEWORK_GAP)/);
        if (statusMatch) status = statusMatch[1].trim();
      }
      
      const report = result.stdout || `Review failed: ${result.stderr || "no output"}`;
      
      return {
        content: [{ type: "text", text: report }],
        details: { 
          status, 
          scenario: params.scenario,
          exitCode: result.exitCode 
        },
      };
    },
  });
  
  // ── Commands ────────────────────────────────────────────────
  
  pi.registerCommand("eval", {
    description: "Run eval scenarios",
    handler: async (args: string, ctx) => {
      if (!args) {
        const { suites } = listScenarios(ctx.cwd);
        ctx.ui.notify(`Usage: /eval <scenario>\n\nAvailable suites: ${suites.join(", ") || "none"}`, "info");
        return;
      }
      
      try {
        const result = await runScenario(args, ctx.cwd, ctx);
        saveResult(result, ctx.cwd);
        ctx.ui.notify(formatReport(result), "info");
      } catch (err) {
        ctx.ui.notify(`Eval failed: ${err}`, "error");
      }
    },
  });
  
  pi.registerCommand("eval-list", {
    description: "List eval scenarios",
    handler: async (_args, ctx) => {
      const { suites, scenarios } = listScenarios(ctx.cwd);
      
      let text = `**Suites:** ${suites.join(", ") || "none"}\n\n`;
      if (scenarios.length > 0) {
        text += `**Scenarios:**\n`;
        for (const s of scenarios) {
          text += `- ${s.id}: ${s.name}\n`;
        }
      }
      
      ctx.ui.notify(text, "info");
    },
  });
  
  pi.registerCommand("eval-report", {
    description: "View eval report",
    handler: async (args: string, ctx) => {
      const { runs } = listRuns(ctx.cwd);
      if (runs.length === 0) {
        ctx.ui.notify("No eval runs found", "info");
        return;
      }
      
      const latest = runs[0];
      const result = loadResult(latest.runId, ctx.cwd);
      if (result) {
        ctx.ui.notify(formatReport(result), "info");
      }
    },
  });
  
  // ── Session Start ──────────────────────────────────────────
  
  pi.on("session_start", (_event, ctx) => {
    ensureDirs(ctx.cwd);
    createWidget(ctx);
  });
}
