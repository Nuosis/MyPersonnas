/**
 * Personality Dimensions Evaluation Runner
 * 
 * Tests whether personality settings in AGENTS.md materially change responses.
 * 
 * Infrastructure:
 * - artifacts/scorer-llm.ts: LLM-as-judge scoring (informality, agency, quirky)
 * - artifacts/scorer.ts: Custom assertion checks for eval evaluation
 * - artifacts/stats.ts: Statistical utilities
 * - artifacts/scoring-prompt.md: LLM judge prompt
 * 
 * Design:
 * - 5 base prompts (P1-P5)
 * - 3 conditions: baseline (no personality), all-0, all-10
 * - 5 runs per condition (internal consistency)
 * - Measures delta on each dimension (informality, succinctness, agency, quirky)
 * - Scoring: LLM-as-judge for style dimensions, word-count for succinctness
 */

import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createReadTool,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import { 
  scoreResponse, 
  DimensionScores 
} from "./artifacts/scorer-llm";
import { 
  ConditionResult,
  evaluateAssertion 
} from "./artifacts/scorer";

// ============ CONFIGURATION ============

const MODEL = "gpt-5.2";
const TEMPERATURE = 0.7;
const SCORER_TEMPERATURE = 0.3;  // Lower temp for consistent scoring
const RUNS_PER_CONDITION = 5;
const OUTPUT_DIR = "./evals/outputs/personality-dimensions";

// ============ AGENT TEMPLATES ============

const BASE_AGENT_WITHOUT_PERSONALITY = `# Claire - Agent Builder & Coding Expert

## Identity

**Name:** Claire  
**Role:** Agent Builder & Coding Expert  
**Owner:** Marcus Swift (AI Engineer)

## Purpose

I am Marcus's primary AI agent, specialized in:
- **Agent Architecture** — Design, build, and iterate on AI agent systems
- **Agent Pipelines** — Create multi-agent workflows and orchestration
- **Coding & Development** — Full-stack development, debugging, refactoring
- **Tool Building** — Extend agent capabilities with custom tools and integrations
- **Technical Documentation** — Document codebases, workflows, and systems

## My Human

**Marcus Swift** is an **AI Engineer** who:
- Builds AI agent systems and workflows
- Works with LLMs, agents, and automation pipelines
- Develops software across the stack
- Needs a capable "second brain" and coding partner

## Communication

- Be direct and concise
- Ask clarifying questions when needed
- Propose solutions, not just problems
- Use code blocks for all code snippets`;

const BASE_AGENT_WITH_PERSONALITY = (settings: { informality: number; succinctness: number; agency: number; quirky: number }) => `${BASE_AGENT_WITHOUT_PERSONALITY}

## Personality Dimensions

Defines how I communicate and behave. Adjust as Marcus prefers.

---

### Informality

- **0 (Robotic):** Designed for agent-to-agent communication. Efficient, stripped, no pleasantries, direct references.
- **10 (Informal):** Full sentences, conversational, personal, human-like. Best for direct human communication.

**Current Setting:** ${settings.informality}

---

### Succinctness

- **0 (Verbose):** Detailed explanations, thorough breakdowns, "explain like I'm 5" style. Avoids repeating already-presented data.
- **10 (Extremely Brief):** Semantically dense. No explainers, fillers, or unnecessary color. Full sentences, but says more with less.

**Current Setting:** ${settings.succinctness}

---

### Agency

- **0 (Cautious):** Prone to waiting for steering. Report and do — check before acting.
- **10 (High Initiative):** Forge ahead with my best plan. Do and report — keep Marcus informed but don't wait to be told every step.

**Current Setting:** ${settings.agency}

---

### Quirky

- **0 (Straight):** All business, no nonsense, purely functional.
- **10 (Playful):** Snarky, colorful, delightful. More sweary, edgy, and fun. Brings personality.

**Current Setting:** ${settings.quirky}`;

// ============ TEST PROMPTS ============

interface Prompt {
  id: string;
  text: string;
  targets: readonly string[];
}

const BASE_PROMPTS: Prompt[] = [
  { id: "P1", text: "Hey, quick question about the codebase", targets: ["informality", "agency"] },
  { id: "P2", text: "Explain how transformers work step by step", targets: ["succinctness"] },
  { id: "P3", text: "Should I delete this branch?", targets: ["agency"] },
  { id: "P4", text: "The build is broken again", targets: ["quirky"] },
  { id: "P5", text: "Here's my new feature, review it", targets: ["informality", "agency"] },
];

// ============ CONDITIONS ============

interface Condition {
  id: string;
  name: string;
  agentMd: string | null;
  settings: { informality: number; succinctness: number; agency: number; quirky: number } | null;
}

const CONDITIONS: Condition[] = [
  { id: "baseline", name: "No personality section", agentMd: BASE_AGENT_WITHOUT_PERSONALITY, settings: null },
  { id: "low", name: "All dimensions at 0", agentMd: null, settings: { informality: 0, succinctness: 0, agency: 0, quirky: 0 } },
  { id: "high", name: "All dimensions at 10", agentMd: null, settings: { informality: 10, succinctness: 10, agency: 10, quirky: 10 } },
];

// ============ MAIN EVALUATION ============

async function runEvaluation(): Promise<{
  runs: ConditionResult[];
  summary: Record<string, any>;
  evals: Record<string, any>;
}> {
  console.log("🚀 Starting Personality Dimensions Evaluation\n");
  
  // Setup
  const cwd = process.cwd();
  const authPath = path.join(process.env.HOME || '', '.pi', 'agent', 'auth.json');
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage);
  
  // Get API key from auth storage for OpenAI
  const openaiModel = getModel("openai", "gpt-5.2");
  const openaiAuth = await modelRegistry.getApiKeyAndHeaders(openaiModel);
  const openaiApiKey = openaiAuth.ok ? openaiAuth.apiKey : undefined;
  
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Results storage
  const results: ConditionResult[] = [];
  
  // Run evaluation
  for (const condition of CONDITIONS) {
    console.log(`\n📋 Condition: ${condition.name}`);
    
    const agentMd = condition.settings 
      ? BASE_AGENT_WITH_PERSONALITY(condition.settings)
      : condition.agentMd!;
    
    for (let run = 0; run < RUNS_PER_CONDITION; run++) {
      console.log(`  Run ${run + 1}/${RUNS_PER_CONDITION}...`);
      
      for (const prompt of BASE_PROMPTS) {
        // Create agent session with this personality config
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir: path.join(cwd, '.pi'),
          systemPromptOverride: () => agentMd,
          agentsFilesOverride: () => ({ agentsFiles: [] }), // Disable loading real AGENTS.md
        });
        await loader.reload();
        
        const { session } = await createAgentSession({
          cwd,
          model: getModel("openai", "gpt-5.2"),
          authStorage,
          modelRegistry,
          resourceLoader: loader,
          tools: [createReadTool(cwd)], // Read-only for eval
        });
        
        // Run prompt
        const response = await session.prompt(prompt.text);
        const responseText = typeof response === 'string' ? response : JSON.stringify(response);
        
        // Score response using LLM scorer
        const scores = await scoreResponse(responseText, MODEL, SCORER_TEMPERATURE, openaiApiKey);
        
        // Store result
        results.push({
          condition: condition.id,
          promptId: prompt.id,
          scores,
        });
        
        console.log(`    ${prompt.id}: inf=${scores.informality.toFixed(1)}, suc=${scores.succinctness.toFixed(1)}, age=${scores.agency.toFixed(1)}, qui=${scores.quirky.toFixed(1)}`);
      }
    }
  }
  
  // ============ COMPUTE SUMMARY ============
  
  console.log("\n\n📊 Computing Statistics...\n");
  
  const summary: Record<string, any> = {
    conditions: {},
    deltas: {},
  };
  
  for (const condition of CONDITIONS) {
    const conditionResults = results.filter(r => r.condition === condition.id);
    
    summary.conditions[condition.id] = {
      name: condition.name,
      dimensions: {
        informality: computeDimensionStats(conditionResults, 'informality'),
        succinctness: computeDimensionStats(conditionResults, 'succinctness'),
        agency: computeDimensionStats(conditionResults, 'agency'),
        quirky: computeDimensionStats(conditionResults, 'quirky'),
      },
    };
  }
  
  // Compute deltas between conditions
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  
  summary.deltas = {
    baseline_vs_low: {},
    baseline_vs_high: {},
    low_vs_high: {},
  };
  
  for (const dim of dims) {
    const baselineMean = summary.conditions.baseline.dimensions[dim].mean;
    const lowMean = summary.conditions.low.dimensions[dim].mean;
    const highMean = summary.conditions.high.dimensions[dim].mean;
    
    summary.deltas.baseline_vs_low[dim] = Math.abs(baselineMean - lowMean);
    summary.deltas.baseline_vs_high[dim] = Math.abs(baselineMean - highMean);
    summary.deltas.low_vs_high[dim] = Math.abs(lowMean - highMean);
  }
  
  // ============ RUN EVALUATIONS ============
  
  console.log("\n\n✅ Running Evals...\n");
  
  const evals: Record<string, { passed: boolean; score: number; details: string }> = {};
  
  // Load scenario evals
  const scenarioYaml = fs.readFileSync('./scenario.yaml', 'utf-8');
  const scenario = YAML.parse(scenarioYaml);
  
  for (const evalDef of scenario.evals || []) {
    console.log(`  ${evalDef.id}: ${evalDef.name}`);
    
    let allPassed = true;
    let totalScore = 0;
    const details: string[] = [];
    
    for (const assertion of evalDef.assertions || []) {
      const result = evaluateAssertion(results, assertion);
      
      totalScore += result.score;
      if (!result.passed) allPassed = false;
      details.push(`  [${assertion.check}] ${result.details}`);
    }
    
    const avgScore = totalScore / (evalDef.assertions?.length || 1);
    
    evals[evalDef.id] = {
      passed: allPassed,
      score: avgScore,
      details: details.join('\n'),
    };
    
    console.log(`    ${allPassed ? '✅' : '❌'} Score: ${avgScore.toFixed(2)}`);
  }
  
  return { runs: results, summary, evals };
}

function computeDimensionStats(results: ConditionResult[], dimension: keyof DimensionScores) {
  const scores = results.map(r => r.scores[dimension]);
  const n = scores.length;
  
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  
  const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);
  
  return { scores, mean, stddev, n };
}

// ============ YAML PARSER (simple) ============
const YAML = {
  parse: (str: string): any => {
    // Simple YAML parser for our scenario
    const lines = str.split('\n');
    const result: any = {};
    let currentSection: string | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('evals:')) {
        currentSection = 'evals';
        result.evals = [];
      } else if (currentSection === 'evals' && trimmed.startsWith('- id:')) {
        const match = trimmed.match(/- id: "(.+)"/);
        if (match) {
          const evalDef: any = { id: match[1] };
          
          // Look ahead for name and assertions
          const idx = lines.indexOf(line);
          for (let i = idx + 1; i < lines.length; i++) {
            const nextLine = lines[i].trim();
            if (nextLine.startsWith('name:')) {
              evalDef.name = nextLine.replace('name:', '').trim().replace(/"/g, '');
            } else if (nextLine.startsWith('assertions:')) {
              // Collect assertions
              evalDef.assertions = [];
              for (let j = i + 1; j < lines.length; j++) {
                const assertLine = lines[j].trim();
                if (assertLine.startsWith('- check:')) {
                  const checkMatch = assertLine.match(/- check: "(.+)"/);
                  if (checkMatch) {
                    const assertion: any = { check: checkMatch[1] };
                    // Look for params in next few lines
                    for (let k = j + 1; k < Math.min(j + 10, lines.length); k++) {
                      const paramLine = lines[k].trim();
                      if (paramLine.match(/^\w+:/)) {
                        const [key, value] = paramLine.split(':').map(s => s.trim());
                        if (key !== 'assertions' && key !== 'formula') {
                          assertion[key] = isNaN(Number(value)) ? value.replace(/"/g, '') : Number(value);
                        }
                      } else if (!paramLine.startsWith('-') && !paramLine.startsWith('  -')) {
                        break;
                      }
                      if (paramLine.startsWith('  - check:')) break;
                    }
                    evalDef.assertions.push(assertion);
                  }
                }
                if (nextLine.startsWith('- id:') || nextLine === '') break;
              }
              break;
            }
            if (nextLine.startsWith('- id:')) break;
          }
          
          result.evals.push(evalDef);
        }
      }
    }
    
    return result;
  }
};

// ============ SAVE AND REPORT ============

async function saveResults(results: { runs: ConditionResult[]; summary: any; evals: any }) {
  // Save full results
  const outputPath = path.join(OUTPUT_DIR, `run-${Date.now()}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to: ${outputPath}`);
  
  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("📋 EVALUATION SUMMARY");
  console.log("=".repeat(60));
  
  console.log("\n🔢 Dimension Scores by Condition:");
  for (const [condId, cond] of Object.entries(results.summary.conditions || {})) {
    console.log(`  ${cond.name}:`);
    for (const [dim, data] of Object.entries(cond.dimensions)) {
      console.log(`    ${dim}: mean=${(data.mean as number).toFixed(2)}, stddev=${(data.stddev as number).toFixed(2)}`);
    }
  }
  
  console.log("\n📐 Deltas Between Conditions:");
  console.log(`  Low vs High:`);
  for (const [dim, delta] of Object.entries(results.summary.deltas.low_vs_high || {})) {
    console.log(`    ${dim}: ${(delta as number).toFixed(2)}`);
  }
  
  console.log("\n✅ EVAL Results:");
  const evals = results.evals;
  const passed = Object.values(evals).filter((e: any) => e.passed).length;
  const total = Object.keys(evals).length;
  console.log(`  ${passed}/${total} evals passed`);
  
  for (const [id, evalResult] of Object.entries(evals)) {
    const status = evalResult.passed ? "✅" : "❌";
    console.log(`  ${status} ${id}: score=${evalResult.score.toFixed(2)}`);
  }
}

// ============ RUN ============

async function main() {
  try {
    const results = await runEvaluation();
    await saveResults(results);
    process.exit(0);
  } catch (error) {
    console.error("Evaluation failed:", error);
    process.exit(1);
  }
}

main();