# Phase 51: Timeout Resilience - Research

**Researched:** 2026-02-14
**Domain:** Execution timeout handling, PR complexity estimation, graceful degradation
**Confidence:** HIGH

## Summary

Phase 51 addresses the problem that large or complex PRs frequently hit the fixed 600-second timeout, producing a generic error message ("Kodiai timed out") with zero review output. The user sees nothing useful. The existing architecture already has most of the building blocks needed: diff analysis with file/line counts, language classification, risk scoring, auto-profile selection by PR size, and a `published` flag that tracks whether MCP tools posted any inline comments during execution.

The key insight from codebase analysis: Claude publishes inline review comments via MCP tools DURING execution, not after. By the time a timeout fires, Claude may have already published several inline comments that are live on GitHub. The current code throws all of that away and posts a generic error. This phase captures partial results, estimates timeout risk proactively, auto-reduces scope for high-risk PRs, and computes dynamic timeouts from PR complexity.

**Primary recommendation:** Implement four changes in order: (1) complexity estimator as a pure function, (2) dynamic timeout computation, (3) pre-review scope auto-reduction for high-risk PRs, (4) informative timeout messages with partial review context. All changes are localized to `executor.ts`, `review.ts`, `config.ts`, and two new pure-function modules.

## Standard Stack

### Core (already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 4.3.6 | Config schema validation for new timeout params | Already used for all config schemas |
| `pino` | (current) | Structured logging for timeout decisions | Already the project logger |
| `@anthropic-ai/claude-agent-sdk` | (current) | Executor streaming with AbortController | Already used in executor.ts |

### Supporting (already in project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `picomatch` | (current) | File pattern matching in risk scoring | Already used in diff-analysis.ts and file-risk-scorer.ts |

### No New Dependencies Needed

This phase requires zero new npm packages. All functionality is implementable with existing project dependencies and pure TypeScript functions.

## Architecture Patterns

### Recommended New Module Structure

```
src/
  lib/
    timeout-estimator.ts          # Pure function: PR complexity -> timeout risk + dynamic timeout
    timeout-estimator.test.ts     # Unit tests for estimator
  execution/
    executor.ts                   # MODIFY: use dynamic timeout, track partial publish state
    config.ts                     # MODIFY: add timeout config section
    types.ts                      # MODIFY: add partial timeout fields to ExecutionResult
  handlers/
    review.ts                     # MODIFY: pre-review scope reduction, informative timeout messages
  lib/
    errors.ts                     # MODIFY: new timeout_partial category with better messaging
```

### Pattern 1: Complexity Estimator (Pure Function)

**What:** A pure function that takes PR metrics and returns a timeout risk assessment plus recommended dynamic timeout.
**When to use:** Called in the review handler before executor.execute(), after diff analysis is complete.

```typescript
// src/lib/timeout-estimator.ts

export type TimeoutRiskLevel = "low" | "medium" | "high";

export type TimeoutEstimate = {
  riskLevel: TimeoutRiskLevel;
  dynamicTimeoutSeconds: number;
  shouldReduceScope: boolean;
  reducedProfile: "minimal" | null;
  reducedFileCount: number | null;
  reasoning: string;
};

export function estimateTimeoutRisk(params: {
  fileCount: number;
  linesChanged: number;        // additions + deletions
  languageComplexity: number;  // weighted avg from LANGUAGE_RISK map
  isLargePR: boolean;
  baseTimeoutSeconds: number;  // from config (default 600)
}): TimeoutEstimate {
  // Complexity score: weighted combination of file count, lines, and language risk
  const fileScore = Math.min(params.fileCount / 100, 1.0);       // 100 files = max
  const lineScore = Math.min(params.linesChanged / 5000, 1.0);   // 5000 lines = max
  const langScore = params.languageComplexity;                     // 0-1 from LANGUAGE_RISK

  const complexity = fileScore * 0.4 + lineScore * 0.4 + langScore * 0.2;

  // Risk thresholds
  let riskLevel: TimeoutRiskLevel;
  if (complexity < 0.3) riskLevel = "low";
  else if (complexity < 0.6) riskLevel = "medium";
  else riskLevel = "high";

  // Dynamic timeout: scale base timeout by complexity
  // Small PRs: keep base. Medium: 1.0-1.25x. Large: 1.25-1.5x. Capped at 1800s (config max).
  const timeoutMultiplier = 1.0 + complexity * 0.5;  // 1.0x to 1.5x
  const dynamicTimeout = Math.min(
    Math.round(params.baseTimeoutSeconds * timeoutMultiplier),
    1800,
  );

  // Scope reduction: for high-risk PRs, recommend minimal profile + reduced files
  const shouldReduceScope = riskLevel === "high";
  const reducedProfile = shouldReduceScope ? "minimal" as const : null;
  const reducedFileCount = shouldReduceScope
    ? Math.min(params.fileCount, 50)  // cap at 50 files for high-risk
    : null;

  const reasoning = `Complexity score ${(complexity * 100).toFixed(0)}/100 ` +
    `(files: ${params.fileCount}, lines: ${params.linesChanged}, ` +
    `lang risk: ${(langScore * 100).toFixed(0)}%). ` +
    `Risk: ${riskLevel}. Timeout: ${dynamicTimeout}s.`;

  return {
    riskLevel,
    dynamicTimeoutSeconds: dynamicTimeout,
    shouldReduceScope,
    reducedProfile,
    reducedFileCount,
    reasoning,
  };
}
```

### Pattern 2: Language Complexity Calculation (Reuses Existing)

**What:** Compute weighted average language complexity from the existing `LANGUAGE_RISK` map in `file-risk-scorer.ts` and `classifyLanguages()` from `diff-analysis.ts`.
**When to use:** Input to the timeout estimator.

```typescript
// In timeout-estimator.ts, helper function
import { LANGUAGE_RISK } from "./file-risk-scorer.ts";

export function computeLanguageComplexity(
  filesByLanguage: Record<string, string[]>,
): number {
  let totalFiles = 0;
  let weightedSum = 0;

  for (const [language, files] of Object.entries(filesByLanguage)) {
    const risk = LANGUAGE_RISK[language] ?? 0.3;
    weightedSum += risk * files.length;
    totalFiles += files.length;
  }

  return totalFiles > 0 ? weightedSum / totalFiles : 0.3;
}
```

### Pattern 3: Dynamic Timeout Override in Executor

**What:** The review handler computes a dynamic timeout and passes it to the executor via ExecutionContext, overriding the static config value.
**When to use:** Always -- the executor should accept an optional timeout override.

```typescript
// In execution/types.ts -- add to ExecutionContext
export type ExecutionContext = {
  // ... existing fields ...
  /** Optional dynamic timeout override (seconds). When set, overrides config.timeoutSeconds. */
  dynamicTimeoutSeconds?: number;
};
```

```typescript
// In execution/executor.ts -- use dynamic timeout
timeoutSeconds = context.dynamicTimeoutSeconds ?? config.timeoutSeconds;
```

### Pattern 4: Informative Timeout Message with Partial Context

**What:** When a timeout occurs and `published === true`, post an informative summary instead of a generic error. When `published === false`, post an improved error with scope information.
**When to use:** In the review handler's error branch.

```typescript
// In review handler, timeout handling branch
if (result.isTimeout) {
  if (result.published) {
    // Partial review -- findings were published before timeout
    const partialMessage = [
      `> **Kodiai completed a partial review** (timed out after ${timeoutEstimate.dynamicTimeoutSeconds}s)`,
      "",
      `_Reviewed files before timeout. Some inline comments were posted above._`,
      "",
      `**What was reviewed:** Top files prioritized by risk score.`,
      `**What was skipped:** Lower-priority files may not have been analyzed.`,
      "",
      `To get a full review, try: increase \`timeoutSeconds\` in \`.kodiai.yml\`, ` +
      `or re-request review on a smaller changeset.`,
    ].join("\n");
    // Post as comment (not error)
  } else {
    // Total timeout -- nothing was published
    const fullTimeoutMessage = [
      `> **Kodiai timed out** (after ${timeoutEstimate.dynamicTimeoutSeconds}s)`,
      "",
      `_The review could not complete within the time limit._`,
      "",
      `**PR complexity:** ${timeoutEstimate.reasoning}`,
      "",
      `Try: increase \`timeoutSeconds\` in \`.kodiai.yml\` (current: ${config.timeoutSeconds}s, max: 1800s), ` +
      `or break the PR into smaller changes.`,
    ].join("\n");
    // Post as error comment
  }
}
```

### Anti-Patterns to Avoid

- **Chunked multi-call review:** Splitting a review into multiple executor calls loses cross-file context, multiplies cost, and adds significant orchestration complexity. The requirements do not call for this. Use scope reduction instead.
- **Retry on timeout:** Automatically re-invoking the executor after timeout risks doubling cost and hitting rate limits. Scope reduction before the first call is preferable to retry after failure.
- **Safety net timer at 80%:** The earlier project research proposed a timer at 80% of timeout to trigger early wrap-up. This requires injecting time-awareness into the LLM prompt, which is fragile and hard to verify. Dynamic timeout + scope reduction is more reliable.
- **Modifying AbortController semantics:** The existing AbortController pattern works correctly. Do not change abort() behavior. Only change what happens AFTER abort is detected.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File risk scoring | Custom scoring | `computeFileRiskScores()` from `file-risk-scorer.ts` | Already handles weighted scoring with normalization |
| Language classification | Custom extension map | `classifyLanguages()` from `diff-analysis.ts` | Already maps 25+ extensions to languages |
| Profile selection | Custom threshold logic | `resolveReviewProfile()` from `auto-profile.ts` | Already selects strict/balanced/minimal by line count |
| Large PR triage | Custom file partitioning | `triageFilesByRisk()` from `file-risk-scorer.ts` | Already tiers files into full/abbreviated/mention-only |
| Error formatting | Custom error messages | `formatErrorComment()` from `errors.ts` | Already handles category-specific formatting with sanitization |
| Config validation | Manual validation | Zod schema in `config.ts` | Already validates all config sections with fallback defaults |

**Key insight:** The existing codebase already has file risk scoring, language classification, auto-profile selection, and large PR triage. The timeout estimator is a thin layer that COMBINES these existing signals into a timeout risk assessment. Do not re-implement any of these.

## Common Pitfalls

### Pitfall 1: Partial Review Pollutes Knowledge Store

**What goes wrong:** If a timeout-partial review is recorded in the knowledge store with the head SHA, subsequent incremental reviews think all files were covered. Files that were skipped due to timeout show up as "no prior findings" instead of "not previously reviewed."
**Why it happens:** The knowledge store records head SHA as "reviewed" without distinguishing partial from complete reviews.
**How to avoid:** For this phase, do NOT change knowledge store recording. When `result.isTimeout === true`, skip the learning memory write pipeline (it already runs in a `.catch()` block). Mark telemetry records with a `timeout_partial` conclusion so the data is not mixed with complete reviews.
**Warning signs:** Incremental re-review after timeout shows unexpected "new findings" on files that were in the original PR.

### Pitfall 2: Scope Reduction Conflicts with User Config

**What goes wrong:** User configures `profile: strict` in `.kodiai.yml`, but the auto-scope-reduction overrides it to `minimal`. User is confused why their strict review is producing minimal output.
**Why it happens:** Auto-scope reduction does not respect the user's explicit profile choice.
**How to avoid:** Only auto-reduce scope when profile is NOT explicitly set by the user (i.e., `source === "auto"`). If the user explicitly set a profile via config or keyword, respect it and let the dynamic timeout handle the extra time needed. Log the decision clearly.
**Warning signs:** Users report that their configured profile is being ignored on large PRs.

### Pitfall 3: Dynamic Timeout Exceeds Config Max

**What goes wrong:** The estimator computes a timeout of 1200s, but the user's config or the system max is 1800s. Or worse, it computes a value below the config minimum of 30s.
**Why it happens:** No clamping applied to the computed timeout.
**How to avoid:** Always clamp: `Math.max(30, Math.min(computedTimeout, config.timeoutSeconds, 1800))`. The dynamic timeout should never EXCEED the user's configured timeout -- it should only REDUCE it for small PRs or INCREASE it up to the configured value for large PRs. Actually: the dynamic timeout should scale from a baseline, not from the user config. If the user sets 600s, a small PR might get 300s, a large PR gets 600s.
**Warning signs:** Small PRs using the full 600s timeout when they should finish in 120s.

### Pitfall 4: Timeout Estimation Adds Latency

**What goes wrong:** The estimator performs expensive operations (e.g., reading files, running git commands) that add startup latency before the review even begins.
**Why it happens:** Over-engineering the estimator with features that require I/O.
**How to avoid:** The estimator MUST be a pure function that takes already-computed metrics (file count, line count, language distribution). All these metrics are already computed by `analyzeDiff()` before the estimator runs. Zero additional I/O.
**Warning signs:** Review startup time increases by more than 10ms after adding the estimator.

### Pitfall 5: `published` Flag is Not Accurate for Partial Reviews

**What goes wrong:** The `published` flag in the executor is set by the `onPublish` callback, which fires when any MCP tool writes to GitHub. But if the timeout fires between MCP tool calls, `published` might be `true` even though only 1 of 7 expected comments was posted.
**Why it happens:** `published` is a boolean, not a count. It does not track how many comments were published.
**How to avoid:** For this phase, `published === true` is sufficient to distinguish "some output exists on GitHub" from "nothing was published." The informative message already says "some inline comments were posted above" without promising a specific count. Future enhancement: track publish count.
**Warning signs:** None for this phase -- the boolean is accurate for its purpose.

## Code Examples

### Example 1: Integration Point in Review Handler

The timeout estimator integrates after diff analysis and before executor.execute():

```typescript
// In review handler, after diffAnalysis and tieredFiles are computed

// TMO-01: Estimate timeout risk
const languageComplexity = computeLanguageComplexity(
  diffAnalysis?.filesByLanguage ?? {},
);
const timeoutEstimate = estimateTimeoutRisk({
  fileCount: changedFiles.length,
  linesChanged: (diffAnalysis?.metrics.totalLinesAdded ?? 0) +
    (diffAnalysis?.metrics.totalLinesRemoved ?? 0),
  languageComplexity,
  isLargePR: diffAnalysis?.isLargePR ?? false,
  baseTimeoutSeconds: config.timeoutSeconds,
});

logger.info(
  {
    ...baseLog,
    gate: "timeout-estimation",
    riskLevel: timeoutEstimate.riskLevel,
    dynamicTimeout: timeoutEstimate.dynamicTimeoutSeconds,
    shouldReduceScope: timeoutEstimate.shouldReduceScope,
  },
  timeoutEstimate.reasoning,
);

// TMO-02: Auto-reduce scope for high-risk PRs
if (timeoutEstimate.shouldReduceScope && profileSelection.source === "auto") {
  // Override profile to minimal
  // Override tieredFiles to reduce file count
}

// TMO-04: Pass dynamic timeout to executor
const result = await executor.execute({
  ...executionContext,
  dynamicTimeoutSeconds: timeoutEstimate.dynamicTimeoutSeconds,
});
```

### Example 2: Executor Modification for Dynamic Timeout

```typescript
// In executor.ts, line ~41
// BEFORE:
// timeoutSeconds = config.timeoutSeconds;

// AFTER:
timeoutSeconds = context.dynamicTimeoutSeconds ?? config.timeoutSeconds;
```

### Example 3: Config Schema Extension

```typescript
// In config.ts -- new timeout config section (optional, for user override)
const timeoutSchema = z.object({
  /** Base timeout in seconds. Dynamic timeout scales from this value. */
  baseSeconds: z.number().min(30).max(1800).default(600),
  /** Enable dynamic timeout scaling based on PR complexity. */
  dynamicScaling: z.boolean().default(true),
  /** Enable automatic scope reduction for high-risk PRs. */
  autoReduceScope: z.boolean().default(true),
}).default({
  baseSeconds: 600,
  dynamicScaling: true,
  autoReduceScope: true,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed 600s timeout for all PRs | Dynamic timeout based on PR complexity | This phase | Large PRs get proportionally more time; small PRs finish faster |
| Generic "Kodiai timed out" error | Informative message with review scope context | This phase | Users understand what was/wasn't reviewed |
| Timeout = total failure, zero output | Partial review preserved when MCP tools published before timeout | This phase | Users get value even when timeout occurs |
| Same review scope regardless of timeout risk | Auto-reduce scope for high-risk PRs | This phase | Prevents timeouts proactively instead of just handling them |

## Existing Code Touchpoints (Verified)

| File | Current State | Required Change |
|------|--------------|-----------------|
| `src/execution/executor.ts` (line 23, 41-47) | Hardcoded `timeoutSeconds = 600`, overridden by config only | Accept `dynamicTimeoutSeconds` from context, use as override |
| `src/execution/types.ts` (line 4-35) | `ExecutionContext` has no timeout field | Add `dynamicTimeoutSeconds?: number` |
| `src/execution/types.ts` (line 38-62) | `ExecutionResult.isTimeout` is boolean | Sufficient -- no change needed |
| `src/execution/config.ts` (line 401, 501-513) | `timeoutSeconds` schema with default 600 | Optionally add timeout config subsection with `dynamicScaling` and `autoReduceScope` flags |
| `src/handlers/review.ts` (line 2279-2293) | Timeout = post generic error via `formatErrorComment` | Branch on `published` flag: partial review message vs. informative error |
| `src/lib/errors.ts` (line 54, 63-64) | `timeout` category with generic message | Keep existing category, improve message template to include scope info |
| `src/lib/auto-profile.ts` (line 1-66) | `resolveReviewProfile()` selects profile by line count | No change -- timeout estimator may override the result in review handler |
| `src/lib/file-risk-scorer.ts` (line 111-123) | `LANGUAGE_RISK` map with risk weights per language | Import and reuse for language complexity computation |
| `src/execution/diff-analysis.ts` (line 54-63) | `classifyLanguages()` groups files by language | Import and reuse for timeout estimation input |

## Open Questions

1. **Should dynamic timeout increase or only decrease from the user's configured value?**
   - What we know: The config allows 30-1800s with default 600. Users who set a custom value expect it to be respected.
   - What's unclear: Should a 3-file PR use the full 600s configured timeout, or should dynamic scaling reduce it to 200s?
   - Recommendation: Dynamic scaling should produce a timeout in the range `[baseTimeout * 0.5, baseTimeout * 1.5]`, clamped to [30, 1800]. This means small PRs get LESS time (saving resources) and large PRs get MORE time. Document this behavior clearly in config comments.

2. **Should scope reduction apply when the user explicitly set a profile?**
   - What we know: Users can set `profile: strict` in `.kodiai.yml` or use keyword override `@kodiai strict`.
   - What's unclear: Should we override an explicit user choice to prevent timeout?
   - Recommendation: NO. Only auto-reduce scope when `profileSelection.source === "auto"`. If the user explicitly chose a profile, respect it and rely on dynamic timeout extension instead. Log a warning if high-risk + explicit profile.

3. **What to do with telemetry for timeout-partial reviews?**
   - What we know: `TelemetryRecord.conclusion` is a string. Currently records "success", "failure", or "error".
   - What's unclear: Should we add a new conclusion value or use the existing "error" with metadata?
   - Recommendation: Record as `conclusion: "timeout_partial"` when `isTimeout && published`, `"timeout"` when `isTimeout && !published`. This preserves telemetry clarity.

## Sources

### Primary (HIGH confidence)
- `src/execution/executor.ts` -- AbortController timeout pattern, `published` flag tracking, timeout error path (lines 21-252)
- `src/execution/config.ts` -- `timeoutSeconds` schema (line 401), default 600, min 30, max 1800 (line 502)
- `src/execution/types.ts` -- `ExecutionContext` and `ExecutionResult` with `isTimeout` flag (lines 1-62)
- `src/handlers/review.ts` -- Review handler timeout error posting (lines 2279-2293), diff analysis (lines 1334-1549), executor invocation (lines 1614-1627)
- `src/lib/auto-profile.ts` -- Profile selection thresholds: strict <= 100 lines, balanced <= 500, minimal > 500 (lines 1-66)
- `src/lib/file-risk-scorer.ts` -- `LANGUAGE_RISK` map, `computeFileRiskScores()`, `triageFilesByRisk()` (lines 1-316)
- `src/execution/diff-analysis.ts` -- `classifyLanguages()`, `analyzeDiff()`, `MAX_ANALYSIS_FILES = 200` (lines 1-365)
- `src/lib/errors.ts` -- Error classification and formatting with timeout category (lines 1-141)

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` -- Three-layer timeout resilience architecture proposal (lines 269-431)
- `.planning/research/FEATURES.md` -- Competitive analysis: CodeRabbit 3600s timeout, Qodo no partial results (lines 313-320)
- `.planning/research/PITFALLS.md` -- Pitfall 10: partial review changes error semantics (lines 335-364)
- `.planning/research/STACK.md` -- Stack recommendations: no new deps, safety net timer approach (lines 438-517)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all patterns verified in existing codebase
- Architecture: HIGH -- all integration points verified by reading actual source code
- Pitfalls: HIGH -- identified from existing research docs and codebase analysis of error handling paths

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable domain, no external dependencies involved)
