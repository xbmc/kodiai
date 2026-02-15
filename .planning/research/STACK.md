# Technology Stack

**Project:** Kodiai v0.10 -- Advanced Signals (Usage-Aware Analysis, Trend Tracking, Checkpoint Publishing, Adaptive Retrieval, Cross-Language Equivalence)
**Researched:** 2026-02-15
**Overall Confidence:** HIGH

## Executive Summary

This milestone adds six capability areas to the existing Kodiai codebase. The key finding is that **one new dependency is recommended** (`@ast-grep/napi` for AST-based API usage analysis), while the remaining five capabilities are achievable with the existing stack plus pure-function implementations.

For **AST/grep-based API usage analysis**: Use `@ast-grep/napi` (v0.40.x) over `tree-sitter` (node bindings). ast-grep provides a higher-level structural search API built on tree-sitter, with NAPI bindings confirmed compatible with Bun v1.1.34+ (which added the Node-API tags that unblocked tree-sitter). ast-grep lets you write pattern queries like `$PKG.deprecatedMethod($$$)` that match AST structure rather than raw text -- critical for avoiding false positives when detecting API usage in cloned workspaces. For languages where AST grammars are unavailable, fall back to Bun's built-in `$` shell for `grep -rn` in the workspace directory.

For **dependency update history and trend queries**: Extend the existing SQLite knowledge store with a `dep_bump_history` table. The existing `reviews` and `findings` tables already track per-review data; the new table captures per-package version transitions over time. Trend queries use SQLite window functions (`LAG`, `AVG OVER`) which are fully supported in SQLite 3.25+ (Bun bundles 3.45+). No new dependency needed.

For **checkpoint publishing on timeout**: The existing `upsertReviewDetailsComment` pattern in `review.ts` plus the Octokit PR comment API provide the publishing mechanism. Checkpoint logic is a timer-based check during long-running executor phases. No new dependency needed -- this is an orchestration pattern using `setTimeout`/`Date.now()` elapsed checks.

For **knee-point detection for adaptive distance thresholds**: Implement the Kneedle algorithm as a ~60-line pure TypeScript function. No library exists in the npm ecosystem for this. The algorithm (normalize, compute difference curve, find maximum) is well-documented in the academic paper "Finding a Kneedle in a Haystack" and straightforward to implement. Store calibration data in a new SQLite table.

For **recency-weighted scoring in vector retrieval**: Apply exponential decay weighting post-retrieval using `Math.exp(-lambda * ageDays)` as a multiplier on the existing `adjustedDistance` from `retrieval-rerank.ts`. This is a 20-line pure function. SQLite's `julianday()` function computes age; the decay computation happens in TypeScript after retrieval. No new dependency needed.

For **cross-language concept equivalence mapping**: Build a static mapping table (TypeScript object literal) of equivalent API patterns across languages (e.g., `Array.prototype.map` <-> `list comprehension` <-> `slice.Map`). This is a curated data structure, not a library concern. The existing `classifyFileLanguage` in `diff-analysis.ts` already identifies PR languages. Equivalence mappings feed into the retrieval query builder to boost cross-language memory matches. No new dependency needed.

## Recommended Stack

### New Dependency

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@ast-grep/napi` | ^0.40.5 | Structural code search in cloned workspaces | AST-level pattern matching across JS/TS/Go/Python/Rust/Java. Built on tree-sitter but provides higher-level query API. NAPI bindings work with Bun 1.1.34+. Avoids needing separate `tree-sitter` + per-language grammar packages. |

### Existing Dependencies (No Changes)

| Technology | Version | Purpose | Used For New Features |
|------------|---------|---------|----------------------|
| `bun:sqlite` | builtin | Persistent storage | dep_bump_history table, threshold calibration table, telemetry tables |
| `sqlite-vec` | ^0.1.7-alpha.2 | Vector search | Same infrastructure, recency weighting applied post-retrieval |
| `voyageai` | ^0.1.0 | Embeddings | Cross-language query embedding (same API) |
| `@octokit/rest` | ^22.0.1 | GitHub API | Checkpoint comment publishing, same PR comment endpoints |
| `zod` | ^4.3.6 | Schema validation | Config extensions for new features |
| `pino` | ^10.3.0 | Structured logging | Quality telemetry, trend logging |
| `p-queue` | ^9.1.0 | Concurrency control | No changes needed |
| `picomatch` | ^4.0.2 | Glob matching | Workspace file filtering before AST analysis |

### No-Dependency Implementations (Pure TypeScript)

| Capability | Approach | Estimated Size | Confidence |
|-----------|----------|----------------|------------|
| Kneedle algorithm | Port from Python `kneed` library | ~60 LOC | HIGH -- algorithm is well-documented, simple math |
| Recency decay weighting | `exp(-lambda * ageDays)` multiplier | ~20 LOC | HIGH -- standard exponential decay |
| Cross-language concept map | Static mapping object + lookup | ~150 LOC data + ~30 LOC lookup | MEDIUM -- mapping quality depends on curation |
| Dep bump history queries | SQLite window functions (LAG, AVG OVER) | ~80 LOC (schema + queries) | HIGH -- standard SQL patterns |
| Checkpoint timer | `Date.now()` elapsed checks in executor loop | ~40 LOC | HIGH -- trivial pattern |
| grep fallback for AST | `Bun.$` shell with `grep -rn` | ~30 LOC | HIGH -- already used in workspace.ts |

## Detailed Technology Decisions

### 1. AST/Grep-Based API Usage Analysis

**Decision: `@ast-grep/napi` over `tree-sitter` (node bindings) or `web-tree-sitter` (WASM)**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| `@ast-grep/napi` | Higher-level pattern API, built-in multi-language support, single package, Rust-powered perf | Pre-1.0 (0.40.x), NAPI binary size | **USE THIS** |
| `tree-sitter` + grammars | More control, mature (0.25.x) | Need separate grammar packages per language (6+), low-level tree walking, Bun NAPI segfault history | Skip |
| `web-tree-sitter` (WASM) | No native compilation | 3-5x slower than native, WASM cold start | Skip |
| Raw `grep -rn` only | Zero dependencies | No AST awareness, high false positive rate | Fallback only |

**Why ast-grep wins for this use case:**

The usage analysis feature needs to answer "does this codebase call `foo.barMethod()`?" across multiple languages. ast-grep's pattern syntax lets you write `$OBJ.barMethod($$$)` which matches structurally -- it won't match string literals containing "barMethod" or comments mentioning it. This is exactly what you need for API usage detection in dep bumps.

ast-grep bundles tree-sitter grammars internally, so one `npm install @ast-grep/napi` gives you TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, and more. With raw tree-sitter, you'd need:
- `tree-sitter` (core)
- `tree-sitter-typescript` (TS + TSX)
- `tree-sitter-javascript`
- `tree-sitter-python`
- `tree-sitter-go`
- `tree-sitter-rust`
- `tree-sitter-java`

That's 7 packages with native compilation each, versus 1 package.

**Bun compatibility:** Bun v1.1.34 (Nov 2024) added `napi_type_tag_object` / `napi_check_object_type_tag` support which was the specific blocker for tree-sitter NAPI bindings. ast-grep uses the same NAPI layer. The project already uses `sqlite-vec` which is also a NAPI extension, confirming the pattern works.

**Integration point:** Called from a new `analyzeApiUsage()` function that runs inside the cloned workspace (same `Workspace.dir` from `jobs/workspace.ts`). Reads source files, searches for patterns matching the updated package's API surface, returns usage evidence.

**Fallback:** For languages without ast-grep grammar support or when the NAPI binary fails to load (fail-open pattern matching `sqlite-vec`), use `Bun.$\`grep -rn "pattern" ${dir}\`` with word-boundary regex. Lower precision but still useful signal.

**Confidence:** HIGH (ast-grep NAPI is actively maintained, 400K weekly npm downloads, confirmed Bun NAPI compat path)

### 2. Dependency Update History Persistence

**Decision: Extend existing SQLite knowledge store schema**

New table schema:

```sql
CREATE TABLE IF NOT EXISTS dep_bump_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  package_name TEXT NOT NULL,
  ecosystem TEXT,
  old_version TEXT,
  new_version TEXT,
  bump_type TEXT,         -- major/minor/patch/unknown
  is_breaking INTEGER NOT NULL DEFAULT 0,
  is_security_bump INTEGER NOT NULL DEFAULT 0,
  merge_confidence TEXT,  -- high/medium/low
  pr_number INTEGER NOT NULL,
  review_id INTEGER REFERENCES reviews(id),
  advisory_count INTEGER NOT NULL DEFAULT 0,
  breaking_change_count INTEGER NOT NULL DEFAULT 0,
  source TEXT             -- dependabot/renovate/unknown
);

CREATE INDEX IF NOT EXISTS idx_dep_history_repo_pkg
  ON dep_bump_history(repo, package_name);
CREATE INDEX IF NOT EXISTS idx_dep_history_repo_created
  ON dep_bump_history(repo, created_at);
```

**Trend queries using window functions:**

```sql
-- Package update frequency (updates per month)
SELECT
  package_name,
  strftime('%Y-%m', created_at) AS month,
  COUNT(*) AS update_count,
  SUM(CASE WHEN bump_type = 'major' THEN 1 ELSE 0 END) AS major_count
FROM dep_bump_history
WHERE repo = $repo
  AND created_at >= datetime('now', '-6 months')
GROUP BY package_name, strftime('%Y-%m', created_at);

-- Packages with increasing major bump frequency (potential instability signal)
SELECT package_name,
  COUNT(*) FILTER (WHERE created_at >= datetime('now', '-30 days')) AS recent_bumps,
  COUNT(*) FILTER (WHERE created_at >= datetime('now', '-90 days')) AS quarter_bumps
FROM dep_bump_history
WHERE repo = $repo AND bump_type = 'major'
GROUP BY package_name
HAVING recent_bumps > 0;
```

**Integration point:** After the existing dep-bump pipeline (`detectDepBump` -> `extractDepBumpDetails` -> `classifyDepBump` -> enrichment -> merge confidence), persist the result to `dep_bump_history` via a new `recordDepBumpHistory()` method on `KnowledgeStore`.

**Confidence:** HIGH (SQLite window functions confirmed available, schema extension is a proven pattern in this codebase)

### 3. Checkpoint Publishing on Timeout

**Decision: Timer-based checkpoint using existing Octokit comment API**

**Pattern:** During long-running review execution, check elapsed time at natural phase boundaries. If elapsed > threshold (e.g., 70% of dynamic timeout), publish partial results as a PR comment before continuing.

**No new infrastructure needed.** The existing codebase already has:

- `upsertReviewDetailsComment()` in `review.ts` -- upserts a comment with an idempotency marker
- `buildReviewOutputMarker()` / `ensureReviewOutputNotPublished()` in `review-idempotency.ts` -- prevents duplicate publishing
- `estimateTimeoutRisk()` in `timeout-estimator.ts` -- provides `dynamicTimeoutSeconds`
- `AbortController` timeout in executor -- provides the deadline

**Checkpoint implementation sketch:**

```typescript
type CheckpointState = {
  startedAt: number;
  timeoutMs: number;
  published: boolean;
  findings: ProcessedFinding[];
  reviewOutputKey: string;
};

function shouldCheckpoint(state: CheckpointState): boolean {
  const elapsed = Date.now() - state.startedAt;
  const threshold = state.timeoutMs * 0.7; // 70% of budget
  return !state.published && elapsed >= threshold && state.findings.length > 0;
}
```

**Retry after checkpoint:** If the review completes after a checkpoint was published, update the same comment (upsert pattern) with final results. The `buildReviewOutputKey()` ensures the same marker is used.

**Integration point:** Add checkpoint check in the review handler between major phases (after executor returns, before finding dedup, after finding prioritization). Each phase boundary is a natural checkpoint opportunity.

**Confidence:** HIGH (pattern is simple, all primitives exist)

### 4. Knee-Point Detection for Adaptive Thresholds

**Decision: Implement Kneedle algorithm as pure TypeScript**

**Why no library:** There is no established JavaScript/TypeScript npm package for knee-point detection. The Python `kneed` library is the reference implementation, but it's Python-only. The algorithm itself is simple enough that porting is preferable to adding a dependency.

**Kneedle algorithm (simplified):**

1. Normalize x and y values to [0, 1]
2. Compute difference curve: `D(i) = y_norm(i) - x_norm(i)`
3. Find the index where D is maximized (concave) or minimized (convex)
4. That's the knee point

```typescript
export function findKneePoint(
  x: number[],
  y: number[],
  direction: 'increasing' | 'decreasing' = 'increasing',
): { kneeX: number; kneeY: number; kneeIndex: number } | null {
  if (x.length < 3) return null;

  // Normalize to [0, 1]
  const xMin = Math.min(...x), xMax = Math.max(...x);
  const yMin = Math.min(...y), yMax = Math.max(...y);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const xNorm = x.map(v => (v - xMin) / xRange);
  const yNorm = y.map(v => (v - yMin) / yRange);

  // Difference curve
  const diff = xNorm.map((xi, i) =>
    direction === 'increasing' ? yNorm[i]! - xi : xi - yNorm[i]!
  );

  // Find max of difference curve
  let maxIdx = 0;
  let maxVal = diff[0]!;
  for (let i = 1; i < diff.length; i++) {
    if (diff[i]! > maxVal) {
      maxVal = diff[i]!;
      maxIdx = i;
    }
  }

  return { kneeX: x[maxIdx]!, kneeY: y[maxIdx]!, kneeIndex: maxIdx };
}
```

**Use case:** Adaptive distance thresholds for vector retrieval. Track `(distanceThreshold, retrievalQuality)` pairs over time per repo. When enough data points accumulate (>= 10), run Kneedle to find the optimal threshold where quality stops improving significantly.

**Storage:** New SQLite table:

```sql
CREATE TABLE IF NOT EXISTS retrieval_calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  distance_threshold REAL NOT NULL,
  result_count INTEGER NOT NULL,
  quality_score REAL NOT NULL,  -- 0-1, based on relevance heuristics
  query_type TEXT               -- review/mention/etc
);

CREATE INDEX IF NOT EXISTS idx_retrieval_cal_repo
  ON retrieval_calibration(repo);
```

**Confidence:** HIGH (algorithm is well-documented, implementation is straightforward)

### 5. Recency-Weighted Scoring in Vector Retrieval

**Decision: Post-retrieval exponential decay multiplier**

**Why post-retrieval, not in-query:** sqlite-vec's `MATCH` operator doesn't support custom scoring functions in the distance computation. Recency weighting must be applied after retrieval, similar to how `rerankByLanguage()` already applies language-based reranking post-retrieval.

**Implementation:**

```typescript
export type RecencyConfig = {
  halfLifeDays: number;  // Distance at which weight = 0.5 (default: 30)
  maxBoost: number;      // Cap on recency boost (default: 0.7, meaning 30% distance reduction)
};

export const DEFAULT_RECENCY_CONFIG: RecencyConfig = {
  halfLifeDays: 30,
  maxBoost: 0.7,
};

export function applyRecencyWeighting(params: {
  results: RerankedResult[];
  config?: RecencyConfig;
}): RerankedResult[] {
  const { results, config = DEFAULT_RECENCY_CONFIG } = params;
  const lambda = Math.LN2 / config.halfLifeDays;
  const now = Date.now();

  return results.map(result => {
    const createdAt = new Date(result.record.createdAt).getTime();
    const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.exp(-lambda * ageDays);
    // Blend: newer memories get distance reduced (lower = better)
    const recencyMultiplier = 1 - (1 - config.maxBoost) * decayFactor;
    // Invert: config.maxBoost=0.7 means newest get 0.7x distance
    const adjustedDistance = result.adjustedDistance * (config.maxBoost + (1 - config.maxBoost) * (1 - decayFactor));

    return { ...result, adjustedDistance };
  }).sort((a, b) => a.adjustedDistance - b.adjustedDistance);
}
```

**Integration point:** Chain after `rerankByLanguage()` in the retrieval pipeline. The pipeline becomes: `sqlite-vec MATCH` -> `rerankByLanguage()` -> `applyRecencyWeighting()` -> threshold filter -> return to prompt builder.

**Prerequisite:** The `learning_memories` table already has `created_at`. The `LearningMemoryRecord` type already includes `createdAt`. The `RetrievalResult` type from `learning/types.ts` needs to include the record (it already does via `getMemoryRecord()`).

**Confidence:** HIGH (standard math, clean integration with existing rerank pipeline)

### 6. Cross-Language Concept Equivalence Mapping

**Decision: Static curated mapping + query augmentation**

**Why not ML/embedding-based:** Cross-language concept equivalence is a curated knowledge problem, not a similarity search problem. "Go's `defer`" is conceptually equivalent to "Python's `with` statement" and "TypeScript's `try/finally`" -- but their embeddings would not be similar because the syntax and surrounding text are completely different. A static mapping provides deterministic, explainable results.

**Data structure:**

```typescript
type ConceptEquivalence = {
  concept: string;          // e.g., "error-handling"
  languages: Record<string, string[]>;  // language -> patterns
};

const CONCEPT_MAP: ConceptEquivalence[] = [
  {
    concept: "error-handling",
    languages: {
      TypeScript: ["try/catch", "Promise.catch", ".catch()", "Error class"],
      Python: ["try/except", "raise", "Exception class"],
      Go: ["if err != nil", "errors.New", "fmt.Errorf"],
      Rust: ["Result<T, E>", "?", ".unwrap()", "anyhow"],
      Java: ["try/catch", "throws", "Exception class"],
    },
  },
  {
    concept: "iteration",
    languages: {
      TypeScript: [".map()", ".filter()", ".reduce()", "for...of"],
      Python: ["list comprehension", "map()", "filter()", "for...in"],
      Go: ["for range", "for i :="],
      Rust: [".iter()", ".map()", ".filter()", ".collect()"],
      Java: [".stream()", ".map()", ".filter()", ".collect()", "for-each"],
    },
  },
  // ... 15-20 core concepts covering the common patterns
];
```

**Usage in retrieval:** When building a retrieval query for a Python PR, and the knowledge store has TypeScript memories about `.map()` usage patterns, the concept map allows the query builder to recognize that Python list comprehensions are conceptually equivalent and boost those cross-language matches.

**Integration point:** Extend `buildRetrievalQuery()` in `learning/retrieval-query.ts` to optionally append concept tags. Extend `rerankByLanguage()` to use concept equivalence when deciding cross-language penalties -- if two findings are about the same concept but different languages, reduce the penalty.

**Confidence:** MEDIUM (the mapping itself is straightforward, but the quality depends on curation breadth and the effectiveness of concept-based boosting -- needs empirical validation)

## What NOT to Add

| Tempting Addition | Why Skip It |
|-------------------|-------------|
| `tree-sitter` + individual grammar packages | ast-grep wraps tree-sitter with a better API; adding raw tree-sitter means managing 7+ native packages |
| `node-semver` library | Already have `parseSemver()` in `dep-bump-detector.ts` and `Bun.semver` built-in |
| Knee-detection npm library | None exist in JS/TS ecosystem; algorithm is ~60 lines |
| ML-based cross-language mapper | Over-engineering; static map with 15-20 concepts covers >90% of practical cases |
| Redis/external cache for trend data | SQLite is already the persistence layer; adding Redis for trend caching adds operational complexity |
| Streaming/SSE for checkpoint publishing | GitHub API is REST-only for PR comments; streaming adds no value here |
| `better-sqlite3` | Already using `bun:sqlite` which is native and faster |
| WASM-based parsers (`web-tree-sitter`) | 3-5x slower than native NAPI; Bun supports NAPI natively |

## Installation

```bash
# New dependency
bun add @ast-grep/napi

# No other changes to package.json
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `@ast-grep/napi` NAPI incompatibility with future Bun versions | API usage analysis degrades to grep fallback | LOW | Fail-open pattern (same as sqlite-vec), grep fallback exists |
| Kneedle algorithm edge cases (monotonic data, insufficient data points) | Adaptive thresholds fall back to static defaults | LOW | Require minimum 10 data points, validate knee point is in sensible range |
| Cross-language concept map incompleteness | Some cross-language matches are missed | MEDIUM | Start with 15-20 high-value concepts, expand based on telemetry |
| Checkpoint publishing race condition (timeout fires during publish) | Partial comment posted, then timeout kills process | LOW | Use try/finally to ensure checkpoint completes, add 5s grace period to timeout |
| SQLite schema migration on existing databases | New tables need CREATE IF NOT EXISTS | LOW | Already established pattern in knowledge store (all tables use IF NOT EXISTS) |

## Sources

- [ast-grep JavaScript API](https://ast-grep.github.io/guide/api-usage/js-api.html) -- API documentation for @ast-grep/napi
- [@ast-grep/napi npm](https://www.npmjs.com/package/@ast-grep/napi) -- v0.40.5, published Jan 2026
- [Bun Node-API documentation](https://bun.com/docs/runtime/node-api) -- 95% Node-API compatibility
- [Bun v1.1.34 release notes](https://bun.com/blog/bun-v1.1.34) -- tree-sitter NAPI compatibility fix
- [tree-sitter/node-tree-sitter GitHub issue #4554](https://github.com/oven-sh/bun/issues/4554) -- tree-sitter segfault fix history
- [Kneedle algorithm paper](https://raghavan.usc.edu/papers/kneedle-simplex11.pdf) -- "Finding a Kneedle in a Haystack"
- [Python kneed library](https://github.com/arvkevi/kneed) -- reference implementation for porting
- [SQLite window functions documentation](https://sqlite.org/windowfunctions.html) -- LAG, AVG OVER support
- [tree-sitter npm](https://www.npmjs.com/package/tree-sitter) -- v0.25.0 (considered, not recommended)
- [SAR: Learning Cross-Language API Mappings](https://oro.open.ac.uk/62277/1/Learning_Cross_Language_API_Mappings_with_Little_Knowledge.pdf) -- academic reference for concept equivalence
