# Feature Landscape

**Domain:** Advanced dependency analysis, execution resilience, and intelligent retrieval for AI code review
**Researched:** 2026-02-15
**Milestone:** v0.10 Advanced Signals
**Confidence:** MEDIUM-HIGH (existing codebase verified, Aikido and Renovate patterns validated via web, knee-point algorithms verified via academic sources, time-decay models verified via RAG literature)

## Existing Foundation (Already Built in v0.9)

These features are production and form the base for v0.10:

| Existing Capability | Module | How v0.10 Extends It |
|---------------------|--------|---------------------|
| Three-stage dep bump detection (detect, extract, classify) | `lib/dep-bump-detector.ts` | Usage analysis adds workspace grepping for affected APIs |
| Security advisory lookup via GitHub Advisory DB | `lib/dep-bump-enrichment.ts` | History tracking adds longitudinal perspective |
| Changelog fetching with three-tier fallback + breaking change detection | `lib/dep-bump-enrichment.ts` | Multi-package correlation detects grouped updates |
| Merge confidence scoring (semver + advisory + breaking changes) | `lib/merge-confidence.ts` | Usage analysis integrates as fourth confidence signal |
| Dynamic timeout scaling + auto scope reduction | `lib/timeout-estimator.ts` | Checkpoint publishing saves partial results; retry reuses them |
| Informative timeout messages (partial vs full timeout) | `handlers/review.ts` | Checkpoint data makes partial messages richer |
| Multi-signal retrieval query (intent, languages, diff patterns, author) | `learning/retrieval-query.ts` | Adaptive thresholds auto-tune distance cutoffs |
| Language-aware re-ranking with same-language boost | `learning/retrieval-rerank.ts` | Cross-language concept equivalence extends this |
| Bounded retrieval with fixed 0.3 distance threshold | `learning/isolation.ts` | Adaptive thresholds replace the fixed value |
| Telemetry store with execution records | `telemetry/store.ts` | Retrieval quality telemetry adds new metric types |

---

## Table Stakes

Features that are expected natural extensions of what v0.9 already provides. Without them, the existing features feel incomplete.

### 1. API Usage Analysis for Breaking Changes

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Grep workspace for imports of bumped package** | When `dep-bump-enrichment.ts` detects breaking changes in a major version bump, the obvious next question is "does our code actually use the changed APIs?" Aikido Security does exactly this -- analyzes the codebase to determine whether breaking changes actually impact the project. Without it, the breaking change warning is generic ("this package has breaking changes") rather than specific ("you import `foo.bar()` which was removed in v3"). | MEDIUM | Existing dep bump detection provides `packageName`. Existing executor has `Grep`/`Glob` tools. Need: (1) extract import patterns for the package from workspace files, (2) cross-reference with breaking change list from changelog. |
| **Report specific affected files and lines** | Aikido's approach identifies exact files and lines that rely on deprecated behavior. For a code review tool, this means: find `import { X } from 'bumped-package'` across the workspace and list those locations. | MEDIUM | Requires the grep results above. Output is a list of `{file, line, importedSymbol}` tuples that feed into the review prompt and merge confidence scoring. |
| **Integrate usage analysis into merge confidence** | Currently `computeMergeConfidence()` uses three signals (semver, advisory, breaking changes). Adding "codebase uses affected APIs: yes/no" as a fourth signal provides actionable differentiation: major bump + no usage = safe; major bump + heavy usage = risky. | LOW | Extends `merge-confidence.ts`. Pure logic addition once usage data is available. |

### 2. Dependency Update History Tracking

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Store dep bump records in knowledge store** | When a package is bumped, record `{repo, packageName, fromVersion, toVersion, ecosystem, bumpType, isSecurityBump, mergeConfidence, mergedAt}`. On future bumps, query history: "lodash was last bumped 45 days ago from 4.17.20 to 4.17.21 with no issues." This is basic institutional memory. | LOW | Extends `knowledge/store.ts` with a new `dep_bump_history` table. Simple INSERT on merge, SELECT on detection. |
| **Surface update frequency and lag** | Track how often each package is updated and how far behind the repo is from latest. Key patterns: (1) high-frequency updaters (updated monthly = healthy), (2) long-lag packages (2 years behind = risky), (3) security-motivated velocity (security bumps merged faster). Renovate's Dependency Dashboard tracks similar metrics. | LOW | Computed from history records. Frequency = count of bumps per time window. Lag = current version vs latest (already extracted from PR). |
| **Feed history into review prompt** | Inject one line: "This package was last updated 45 days ago (v4.17.20 to v4.17.21, merged without issues)." Gives the LLM reviewer longitudinal context. | LOW | Query history table at review time, format as prompt section. |

### 3. Checkpoint Publishing for Timeout Recovery

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Save partial review state during execution** | Current behavior: timeout = everything lost except published inline comments. Expected: periodically checkpoint what has been reviewed so far. Not "streaming" (anti-feature) -- saving state that can be summarized on timeout. The `published` flag in `executor.ts` already tracks whether inline comments were posted; extend to track what files/findings were covered. | MEDIUM | The executor streams messages via `for await (const message of sdkQuery)`. Track `assistant` messages that indicate file analysis progress. On timeout, the catch block has access to accumulated state. |
| **Post enriched timeout summary using checkpoint data** | Currently the timeout message says "Timed out after Xs." With checkpoint data: "Reviewed 45/120 files. 8 inline comments published. Files not reviewed: [top 5 by risk]. Consider increasing timeoutSeconds or re-requesting review." | LOW | Consumes checkpoint data in the timeout handler. Extends the existing timeout comment logic in `review.ts`. |

---

## Differentiators

Features that set Kodiai apart from Dependabot, Renovate, CodeRabbit. Not universally expected but high-value.

### 4. Multi-Package Correlation

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Detect grouped scope-prefix updates** | When a PR updates `@babel/core`, `@babel/preset-env`, and `@babel/plugin-transform-runtime`, these are a coordinated monorepo release. The review should note "3 packages from @babel/* updated together" rather than treating each independently. Renovate has explicit `groupName` support for this. Detection: group packages sharing a scope prefix (`@scope/`) or known ecosystem family (eslint + @eslint/, typescript-eslint/*). | LOW | Parse all changed packages from manifest diffs (existing `extractDepBumpDetails` handles single packages; extend for multi-package PRs where `isGroup: true`). Group by npm scope prefix or known families. |
| **Cross-reference version compatibility in groups** | In monorepo ecosystems (Babel, ESLint, Angular), all packages within a group must be at compatible versions. Detect mismatches: `@typescript-eslint/parser@8.0.0` with `@typescript-eslint/eslint-plugin@7.0.0` is likely broken. | MEDIUM | Requires knowing which packages form a compatibility group. Heuristic: same scope prefix + same major version expected. For known ecosystems (Babel, ESLint, Angular, React), maintain a small compatibility rules table. |
| **Aggregate group confidence** | For grouped updates, compute a single merge confidence rather than per-package. The group confidence is the minimum of individual confidences (weakest link). | LOW | Extends `computeMergeConfidence()` to accept an array of `DepBumpContext` and return a single aggregate. |

### 5. Retry with Reduced Scope on Timeout

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Auto-retry with top-N files by risk score** | When a review times out, automatically retry with a reduced file set. The existing `file-risk-scorer.ts` already ranks files. Cut scope to top 50% by risk, retry once. This transforms a zero-value timeout into a partial review. | HIGH | Requires: (1) detecting timeout in the review handler, (2) computing reduced file set from risk scores, (3) re-invoking executor with reduced scope, (4) marking result as "reduced-scope review." Touches job queue coordination and idempotency logic. |
| **What to cut: abbreviation tier first, then file count** | The existing tiered review system has `full` and `abbreviated` tiers. On retry: (1) drop the `abbreviated` tier entirely, (2) if still too large, halve the `full` tier by risk rank. This preserves the most important files. | MEDIUM | Extends `timeout-estimator.ts` with a `computeRetryScope()` function. Uses existing risk scores. |
| **Reuse checkpoint data on retry** | If checkpoint publishing captured some findings before timeout, the retry should not re-review files that already have published comments. Skip files with existing inline comments from the same review run. | MEDIUM | Requires checkpoint data from feature 3. Cross-reference published file paths with retry file list. |

### 6. Adaptive Distance Thresholds (Knee-Point Detection)

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Replace fixed 0.3 threshold with data-driven cutoff** | The current fixed `distanceThreshold: 0.3` in `isolation.ts` works for some queries but is suboptimal for others. Short queries produce tighter distance clusters; long queries produce wider spreads. Adaptive thresholds self-tune per query. The Kneedle algorithm (Satopaa et al.) detects knee points in sorted distance curves and is the standard approach. | MEDIUM | Retrieve with relaxed threshold (e.g., 0.8), sort results by distance ascending, apply knee-point detection to find the natural "elbow" where distances jump. Keep results below the knee. Safety bounds: floor = always return top-1 result, ceiling = never accept distance > 0.7. |
| **Simplified knee-point: maximum gap detection** | Full Kneedle is overkill for 5-20 candidate results. Simpler approach: find the largest gap in the sorted distance array. Everything below the gap is "relevant"; everything above is "noise." This is the L-method simplified -- effective for small result sets. | LOW | Sort distances, compute deltas between consecutive results, find max delta. Split at max delta. O(n) computation, no external libraries needed. |
| **Fallback to percentile-based cutoff** | When the distance distribution is uniform (no clear knee), fall back to percentile: keep results within 1.5x the distance of the best match. This handles the degenerate case where all results are similarly distant. | LOW | `threshold = bestDistance * 1.5`. Simple multiplier. Combined with the gap detection, this creates a robust two-strategy system. |

### 7. Recency Weighting for Memory Relevance

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Exponential time-decay on retrieval distances** | Older memories reflect outdated patterns. A finding from 6 months ago is less relevant than one from last week. Apply a time-decay multiplier to distances: `adjustedDistance = distance * decayFactor(age)`. The existing `RerankedResult` type already has `adjustedDistance` -- extend the pattern. | LOW | Exponential decay: `decayFactor = 1.0 + decayRate * (ageDays / halfLifeDays)`. With halfLife=90 days and decayRate=0.3: 0 days = 1.0x (no penalty), 90 days = 1.3x (30% farther), 180 days = 1.6x (60% farther). Tune via config. |
| **Preserve recent security findings regardless of age** | Security-category findings should not decay as aggressively. A "SQL injection" finding from 6 months ago is still highly relevant. Apply reduced decay for `category === "security"`. | LOW | Category-aware decay multiplier. Security findings use 0.5x the normal decay rate. |
| **Configurable decay parameters** | Expose `recencyDecay.halfLifeDays` and `recencyDecay.rate` in `.kodiai.yml` knowledge section. Default: 90-day half-life, 0.3 rate. Teams updating frequently want shorter half-life; stable codebases want longer. | LOW | Config schema extension. Already have config parsing infrastructure with graceful degradation. |

### 8. Retrieval Quality Telemetry

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Track retrieval metrics per execution** | Record: `{resultCount, avgDistance, minDistance, maxDistance, thresholdUsed, kneePointDetected, languageMatchCount, recencyAdjustedCount}`. These are the key metrics for tuning retrieval quality. RAG evaluation literature emphasizes Precision@K and distance distribution monitoring. | LOW | Extend `TelemetryRecord` type with optional retrieval fields. Log at the point where retrieval results are consumed in the review handler. |
| **Track retrieval-to-outcome correlation** | When a retrieved memory influences a finding (same file path or same category), record the linkage. Over time, this reveals whether retrieval actually improves review quality. Core RAG metric: contextual relevance. | MEDIUM | Requires post-review analysis: compare retrieved memory categories/file paths with produced finding categories/file paths. Jaccard similarity or simple overlap count. |
| **Aggregate telemetry for threshold tuning** | Periodically analyze retrieval telemetry to surface: (1) repos where distance threshold is too tight (0 results frequently), (2) repos where threshold is too loose (high avg distance), (3) optimal threshold per repo based on outcome correlation. | LOW | SQL aggregation queries over the telemetry table. Could be a CLI command: `kodiai telemetry retrieval-health`. |

### 9. Cross-Language Concept Equivalence

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Test Voyage Code 3 cross-language retrieval** | Before building anything, empirically test whether the current embedding model (Voyage Code 3, 1024-dim) already captures cross-language equivalences. Embed "null pointer check in Java" and "optional chaining in TypeScript" and measure distance. If distance < 0.4, the model handles it natively. | LOW | Test-only. Generate embeddings for 10 known cross-language concept pairs, measure distances. If the model handles it, this feature is "free." |
| **Concept normalization layer (if model insufficient)** | If Voyage Code 3 does not capture equivalences: build a small lookup table mapping language-specific patterns to canonical concepts. Example: `{java: "NullPointerException", typescript: "undefined access", python: "AttributeError: NoneType", go: "nil pointer dereference"} -> "null-safety"`. Use canonical concepts as query enrichment. | MEDIUM | Manual curation of ~20-30 common cross-language concept groups. Append canonical concept name to retrieval query when the PR language differs from memory language. |
| **Language-pair affinity scoring** | Some language pairs share more concepts than others (TypeScript/JavaScript are near-identical; Go/Rust share memory safety patterns; Python/Ruby share dynamic typing patterns). Use affinity scores to weight cross-language retrieval: high-affinity pairs get less penalty in re-ranking. | LOW | Small lookup table: `{ts-js: 0.95, go-rust: 0.7, python-ruby: 0.7, java-kotlin: 0.9, ...}`. Modifies the `crossLanguagePenalty` in `retrieval-rerank.ts` to be pair-aware instead of uniform. |

---

## Anti-Features

Features to explicitly NOT build. Some are natural-seeming extensions that would harm the product.

| Anti-Feature | Why Tempting | Why Avoid | What to Do Instead |
|--------------|-------------|-----------|-------------------|
| **Full AST parsing for usage analysis** | "Parse the dependency source code AST to find all exported API changes." | Downloading and parsing npm packages at review time is slow (packages can be megabytes) and ecosystem-specific (different parsers for npm, Go, Rust, Python). Aikido can do this because they run offline; a webhook handler cannot. | Use the changelog/release notes as a proxy for API changes. Grep workspace for import statements of the bumped package. This covers 80% of cases without AST parsing. |
| **Transitive dependency impact analysis** | "Track breaking changes in transitive deps too." | A single npm project has 500+ transitive deps. Analyzing all of them per bump is scope explosion and hits GitHub API rate limits. | Analyze only packages directly changed in the PR diff. Transitive analysis belongs to `npm audit` and Dependabot alerts. |
| **ML-based timeout prediction** | "Train a model to predict review duration from PR features." | No training data exists yet. The heuristic in `timeout-estimator.ts` (weighted file count + lines + language complexity) is sufficient and debuggable. | Collect telemetry on actual vs predicted durations. When enough data exists (1000+ executions), revisit. |
| **Real-time streaming of review findings** | "Post each finding as it's generated." | GitHub REST API rate limits + notification noise. CodeRabbit explicitly moved away from streaming to buffered output. | Use checkpoint publishing (batch save at intervals), not per-finding streaming. Publish as a batch on completion or on timeout. |
| **Persistent retry queue for timeouts** | "Queue timed-out reviews for background retry with exponential backoff." | Review relevance decays rapidly. A retry 30 minutes later reviews stale code (new commits may have landed). Adds job queue complexity for diminishing returns. | Single immediate retry with reduced scope. If that also fails, post the partial results and stop. No background queue. |
| **Global (cross-owner) memory sharing** | "Share learnings across all Kodiai users." | Privacy and relevance concerns. Org A's coding patterns are not relevant to Org B. Data isolation is a feature, not a limitation. | Owner-level sharing (already built) is the right boundary. Cross-language concept mapping handles the "universal patterns" case. |
| **Automatic threshold auto-tuning** | "Continuously update distance thresholds based on telemetry." | Creates a feedback loop: threshold changes affect retrieval, which affects outcomes, which affects the next threshold update. Drift risk. | Collect telemetry, surface recommendations, let operators tune. Semi-automatic, not fully automatic. |

---

## Feature Dependencies

```text
API USAGE ANALYSIS
===================
[Existing: dep-bump-detector, dep-bump-enrichment, merge-confidence]
    |
    +-- extends --> [Grep workspace for imports of bumped package]
    |                   |
    |                   +-- requires --> packageName from dep bump detection
    |                   +-- requires --> workspace access (existing Grep/Glob tools)
    |                   +-- produces --> List of {file, line, importedSymbol}
    |
    +-- extends --> [Integrate usage into merge confidence]
                        |
                        +-- requires --> usage analysis results
                        +-- modifies --> computeMergeConfidence() fourth signal


DEPENDENCY HISTORY & MULTI-PACKAGE CORRELATION
================================================
[Existing: knowledge store, dep-bump-detector]
    |
    +-- extends --> [dep_bump_history table in knowledge store]
    |                   |
    |                   +-- INSERT on merge (from review handler)
    |                   +-- SELECT on detection (prior bump data)
    |
    +-- extends --> [Multi-package detection from manifest diffs]
    |                   |
    |                   +-- requires --> Parse multiple version changes
    |                   +-- requires --> Scope prefix grouping logic
    |                   +-- produces --> Package groups with aggregate confidence
    |
    +-- extends --> [History + correlation feed into review prompt]


CHECKPOINT PUBLISHING & RETRY
===============================
[Existing: executor.ts, timeout-estimator.ts, review.ts timeout handler]
    |
    +-- extends --> [Checkpoint accumulator in executor]
    |                   |
    |                   +-- intercepts --> assistant messages during streaming
    |                   +-- tracks --> files analyzed, findings generated
    |                   +-- available on --> timeout catch block
    |
    +-- extends --> [Enriched timeout summary from checkpoint data]
    |
    +-- extends --> [Retry with reduced scope]
                        |
                        +-- requires --> checkpoint data (what was already reviewed)
                        +-- requires --> risk-ranked file list (existing)
                        +-- requires --> re-invocation of executor
                        +-- produces --> reduced-scope review result


ADAPTIVE RETRIEVAL
===================
[Existing: isolation.ts, retrieval-rerank.ts, retrieval-query.ts]
    |
    +-- extends --> [Adaptive distance threshold (knee-point)]
    |                   |
    |                   +-- replaces --> fixed 0.3 threshold
    |                   +-- requires --> relaxed initial retrieval (0.8 threshold)
    |                   +-- applies --> gap detection + percentile fallback
    |
    +-- extends --> [Recency weighting]
    |                   |
    |                   +-- modifies --> adjustedDistance in re-ranking pipeline
    |                   +-- uses --> createdAt from memory records
    |
    +-- extends --> [Cross-language concept equivalence]
    |                   |
    |                   +-- step 1 --> empirical test of Voyage Code 3
    |                   +-- step 2 (conditional) --> concept normalization table
    |                   +-- step 3 --> language-pair affinity scoring
    |
    +-- extends --> [Retrieval quality telemetry]
                        |
                        +-- records --> per-execution retrieval metrics
                        +-- correlates --> retrieval results vs finding outcomes
```

### Critical Path

1. **API usage analysis** depends on existing dep bump detection (shipped). Can start immediately.
2. **Checkpoint publishing** must precede **retry with reduced scope** (retry reuses checkpoint data).
3. **Adaptive distance thresholds** and **recency weighting** are independent of each other but both modify the retrieval pipeline. Implement adaptive thresholds first (modifies what results come back) then recency weighting (modifies their ranking).
4. **Cross-language concept equivalence** starts with a test -- if Voyage Code 3 handles it natively, skip the normalization layer.
5. **Retrieval quality telemetry** should ship early to collect baseline data before adaptive thresholds change behavior.

### Independence Points

- **All four feature areas are fully independent** of each other (dep analysis, execution resilience, retrieval, telemetry)
- Within dep analysis: usage analysis, history tracking, and multi-package correlation are independent
- Within retrieval: adaptive thresholds, recency weighting, and cross-language equivalence are independent
- Telemetry is read-only/additive and can ship at any time

---

## MVP Recommendation

### Build First (P1) -- High value, builds on shipped v0.9 infrastructure

1. **API usage analysis: grep for imports of bumped package** -- The single highest-value extension of the dep bump pipeline. Transforms generic "breaking change" warnings into specific "your code at `src/auth.ts:42` imports the removed function." Aikido charges enterprise pricing for this. We can do a 80% version with `Grep` for import statements.

2. **Dependency update history tracking** -- Small schema addition, big context improvement. One line in the review prompt ("last updated 45 days ago, no issues") provides longitudinal context no competitor offers for free.

3. **Retrieval quality telemetry** -- Ship early to establish baseline metrics before any retrieval changes. Low effort, critical for validating that subsequent features (adaptive thresholds, recency) actually improve quality.

4. **Checkpoint accumulation during execution** -- Track files analyzed and findings generated during the streaming loop. This is infrastructure for both enriched timeout messages and retry. Low risk: additive tracking, no behavior change.

5. **Recency weighting for retrieval** -- Simple math applied in the existing re-ranking pipeline. Older memories get slight distance penalties. Immediate quality improvement with no infrastructure changes.

6. **Multi-package correlation (scope prefix detection)** -- Parse grouped updates, note coordination in review. Low complexity, fills a gap in the existing `isGroup: true` handling.

### Build Second (P2) -- Depth features requiring more infrastructure

7. **Adaptive distance thresholds (max-gap detection)** -- Replace fixed 0.3 with data-driven cutoff. Use simplified max-gap approach, not full Kneedle. Depends on telemetry baseline from P1 to validate improvement.

8. **Enriched timeout summary from checkpoint data** -- Consume checkpoint data (P1 item 4) to produce specific timeout messages listing reviewed files and unreviewed remainder.

9. **Integrate usage analysis into merge confidence** -- Add fourth signal to `computeMergeConfidence()`. Depends on usage analysis (P1 item 1) being stable.

10. **Language-pair affinity scoring** -- Small lookup table making cross-language retrieval penalty context-aware. Extends existing `retrieval-rerank.ts`.

### Defer (P3) -- Complex or conditional

11. **Retry with reduced scope on timeout** -- High value but requires job queue coordination, idempotency handling, and checkpoint data. Build after checkpoint publishing is proven stable.

12. **Cross-language concept normalization** -- Conditional on empirical testing of Voyage Code 3. Only build if the model does not handle cross-language equivalence natively.

13. **Cross-reference version compatibility in package groups** -- Requires maintaining a compatibility rules table for known ecosystems. Valuable but niche (only matters for monorepo ecosystem updates).

14. **Retrieval-to-outcome correlation tracking** -- Post-review analysis comparing retrieved memories to produced findings. Important for tuning but requires enough data first.

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Risk | Priority |
|---------|------------|------------|------|----------|
| API usage analysis (grep imports) | **HIGH** | MEDIUM | LOW | **P1** |
| Dep update history tracking | MEDIUM | LOW | LOW | **P1** |
| Retrieval quality telemetry (baseline) | MEDIUM | LOW | LOW | **P1** |
| Checkpoint accumulation in executor | MEDIUM | MEDIUM | LOW | **P1** |
| Recency weighting for retrieval | MEDIUM | LOW | LOW | **P1** |
| Multi-package scope-prefix correlation | MEDIUM | LOW | LOW | **P1** |
| Adaptive distance threshold (max-gap) | MEDIUM | MEDIUM | MEDIUM | **P2** |
| Enriched timeout summary | MEDIUM | LOW | LOW | **P2** |
| Usage analysis in merge confidence | MEDIUM | LOW | LOW | **P2** |
| Language-pair affinity scoring | LOW | LOW | LOW | **P2** |
| Retry with reduced scope | **HIGH** | HIGH | MEDIUM | **P3** |
| Cross-language concept normalization | LOW | MEDIUM | MEDIUM | **P3** |
| Group version compatibility check | LOW | MEDIUM | LOW | **P3** |
| Retrieval-to-outcome correlation | LOW | MEDIUM | LOW | **P3** |

---

## Implementation Notes

### API Usage Analysis -- Practical Approach

Do NOT parse ASTs. Instead:

1. From `dep-bump-enrichment.ts`, the `breakingChanges` array contains snippets like "Removed `createClient()` function" or "Renamed `Config` to `Options`"
2. Extract symbol names from breaking change snippets (LLM-assisted or regex: extract capitalized words, camelCase identifiers, backtick-quoted names)
3. Grep the workspace for `import.*from ['"]<packageName>['"]` to find all import sites
4. If specific symbols are known, grep for those symbols in the importing files
5. Report: "Found 3 files importing `bumped-package`: `src/auth.ts`, `src/db.ts`, `lib/utils.ts`. Breaking change `createClient() removed` may affect `src/auth.ts:42`."

This approach works across npm, Go (`import "package"`), Python (`import package` / `from package import X`), and Rust (`use package::`).

### Knee-Point Detection -- Simplified Algorithm

```typescript
function findKneePoint(distances: number[]): number {
  if (distances.length <= 1) return distances.length;

  // Compute gaps between consecutive sorted distances
  let maxGap = 0;
  let kneeIndex = distances.length;

  for (let i = 1; i < distances.length; i++) {
    const gap = distances[i] - distances[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      kneeIndex = i;
    }
  }

  // Only split if the max gap is significant (>2x median gap)
  const gaps = distances.slice(1).map((d, i) => d - distances[i]);
  const medianGap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 0;

  if (maxGap < medianGap * 2) {
    // No clear knee -- use percentile fallback
    const threshold = distances[0] * 1.5;
    return distances.findIndex(d => d > threshold);
  }

  return kneeIndex;
}
```

### Recency Decay -- Formula

```typescript
function computeRecencyMultiplier(createdAt: string, config: {
  halfLifeDays: number;  // default: 90
  maxPenalty: number;     // default: 0.5 (50% distance increase cap)
}): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const decay = (ageDays / config.halfLifeDays) * 0.3;
  return 1.0 + Math.min(decay, config.maxPenalty);
}
// 0 days old: 1.0x (no change)
// 90 days old: 1.3x (30% farther)
// 180 days old: 1.5x (capped at maxPenalty)
```

### Checkpoint Publishing -- What to Track

```typescript
type ExecutionCheckpoint = {
  filesAnalyzed: string[];       // file paths mentioned in assistant messages
  findingsGenerated: number;      // count of inline comments published via MCP
  lastActivityMs: number;         // timestamp of last assistant message
  elapsedMs: number;              // total execution time so far
};
```

Track by intercepting the message stream in `executor.ts`. On timeout, this data is available in the catch block and passed back to the review handler for the enriched timeout message.

---

## Sources

### Direct Evidence (HIGH confidence -- verified in codebase)
- `src/lib/dep-bump-detector.ts` -- Three-stage pipeline with `isGroup` flag for multi-package PRs
- `src/lib/dep-bump-enrichment.ts` -- `breakingChanges` array from changelog, `SecurityContext` with `isSecurityBump`
- `src/lib/merge-confidence.ts` -- Three-signal scoring (semver + advisory + breaking), extensible to fourth signal
- `src/learning/retrieval-rerank.ts` -- `adjustedDistance` pattern for post-retrieval score modification
- `src/learning/isolation.ts` -- Fixed `distanceThreshold` parameter, retrieval with provenance
- `src/execution/executor.ts` -- Message streaming loop, `published` flag, timeout catch block
- `src/lib/timeout-estimator.ts` -- Complexity scoring with `shouldReduceScope` and `reducedFileCount`
- `src/telemetry/types.ts` -- `TelemetryRecord` type, extensible for retrieval metrics

### Competitor Analysis (MEDIUM confidence -- verified via web)
- [Aikido Upgrade Impact Analysis](https://www.aikido.dev/blog/breaking-changes) -- Analyzes codebase for actual impact of breaking changes, three-bucket classification (all clear / breaking / manual validation). Supports JS, Python, Java, Go, .NET, PHP, Clojure.
- [Renovate Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) -- Tracks dependency state across repos, groups related updates, supports `groupName` configuration for monorepo ecosystems.

### Research (MEDIUM confidence -- verified via academic sources)
- [Kneedle Algorithm](https://www.researchgate.net/publication/224249192_Finding_a_Kneedle_in_a_Haystack_Detecting_Knee_Points_in_System_Behavior) -- Standard knee-point detection for sorted curves. Satopaa et al.
- [Kneeliverse Library](https://www.sciencedirect.com/science/article/pii/S2352711025001281) -- 2025 library implementing Kneedle, L-method, DFDT, and Menger algorithms for multi-knee detection.
- [kneed Python Library](https://github.com/arvkevi/kneed) -- Python implementation of Kneedle with sensitivity parameter. Validates the max-gap simplified approach for small result sets.
- [Re3: Relevance & Recency Retrieval](https://arxiv.org/html/2509.01306v1) -- 2025 framework for temporal information retrieval with modular time encoding and enhancement components.
- [Beyond Basic RAG: Retrieval Weighting](https://www.langflow.org/blog/beyond-basic-rag-retrieval-weighting) -- Exponential decay model: multiply similarity scores by time-based decay factors before ranking.
- [RAG Evaluation Metrics (2025)](https://deconvoluteai.com/blog/rag/metrics-retrieval) -- Precision@K, Recall@K, MRR, NDCG as core retrieval quality metrics.
- [Checkpoint-Based Recovery for Long-Running Tasks](https://dev3lop.com/checkpoint-based-recovery-for-long-running-data-transformations/) -- Checkpointing safeguards partial results for fault tolerance.
- [Byam: Fixing Breaking Dependency Updates with LLMs](https://arxiv.org/html/2505.07522v1) -- LLM-assisted compilation failure fixing for breaking dependency updates.

---
*Feature research for: Kodiai v0.10 -- Advanced Signals (API Usage Analysis, Dependency History, Multi-Package Correlation, Checkpoint Publishing, Retry, Adaptive Thresholds, Recency Weighting, Retrieval Telemetry, Cross-Language Equivalence)*
*Researched: 2026-02-15*
