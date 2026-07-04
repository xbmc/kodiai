# Addon Rule Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Kodi addon submission-rule review to addon repository PRs and merge its findings into the existing idempotent addon-check comment.

**Architecture:** Keep `src/handlers/addon-check.ts` as the orchestrator. Add focused `src/lib/addon-rule-*` modules for rule loading, file collection, deterministic checks, prompt building, LLM output parsing, and formatting. Route addon-repo `@kodiai review` mentions into the addon-check handler instead of the generic review executor.

**Tech Stack:** Bun test runner, TypeScript, existing GitHub App abstractions, existing job queue/workspace manager, existing LLM `generateWithFallback`/task routing utilities, current addon-check formatter.

---

### Task 1: Add Addon-Rule Finding Types And Formatter Support

**Files:**
- Modify: `src/lib/addon-check-formatter.ts`
- Test: `src/lib/addon-check-formatter.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Add tests that call `formatAddonCheckComment` with an `addonRuleReview` option:

```ts
expect(formatAddonCheckComment([], marker, classification, {
  rulesSource: { kind: "wiki", url: "https://kodi.wiki/view/Add-on_rules" },
  findings: [
    { addonId: "plugin.video.example", level: "ERROR", source: "deterministic", message: "Missing English description in addon.xml." },
    { addonId: "plugin.video.example", level: "WARN", source: "llm", message: "Download appears to happen without user confirmation." },
  ],
})).toContain("## Kodi Add-on Rule Review");
```

Also test fallback source text and clean addon-rule review text.

- [ ] **Step 2: Run formatter tests to verify failure**

Run: `bun test src/lib/addon-check-formatter.test.ts -t "addon-rule"`

Expected: FAIL because `formatAddonCheckComment` does not accept addon-rule review options.

- [ ] **Step 3: Implement formatter types and section rendering**

Add exported types:

```ts
export type AddonRuleFinding = {
  addonId: string;
  level: "ERROR" | "WARN";
  source: "deterministic" | "llm";
  message: string;
};

export type AddonRuleReviewComment = {
  rulesSource: { kind: "wiki" | "fallback"; url: string };
  findings: AddonRuleFinding[];
  incompleteReason?: string;
};
```

Change `formatAddonCheckComment` to accept an optional fourth parameter and append `## Kodi Add-on Rule Review` with the rules source, findings table, clean message, and incomplete note.

- [ ] **Step 4: Run formatter tests to verify pass**

Run: `bun test src/lib/addon-check-formatter.test.ts -t "addon-rule"`

Expected: PASS.

### Task 2: Add Wiki-Backed Rule Source With Fallback

**Files:**
- Create: `src/lib/addon-rule-source.ts`
- Test: `src/lib/addon-rule-source.test.ts`

- [ ] **Step 1: Write failing source-loader tests**

Test that a successful injected fetch returns `{ kind: "wiki", url, text }`, and a failed/empty fetch returns `{ kind: "fallback", url, text }`.

- [ ] **Step 2: Run source-loader tests to verify failure**

Run: `bun test src/lib/addon-rule-source.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `loadAddonRuleSource`**

Create a bounded loader:

```ts
export const ADDON_RULES_URL = "https://kodi.wiki/view/Add-on_rules";
export const EMBEDDED_ADDON_RULES = "...rules from issue #194...";
export async function loadAddonRuleSource(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxChars?: number;
}): Promise<{ kind: "wiki" | "fallback"; url: string; text: string }>;
```

Strip HTML tags enough for prompt use, cap content, and fallback on network failure, timeout, non-2xx, or empty content.

- [ ] **Step 4: Run source-loader tests**

Run: `bun test src/lib/addon-rule-source.test.ts`

Expected: PASS.

### Task 3: Add Changed-Addon File Collection

**Files:**
- Create: `src/lib/addon-rule-context.ts`
- Test: `src/lib/addon-rule-context.test.ts`

- [ ] **Step 1: Write failing context tests**

Test that the collector groups PR files by addon id, includes full content for `addon.xml`, `.py`, and `.js`, includes file-list-only paths, truncates large files, and excludes root-level files from addon IDs.

- [ ] **Step 2: Run context tests to verify failure**

Run: `bun test src/lib/addon-rule-context.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement context collection**

Export:

```ts
export type AddonRuleFileContext = { path: string; content?: string; omittedReason?: string };
export type AddonRuleAddonContext = { addonId: string; files: AddonRuleFileContext[]; allChangedPaths: string[] };
export async function collectAddonRuleContext(params: {
  workspaceDir: string;
  files: Array<{ filename: string }>;
  maxFileChars?: number;
}): Promise<AddonRuleAddonContext[]>;
```

Use `Bun.file(...).text()` with safe path joining and bounded reads.

- [ ] **Step 4: Run context tests**

Run: `bun test src/lib/addon-rule-context.test.ts`

Expected: PASS.

### Task 4: Add Deterministic Rule Checks

**Files:**
- Create: `src/lib/addon-rule-deterministic.ts`
- Test: `src/lib/addon-rule-deterministic.test.ts`

- [ ] **Step 1: Write failing deterministic-check tests**

Cover forbidden dev artifacts, forbidden binaries, missing license, invalid translation directories, missing English manifest text, invalid language codes, and clean allowed image/font files.

- [ ] **Step 2: Run deterministic tests to verify failure**

Run: `bun test src/lib/addon-rule-deterministic.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic checker**

Export:

```ts
export function runDeterministicAddonRuleChecks(
  contexts: readonly AddonRuleAddonContext[],
): AddonRuleFinding[];
```

Parse `addon.xml` using conservative regexes, not a new XML dependency. Use `WARN` for license/SPDX uncertainty and `ERROR` for clear file/path/manifest omissions.

- [ ] **Step 4: Run deterministic tests**

Run: `bun test src/lib/addon-rule-deterministic.test.ts`

Expected: PASS.

### Task 5: Add LLM Prompt And Parser

**Files:**
- Create: `src/lib/addon-rule-llm.ts`
- Test: `src/lib/addon-rule-llm.test.ts`

- [ ] **Step 1: Write failing LLM tests**

Test prompt contains rule source, full changed file content, output JSON schema, no merge verdict, and `ERROR`/`WARN`. Test parser accepts valid JSON and rejects malformed levels, unknown sources, missing addon IDs, raw prompt leakage, and PR backlinks.

- [ ] **Step 2: Run LLM tests to verify failure**

Run: `bun test src/lib/addon-rule-llm.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement prompt builder and parser**

Export:

```ts
export function buildAddonRuleReviewPrompt(params: {
  repo: string;
  prNumber: number;
  rules: { kind: "wiki" | "fallback"; url: string; text: string };
  contexts: readonly AddonRuleAddonContext[];
}): string;

export function parseAddonRuleReviewOutput(text: string): AddonRuleFinding[];
```

Require JSON object shape `{ "findings": [...] }`. Force parsed finding `source` to `llm`.

- [ ] **Step 4: Run LLM tests**

Run: `bun test src/lib/addon-rule-llm.test.ts`

Expected: PASS.

### Task 6: Integrate Addon-Rule Review Into Addon Handler

**Files:**
- Modify: `src/handlers/addon-check.ts`
- Test: `src/handlers/addon-check.test.ts`

- [ ] **Step 1: Write failing handler tests**

Add tests that:

- `pull_request.opened` posts combined checker and addon-rule sections.
- `pull_request.synchronize` does not call the LLM rule reviewer automatically.
- combined comment still posts if checker is unavailable.

- [ ] **Step 2: Run handler tests to verify failure**

Run: `bun test src/handlers/addon-check.test.ts -t "addon-rule"`

Expected: FAIL because the handler has no addon-rule integration.

- [ ] **Step 3: Add dependency injection and orchestration**

Extend handler deps with optional test hooks:

```ts
__loadAddonRuleSourceForTests?: typeof loadAddonRuleSource;
__runAddonRuleLlmForTests?: (params: AddonRuleLlmInput) => Promise<AddonRuleFinding[]>;
```

For `opened`, collect context, load rules, run deterministic checks, run LLM if scoped files exist, and pass `addonRuleReview` into `formatAddonCheckComment`. For `synchronize`, skip the LLM portion unless the event was explicitly requested by mention path.

- [ ] **Step 4: Run handler tests**

Run: `bun test src/handlers/addon-check.test.ts -t "addon-rule"`

Expected: PASS.

### Task 7: Route Addon-Repo `@kodiai review` To Addon-Rule Review

**Files:**
- Modify: `src/handlers/mention.ts`
- Modify: `src/index.ts`
- Test: `src/handlers/mention.test.ts`

- [ ] **Step 1: Write failing mention-routing test**

Add a test showing `@kodiai review` on `xbmc/repo-plugins` does not call the generic executor and does invoke the addon-rule review path.

- [ ] **Step 2: Run mention test to verify failure**

Run: `bun test src/handlers/mention.test.ts -t "addon repo review"`

Expected: FAIL because explicit review currently routes through the generic review executor.

- [ ] **Step 3: Implement routing seam**

Add an injected addon review dispatcher to mention handler deps:

```ts
addonReviewDispatcher?: (event: WebhookEvent) => Promise<void>;
```

When `isReviewRequest(...)`, `mention.prNumber` exists, and `config.addonRepos` includes the repo, call the dispatcher and return before generic review execution. Wire `src/index.ts` so the dispatcher uses the addon-check review entrypoint.

- [ ] **Step 4: Run mention-routing test**

Run: `bun test src/handlers/mention.test.ts -t "addon repo review"`

Expected: PASS.

### Task 8: Final Verification

**Files:**
- All touched TypeScript files

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test \
  src/lib/addon-check-formatter.test.ts \
  src/lib/addon-rule-source.test.ts \
  src/lib/addon-rule-context.test.ts \
  src/lib/addon-rule-deterministic.test.ts \
  src/lib/addon-rule-llm.test.ts \
  src/handlers/addon-check.test.ts \
  src/handlers/mention.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 3: Run scoped lint**

Run:

```bash
bunx eslint \
  src/lib/addon-check-formatter.ts \
  src/lib/addon-rule-source.ts \
  src/lib/addon-rule-context.ts \
  src/lib/addon-rule-deterministic.ts \
  src/lib/addon-rule-llm.ts \
  src/handlers/addon-check.ts \
  src/handlers/mention.ts \
  src/index.ts
```

Expected: exit code 0.
