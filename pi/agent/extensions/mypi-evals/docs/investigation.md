# mypi-evals Bug Investigation

## Problem
When pi loads the extension, all 11 evals show `name="undefined"` and `description="eval"`. Standalone YAML parsing works correctly.

## Root Cause
Variable name typo in `listScenarios()`: the loop iterates as `evalItem` but the push used `eval` (which references the suite name string in the outer scope), causing eval names/descriptions to be wrong.

Fixed: `eval` → `evalItem` in the scenarios.push() call.

## Hypothesis List

| # | Hypothesis | Null Hypothesis | Status |
|---|------------|-----------------|--------|
| 1 | Wrong working directory — `ctx.cwd` differs between extension load vs tool execution | `ctx.cwd` is the same at registration and execution | ❌ NULLIFIED — `cwd="/Users/devflow"` confirmed at both. Working dir is not the issue. |
| 7 | **Eval schema mismatch** — YAML uses `assertion:` (singular) but code expects `assertions:` (plural) | YAML has `assertions:` (plural) as the code expects | ✅ **NULLIFIED + SOLVED** — YAML `assertion:` (singular) is correct. Evals parse correctly with `name` and `description` populated. Bug was variable name typo: loop uses `evalItem` but push used `eval`. |

## Debug Log Evidence (Hypothesis 1)

```
[DEBUG][2026-04-26T05:45:49.919Z][listScenarios] cwd="/Users/devflow" {"scenariosDir":"/Users/devflow/evals/scenarios"}
[DEBUG][2026-04-26T05:45:49.919Z][extension.register] cwd="unknown" {}
```

## Debug Log Evidence (Hypothesis 7 - eval_raw)

```
[DEBUG][2026-04-26T05:54:35.004Z][eval_raw] cwd="/Users/devflow" {"suiteName":"personality-dimensions","evalId":"CTRL-002","evalName":"Baseline is not middle-ground default","evalDesc":"Baseline scores should vary, not be uniformly ~5","evalKeys":["id","name","description","type","assertion"]}
```

`evalName` and `evalDesc` are correctly populated — proving the null that "values are empty after parse" is FALSE. The problem was downstream in the push call.

## Method
1. Pick the most fundamental remaining hypothesis
2. Design a test that PROVES THE NULL (not the hypothesis)
3. If null is proven false → hypothesis might be worth exploring
4. If null holds → move to next hypothesis
5. Never race ahead — work systematically

## Files
- Extension: `~/.pi/agent/extensions/mypi-evals/index.ts`
- Scenarios: `~/evals/scenarios/`
- Debug log: `/tmp/pi-evals-debug.log`