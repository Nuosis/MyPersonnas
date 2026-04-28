/**
 * Personality Dimensions LLM Scorer
 * 
 * Uses LLM-as-judge to score responses on all personality dimensions.
 * 
 * IMPORTANT: All scoring is done by the LLM. No heuristic fallbacks.
 */

import { getModel, complete } from "@mariozechner/pi-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export interface DimensionScores {
  informality: number;
  succinctness: number;
  agency: number;
  quirky: number;
}

// Load scoring prompt once at module load
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCORING_PROMPT = fs.readFileSync(
  path.join(__dirname, "scoring-prompt.md"),
  "utf-8"
);

/**
 * Score a single response using LLM-as-judge
 * 
 * @param response - The agent response to score
 * @param model - The LLM model to use for scoring (default: gpt-5.2)
 * @param temperature - Temperature for LLM scoring (default: 0.3 for consistent scores)
 * @param apiKey - API key for the model provider
 * @returns Promise<DimensionScores> - Scores for all 4 dimensions
 */
export async function scoreResponse(
  response: string,
  model: string = "gpt-5.2",
  temperature: number = 0.3,
  apiKey?: string
): Promise<DimensionScores> {
  const llm = getModel("openai", model);
  
  const prompt = `${SCORING_PROMPT}

## Response to Score

"""
${response}
"""

## Task

Rate this response on each dimension (0-10). Return your scores as a JSON object.
Be thorough and consider all aspects of tone, language, and style.
`;

  const result = await complete(
    llm, 
    { messages: [{ role: 'user', content: prompt }] }, 
    { temperature, apiKey }
  );
  
  // Extract text content from result
  const text = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map(c => c.text)
    .join("\n");
  
  // Try to extract JSON block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const scores = JSON.parse(jsonMatch[0]);
      return {
        informality: clamp(scores.informality ?? 5, 0, 10),
        succinctness: clamp(scores.succinctness ?? 5, 0, 10),
        agency: clamp(scores.agency ?? 5, 0, 10),
        quirky: clamp(scores.quirky ?? 5, 0, 10),
      };
    } catch (e) {
      // JSON parse failed, fall through to error
    }
  }
  
  // If we get here, LLM scoring failed - this is a critical error
  // Do NOT use heuristics as fallback - that defeats the purpose
  throw new Error(`LLM scoring failed to return valid JSON. Response was: ${text.substring(0, 200)}`);
}

/**
 * Score multiple responses in batch for efficiency
 */
export async function scoreResponses(
  responses: string[],
  model: string = "gpt-5.2",
  temperature: number = 0.3,
  apiKey?: string
): Promise<DimensionScores[]> {
  return Promise.all(responses.map(r => scoreResponse(r, model, temperature, apiKey)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default { scoreResponse, scoreResponses };