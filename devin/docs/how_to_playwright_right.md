# How to Playwright Right — E2E Testing That Works for LLMs

> Patterns and principles for building Playwright test suites that are fast, reliable,
> and easy for an LLM to understand, modify, and trust.
> These lessons are framework-agnostic and apply to any web app with an HTTP auth layer.
>
> **See also:** For unit/integration testing patterns (mocking, test-only code, TDD),
> read `testing-anti-patterns.md` in the same docs directory.

---

## The Core Problem

LLM-coded Playwright tests often fail not because the app is broken, but because the test
infrastructure is wrong. The two most common failure modes:

1. **Slow auth** — every test logs in via the UI, burning 5–10s per test
2. **Brittle locators** — tests check for text or elements that don't exist on the rendered page

The fix for both is programmatic auth + realistic assertions.

---

## Principle 1: Auth Setup Is a Function, Not a Workflow

**Never do this (slow, fragile):**
```typescript
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#username", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/dashboard");
}
```
Every test calls this → 5–10s per test just for auth.

**Do this instead (fast, deterministic):**

```typescript
// test-setup.ts
test.beforeAll(async ({ browser }) => {
  // 1. Get a session token directly from the auth API
  const token = await getSessionToken(email, password);

  // 2. Create a browser context with the session cookie pre-injected
  const ctx = await browser.newContext();
  await ctx.addCookies([{
    name: "session_cookie_name",       // whatever the app uses
    value: token,
    domain: new URL(BASE_URL).hostname,
    path: "/",
    httpOnly: true,
    secure: BASE_URL.startsWith("https"),
  }]);

  // 3. Save to a file shared by all tests in the suite
  await ctx.storageState({ path: "./.auth/suite.json" });
  await ctx.close();
});
```

Then in `playwright.config.ts`:
```typescript
use: {
  storageState: "./.auth/suite.json",
  baseURL: process.env.BASE_URL ?? "http://localhost:3000",
}
```

**Result:** Auth runs once per suite (~1–2s), not once per test. All tests start
with a fully authenticated browser context.

**Key insight:** Authenticate at the API level, not the UI level. The browser
context you create is indistinguishable from one created after a real login — but
it takes milliseconds instead of seconds.

---

## Principle 2: Each Test Suite Gets Its Own Isolated Data

Tests that create, modify, or destroy data must run against their own dedicated
tenant, org, or workspace. Sharing a static demo account causes:

- State pollution between runs
- Permission conflicts
- Flaky tests that pass or fail based on what other tests did before

**The isolation pattern:**
```
beforeAll:
  create test tenant + test user → authenticate → save session
  ↓ tests run
afterAll:
  delete test tenant → all data torn down, no residue
```

**How to create a test tenant programmatically:**

1. Authenticate as an admin/superuser
2. Call the tenant creation API (or use a seed/registration endpoint)
3. Create a test user and invite them to the tenant
4. Accept the invite to activate their account
5. Login as that user → get their session token

**Email domain gotcha:** Many backends validate email domains strictly.
`@test.local`, `@example.com`, and other common test domains may be rejected
as special-use or reserved TLDs. Use a domain that passes your backend's
email validator — or use the invite acceptance flow which often accepts any
valid-format email.

---

## Principle 3: Verify Locators Against Reality, Not Assumptions

Before writing a test, inspect what's actually rendered. Never assume a page
contains text or elements based on what the code "should" render.

**How to inspect a page:**
```bash
# Get the raw page HTML (no auth = login page; with auth = real page)
curl -s "http://localhost:3000/dashboard" -H "Cookie: session=..."

# Or open the screenshot saved on test failure
ls test-results/*/test-failed-*.png
```

**The safe assertion pattern:**
```typescript
// ✅ Check for what IS there, with a graceful fallback
const hasHeading = await page.locator("h1").isVisible().catch(() => false);
const hasEmptyState = await page.locator("text=/no data/i").isVisible().catch(() => false);
if (!hasHeading && !hasEmptyState) {
  throw new Error("Dashboard rendered nothing recognizable");
}

// ✅ Check for any one of several valid states
expect(
  await page.locator("h1:has-text('Dashboard')").isVisible().catch(() => false) ||
  await page.locator("text=/No CHI data/i").isVisible().catch(() => false)
).toBeTruthy();

// ❌ Don't assume specific text that the page may not contain
page.locator("text=Pillars")           // may render as "Dashboard" or "Overview"
page.locator("[data-testid='xyz']")    // may not be in the component at all
```

**The screenshot-first habit:** When a test fails, look at the screenshot before
touching the code. The failure is usually a wrong assumption about what rendered,
not a bug in the app.

---

## Principle 4: Document Known Bugs as Skipped Tests, Not Comments

When a test exposes a real bug (not a test infrastructure problem), use `test.skip`
with a root-cause note. This is more actionable than a comment because it blocks
the test from running until someone fixes it.

```typescript
// RED: Page returns HTTP 500 when tenant has no surveys.
// Root cause: server component passes undefined orgId to the data fetcher.
// Fix: add null guard on orgId before the API call.
test.skip("TC-003: Page loads without 500-level error", async ({ page }) => {
  const res = await page.goto(`${BASE_URL}/${ORG}/page`);
  expect(res?.status()).toBeLessThan(500);
});
```

An LLM reading this file immediately knows:
- The test is intentionally skipped
- Why it's skipped
- What the fix is and where to look

Comments get lost. `test.skip` with a reason is self-documenting and persistent.

---

## Principle 5: Config That Doesn't Surprise You

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    storageState: "./.auth/suite.json",  // shared auth state
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",          // captures what's actually broken
    video: "retain-on-failure",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,  // critical: don't start a second server
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "tests/e2e/reports" }],
  ],
});
```

**`reuseExistingServer: true`** is the most commonly forgotten config option.
Without it, Playwright will fail with "port already in use" if you have a dev
server running.

---

## Principle 6: Common Failure Mode Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| Test times out looking for element | Wrong locator — element not in DOM | Inspect actual page HTML first |
| Page returns HTTP 500 | Server-side null/undefined passed to API | Add null guards; prefer client-side data fetching for dynamic data |
| Auth cookie not accepted | Cookie domain / httpOnly / secure mismatch | Match cookie flags to your app's protocol (http vs https) and domain |
| `page.url()` is `about:blank` | Page crashed (500 or JS error) | Fix the crash first; the page never loaded |
| All tests fail with "Login failed" | `beforeAll` in wrong file or not imported | Ensure `globalSetup` / `beforeAll` runs before tests |
| Email validation error on invite | Backend rejects the email domain | Use a domain that passes the backend's validator |
| Tests pass locally, fail in CI | Base URL differs; auth file not found | Use env vars for BASE_URL; ensure `.auth/` is created before tests run |

---

## Principle 7: Running the Suite

```bash
# Set required env vars — never hardcode URLs
export BASE_URL="http://localhost:3000"
export API_BASE_URL="https://api.example.com"

# Run the suite
npx playwright test tests/e2e/my-suite.spec.ts

# Watch mode (UI)
npx playwright test tests/e2e/my-suite.spec.ts --ui

# HTML report
npx playwright show-report tests/e2e/reports
```

---

## Principle 8: File Layout

```
project/
├── playwright.config.ts
├── .auth/                          # gitignored — contains live session tokens
│   └── suite.json                  # shared auth state (one per suite)
└── tests/
    └── e2e/
        ├── auth-setup.ts           # beforeAll + afterAll (create/teardown tenant)
        └── my-test.spec.ts         # test suite
```

**Always gitignore `.auth/`** — it contains active session tokens.

---

## Summary: The LLM-Friendly Test Suite

A Playwright suite that a future LLM (or developer) can actually work with has:

| Property | Why It Matters |
|---|---|
| Programmatic auth | No UI steps; auth is a function call; tests start fast |
| Isolated tenant per run | Tests are independent; no shared state pollution |
| Realistic locators | Verified against what's actually rendered, not assumed |
| Skipped RED tests with root cause | Self-documenting bugs; not just TODO comments |
| Shared `storageState` | One auth file, all tests share it; no per-test overhead |
| Env-driven config | BASE_URL and API_BASE from env vars, not hardcoded |
| Screenshots on failure | The failure artifact tells you what actually rendered |

The goal is not just "tests that pass." The goal is tests that are:

- **Fast** — no repeated auth overhead
- **Trustworthy** — isolated data, realistic assertions
- **Readable** — an LLM can understand what's being tested and why
- **Maintainable** — RED tests tell you exactly what's broken and how to fix it

Start from this structure on every new project. You'll thank yourself later.


---

## Principle 9: Execution Patterns — Hard-Won Lessons

### Dev Mode vs Production Mode

**Never run E2E tests against `npm run dev`.** Dev mode causes instability:

| Issue | Cause |
|-------|-------|
| ERR_EMPTY_RESPONSE crashes | Hot Module Replacement memory leaks |
| Sporadic timeouts | V8 heap exhaustion from continuous compilation |
| Inconsistent behavior | Webpack HMR state pollution |

**Always use production mode:**
```bash
# Locally
NODE_ENV=production npm run build && npm start

# In Docker (ensure NODE_ENV=production, not development)
environment:
  NODE_ENV: production
```

**Docker compose gotcha:** If using volume mounts (e.g., `./app:/app`), the mount overwrites the built code on each run. Either:
1. Build locally first, then mount with `NODE_ENV=production` so it skips rebuild
2. OR run the build inside the container (slower)
3. OR use a named volume for `.next/` to persist the build

### Single Worker Mode for Reliability

**Default: Don't use parallel workers.** Multiple workers cause:
- Memory pressure (5 workers = 5 browsers = ~2GB RAM)
- Cascading failures when one worker destabilizes
- Race conditions in shared state

```bash
# ✅ Stable pattern: single worker
npx playwright test --workers=1

# ❌ Unstable: multiple workers (may cause crashes)
npx playwright test  # defaults to numCpus workers
```

### The `waitUntil` Trap

**Never use `waitUntil: "networkidle"`.** It causes tests to hang:

```typescript
// ❌ This hangs on pages with continuous API polling
await page.goto(url, { waitUntil: "networkidle" });  // 30s+ timeout

// ✅ This loads fast and reliably
await page.goto(url, { waitUntil: "domcontentloaded" });
```

Pages with real-time updates (websockets, polling, streaming) never reach "networkidle".

### Running Strategy

**Before running full suite:**
1. Run 1-2 test files first to verify stability
2. Check container/app health with `curl` before suite
3. Restart container if health check fails

**The pattern:**
```bash
# 1. Verify app is healthy
curl -s -o /dev/null -w "%{http_code}" http://localhost:59001/
# Expected: 200

# 2. Run small batch first
npx playwright test tests/e2e/small-spec.ts --workers=1

# 3. If stable, run full suite
npx playwright test --workers=1
```

### Batch Running Pattern

When full suite times out, run in batches:
```bash
npx playwright test tests/e2e/auth-tests.spec.ts --workers=1
npx playwright test tests/e2e/dashboard-tests.spec.ts --workers=1
npx playwright test tests/e2e/admin-tests.spec.ts --workers=1
```

### Common Issues & Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Test hangs at `page.goto` | Dev server crashed | Restart container |
| All tests fail with connection refused | App not running | Check `docker compose ps` |
| Auth works, then fails | Token expired mid-suite | Use fresh auth per batch |
| Tests pass alone, fail together | Test pollution or memory | Run with `--workers=1` |
| Build succeeds, start fails | Missing `.next/` files | Run `npm run build` first |

---

## Related Reading

| Guide | Focus | When to Read |
|-------|-------|--------------|
| `testing-anti-patterns.md` | Unit/integration anti-patterns (mocks, test-only code, TDD) | Writing tests beyond E2E |

**Core principle both guides share:** Test what the code does, not what the test infrastructure does.