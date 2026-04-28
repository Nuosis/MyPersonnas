# Personality Dimensions Eval - Scenario Definition

## Overview

This eval tests whether personality dimension settings in AGENTS.md **materially change** agent responses.

## Hypothesis

If personality settings (informality, succinctness, agency, quirky) are effective, then:
- **High internal consistency**: Same condition → similar scores across runs
- **High external inconsistency**: Different conditions → different scores (delta ≥ 4)

## Design

| Factor | Value |
|--------|-------|
| Base prompts | 5 (P1-P5) |
| Conditions | 3 (baseline, all-0, all-10) |
| Runs per condition | 5 |
| Total runs | 5 × 3 × 5 = 75 responses |
| Model | claude-sonnet |
| Temperature | 0.7 |

## Conditions

### Condition 1: Baseline (no personality section)
AGENTS.md without Personality Dimensions section. Tests what the model does by default.

### Condition 2: All-0 (Robotic, Verbose, Cautious, Straight)
All personality dimensions set to 0:
- Informality: 0 (Robotic)
- Succinctness: 0 (Verbose)
- Agency: 0 (Cautious)
- Quirky: 0 (Straight)

### Condition 3: All-10 (Informal, Brief, High Initiative, Playful)
All personality dimensions set to 10:
- Informality: 10 (Informal)
- Succinctness: 10 (Brief)
- Agency: 10 (High Initiative)
- Quirky: 10 (Playful)

## Base Prompts

| ID | Prompt | Target Dimensions |
|----|--------|-------------------|
| P1 | "Hey, quick question about the codebase" | informality, agency |
| P2 | "Explain how transformers work step by step" | succinctness |
| P3 | "Should I delete this branch?" | agency |
| P4 | "The build is broken again" | quirky |
| P5 | "Here's my new feature, review it" | informality, agency |

## Scoring Functions

Each dimension is scored 0-10 based on linguistic markers:

### Informality
- **High (10):** "hey", "awesome", "sure thing", "gotcha", "let's"
- **Low (0):** "acknowledged", "processing", "pursuant to", "hereby"

### Succinctness
- **High (10):** < 20 words
- **High (8):** 20-50 words
- **Mid (6):** 50-100 words
- **Mid (4):** 100-200 words
- **Low (2):** 200-400 words
- **Low (0):** > 400 words

### Agency
- **High (10):** "I'll", "let me", "done", "just did", "took care of"
- **Low (0):** "would you like", "should I", "please confirm", "do you want"

### Quirky
- **High (10):** "lol", "bruh", "yikes", "dammit", "welp"
- **Low (0):** "however", "therefore", "furthermore", "in conclusion"

## Evals

### Internal Consistency

| ID | Eval | Pass Criteria |
|----|------|---------------|
| INT-001 | Low condition scores low | mean(all dims) < 3 |
| INT-002 | High condition scores high | mean(all dims) ≥ 7 |
| INT-003 | Runs are internally consistent | stddev < 1.5 per dim |

### External Consistency (Deltas)

| ID | Eval | Pass Criteria |
|----|------|---------------|
| DELTA-001 | Informality delta | \|high - low\| ≥ 4 |
| DELTA-002 | Succinctness delta | \|high - low\| ≥ 4 |
| DELTA-003 | Agency delta | \|high - low\| ≥ 4 |
| DELTA-004 | Quirky delta | \|high - low\| ≥ 4 |

### Cross-Prompt Reliability

| ID | Eval | Pass Criteria |
|----|------|---------------|
| REL-001 | Delta consistent across prompts | Delta ≥ 4 in ≥ 4/5 prompts |
| REL-002 | Cronbach's alpha | α ≥ 0.7 |

### Baseline Controls

| ID | Eval | Pass Criteria |
|----|------|---------------|
| CTRL-001 | Baseline differs from extremes | \|baseline - low\| > 1.5 for ≥ 2 dims |
| CTRL-002 | Baseline is not uniform | mean scores between 3-7 |

## Expected Outcomes

### If Personality Settings ARE Effective:
- INT evals: ✅ PASS (conditions produce distinct score distributions)
- DELTA evals: ✅ PASS (deltas between low/high ≥ 4)
- REL evals: ✅ PASS (consistent across prompts)
- CTRL evals: ✅ PASS (baseline is controlled)

### If Personality Settings Are NOT Effective:
- INT evals: ❌ FAIL (no clustering at low/high)
- DELTA evals: ❌ FAIL (deltas < 4)
- REL evals: ❌ FAIL (inconsistent)
- CTRL evals: ❓ UNCERTAIN

## Running

```bash
cd /Users/devflow/evals/scenarios/personality-dimensions
npx tsx eval-runner.ts
```

## Output

Results saved to:
```
evals/outputs/personality-dimensions/run-{timestamp}.json
```

Contains:
- `runs[]`: All 75 responses with scores
- `summary{}`: Aggregated statistics per condition/dimension
- `evals{}`: Pass/fail for each eval with details
