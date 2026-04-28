/**
 * Personality Dimensions Custom Scorer
 * 
 * Implements custom assertion checks for personality-dimensions evals.
 * These are used by the harness to evaluate scores.
 * 
 * Supported assertion checks:
 * - all_dims_below: All dimensions below threshold
 * - all_dims_above: All dimensions above threshold
 * - delta: Difference between conditions
 * - delta_across_all_prompts: Delta consistent across prompts
 * - baseline_different: Baseline statistically distinct from extremes
 * - baseline_not_uniform: Baseline not uniformly at middle
 * - stddev: Standard deviation of scores
 * - cronbach_alpha: Inter-item reliability
 */

import { mean, stddev, variance } from './stats';

export interface DimensionScores {
  informality: number;
  succinctness: number;
  agency: number;
  quirky: number;
}

export interface ConditionResult {
  condition: string;
  promptId: string;
  scores: DimensionScores;
}

export interface EvalAssertion {
  check: string;
  [key: string]: any;
}

// ============ SCORING FUNCTIONS ============

export function scoreInformality(response: string): number {
  const informalMarkers = [
    "yo", "yo!", "hey", "hi", "hello", "great", "awesome", "sure thing", "yeah", "yep", 
    "gotcha", "cool", "nice", "perfect", "no worries", "all good", "let's", "you know", 
    "alright", "sounds good", "appreciate", "cheers", "sure", "no prob", "no problem", 
    "happy to", "glad to", "definitely", "absolutely"
  ];
  const machineMarkers = [
    "acknowledged", "processing", "executing", "as requested", "hereby", 
    "pursuant to", "in accordance with", "this response", "in response to", 
    "i am an ai", "as an ai assistant", "my purpose is", "i can help with",
    "i have analyzed", "i recommend", "please confirm"
  ];
  
  const lower = response.toLowerCase();
  const informalScore = informalMarkers.filter(m => lower.includes(m)).length;
  const machineScore = machineMarkers.filter(m => lower.includes(m)).length;
  
  // Also check for exclamation marks and casual tone
  const exclamationCount = (response.match(/!/g) || []).length;
  const hasEmoji = /[\p{Emoji}]/u.test(response) || /💀|😂|😎|🤔|👍/.test(response);
  
  const informalBonus = exclamationCount * 0.5 + (hasEmoji ? 1 : 0);
  
  return Math.min(10, Math.max(0, informalScore * 2 - machineScore * 3 + informalBonus));
}

export function scoreSuccinctness(response: string): number {
  const wordCount = response.split(/\s+/).length;
  if (wordCount < 20) return 10;
  if (wordCount < 50) return 8;
  if (wordCount < 100) return 6;
  if (wordCount < 200) return 4;
  if (wordCount < 400) return 2;
  return 0;
}

export function scoreAgency(response: string): number {
  const proactiveMarkers = [
    "i'll", "let me", "i'm going to", "done", "already", "just did", 
    "went ahead", "took care of", "fixed", "checked", "updated", 
    "i created", "i added", "done!", "handled", "completed"
  ];
  const reactiveMarkers = [
    "would you like", "should i", "do you want", "let me know", 
    "please confirm", "please provide", "do you wish", "would you prefer"
  ];
  
  const lower = response.toLowerCase();
  const proactiveScore = proactiveMarkers.filter(m => lower.includes(m)).length;
  const reactiveScore = reactiveMarkers.filter(m => lower.includes(m)).length;
  
  return Math.min(10, Math.max(0, proactiveScore * 3 - reactiveScore * 2));
}

export function scoreQuirky(response: string): number {
  const quirkyMarkers = [
    "lol", "haha", "lmao", "bruh", "well well", "oh boy", "yikes", "oof", "ugh", 
    "holy", "dammit", "fml", "welp", "smh", "ffs", "wth", "smh", "sheesh",
    "💀", "😂", "😭", "🙄", "🤷", "😎", "🤔", "💪", "👀", "🎉", "🔥"
  ];
  const straightMarkers = [
    "however", "therefore", "furthermore", "consequently", "in conclusion", 
    "to summarize", "as previously mentioned", "it is worth noting", "in this regard"
  ];
  
  const lower = response.toLowerCase();
  const quirkyScore = quirkyMarkers.filter(m => lower.includes(m)).length;
  const straightScore = straightMarkers.filter(m => lower.includes(m)).length;
  
  return Math.min(10, Math.max(0, quirkyScore * 4 - straightScore * 2));
}

export function scoreResponse(response: string): DimensionScores {
  return {
    informality: scoreInformality(response),
    succinctness: scoreSuccinctness(response),
    agency: scoreAgency(response),
    quirky: scoreQuirky(response),
  };
}

// ============ ASSERTION CHECKS ============

/**
 * all_dims_below: All dimensions below threshold
 * Usage: { check: "all_dims_below", condition: "low", threshold: 3 }
 */
export function checkAllDimsBelow(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const condition = assertion.condition || "low";
  const threshold = assertion.threshold ?? 3;
  
  const conditionResults = results.filter(r => r.condition === condition);
  
  let dimsAbove = 0;
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  
  for (const dim of dims) {
    const avg = mean(conditionResults.map(r => r.scores[dim]));
    if (avg >= threshold) dimsAbove++;
  }
  
  const passed = dimsAbove === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    details: `${condition}: ${dimsAbove}/4 dims >= ${threshold}`,
  };
}

/**
 * all_dims_above: All dimensions above threshold
 * Usage: { check: "all_dims_above", condition: "high", threshold: 7 }
 */
export function checkAllDimsAbove(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const condition = assertion.condition || "high";
  const threshold = assertion.threshold ?? 7;
  
  const conditionResults = results.filter(r => r.condition === condition);
  
  let dimsBelow = 0;
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  
  for (const dim of dims) {
    const avg = mean(conditionResults.map(r => r.scores[dim]));
    if (avg < threshold) dimsBelow++;
  }
  
  const passed = dimsBelow === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    details: `${condition}: ${dimsBelow}/4 dims < ${threshold}`,
  };
}

/**
 * delta: Difference between conditions
 * Usage: { check: "delta", dimension: "informality", min_delta: 4 }
 */
export function checkDelta(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const dimension = assertion.dimension || "informality";
  const minDelta = assertion.min_delta ?? 4;
  
  const lowResults = results.filter(r => r.condition === "low");
  const highResults = results.filter(r => r.condition === "high");
  
  const lowMean = mean(lowResults.map(r => r.scores[dimension as keyof DimensionScores]));
  const highMean = mean(highResults.map(r => r.scores[dimension as keyof DimensionScores]));
  
  const delta = Math.abs(highMean - lowMean);
  const passed = delta >= minDelta;
  
  // Partial credit for near-misses
  let score: number;
  if (delta >= minDelta * 2) score = 1;
  else if (delta >= minDelta) score = 0.75;
  else if (delta >= minDelta * 0.75) score = 0.5;
  else score = 0;
  
  return {
    passed,
    score,
    details: `${dimension}: |${highMean.toFixed(2)} - ${lowMean.toFixed(2)}| = ${delta.toFixed(2)} (min: ${minDelta})`,
  };
}

/**
 * delta_across_all_prompts: Delta consistent across prompts
 * Usage: { check: "delta_across_all_prompts", min_prompts: 4, min_delta: 4 }
 */
export function checkDeltaAcrossPrompts(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const minPrompts = assertion.min_prompts ?? 4;
  const minDelta = assertion.min_delta ?? 4;
  
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  const promptIds = [...new Set(results.map(r => r.promptId))];
  
  let promptsWithDelta = 0;
  
  for (const promptId of promptIds) {
    const lowResults = results.filter(r => r.condition === "low" && r.promptId === promptId);
    const highResults = results.filter(r => r.condition === "high" && r.promptId === promptId);
    
    for (const dim of dims) {
      const lowMean = mean(lowResults.map(r => r.scores[dim as keyof DimensionScores]));
      const highMean = mean(highResults.map(r => r.scores[dim as keyof DimensionScores]));
      
      if (Math.abs(highMean - lowMean) >= minDelta) {
        promptsWithDelta++;
        break; // Only count prompt once if any dim has delta
      }
    }
  }
  
  const passed = promptsWithDelta >= minPrompts;
  return {
    passed,
    score: promptsWithDelta / promptIds.length,
    details: `${promptsWithDelta}/${promptIds.length} prompts have delta >= ${minDelta}`,
  };
}

/**
 * baseline_different: Baseline statistically distinct from extremes
 * Usage: { check: "baseline_different", min_diff: 1.5, dims_required: 2 }
 */
export function checkBaselineDifferent(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const minDiff = assertion.min_diff ?? 1.5;
  const dimsRequired = assertion.dims_required ?? 2;
  
  const baselineResults = results.filter(r => r.condition === "baseline");
  const lowResults = results.filter(r => r.condition === "low");
  const highResults = results.filter(r => r.condition === "high");
  
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  let dimsDistinct = 0;
  
  for (const dim of dims) {
    const baselineMean = mean(baselineResults.map(r => r.scores[dim as keyof DimensionScores]));
    const lowMean = mean(lowResults.map(r => r.scores[dim as keyof DimensionScores]));
    const highMean = mean(highResults.map(r => r.scores[dim as keyof DimensionScores]));
    
    const diffFromLow = Math.abs(baselineMean - lowMean);
    const diffFromHigh = Math.abs(highMean - baselineMean);
    
    if (diffFromLow >= minDiff && diffFromHigh >= minDiff) {
      dimsDistinct++;
    }
  }
  
  const passed = dimsDistinct >= dimsRequired;
  return {
    passed,
    score: dimsDistinct / dims.length,
    details: `${dimsDistinct}/${dims.length} dims are distinct from both low and high`,
  };
}

/**
 * baseline_not_uniform: Baseline not uniformly at middle
 * Usage: { check: "baseline_not_uniform", range_min: 3, range_max: 7 }
 */
export function checkBaselineNotUniform(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const rangeMin = assertion.range_min ?? 3;
  const rangeMax = assertion.range_max ?? 7;
  
  const baselineResults = results.filter(r => r.condition === "baseline");
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  
  const means = dims.map(dim => mean(baselineResults.map(r => r.scores[dim as keyof DimensionScores])));
  
  // Check that means span a range (not all at ~5)
  const minMean = Math.min(...means);
  const maxMean = Math.max(...means);
  const range = maxMean - minMean;
  
  // Also check that not all are clustered around middle
  const allInMiddle = means.every(m => m >= rangeMin && m <= rangeMax);
  
  const passed = range >= 2 || !allInMiddle;
  return {
    passed,
    score: passed ? 1 : 0,
    details: `baseline means: [${means.map(m => m.toFixed(1)).join(", ")}] range=${range.toFixed(1)}`,
  };
}

/**
 * internal_consistency: Stddev within condition
 * Usage: { check: "internal_consistency", condition: "low", threshold: 1.5, dimension: "all" }
 */
export function checkInternalConsistency(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const condition = assertion.condition || "low";
  const threshold = assertion.threshold ?? 1.5;
  const dimension = assertion.dimension || "all";
  
  const conditionResults = results.filter(r => r.condition === condition);
  const dims = dimension === "all" 
    ? (["informality", "succinctness", "agency", "quirky"] as const)
    : ([dimension] as const);
  
  let failedDims = 0;
  
  for (const dim of dims) {
    const scores = conditionResults.map(r => r.scores[dim as keyof DimensionScores]);
    const sd = stddev(scores);
    if (sd >= threshold) failedDims++;
  }
  
  const passed = failedDims === 0;
  return {
    passed,
    score: passed ? 1 : 0,
    details: `${condition}: ${failedDims}/${dims.length} dims exceed stddev ${threshold}`,
  };
}

/**
 * cronbach_alpha: Inter-item reliability
 * Usage: { check: "cronbach_alpha", threshold: 0.7 }
 */
export function checkCronbachAlpha(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const threshold = assertion.threshold ?? 0.7;
  
  const dims = ["informality", "succinctness", "agency", "quirky"] as const;
  
  // Group by condition
  const conditions = ["baseline", "low", "high"];
  const allScores: number[][] = [];
  
  for (const condition of conditions) {
    const conditionResults = results.filter(r => r.condition === condition);
    for (const result of conditionResults) {
      allScores.push(dims.map(d => result.scores[d as keyof DimensionScores]));
    }
  }
  
  // Calculate Cronbach's alpha
  // α = (k/(k-1)) * (1 - sum(var_i)/var(sum))
  const k = dims.length;
  
  // Item variances
  const itemVariances = dims.map((_, i) => {
    const itemScores = allScores.map(scores => scores[i]);
    return variance(itemScores);
  });
  
  // Total score variance
  const totalScores = allScores.map(scores => scores.reduce((a, b) => a + b, 0));
  const totalVariance = variance(totalScores);
  
  const alpha = (k / (k - 1)) * (1 - itemVariances.reduce((a, b) => a + b, 0) / totalVariance);
  
  const passed = alpha >= threshold;
  return {
    passed,
    score: passed ? 1 : Math.max(0, alpha / threshold),
    details: `Cronbach's α = ${alpha.toFixed(3)} (threshold: ${threshold})`,
  };
}

// ============ MAIN EVALUATOR ============

export type AssertionCheck = (
  results: ConditionResult[],
  assertion: EvalAssertion
) => { passed: boolean; score: number; details: string };

export const assertionChecks: Record<string, AssertionCheck> = {
  all_dims_below: checkAllDimsBelow,
  all_dims_above: checkAllDimsAbove,
  delta: checkDelta,
  delta_across_all_prompts: checkDeltaAcrossPrompts,
  baseline_different: checkBaselineDifferent,
  baseline_not_uniform: checkBaselineNotUniform,
  internal_consistency: checkInternalConsistency,
  cronbach_alpha: checkCronbachAlpha,
};

export function evaluateAssertion(
  results: ConditionResult[],
  assertion: EvalAssertion
): { passed: boolean; score: number; details: string } {
  const check = assertionChecks[assertion.check];
  if (!check) {
    return {
      passed: false,
      score: 0,
      details: `Unknown assertion check: ${assertion.check}`,
    };
  }
  return check(results, assertion);
}