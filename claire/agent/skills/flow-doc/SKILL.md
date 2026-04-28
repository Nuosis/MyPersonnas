---
name: flow-doc
description: Generate flow documentation from code with Playwright e2e tests that comply with testing standards. Use after implementation is complete. Scan → categorize → document → test → iterate until green.
---

# Flow Doc — Incremental User Flow Documentation

Generate user flow documentation from codebase with Playwright e2e tests. **Designed for incremental runs** — only processes what's new, respects previous decisions, and hands off to e2e-testing chain for execution.

## Core Principles

| Principle | What it means |
|-----------|---------------|
| **Incremental** | Compare against existing `component-index.md`. Only process new components. |
| **Respect prior decisions** | Catalogued + no flow = intentional skip. Don't re-evaluate. |
| **flow-doc stops at docs/tests** | Write the tests, then hand off to e2e-testing chain for execution. |
| **One review pass** | Implement fixes from review once, then done. No re-review loops. |
| **Quick check** | Developer can run this as a "did we cover everything?" before moving on. |

## Prerequisites

1. **Development complete** — all unit + integration tests green
2. **Codebase stable** — no active refactoring
3. **Testing guides loaded:**
   - `/Users/devflow/.openclaw/workspace/docs/testing-anti-patterns.md`
   - `/Users/devflow/.openclaw/workspace/docs/how_to_playwright_right.md`
4. **Existing `docs/flows/component-index.md`** — baseline for what's already catalogued

## Process Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  STEP 1     │     │  STEP 2     │     │  STEP 3     │     │  STEP 4     │
│  Delta      │ ──▶ │  Categorize │ ──▶ │  Write Flow │ ──▶ │  Write      │
│  Scan       │     │  New        │     │  Docs       │     │  Playwright │
│  (new only) │     │  Only       │     │  (new)      │     │  Tests      │
└─────────────┘     └─────────────┘     └─────────────┘     │  (new)      │
                                                            └──────┬──────┘
                                                                   │
                                                                   ▼
                                                            ┌─────────────┐
                                                            │  STEP 5     │
                                                            │  E2E        │
                                                            │  Test       │
                                                            │  Review     │
                                                            │  (once)     │
                                                            └──────┬──────┘
                                                                   │
                                                                   ▼
                                                            ┌─────────────┐
                                                            │  DONE       │
                                                            │  No re-     │
                                                            │  review     │
                                                            └─────────────┘
```

**Note:** flow-doc writes tests but does NOT execute them. Execution is handled by the e2e-testing chain.

## Step 1: Delta Scan — Find Only New Components

**Goal:** Compare against existing `component-index.md` and find only what's new.

```bash
cd {repo}

# 1. Extract current component list from code
grep -rph '`/api/v1' --include="*.tsx" --include="*.ts" app/ components/ \
  | grep -v "node_modules\|openapi-client\|\.gen\.ts\|\.test\.ts\|\.spec\.ts" \
  | sort -u > /tmp/current_api_calls.txt
grep -rph 'router\.push\|redirect\|useRouter' --include="*.tsx" \
  | grep -v "node_modules\|\.gen\.ts\|\.test\.ts" > /tmp/current_nav.txt

# 2. Compare against existing component-index.md
# Parse out what's already catalogued, find the delta

# 3. Report: what's NEW since last scan
```

**Output:** List of new components not in existing `component-index.md`.

## Step 2: Categorize — Is This a Flow or Display?

**Apply ONLY to new components.** Respect previous decisions — if something was catalogued with "display" and no flow, it was intentional.

### The Decision Tree

```
Does this component have:
│
├── Multi-step logic? (create → validate → API → redirect)
│   └── YES → WRITE FLOW DOC
│
├── Branching based on API response? (success/error/pending)
│   └── YES → WRITE FLOW DOC
│
├── Role-based visibility? (admin vs manager vs member)
│   └── YES → WRITE FLOW DOC
│
├── Error recovery? (retry, confirm dialog, form validation)
│   └── YES → WRITE FLOW DOC
│
├── State machine? (draft → active → closed → reopened)
│   └── YES → WRITE FLOW DOC
│
└── Otherwise: pure display (renders data, no branching)
    └── NO → IGNORE (mark in component-index)
```

### Display Components (Ignore)
- `chi-score-card.tsx` — renders number only
- `metric-card.tsx` — display-only
- `pagination.tsx` — generic UI pattern
- `skeleton.tsx` — loading state
- `badge.tsx`, `alert.tsx` — primitive UI

### Flow Components (Document)
- `create-engagement-dialog.tsx` — multi-step wizard
- `invite/page.tsx` — branching flow
- `distribute-engagement-dialog.tsx` — select → POST → success
- `AddParticipantDialog.tsx` — form → validation → API

**Expected ratio:** ~100 display, ~20 flows, ~5 disabled/stub

**On "nothing new":** If delta scan finds no new components, skip to Step 5 (test review).

## Step 3: Write Flow Docs

**Template:**

```markdown
# {Role} Flow: {Name}

## Mermaid Diagram
- Flowchart with error branches
- Include API calls as nodes

## Context
- Trigger conditions
- Who can access (role)
- Preconditions

## Key Data Shapes
- TypeScript interfaces for payloads
- Zod validation schemas

## API Summary
| Action | Method | Endpoint | Source |

## State Transitions
- useState variables and meaning
- Dialog open/close states
- Loading states

## Error Handling
- 2-3 failure modes that matter
- User feedback (toast, inline, redirect)

## Role Rules
- Actual permission checks from code

## Test Assertions (Playwright)
- Real selectors, not pseudo-code
- page.goto(), click(), expect() patterns
```

**Output location:** `docs/flows/{users,features}/{filename}.md`

## Step 4: Write Playwright Tests

**Standards from guides:**
- Programmatic auth (API token, not UI login)
- Isolated tenant per test suite
- Realistic locators (verify against actual DOM)
- Skip RED tests with root-cause comment

**File layout:**
```
tests/e2e/
├── auth-setup.ts      # beforeAll + afterAll
├── {flow-name}.spec.ts
└── reports/
```

**Config requirements:**
```typescript
// playwright.config.ts
use: {
  storageState: "./.auth/suite.json",
  baseURL: process.env.BASE_URL,
}
webServer: {
  reuseExistingServer: true,  // critical
}
```

**Anti-patterns to avoid:**
- ❌ Testing mock existence
- ❌ Test-only methods in production
- ❌ Per-test UI login (slow)
- ❌ Hardcoded URLs
- ❌ Assuming element text without verification

**After writing tests:** Hand off to e2e-testing chain for execution. flow-doc does NOT run tests.

## Step 5: E2E Test Review + Handoff

**This is the ONLY review pass.** After this, we're done — no re-review.

### Review Checklist

1. **testing-anti-patterns.md compliance:**
   - [ ] No test-only methods in production
   - [ ] No testing mock existence
   - [ ] Mocks isolate, not define behavior

2. **how_to_playwright_right.md compliance:**
   - [ ] Programmatic auth (no UI login steps)
   - [ ] Isolated tenant per run
   - [ ] Realistic locators verified against DOM
   - [ ] Skipped RED tests have root-cause comment
   - [ ] Env-driven config (BASE_URL from env)
   - [ ] Screenshots on failure

3. **Flow doc quality:**
   - [ ] Mermaid covers happy path + error branches
   - [ ] API table has correct HTTP methods
   - [ ] Test assertions use real selectors
   - [ ] Disabled features explicitly noted

### If Standards Issues Found

**Implement fixes immediately.** Do not re-run review.

| Symptom | Fix |
|---------|-----|
| 500 error | Add null guard in code |
| Wrong text | Update test assertion to match actual |
| Missing element | Add missing UI or fix test locator |
| Auth failure | Fix session cookie setup |
| Anti-pattern | Rewrite test to comply with guides |

### Handoff to E2E Testing Chain

After review (and fixes if needed), hand off to e2e-testing skill for execution:

```
/skill e2e-testing
```

The e2e-testing chain handles:
- Running the Playwright test suite
- Iterating until tests pass
- Committing meaningful fixes

## On "Nothing New"

If delta scan finds no new components:
1. Mark `component-index.md` as "up to date" with timestamp
2. Skip to running existing tests (or mark as "already covered")
3. Exit with summary: "No new components. Last scan: YYYY-MM-DD"

**Do NOT regenerate existing flow docs or rewrite existing tests.**

## Running This Process

```bash
# Full incremental run (scan → docs → tests → review → handoff)
/skill flow-doc

# Quick status check (just delta scan, no docs)
/skill flow-doc --scan-only

# Skip docs, go straight to test review (if nothing new)
/skill flow-doc --test-review-only
```

**Output on completion:**
- Updated `component-index.md` with new components
- New/updated flow docs in `docs/flows/`
- New/updated Playwright tests in `tests/e2e/`
- Summary: "N new components, M flows documented, K tests written"
- Ready for e2e-testing chain execution