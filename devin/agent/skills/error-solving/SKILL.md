---
name: error-solving
description: Systematic error-solving method using null hypotheses. Use when debugging issues where root cause is unclear, or when you find yourself chasing multiple hypotheses without resolution.
---

# Error Solving - Systematic Debugging Skill

Use this skill when:
- Bug root cause is unclear
- Multiple plausible hypotheses exist
- You've already tried "obvious" fixes without success
- You're about to start guessing without evidence
- The same issue keeps surfacing after apparent fixes

## Core Doctrine

**Prove the null hypothesis, not your theory.**

A hypothesis is a possible explanation. The null hypothesis is the opposite — the claim that the hypothesis is NOT true.

- **Null holds** (evidence supports it) → Move to next hypothesis
- **Null falsified** (evidence contradicts it) → Hypothesis may be worth exploring

This prevents the "I know what the issue is!" trap — you stay systematic and grounded in evidence.

## When to Trigger

Keywords that suggest this skill is needed:
- "I can't figure this out"
- "What's causing this?"
- "Why is this broken?"
- "Multiple things could be wrong"
- "I've tried X and Y but it still doesn't work"
- "What am I missing?"

## The Method

### Step 1: Define the Problem Precisely

Before hypothesizing, state the problem in one sentence:
- What is observed vs what is expected?
- What is the error/output/behavior?
- Is it reproducible? Sporadic?

### Step 2: List Hypotheses (Fundamental → Dependent)

Order by how foundational they are. Simple, structural issues first.

Example ordering:
1. Working directory / path mismatch
2. Module/dependency resolution
3. Data structure/schema mismatch
4. Configuration/environment
5. Caching/stale state
6. Version conflicts
7. Logic errors
8. Edge cases

Write the list as a numbered series with:
- The hypothesis (what you think might be true)
- The null hypothesis (what must be true for the hypothesis to be wrong)

### Step 3: Pick the Most Fundamental

Start at the top of the list. Don't skip ahead to the clever/interesting hypothesis.

### Step 4: Design a Falsification Test

For the null hypothesis, design a test that:
- Produces **actual output** (logs, stdout, stderr, file contents)
- Would **prove the null is FALSE** if hypothesis turns out to be true
- Is **minimal** — one variable at a time

**RULE:** No code review as evidence. You must see the effect in real output.

### Step 5: Execute and Observe

Run the test. Read the actual output. Do not interpret through the lens of what you think is happening.

### Step 6: Interpret

- **Null holds** (test result is as-expected even if hypothesis were true) → Nullify this hypothesis. Move to next.
- **Null falsified** (test result contradicts null) → Hypothesis is live. Investigate further with more targeted tests.

### Step 7: Document

Record:
- Which hypothesis was tested
- What the test was
- Actual output
- Result (nullified / falsified / inconclusive)
- Any new questions raised

### Step 8: Iterate

Repeat until the root cause is found.

## Example

**Problem:** Extension loads but all 11 evals show `name="undefined"`. Standalone YAML parsing works.

**Hypotheses:**
1. Wrong working directory (`ctx.cwd` differs at load vs exec)
2. Scenarios directory path mismatch
3. YAML library version conflict
4. Jiti transpilation issue
5. Eval schema mismatch (`assertion:` vs `assertions:`)
... (others)

**Pick #1:**

- **Null:** `ctx.cwd` is the same at registration and execution
- **Test:** Add logging that captures `cwd` at both moments. Output to `/tmp/debug.log`
- **Result:** Both show `/Users/devflow`. **Null holds.** Move to next.

**Pick #5 (eval schema):**

- **Null:** YAML has `assertions:` (plural) as code expects
- **Test:** Log raw parsed eval object inside loop before push
- **Result:** `evalName="Baseline is not middle-ground default"` — populated, not undefined. **Null falsified!** Values are populated, problem is downstream.

**Result:** Further investigation shows loop uses `evalItem` but push references `eval` (typo). Bug found.

## Output Format

When debugging, maintain a living document in `docs/investigation.md` alongside the relevant code:

```
## Problem
[one sentence]

## Hypothesis List

| # | Hypothesis | Null Hypothesis | Status |
|---|------------|-----------------|--------|
| 1 | H1 | Null1 | ❌ NULLIFIED |
| 2 | H2 | Null2 | 🔎 OPEN |

## Debug Evidence
[specific output from tests]

## Current Hypothesis
[which one is being actively investigated]
```

## Key Rules

1. **Never skip steps.** Work the list top-to-bottom.
2. **No code review as proof.** Use actual output.
3. **One hypothesis at a time.** Don't batch.
4. **Stay humble.** The "obvious" answer is often wrong.
5. **Document everything.** Future you will thank present you.

## Trigger Phrases

- "use error-solving"
- "error-solving skill"
- "debug systematically"
- "null hypothesis method"
- "I think we need the debug skill"

## Companion Skills

- `task-mode` — Use when you need to persist on solving the issue until fixed
- `agent-eval` — Use when verifying the fix actually works via tests
- `bake-pi` — Use when the fix involves creating new agents or extensions