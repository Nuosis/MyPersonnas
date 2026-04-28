# Evals for personality-dimensions scenario
# Tests: Does changing personality settings materially change responses?

**Last Updated:** 2026-04-25
**Infrastructure:** `artifacts/scorer.ts`, `artifacts/stats.ts`, `artifacts/scoring-prompt.md`

## Infrastructure Components

### artifacts/scorer.ts
Custom assertion checks and scoring functions:
- `scoreResponse(response: string): DimensionScores` - Heuristic scoring
- `assertionChecks` registry mapping check names to functions
- Functions: `all_dims_below`, `all_dims_above`, `delta`, `delta_across_all_prompts`, `baseline_different`, `baseline_not_uniform`, `internal_consistency`, `cronbach_alpha`

### artifacts/stats.ts
Statistical utilities:
- `mean()`, `variance()`, `stddev()`
- `cronbachAlpha(itemScores: number[][])`
- `correlation(x: number[], y: number[])`

### artifacts/scoring-prompt.md
LLM evaluator prompt for scoring responses on each dimension (0-10 scale).

## Internal Consistency Evals

### INT-001: Low condition scores low
- **Type:** boolean
- **Check:** `all_dims_below`
- **Condition:** "low"
- **Threshold:** 3
- **Pass:** All 4 dimensions have mean < 3 for low condition

### INT-002: High condition scores high
- **Type:** boolean
- **Check:** `all_dims_above`
- **Condition:** "high"
- **Threshold:** 7
- **Pass:** All 4 dimensions have mean >= 7 for high condition

### INT-003: Runs are internally consistent
- **Type:** boolean
- **Checks:** `internal_consistency` (one per condition)
- **Condition:** low, high
- **Threshold:** 1.5 (stddev)
- **Pass:** Stddev of scores < 1.5 for both low and high conditions across 5 runs

## External Consistency (Delta) Evals

### DELTA-001: Informality delta between conditions
- **Type:** likert
- **Scale:** [0, 2, 5, 8, 10]
- **Check:** `delta`
- **Dimension:** informality
- **Min Delta:** 4
- **Pass:** |high_mean - low_mean| >= 4

### DELTA-002: Succinctness delta between conditions
- **Type:** likert
- **Scale:** [0, 2, 5, 8, 10]
- **Check:** `delta`
- **Dimension:** succinctness
- **Min Delta:** 4

### DELTA-003: Agency delta between conditions
- **Type:** likert
- **Scale:** [0, 2, 5, 8, 10]
- **Check:** `delta`
- **Dimension:** agency
- **Min Delta:** 4

### DELTA-004: Quirky delta between conditions
- **Type:** likert
- **Scale:** [0, 2, 5, 8, 10]
- **Check:** `delta`
- **Dimension:** quirky
- **Min Delta:** 4

## Cross-Prompt Reliability Evals

### REL-001: Delta consistent across prompts
- **Type:** boolean
- **Check:** `delta_across_all_prompts`
- **Min Prompts:** 4
- **Min Delta:** 4
- **Pass:** Delta >= 4 in at least 4/5 prompts

### REL-002: Cronbach's alpha >= 0.7
- **Type:** formula
- **Check:** `cronbach_alpha`
- **Threshold:** 0.7
- **Formula:** α = (k/(k-1)) * (1 - Σvar_i / var(sum))
- **Pass:** α >= 0.7 (inter-item reliability)

## Baseline Control Evals

### CTRL-001: Baseline differs from extremes
- **Type:** boolean
- **Check:** `baseline_different`
- **Min Diff:** 1.5
- **Dims Required:** 2
- **Pass:** At least 2 dimensions have baseline distinct from both low and high (|baseline - low| >= 1.5 AND |high - baseline| >= 1.5)

### CTRL-002: Baseline is not middle-ground default
- **Type:** boolean
- **Check:** `baseline_not_uniform`
- **Range:** [3, 7]
- **Pass:** Either: (a) means span range >= 2, OR (b) not all means clustered in middle

## Scoring Function Details

### Informality (0 = Robotic, 10 = Informal)
- Informal markers add +1.5 each
- Machine markers subtract -3 each
- Range: 0-10, capped

### Succinctness (0 = Verbose, 10 = Brief)
- Word count based:
  - <20 words = 10
  - 20-50 = 8
  - 50-100 = 6
  - 100-200 = 4
  - 200-400 = 2
  - >400 = 0

### Agency (0 = Cautious, 10 = Proactive)
- Proactive markers add +3 each
- Reactive markers subtract -2 each
- Range: 0-10, capped

### Quirky (0 = Straight, 10 = Playful)
- Quirky markers add +4 each
- Straight markers subtract -2 each
- Range: 0-10, capped

## Expected Outcomes

### If Personality Settings ARE Effective:
- INT-001: ✅ PASS (low condition scores cluster at low end)
- INT-002: ✅ PASS (high condition scores cluster at high end)
- INT-003: ✅ PASS (5 runs produce consistent scores, stddev < 1.5)
- DELTA-001 to 004: ✅ PASS (deltas between low/high >= 4)
- REL-001: ✅ PASS (delta consistent across prompts)
- REL-002: ✅ PASS (α >= 0.7)
- CTRL-001: ✅ PASS (baseline distinct from extremes)
- CTRL-002: ✅ PASS (baseline not uniformly ~5)

### If Personality Settings Are NOT Effective:
- INT-001/002: ❌ FAIL (no clustering)
- INT-003: ❌ FAIL (high variance)
- DELTA-001 to 004: ❌ FAIL (deltas < 4)
- REL-001/002: ❌ FAIL (inconsistent)
- CTRL: ❓ UNCLEAR (baseline behavior unpredictable)