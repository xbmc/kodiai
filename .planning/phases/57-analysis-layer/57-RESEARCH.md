# Phase 57: Analysis Layer - Research

**Researched:** 2026-02-15
**Domain:** Workspace usage analysis, multi-package coordination detection, recency-weighted retrieval
**Confidence:** HIGH

## Summary

Phase 57 adds three analysis capabilities on top of the Phase 56 foundation: (1) workspace-aware usage evidence for dependency bumps with breaking changes, (2) multi-package coordination detection for scoped package groups, and (3) recency-weighted scoring for learning memory retrieval. All three are enrichments that chain into existing pipelines (dep bump context in the review prompt, and retrieval reranking) without changing core execution flow.

The workspace grep for usage analysis is the most technically interesting piece. The review handler already creates a shallow git clone (`Workspace`) and has the PR HEAD checked out. Usage analysis can run `git grep` (or Bun `$` shell `grep`) within that clone to find imports/usage of affected APIs, constrained by a 3-second timeout. GitHub's Code Search API is NOT suitable because it only searches the default branch, not the PR branch. Local workspace grep is both faster and searches the correct code state.

Recency weighting fits naturally as a post-rerank adjustment step. The `learning_memories` table already stores `created_at`. After `rerankByLanguage()` produces `RerankedResult[]`, a new `applyRecencyWeighting()` function adjusts `adjustedDistance` based on memory age, with a severity-aware decay floor of 0.3 that prevents CRITICAL/MAJOR findings from being forgotten.

**Primary recommendation:** Implement three pure-function modules (`src/lib/usage-analyzer.ts`, `src/lib/scope-coordinator.ts`, `src/learning/retrieval-recency.ts`) plus wiring in the review handler, following the existing fail-open enrichment pattern.

## Standard Stack

### Core
| Library/Tech | Version | Purpose | Why Standard (in this repo) |
|---|---:|---|---|
| Bun (`$` shell) | (runtime) | Run `grep`/`git grep` in workspace clone for usage analysis | Already used throughout `src/handlers/review.ts` for git operations |
| Bun (`bun:sqlite`) | (runtime) | Knowledge + learning memory stores | All stores use this |
| TypeScript (ESM) | peer `^5` | Implementation language | Repo standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---|---:|---|---|
| `pino` | `^10.3.0` | Logging | Usage analysis + recency weighting debug logs |
| `AbortSignal.timeout()` | (runtime) | Enforce 3-second time budget on grep | Already used in dep-bump-enrichment.ts (line 207) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Local `grep` in workspace clone | GitHub Code Search API (`octokit.rest.search.code`) | Code Search API only indexes the default branch, not the PR branch; also rate-limited at 30 req/min |
| Post-rerank recency adjustment | SQL-level recency filtering | SQL filtering would prevent old CRITICAL findings from appearing at all; post-rerank preserves them with a floor |

## Architecture Patterns

### Recommended Project Structure (extensions)
```
src/
├── lib/
│   ├── usage-analyzer.ts          # NEW: grep workspace for API usage (DEP-04)
│   ├── usage-analyzer.test.ts     # NEW
│   ├── scope-coordinator.ts       # NEW: detect multi-package scope groups (DEP-06)
│   ├── scope-coordinator.test.ts  # NEW
│   ├── dep-bump-detector.ts       # existing (no changes)
│   └── dep-bump-enrichment.ts     # existing (no changes)
├── learning/
│   ├── retrieval-recency.ts       # NEW: recency weighting (RET-04)
│   ├── retrieval-recency.test.ts  # NEW
│   └── retrieval-rerank.ts        # existing (no changes to this file)
├── handlers/
│   └── review.ts                  # MODIFIED: wire usage analysis + scope coord + recency
└── execution/
    └── review-prompt.ts           # MODIFIED: render usage evidence + scope coordination
```

### Pattern 1: Fail-Open Enrichment with Time Budget
**What:** Usage analysis is a best-effort enrichment that must complete within 3 seconds and never block the review.
**When to use:** Any workspace-dependent analysis that could hang on large repos.
**Example:**
```typescript
// Pattern from dep-bump-enrichment.ts (line 207)
const resp = await fetch(url, {
  signal: AbortSignal.timeout(3000),
});

// For subprocess: Bun $ with timeout
const result = await $`git -C ${dir} grep -rn ${pattern} -- ${globs}`
  .quiet()
  .nothrow()
  .timeout(3000);
```

### Pattern 2: Pure Function Modules in src/lib/
**What:** Analysis logic is a pure function taking inputs and returning a typed result. No side effects, no store writes, no API calls.
**When to use:** Usage analysis and scope coordination are both pure transforms of existing data.
**Why:** Matches `dep-bump-detector.ts`, `merge-confidence.ts`, `finding-prioritizer.ts` -- all pure functions tested in isolation.

### Pattern 3: Post-Rerank Chaining for Retrieval Adjustments
**What:** Recency weighting applies AFTER `rerankByLanguage()`, adjusting `adjustedDistance` further, then re-sorting.
**When to use:** Any additional scoring dimension that should compose with language reranking.
**Why:** The existing pipeline is: isolation layer -> language rerank -> prompt. Recency slots in as: isolation layer -> language rerank -> recency weight -> prompt. This avoids disrupting existing retrieval quality.

### Anti-Patterns to Avoid
- **Calling GitHub API for code search during review:** Rate-limited (30/min), wrong branch (default only), adds latency. Use the workspace clone instead.
- **Blocking review on usage analysis failure:** Must fail open. Missing usage data never blocks the review.
- **Modifying `rerankByLanguage()` internals:** Recency is a separate concern. Chain after, not interleave.
- **Recency filtering that drops old CRITICAL findings entirely:** The 0.3 floor ensures they still appear, just at lower priority than recent equivalent findings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Breaking change snippet extraction | New parser for changelog text | `extractBreakingChanges()` in `dep-bump-enrichment.ts` | Already handles all marker patterns (line 250-278) |
| Semver classification | New version parser | `classifyDepBump()` / `parseSemver()` | Already consistent (line 300-353 of dep-bump-detector.ts) |
| Scope prefix extraction | Complex regex for npm scope parsing | Simple `pkg.startsWith('@') ? pkg.split('/')[0] : null` | npm scopes are trivially `@scope/name` |
| File language classification | New extension-to-language map | `classifyFileLanguage()` from `diff-analysis.ts` | Already used in retrieval rerank |
| Workspace subprocess execution | Custom child_process wrapper | Bun `$` shell API | Already the repo standard for git operations |

**Key insight:** Usage analysis is the only truly new capability. Everything else (breaking change detection, scope parsing, recency math) uses existing primitives or trivial string operations.

## Common Pitfalls

### Pitfall 1: grep Performance on Large Repos
**What goes wrong:** `grep -r` on a monorepo with thousands of files takes >3 seconds, causing timeout.
**Why it happens:** Unbounded recursive search scans node_modules, .git, vendor dirs.
**How to avoid:** Use `git grep` (only searches tracked files, respects .gitignore). Limit to relevant file extensions based on ecosystem. Cap result count (first 20 matches sufficient for evidence).
**Warning signs:** Usage analysis timeout rate >10% in telemetry.

### Pitfall 2: Breaking Change Snippets Don't Contain API Names
**What goes wrong:** The breaking change text says "Breaking: removed deprecated APIs" but doesn't name specific functions, so grep has nothing to search for.
**Why it happens:** Many changelogs use vague language; only well-maintained projects list specific API names.
**How to avoid:** Extract search terms from both (a) breaking change snippets and (b) the package name itself (e.g., `import { X } from "package"`). If no specific API names found in changelog, fall back to searching for any imports of the package.
**Warning signs:** Usage evidence says "package imported at X" but can't identify specific affected APIs.

### Pitfall 3: Recency Weighting Disrupts Existing Retrieval Quality
**What goes wrong:** Old, highly relevant findings get demoted below recent but less relevant findings.
**Why it happens:** Aggressive time decay overwhelms semantic distance.
**How to avoid:** Use a multiplicative adjustment with a floor (0.3 minimum multiplier). The semantic distance remains the primary signal; recency is a secondary tiebreaker. Test that existing retrieval test cases still pass.
**Warning signs:** Retrieval quality metrics (avg_distance) degrade after recency is enabled.

### Pitfall 4: Multi-Package Coordination False Positives
**What goes wrong:** Two unrelated packages happen to share a scope prefix (e.g., `@types/node` and `@types/jest`) and get incorrectly flagged as coordinated.
**Why it happens:** Scope prefix alone is too broad a signal.
**How to avoid:** Only flag coordination when 2+ packages from the same scope are updated in the same PR. For group bumps (already detected), this is implicit. For non-group bumps, this is N/A since they have a single package.
**Warning signs:** Coordination note appears on single-package bumps.

### Pitfall 5: Bun $ Timeout Behavior
**What goes wrong:** Bun's `$` shell API `.timeout()` method may not exist or behave differently than expected.
**Why it happens:** Bun's shell API timeout support varies by version.
**How to avoid:** Wrap the subprocess call with `Promise.race([grepPromise, timeoutPromise])` as a defensive pattern. Use `AbortSignal.timeout(3000)` with `Bun.spawn()` if `$` doesn't support timeout directly.
**Warning signs:** Usage analysis hangs indefinitely on slow repos.

## Code Examples

### Usage Analysis: grep Workspace for Package Imports
```typescript
// src/lib/usage-analyzer.ts
import { $ } from "bun";

export type UsageEvidence = {
  filePath: string;
  line: number;
  snippet: string;
};

export type UsageAnalysisResult = {
  evidence: UsageEvidence[];
  searchTerms: string[];
  timedOut: boolean;
};

/**
 * Grep the workspace for imports/usage of a specific package.
 * Returns file:line evidence within a time budget.
 * Fails open: returns empty evidence on any error.
 */
export async function analyzePackageUsage(params: {
  workspaceDir: string;
  packageName: string;
  breakingChangeSnippets: string[];
  ecosystem: string;
  timeBudgetMs?: number;
}): Promise<UsageAnalysisResult> {
  const { workspaceDir, packageName, breakingChangeSnippets, timeBudgetMs = 3000 } = params;

  // Extract search terms from package name + breaking change text
  const searchTerms = buildSearchTerms(packageName, breakingChangeSnippets);
  if (searchTerms.length === 0) {
    return { evidence: [], searchTerms: [], timedOut: false };
  }

  const evidence: UsageEvidence[] = [];
  let timedOut = false;

  try {
    // Use git grep (respects .gitignore, only tracked files)
    const pattern = searchTerms.join("\\|");
    const result = await Promise.race([
      $`git -C ${workspaceDir} grep -rn --max-count=20 ${pattern}`.quiet().nothrow(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeBudgetMs)),
    ]);

    if (result === null) {
      timedOut = true;
      return { evidence: [], searchTerms, timedOut };
    }

    if (result.exitCode === 0) {
      const lines = result.stdout.toString().split("\n").filter(Boolean);
      for (const line of lines.slice(0, 20)) {
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          evidence.push({
            filePath: match[1]!,
            line: parseInt(match[2]!, 10),
            snippet: match[3]!.trim().slice(0, 120),
          });
        }
      }
    }
  } catch {
    // Fail open
  }

  return { evidence, searchTerms, timedOut };
}
```

### Scope Coordination Detection
```typescript
// src/lib/scope-coordinator.ts
export type ScopeGroup = {
  scope: string;
  packages: string[];
};

/**
 * Detect multi-package coordination: packages sharing a scope prefix
 * updated together in the same PR.
 */
export function detectScopeCoordination(packageNames: string[]): ScopeGroup[] {
  const byScope = new Map<string, string[]>();
  for (const pkg of packageNames) {
    if (!pkg.startsWith("@")) continue;
    const scope = pkg.split("/")[0]!;
    const list = byScope.get(scope) ?? [];
    list.push(pkg);
    byScope.set(scope, list);
  }

  // Only report groups with 2+ packages
  return Array.from(byScope.entries())
    .filter(([_, pkgs]) => pkgs.length >= 2)
    .map(([scope, packages]) => ({ scope, packages }));
}
```

### Recency Weighting (Post-Rerank)
```typescript
// src/learning/retrieval-recency.ts
import type { RerankedResult } from "./retrieval-rerank.ts";

export type RecencyConfig = {
  /** Half-life in days: after this many days, the recency multiplier reaches ~0.65 */
  halfLifeDays: number;
  /** Minimum multiplier floor -- prevents old findings from vanishing */
  floorMultiplier: number;
  /** Severities exempt from decay below the floor */
  floorSeverities: string[];
};

export const DEFAULT_RECENCY_CONFIG: RecencyConfig = {
  halfLifeDays: 90,
  floorMultiplier: 0.3,
  floorSeverities: ["critical", "major"],
};

/**
 * Apply recency weighting to reranked retrieval results.
 * Chains after rerankByLanguage() without modifying it.
 *
 * Multiplier formula: max(floor, e^(-lambda * ageDays))
 * where lambda = ln(2) / halfLifeDays
 *
 * Recent findings (< 30 days) get multiplier ~1.0 (near-neutral).
 * Old findings (> 180 days) decay toward the floor.
 * CRITICAL/MAJOR findings use the floor as minimum, never lower.
 */
export function applyRecencyWeighting(params: {
  results: RerankedResult[];
  now?: Date;
  config?: RecencyConfig;
}): RerankedResult[] {
  const { results, now = new Date(), config = DEFAULT_RECENCY_CONFIG } = params;
  const lambda = Math.LN2 / config.halfLifeDays;
  const nowMs = now.getTime();

  const weighted = results.map((r) => {
    const createdAt = r.record.createdAt
      ? new Date(r.record.createdAt + "Z").getTime()
      : nowMs; // Unknown age treated as recent
    const ageDays = Math.max(0, (nowMs - createdAt) / (1000 * 60 * 60 * 24));

    let multiplier = Math.exp(-lambda * ageDays);

    // Apply severity-aware floor
    const isCriticalSeverity = config.floorSeverities.includes(r.record.severity);
    const floor = isCriticalSeverity ? config.floorMultiplier : config.floorMultiplier * 0.5;
    multiplier = Math.max(floor, multiplier);

    return {
      ...r,
      adjustedDistance: r.adjustedDistance * (2 - multiplier),
      // (2 - multiplier) inverts the multiplier for distance: recent = lower distance, old = higher
    };
  });

  // Re-sort by adjusted distance
  weighted.sort((a, b) => a.adjustedDistance - b.adjustedDistance);
  return weighted;
}
```

### Wiring Usage Evidence into Review Prompt
```typescript
// In buildDepBumpSection() in review-prompt.ts, after breaking change warning:
if (usageEvidence && usageEvidence.length > 0) {
  lines.push("", "### Workspace Usage Evidence", "");
  lines.push("The following files in this repo import or use APIs from this package:");
  for (const ev of usageEvidence.slice(0, 10)) {
    lines.push(`- \`${ev.filePath}:${ev.line}\` -- \`${ev.snippet}\``);
  }
  if (usageEvidence.length > 10) {
    lines.push(`- ... and ${usageEvidence.length - 10} more locations`);
  }
}
```

## State of the Art

| Old Approach | Current Approach (in this repo) | When Changed | Impact |
|---|---|---|---|
| No usage analysis for dep bumps | Breaking change warning without evidence | Phase 53-55 | Reviewer must manually check usage |
| No multi-package coordination | Each package reviewed independently | Phase 53 | Reviewer misses related updates |
| No recency weighting in retrieval | All memories weighted equally regardless of age | Phase 28 | Old stale patterns have same influence as recent ones |

**Deprecated/outdated:**
- GitHub Code Search API for workspace analysis: only indexes default branch, unsuitable for PR-branch analysis.

## Open Questions

1. **How to extract specific API names from breaking change snippets?**
   - What we know: `extractBreakingChanges()` returns text snippets like "BREAKING: `foo.bar()` removed".
   - What's unclear: How reliably API names can be extracted from these snippets across different changelog styles.
   - Recommendation: Use regex to extract identifiers from snippets (`/\b[a-zA-Z_]\w*(?:\.\w+)+\(\)/g`). Fall back to package-name-only search if no specific APIs found. This is best-effort evidence, not precision tooling.

2. **Should group bumps get scope coordination analysis?**
   - What we know: Group bumps (`isGroup: true`) already flag multiple packages. Phase 53 detects them via title regex.
   - What's unclear: Whether `DepBumpDetails` for group bumps contains the list of individual package names (currently it sets `packageName: null`).
   - Recommendation: For group bumps, parse package names from the PR body (Dependabot/Renovate list them). This is a stretch goal -- start with single-package usage analysis.

3. **What recency half-life is optimal?**
   - What we know: The spec says "last 30 days score higher than 6+ months ago" with 0.3 floor.
   - What's unclear: Whether 90-day half-life is the right decay curve.
   - Recommendation: Start with 90-day half-life (30-day findings get ~0.79 multiplier, 180-day get ~0.25 which floors at 0.3). Make it configurable so it can be tuned from telemetry data.

## Sources

### Primary (HIGH confidence)
- `src/handlers/review.ts` -- Workspace lifecycle (lines 1145-1170), retrieval context pipeline (lines 1587-1666), dep bump enrichment (lines 1436-1483)
- `src/lib/dep-bump-enrichment.ts` -- Breaking change extraction, `extractBreakingChanges()` (lines 250-278)
- `src/lib/dep-bump-detector.ts` -- Detection pipeline, `DepBumpContext` type (lines 34-45)
- `src/learning/retrieval-rerank.ts` -- Language reranking pipeline, `RerankedResult` type
- `src/learning/memory-store.ts` -- `learning_memories` table with `created_at` column (line 125)
- `src/learning/isolation.ts` -- Retrieval isolation layer returning `RetrievalWithProvenance`
- `src/execution/review-prompt.ts` -- `buildDepBumpSection()` (lines 978-1055), `buildRetrievalContextSection()` (lines 783-807)
- `src/knowledge/types.ts` -- `KnowledgeStore` interface
- `src/jobs/types.ts` -- `Workspace` type with `dir` property

### Secondary (MEDIUM confidence)
- GitHub REST API Code Search documentation -- confirms default-branch-only limitation for code search
- Bun shell API (`$`) -- subprocess execution with `.quiet().nothrow()` pattern, used extensively in review handler

### Tertiary (LOW confidence)
- Bun `$` timeout support -- needs verification for specific Bun version used in this project. Defensive `Promise.race` pattern recommended as fallback.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already used in the codebase
- Architecture: HIGH -- patterns directly follow existing enrichment pipeline
- Pitfalls: MEDIUM -- grep performance on large repos needs production validation; recency half-life needs tuning
- Usage analysis approach: HIGH -- workspace clone already available, local grep is the only viable option (GitHub API limitation confirmed)

**Research date:** 2026-02-15
**Valid until:** 2026-03-17
