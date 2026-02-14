# Architecture Patterns

**Domain:** v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval
**Researched:** 2026-02-14
**Confidence:** HIGH (based on direct codebase analysis of all source files + API documentation)

## Recommended Architecture

All three v0.9 features integrate into the existing review pipeline as additional preprocessing, enrichment, and resilience layers. No new services, no new databases, no new processes. The established pattern continues: fail-open enrichments that degrade gracefully.

### System Integration Map

```
+--------------------------------------------------------------------------------+
| Existing Review Pipeline                                                       |
|                                                                                |
| [Webhook] -> [Router] -> [Review Handler] -> [Executor] -> [Post-process]     |
|                               |                                                |
|                               | (v0.9 ENHANCEMENTS)                            |
|                               v                                                |
|  +-------------------------------------------+                                |
|  | Early Pipeline (pre-execution)             |                                |
|  |                                            |                                |
|  | 1. loadRepoConfig()           [existing]   |                                |
|  | 2. parsePRIntent()            [existing]   |                                |
|  | 3. resolveAuthorTier()        [existing]   |                                |
|  | 4. computeIncrementalDiff()   [existing]   |                                |
|  | 5. collectDiffContext()       [existing]   |                                |
|  | 6. analyzeDiff()             [existing]    |                                |
|  | 7. detectDependencyBump()        [NEW]     | <-- Feature 1                  |
|  |    a. classifyBumpType()                   |                                |
|  |    b. fetchChangelogContext()              |                                |
|  |    c. lookupAdvisories()                   |                                |
|  | 8. computeFileRiskScores()    [existing]   |                                |
|  | 9. triageFilesByRisk()        [existing]   |                                |
|  | 10. retrievalWithMultiSignal()   [MOD]     | <-- Feature 3                  |
|  | 11. resolveReviewProfile()    [existing]   |                                |
|  | 12. buildReviewPrompt()       [MODIFIED]   | <-- Features 1, 3              |
|  +-------------------------------------------+                                |
|                                                                                |
|  +-------------------------------------------+                                |
|  | Execution Layer                             |                                |
|  |                                            |                                |
|  | 13. executor.execute()        [MODIFIED]   | <-- Feature 2                  |
|  |     a. Chunked execution for large PRs     |                                |
|  |     b. Partial result capture on timeout   |                                |
|  +-------------------------------------------+                                |
|                                                                                |
|  +-------------------------------------------+                                |
|  | Post-Execution (timeout resilience)         |                                |
|  |                                            |                                |
|  | 14. capturePartialResults()      [NEW]     | <-- Feature 2                  |
|  | 15. extractFindings()         [existing]   |                                |
|  | 16. applyEnforcement()        [existing]   |                                |
|  | 17. formatReviewDetails()     [MODIFIED]   | <-- Features 1, 2              |
|  +-------------------------------------------+                                |
+--------------------------------------------------------------------------------+
```

---

## Feature 1: Dependency Bump Analysis

### Problem

Dependency bump PRs (Dependabot, Renovate, manual updates) modify lock files and manifests but contain no meaningful code diff. The current pipeline treats them identically to code PRs, producing low-value style/correctness findings on generated lock file content while missing what actually matters: breaking changes, CVEs, and changelog context.

### Architecture: Dependency Bump Detector

**Detection strategy:** Pure diff analysis -- no new API calls needed for detection.

A dependency bump PR is identified by analyzing what files changed and what the diff content looks like. The detector runs AFTER `analyzeDiff()` (which already classifies files by category and detects `riskSignals` including "Modifies dependency manifest") but BEFORE prompt building.

```
[analyzeDiff()]
    |
    | Already detects "Modifies dependency manifest" risk signal
    | Already classifies files into categories (config, source, etc.)
    |
    v
[NEW: detectDependencyBump()]
    |
    | Input:
    |   changedFiles: string[]
    |   filesByCategory: Record<string, string[]>
    |   riskSignals: string[]
    |   diffContent: string | undefined
    |   prTitle: string
    |   prBody: string | null
    |
    | Step 1: Is this a dependency bump PR?
    |   - riskSignals includes "Modifies dependency manifest"
    |   - Majority of changed files are manifest/lock files
    |   - OR PR title matches Dependabot/Renovate patterns
    |
    | Step 2: What ecosystem(s)?
    |   - package.json / package-lock.json / yarn.lock / pnpm-lock.yaml => npm
    |   - go.mod / go.sum => go
    |   - Cargo.toml / Cargo.lock => rust (cargo)
    |   - requirements.txt / Pipfile.lock => pip
    |   - Gemfile / Gemfile.lock => rubygems
    |
    | Step 3: Extract version transitions from diff
    |   - Parse old/new versions from manifest diff
    |   - Classify: patch / minor / major using semver
    |
    | Output: DependencyBumpAnalysis | null
    |
    v
[When DependencyBumpAnalysis is non-null:]
    |
    v
[NEW: enrichDependencyContext()]
    |
    | Async enrichments (each fail-open):
    |
    | a. fetchChangelogContext()
    |    - npm: fetch from registry.npmjs.org/<pkg>
    |      The npm registry returns `repository` field with GitHub URL
    |      Fetch CHANGELOG.md / CHANGES.md from GitHub repo via octokit
    |    - go: parse pkg.go.dev or module proxy
    |    - Generic: attempt GitHub releases API from repository URL
    |    - Cap at 2000 chars of changelog per package, 5 packages max
    |
    | b. lookupAdvisories()
    |    - GitHub Advisory Database REST API:
    |      GET /advisories?affects=<pkg>@<old_version>&ecosystem=<eco>
    |    - Filter to advisories fixed between old and new versions
    |    - Extract: GHSA ID, severity, summary, patched_versions
    |    - This API is available without authentication (public data)
    |    - Rate limit: use installation octokit for higher limits
    |
    | c. assessBreakingChange()
    |    - If semver diff is "major": flag as breaking
    |    - If changelog contains "BREAKING" / "breaking change": flag
    |    - If Dependabot/Renovate body contains compatibility score: extract
    |
    | Output: DependencyContext {
    |   packages: Array<{
    |     name: string;
    |     ecosystem: string;
    |     fromVersion: string;
    |     toVersion: string;
    |     semverDiff: "patch" | "minor" | "major";
    |     changelog: string | null;        // truncated
    |     advisories: Advisory[];
    |     isBreaking: boolean;
    |     compatibilityScore: number | null; // from Dependabot
    |   }>;
    |   mergeConfidence: "high" | "medium" | "low";
    | }
```

### Merge Confidence Score

A deterministic merge confidence score based on bump characteristics:

```typescript
function computeMergeConfidence(packages: DependencyPackage[]): "high" | "medium" | "low" {
  // Any unpatched CVE with severity >= high => low confidence
  if (packages.some(p => p.advisories.some(a => a.severity === "critical" || a.severity === "high"))) {
    return "low";
  }

  // Any major version bump => medium confidence (breaking potential)
  if (packages.some(p => p.semverDiff === "major")) {
    return "medium";
  }

  // Any medium-severity advisory => medium confidence
  if (packages.some(p => p.advisories.length > 0)) {
    return "medium";
  }

  // All patch/minor, no advisories => high confidence
  return "high";
}
```

### Prompt Integration

When `DependencyBumpAnalysis` is detected, the review prompt is augmented with a dedicated section:

```
[buildReviewPrompt()]
    |
    | [NEW] buildDependencyBumpSection()
    |   - "This PR bumps N dependencies. Review with dependency-specific focus:"
    |   - Package table: name | from | to | diff type | CVEs | breaking
    |   - Changelog excerpts (if available)
    |   - Advisory details (if any)
    |   - "Focus on: breaking API changes in consuming code, deprecated usage,
    |     security advisories, and lock file consistency."
    |   - "DO NOT review lock file content line-by-line."
    |   - "Merge confidence: HIGH/MEDIUM/LOW based on [reasoning]"
```

### Review Details Integration

The Review Details comment (post-execution deterministic summary) is enhanced:

```
## Dependency Analysis
| Package | From | To | Bump | CVEs | Breaking |
|---------|------|----|------|------|----------|
| lodash  | 4.17.20 | 4.17.21 | patch | 0 | No |
| express | 4.x | 5.0.0 | major | 0 | Yes |

Merge Confidence: MEDIUM (major version bump in express)
```

### Integration with Existing Architecture

| Existing Component | Change | Details |
|-------------------|--------|---------|
| `src/execution/diff-analysis.ts` | NONE | Already detects manifest files in risk signals |
| `src/handlers/review.ts` | INSERT ~40 lines | Wire `detectDependencyBump()` and `enrichDependencyContext()` between diff analysis and prompt building |
| `src/execution/review-prompt.ts` | ADD section builder | `buildDependencyBumpSection()` -- ~80 lines |
| `src/execution/config.ts` | ADD schema | `dependencyAnalysis` config section -- ~20 lines |
| `src/handlers/review.ts` (formatReviewDetailsSummary) | MODIFY | Add dependency table to Review Details -- ~30 lines |

### New Modules

| Module | Location | Type | Lines (est.) |
|--------|----------|------|-------------|
| `dep-bump-detector.ts` | `src/lib/` | Pure function + async enrichment | ~250 |
| `dep-bump-detector.test.ts` | `src/lib/` | Unit tests | ~300 |
| `changelog-fetcher.ts` | `src/lib/` | Async, fail-open HTTP | ~150 |
| `changelog-fetcher.test.ts` | `src/lib/` | Unit tests | ~200 |
| `advisory-lookup.ts` | `src/lib/` | Async, fail-open HTTP | ~120 |
| `advisory-lookup.test.ts` | `src/lib/` | Unit tests | ~150 |

---

## Feature 2: Timeout / Chunked Review Resilience

### Problem

The xbmc repository (and other large C++ projects) has a ~10% review failure rate due to timeouts. Current behavior: the executor's 600-second timeout fires, the AbortController cancels the Claude SDK query, and the review handler posts an error comment ("Kodiai timed out"). Any inline comments Claude already published before the timeout are orphaned -- no summary comment, no Review Details, no knowledge store recording.

### Current Timeout Flow

```
[executor.execute()]
    |
    | AbortController with setTimeout(600s)
    |
    v
[Claude SDK query() -- streaming messages]
    |
    | message.type === "assistant" -> logged
    | message.type === "result" -> captured as resultMessage
    |
    | If timeout fires DURING streaming:
    |   controller.abort() -> SDK throws AbortError
    |   catch block returns { conclusion: "error", isTimeout: true }
    |
    v
[review handler]
    |
    | result.conclusion === "error" && result.isTimeout
    |   -> postOrUpdateErrorComment("timeout")
    |   -> NO finding extraction
    |   -> NO knowledge store recording
    |   -> NO learning memory write
    |   -> Orphaned inline comments remain on PR
```

### Architecture: Timeout Resilience (Three-Layer Approach)

#### Layer 1: Progressive Timeout with Partial Result Capture

**Modify the executor to capture partial results when timeout occurs.**

The key insight: Claude publishes inline review comments via MCP tools DURING execution, not after. By the time a timeout fires at 600s, Claude may have already published 5-7 inline comments via the `mcp__inline_review__submit_inline_comments` tool. Those comments are already on GitHub.

```
[executor.execute()]
    |
    | EXISTING: AbortController with setTimeout(config.timeoutSeconds * 1000)
    |
    | [NEW] Track MCP tool calls during streaming:
    |   - Count published inline comments (onPublish callback already exists)
    |   - Capture publish timestamps
    |
    | If timeout fires:
    |   [EXISTING] controller.abort()
    |   [NEW] Return { conclusion: "timeout_partial", isTimeout: true,
    |                   published: true/false (from onPublish tracking) }
    |
    v
[review handler -- MODIFIED timeout handling]
    |
    | When result.isTimeout === true AND result.published === true:
    |   [NEW] Proceed to finding extraction (extractFindingsFromReviewComments)
    |   [NEW] Apply post-LLM enforcement pipeline as normal
    |   [NEW] Append "partial review" notice to Review Details
    |   [NEW] Record to knowledge store with conclusion: "timeout_partial"
    |   [NEW] Post/update summary note: "This is a partial review (timed out
    |          after Xs). N comments were posted. Re-request review to retry."
    |
    | When result.isTimeout === true AND result.published === false:
    |   [EXISTING] Post error comment as today
```

This is the simplest and highest-impact change. It turns the 10% failure rate into a graceful degradation: partial reviews instead of error comments.

#### Layer 2: Chunked Execution for Large PRs

**For PRs that exceed a configurable threshold, split the review into chunks.**

The existing large PR triage system (`triageFilesByRisk`) already divides files into full/abbreviated/mention-only tiers. Chunked execution extends this by running separate executor passes per chunk when the PR is large enough to risk timeout.

```
[triageFilesByRisk()] -- existing
    |
    | TieredFiles: { full: [], abbreviated: [], mentionOnly: [] }
    |
    v
[NEW: shouldChunkReview()]
    |
    | Decision heuristic (pure function):
    |   totalFiles > chunkThreshold (default: 100)
    |   OR estimatedTokens > tokenBudget (heuristic from lines + files)
    |   AND config.review.chunkedReview.enabled (default: false initially)
    |
    | If NO: proceed with single execution as today
    | If YES:
    |
    v
[NEW: partitionReviewChunks()]
    |
    | Partition full-review files into chunks of ~30 files each
    | Each chunk gets its own executor.execute() call
    | Chunks share the same reviewOutputKey prefix but with chunk suffix
    |
    | Chunk 1: files[0..29]   -> reviewOutputKey + "-chunk-1"
    | Chunk 2: files[30..59]  -> reviewOutputKey + "-chunk-2"
    | ...
    |
    v
[Sequential execution per chunk]
    |
    | For each chunk:
    |   1. Build chunk-specific prompt (subset of files, shared context)
    |   2. Execute with per-chunk timeout (timeoutSeconds / numChunks, min 120s)
    |   3. Capture results (success or partial timeout)
    |   4. If any chunk succeeds, mark overall as partial success
    |
    v
[Merge chunk results]
    |
    | Merge findings from all successful chunks
    | Apply post-LLM pipeline (enforcement, suppression, prioritization)
    | Build unified Review Details with chunk completion status
```

**Important constraint:** Chunks run sequentially (not parallel) because:
1. Per-installation concurrency is already limited by p-queue
2. Each chunk needs the workspace git state
3. Rate limit budget must be shared

#### Layer 3: Adaptive Timeout Based on PR Size

**Scale the timeout based on PR complexity.**

```typescript
function computeAdaptiveTimeout(params: {
  baseTimeout: number;     // config.timeoutSeconds (default 600)
  fileCount: number;
  linesChanged: number;
  isLargePR: boolean;
  isDependencyBump: boolean;
}): number {
  // Dependency bumps: shorter timeout (less review needed)
  if (params.isDependencyBump) {
    return Math.min(params.baseTimeout, 300);
  }

  // Small PRs: keep base timeout
  if (params.fileCount <= 10 && params.linesChanged <= 500) {
    return params.baseTimeout;
  }

  // Large PRs: extend timeout proportionally, cap at 1.5x
  if (params.isLargePR) {
    return Math.min(params.baseTimeout * 1.5, 900);
  }

  return params.baseTimeout;
}
```

### Config Schema Addition

```typescript
const chunkedReviewSchema = z.object({
  enabled: z.boolean().default(false),
  chunkThreshold: z.number().min(50).max(500).default(100),
  maxChunks: z.number().min(2).max(10).default(3),
  minChunkTimeout: z.number().min(60).max(600).default(120),
}).default({
  enabled: false,
  chunkThreshold: 100,
  maxChunks: 3,
  minChunkTimeout: 120,
});
```

### Integration with Existing Architecture

| Existing Component | Change | Details |
|-------------------|--------|---------|
| `src/execution/executor.ts` | MODIFY ~20 lines | Return `published: true` flag on timeout when onPublish was called |
| `src/execution/types.ts` | MODIFY ~5 lines | Add `isTimeoutPartial` to ExecutionResult |
| `src/handlers/review.ts` | MODIFY ~60 lines | Timeout branch: extract findings instead of posting error |
| `src/handlers/review.ts` | ADD ~80 lines | Chunked execution loop (when enabled) |
| `src/handlers/review.ts` (formatReviewDetailsSummary) | MODIFY ~15 lines | Partial review / chunk status in Review Details |
| `src/execution/config.ts` | ADD schema ~15 lines | `chunkedReview` config section |
| `src/lib/errors.ts` | MODIFY ~5 lines | New error category "timeout_partial" |

### New Modules

| Module | Location | Type | Lines (est.) |
|--------|----------|------|-------------|
| `chunk-partitioner.ts` | `src/lib/` | Pure function | ~80 |
| `chunk-partitioner.test.ts` | `src/lib/` | Unit tests | ~120 |
| `adaptive-timeout.ts` | `src/lib/` | Pure function | ~40 |
| `adaptive-timeout.test.ts` | `src/lib/` | Unit tests | ~60 |

---

## Feature 3: Intelligent Retrieval Improvements

### Problem

Current retrieval query construction is naive: `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}`. This single-signal approach misses several dimensions that would improve retrieval relevance:

1. **File path context** -- similar findings are more likely on similar file paths
2. **Finding categories** -- past security findings should surface for security-relevant code
3. **Diff content** -- the actual changes matter more than file names
4. **Language awareness** -- Python findings are less relevant for Go code
5. **Static distance threshold** -- 0.3 works for some repos but not others

### Current Retrieval Flow

```
[review handler, lines 1427-1460]
    |
    | queryText = `${pr.title}\n${reviewFiles.slice(0, 20).join("\n")}`
    | embedResult = embeddingProvider.generate(queryText, "query")
    |
    | retrieval = isolationLayer.retrieveWithIsolation({
    |   queryEmbedding: embedResult.embedding,
    |   repo, owner, sharingEnabled,
    |   topK: config.knowledge.retrieval.topK,          // default 5
    |   distanceThreshold: config.knowledge.retrieval.distanceThreshold,  // default 0.3
    | })
    |
    | retrievalCtx = { findings: retrieval.results.map(...) }
    |
    v
[buildReviewPrompt()] -- existing retrievalContext parameter
```

### Architecture: Multi-Signal Query Construction

**Replace the naive query with a multi-signal composite query.**

```
[NEW: buildRetrievalQuery()]
    |
    | Input:
    |   prTitle: string
    |   reviewFiles: string[]
    |   diffAnalysis: DiffAnalysis
    |   riskSignals: string[]
    |   conventionalType: ConventionalCommitType | null
    |   dependencyBumpDetected: boolean
    |
    | Signal 1: PR Intent (title + conventional type)
    |   "fix: null pointer dereference in auth handler"
    |   -> "[fix] [correctness] null pointer dereference auth handler"
    |
    | Signal 2: File Path Context (top-5 risk-scored files)
    |   Filter to source files only (skip lock files, docs, tests)
    |   Include directory structure: "src/auth/jwt-validator.ts"
    |
    | Signal 3: Risk Signal Amplification
    |   If "Modifies authentication/authorization code" in riskSignals:
    |     Append "authentication authorization security"
    |   If "Modifies database schema or migrations" in riskSignals:
    |     Append "database migration schema safety"
    |
    | Signal 4: Language Context
    |   Primary language from diffAnalysis.filesByLanguage
    |   Append language name to bias toward same-language findings
    |
    | Signal 5: Diff Summary (first 500 chars of actual diff)
    |   Extract key identifiers from added lines
    |   Dedupe and include as retrieval signal
    |
    | Output: string (structured query text for embedding)
    |   Format: "[type] [categories] <intent>\n<files>\n<risk context>\n<language>"
```

### Architecture: Adaptive Distance Thresholds

**Replace the static 0.3 threshold with per-repo adaptive thresholds.**

```
[NEW: computeAdaptiveThreshold()]
    |
    | Input:
    |   baseThreshold: number        // config.knowledge.retrieval.distanceThreshold
    |   repoMemoryCount: number      // how many memories exist for this repo
    |   primaryLanguage: string      // from diffAnalysis
    |   isSharedPoolQuery: boolean   // whether querying across repos
    |
    | Adjustments (multiplicative):
    |
    | 1. Repository maturity adjustment
    |    - < 50 memories: threshold * 1.3 (more permissive, less data)
    |    - 50-200 memories: threshold * 1.0 (baseline)
    |    - > 200 memories: threshold * 0.8 (more selective, rich data)
    |
    | 2. Language-specific adjustment
    |    - C/C++: threshold * 0.9 (findings more specific, tighter match needed)
    |    - Python/JS/TS: threshold * 1.0 (baseline)
    |    - Mixed/Unknown: threshold * 1.1 (more permissive)
    |
    | 3. Shared pool penalty
    |    - Same repo: threshold * 1.0
    |    - Shared pool: threshold * 0.85 (cross-repo needs tighter match)
    |
    | Output: number (adjusted distance threshold)
    |
    | Constraints: floor 0.1, ceiling 0.5
```

### Architecture: Language-Aware Retrieval Boosting

**Post-retrieval re-ranking that boosts same-language findings.**

```
[isolationLayer.retrieveWithIsolation()]
    |
    | Returns: RetrievalWithProvenance { results, provenance }
    |
    v
[NEW: boostRetrievalResults()]
    |
    | Input:
    |   results: RetrievalResult[]
    |   primaryLanguage: string
    |   queryCategories: string[]  // from risk signals
    |
    | For each result:
    |   1. Language match boost:
    |      Extract language from result.record.filePath extension
    |      If matches primaryLanguage: distance * 0.85 (boost)
    |
    |   2. Category match boost:
    |      If result.record.category in queryCategories: distance * 0.9
    |
    |   3. Recency boost (if applicable):
    |      More recent findings get slight distance reduction
    |
    | Re-sort by adjusted distance, re-apply topK
    |
    | Output: RetrievalResult[] (re-ranked)
```

### Config Schema Changes

```typescript
const retrievalSchema = z.object({
  enabled: z.boolean().default(true),
  topK: z.number().min(1).max(20).default(5),
  distanceThreshold: z.number().min(0).max(2).default(0.3),
  maxContextChars: z.number().min(0).max(5000).default(2000),
  // NEW: Adaptive threshold configuration
  adaptiveThreshold: z.boolean().default(true),
  // NEW: Language-aware boosting
  languageBoosting: z.boolean().default(true),
}).default({
  enabled: true,
  topK: 5,
  distanceThreshold: 0.3,
  maxContextChars: 2000,
  adaptiveThreshold: true,
  languageBoosting: true,
});
```

### Integration with Existing Architecture

| Existing Component | Change | Details |
|-------------------|--------|---------|
| `src/handlers/review.ts` (retrieval block, lines 1427-1460) | MODIFY ~30 lines | Replace naive query with `buildRetrievalQuery()`, add adaptive threshold + boosting |
| `src/learning/isolation.ts` | NONE | Retrieval interface unchanged; boosting is post-retrieval |
| `src/learning/memory-store.ts` | ADD method ~10 lines | `getMemoryCount(repo: string): number` for adaptive threshold |
| `src/learning/types.ts` | MODIFY ~3 lines | Add `getMemoryCount` to `LearningMemoryStore` interface |
| `src/execution/config.ts` | MODIFY ~5 lines | Add `adaptiveThreshold` and `languageBoosting` to retrieval schema |

### New Modules

| Module | Location | Type | Lines (est.) |
|--------|----------|------|-------------|
| `retrieval-query-builder.ts` | `src/lib/` | Pure function | ~120 |
| `retrieval-query-builder.test.ts` | `src/lib/` | Unit tests | ~200 |
| `adaptive-threshold.ts` | `src/lib/` | Pure function | ~60 |
| `adaptive-threshold.test.ts` | `src/lib/` | Unit tests | ~80 |
| `retrieval-booster.ts` | `src/lib/` | Pure function | ~80 |
| `retrieval-booster.test.ts` | `src/lib/` | Unit tests | ~120 |

---

## Component Boundaries

### New Components

| Component | Responsibility | Type | Communicates With |
|-----------|---------------|------|-------------------|
| `src/lib/dep-bump-detector.ts` | Detect dependency bump PRs from diff data | Pure function | Review handler |
| `src/lib/changelog-fetcher.ts` | Fetch changelog data from npm registry / GitHub | Async, fail-open | Dep bump detector |
| `src/lib/advisory-lookup.ts` | Query GitHub Advisory Database for CVEs | Async, fail-open | Dep bump detector |
| `src/lib/chunk-partitioner.ts` | Partition files into review chunks | Pure function | Review handler |
| `src/lib/adaptive-timeout.ts` | Compute timeout based on PR size | Pure function | Review handler |
| `src/lib/retrieval-query-builder.ts` | Build multi-signal retrieval query | Pure function | Review handler |
| `src/lib/adaptive-threshold.ts` | Compute per-repo distance threshold | Pure function | Review handler |
| `src/lib/retrieval-booster.ts` | Post-retrieval language/category boosting | Pure function | Review handler |

### Modified Components

| Component | Modification | Scope |
|-----------|-------------|-------|
| `src/handlers/review.ts` | Wire all three features into pipeline | Medium (~150 lines) |
| `src/execution/executor.ts` | Track published state on timeout | Small (~20 lines) |
| `src/execution/types.ts` | Add timeout-partial to result type | Tiny (~5 lines) |
| `src/execution/config.ts` | Add config schemas for all three features | Small (~40 lines) |
| `src/execution/review-prompt.ts` | Add dependency bump section builder | Small (~80 lines) |
| `src/learning/memory-store.ts` | Add `getMemoryCount()` method | Tiny (~10 lines) |
| `src/learning/types.ts` | Add method to interface | Tiny (~3 lines) |

---

## Data Flow: Complete Pipeline with v0.9

```
[Webhook arrives]
    |
    v
[Event Router] -> pull_request.opened / synchronize / review_requested
    |
    v
[Review Handler]
    |-- Skip draft, skip [no-review], bot filter
    |-- Job queue enqueue (per-installation concurrency)
    |
    v
[Workspace creation + git clone (depth 50)]
    |
    v
[loadRepoConfig(.kodiai.yml)]
    |
    v
[parsePRIntent(title, body, commits)]  -- keyword parsing
    |-- [no-review] / [wip] / [strict-review] etc.
    |
    v
[resolveAuthorTier()] -- webhook payload + cache
    |
    v
[computeIncrementalDiff()] -- incremental re-review detection
    |
    v
[collectDiffContext()] -- git diff with merge-base recovery
    |-- changedFiles, numstatLines, diffContent
    |
    v
[analyzeDiff()] -- file categories, languages, risk signals
    |
    v
[NEW: detectDependencyBump()]                    <-- v0.9 Feature 1
    |-- Classify: pure dependency bump vs mixed
    |-- Extract: packages, old/new versions
    |
    v
[NEW: enrichDependencyContext()]                 <-- v0.9 Feature 1
    |-- Fetch changelogs (npm registry, GitHub releases)
    |-- Lookup CVEs (GitHub Advisory Database REST API)
    |-- Compute merge confidence score
    |
    v
[computeFileRiskScores() + triageFilesByRisk()]
    |-- Existing large PR triage
    |
    v
[NEW: shouldChunkReview()]                       <-- v0.9 Feature 2
    |-- If no: single execution path (existing)
    |-- If yes: partition into chunks
    |
    v
[NEW: buildRetrievalQuery()]                     <-- v0.9 Feature 3
    |-- Multi-signal composite query
    |-- PR title + top files + risk signals + language
    |
    v
[embeddingProvider.generate(multiSignalQuery)]
    |
    v
[NEW: computeAdaptiveThreshold()]                <-- v0.9 Feature 3
    |-- Per-repo memory count adjustment
    |-- Language-specific adjustment
    |
    v
[isolationLayer.retrieveWithIsolation()]
    |-- Existing repo-scoped + shared pool retrieval
    |
    v
[NEW: boostRetrievalResults()]                   <-- v0.9 Feature 3
    |-- Language match boost
    |-- Category match boost
    |
    v
[resolveReviewProfile()]  -- keyword > auto > manual > config
    |
    v
[buildReviewPrompt()]
    |-- [EXISTING] All review context sections
    |-- [NEW] Dependency bump section (if detected)
    |-- [NEW] Enhanced retrieval context (with provenance detail)
    |
    v
[executor.execute()]                             <-- v0.9 Feature 2
    |-- [MODIFIED] Track MCP publish events during streaming
    |-- [MODIFIED] On timeout: capture partial state
    |
    v
[Post-execution]
    |
    |-- If timeout AND published:                <-- v0.9 Feature 2
    |     [NEW] Extract findings from already-posted comments
    |     [NEW] Apply full post-LLM pipeline
    |     [NEW] Post partial review summary
    |
    |-- If timeout AND NOT published:
    |     [EXISTING] Post error comment
    |
    |-- If success:
    |     [EXISTING] Full post-LLM pipeline
    |
    v
[extractFindingsFromReviewComments()]
    |
    v
[applyEnforcement()] -> [evaluateFeedbackSuppressions()]
    |
    v
[prioritizeFindings()] -> [formatReviewDetailsSummary()]
    |-- [NEW] Dependency analysis table (if dep bump)
    |-- [NEW] Partial review status (if timeout-partial)
    |
    v
[Knowledge store recording]
    |-- [MODIFIED] Record with conclusion: "timeout_partial" when applicable
    |
    v
[Learning memory write (async, fail-open)]
```

---

## Patterns to Follow

### Pattern 1: Pure Function Enrichment (Established, MUST Follow)

All new detection and computation modules are pure functions with typed inputs and outputs.

```typescript
// All new modules follow this pattern:
export function detectDependencyBump(input: BumpDetectionInput): DependencyBumpAnalysis | null;
export function shouldChunkReview(input: ChunkDecisionInput): boolean;
export function buildRetrievalQuery(input: QueryBuildInput): string;
export function computeAdaptiveThreshold(input: ThresholdInput): number;
export function boostRetrievalResults(input: BoostInput): RetrievalResult[];
```

### Pattern 2: Fail-Open Enrichment (Established, MUST Follow)

Every v0.9 feature wraps in try/catch and continues on failure. No v0.9 feature should block a review from completing.

```typescript
let dependencyContext: DependencyContext | null = null;
try {
  const bumpAnalysis = detectDependencyBump({ changedFiles, filesByCategory, riskSignals, diffContent, prTitle, prBody });
  if (bumpAnalysis) {
    dependencyContext = await enrichDependencyContext({
      packages: bumpAnalysis.packages,
      octokit,
      logger,
    });
  }
} catch (err) {
  logger.warn({ ...baseLog, err }, "Dependency bump analysis failed (fail-open, proceeding without dep context)");
}
```

### Pattern 3: Config-Gated with Progressive Defaults

- Dependency bump detection: **enabled by default** (detection only, no API calls)
- Changelog/advisory enrichment: **enabled by default** (fail-open, bounded API calls)
- Chunked review: **disabled by default** (opt-in, changes execution model)
- Timeout partial capture: **enabled by default** (pure improvement, no behavior change for successful reviews)
- Adaptive retrieval threshold: **enabled by default** (transparent improvement)
- Language retrieval boosting: **enabled by default** (transparent improvement)

### Pattern 4: Bounded External API Calls

All new external API calls have hard limits:

```typescript
const CHANGELOG_LIMITS = {
  maxPackages: 5,           // Only fetch changelogs for top-5 packages
  maxCharsPerPackage: 2000, // Truncate changelog excerpts
  timeoutMs: 5000,          // Per-package fetch timeout
  totalTimeoutMs: 15000,    // Total changelog fetch budget
};

const ADVISORY_LIMITS = {
  maxPackages: 10,          // Only lookup advisories for top-10 packages
  timeoutMs: 5000,          // Advisory API timeout
};
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Parsing Lock File Diffs Line-by-Line

**What:** Extracting version bumps by parsing lock file content (package-lock.json, yarn.lock).
**Why bad:** Lock files are enormous, auto-generated, and format varies by tool version. Parsing is fragile and slow.
**Instead:** Extract version transitions from the MANIFEST file diff (package.json, go.mod, Cargo.toml) where entries are human-readable and stable. Use manifest as source of truth; lock file presence only confirms the ecosystem.

### Anti-Pattern 2: Parallel Chunk Execution

**What:** Running multiple review chunks simultaneously for faster large PR review.
**Why bad:** Per-installation concurrency is already limited by p-queue (prevents GitHub API abuse). Multiple concurrent Claude executions would consume rate limits faster, risk timeouts from resource contention, and complicate finding deduplication.
**Instead:** Sequential chunk execution with early termination if timeout pressure increases.

### Anti-Pattern 3: Persisting Retrieval Threshold Calibration

**What:** Storing learned thresholds in SQLite and training them over time.
**Why bad:** Adds schema complexity, migration burden, and cold-start problems for new repos. The adaptive threshold is deterministic from observable signals.
**Instead:** Compute threshold dynamically from memory count + language. Log the computed threshold for monitoring. If a repo consistently gets bad results, the operator adjusts `distanceThreshold` in `.kodiai.yml`.

### Anti-Pattern 4: Breaking the Single-Pass Post-LLM Pipeline

**What:** Adding dependency-specific finding extraction or timeout-specific enforcement logic that branches before the existing post-LLM pipeline.
**Why bad:** The post-LLM pipeline (enforcement -> suppression -> prioritization -> formatting) is the single most complex code path. Branching it creates divergent behavior and doubles the testing surface.
**Instead:** All reviews (normal, dependency bump, timeout-partial, chunked) converge to the same post-LLM pipeline. The only difference is the input: which findings were extracted, and whether a partial review notice is appended.

### Anti-Pattern 5: Modifying the Executor for Chunking

**What:** Adding chunk awareness to `executor.ts` -- passing chunk index, coordinating between chunks inside the executor.
**Why bad:** The executor is correctly generic: it takes a prompt, a workspace, and a timeout, and returns a result. Chunk orchestration is a review handler concern.
**Instead:** The review handler calls `executor.execute()` N times (once per chunk) with different prompts. The executor is unaware of chunking.

---

## Dependency Analysis and Build Order

### Feature Dependencies

```
Timeout Resilience (Feature 2)      -- INDEPENDENT
    |
    | Layer 1 (partial capture) has zero deps
    | Layer 2 (chunking) benefits from partial capture
    | Layer 3 (adaptive timeout) benefits from dep bump detection
    |
Dependency Bump Analysis (Feature 1) -- INDEPENDENT
    |
    | Detection is pure function
    | Enrichment uses existing octokit
    | Prompt section is independent
    |
Intelligent Retrieval (Feature 3)    -- INDEPENDENT
    |
    | Multi-signal query replaces existing query
    | Adaptive threshold is pure computation
    | Boosting is post-retrieval decoration
```

All three features are independent. None requires another to function. The recommended build order considers risk, impact, and complexity.

### Recommended Build Order

1. **Timeout Resilience (Layer 1: Partial Capture) FIRST** -- Highest impact, lowest risk. Turns 10% failure rate into graceful partial reviews. Requires only ~25 lines of executor change and ~60 lines of review handler change. Immediately measurable impact on xbmc and other large repos.

2. **Intelligent Retrieval SECOND** -- Medium complexity, pure functions only, no external API calls. Improves quality for all repos with learning memory. Can be measured by retrieval relevance metrics in telemetry.

3. **Dependency Bump Analysis THIRD** -- Highest complexity (external API calls to npm registry, GitHub Advisory API). Requires careful rate limiting and timeout management. Benefits a specific PR type (dependency bumps) rather than all reviews.

4. **Timeout Resilience (Layer 2: Chunking) FOURTH** -- Depends on Layer 1 being stable. More complex orchestration. Opt-in only (config-gated). Should be implemented after partial capture proves reliable.

5. **Timeout Resilience (Layer 3: Adaptive Timeout) FIFTH** -- Simplest layer but benefits from dependency bump detection being in place (dependency bumps get shorter timeouts). Can be delivered with any other layer.

### Independence Verification

| Feature | Needs Timeout? | Needs Dep Bump? | Needs Retrieval? |
|---------|---------------|-----------------|------------------|
| Timeout Resilience | -- | NO | NO |
| Dep Bump Analysis | NO | -- | NO |
| Intelligent Retrieval | NO | NO | -- |

However, there are beneficial interactions:
- Adaptive timeout (Layer 3) can use dependency bump detection to set shorter timeouts for dep bump PRs
- Retrieval query builder benefits from dependency bump detection (skip retrieval for pure dep bumps)
- Chunked review (Layer 2) benefits from partial capture (Layer 1) for per-chunk timeout handling

---

## Scalability Considerations

| Concern | At 10 repos | At 100 repos | At 1000 repos |
|---------|-------------|--------------|---------------|
| Dep bump detection | Instant (regex + set ops) | Same | Same |
| Changelog fetch | 5-15s per dep bump PR (bounded) | Same per PR | Monitor npm registry rate limits |
| Advisory lookup | 1-3s per dep bump PR (bounded) | Same per PR | Advisory API has generous limits |
| Partial timeout capture | Zero overhead (tracking already exists) | Same | Same |
| Chunked review | N * executor time (sequential) | Same per PR | Monitor per-installation queue depth |
| Multi-signal query | Instant (string concatenation) | Same | Same |
| Adaptive threshold | Instant + 1 SQL COUNT query | Same | Same |
| Retrieval boosting | Instant (array re-sort, topK items) | Same | Same |

The primary scalability concern is changelog fetching for repos with many Dependabot PRs. Mitigation: bounded per-package timeouts and max-5-packages limit. For very active repos, consider caching changelog data in SQLite (future optimization, not v0.9 scope).

---

## Files Changed Summary

### New Files

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/lib/dep-bump-detector.ts` | ~250 | Detect dependency bump PRs, extract version transitions |
| `src/lib/dep-bump-detector.test.ts` | ~300 | Unit tests for detection across ecosystems |
| `src/lib/changelog-fetcher.ts` | ~150 | Fetch changelogs from npm registry / GitHub |
| `src/lib/changelog-fetcher.test.ts` | ~200 | Unit tests with mocked HTTP |
| `src/lib/advisory-lookup.ts` | ~120 | Query GitHub Advisory Database |
| `src/lib/advisory-lookup.test.ts` | ~150 | Unit tests with mocked API |
| `src/lib/chunk-partitioner.ts` | ~80 | Partition files into review chunks |
| `src/lib/chunk-partitioner.test.ts` | ~120 | Unit tests for partitioning logic |
| `src/lib/adaptive-timeout.ts` | ~40 | Compute timeout from PR characteristics |
| `src/lib/adaptive-timeout.test.ts` | ~60 | Unit tests |
| `src/lib/retrieval-query-builder.ts` | ~120 | Multi-signal retrieval query construction |
| `src/lib/retrieval-query-builder.test.ts` | ~200 | Unit tests for query building |
| `src/lib/adaptive-threshold.ts` | ~60 | Per-repo distance threshold computation |
| `src/lib/adaptive-threshold.test.ts` | ~80 | Unit tests |
| `src/lib/retrieval-booster.ts` | ~80 | Post-retrieval language/category boosting |
| `src/lib/retrieval-booster.test.ts` | ~120 | Unit tests |

### Modified Files

| File | Change | Scope |
|------|--------|-------|
| `src/handlers/review.ts` | Wire all three features | Medium (~150 lines) |
| `src/execution/executor.ts` | Track published on timeout | Small (~20 lines) |
| `src/execution/types.ts` | Add timeout-partial result | Tiny (~5 lines) |
| `src/execution/config.ts` | Add 3 config schema sections | Small (~40 lines) |
| `src/execution/review-prompt.ts` | Add dependency bump section | Small (~80 lines) |
| `src/learning/memory-store.ts` | Add getMemoryCount method | Tiny (~10 lines) |
| `src/learning/types.ts` | Add method to interface | Tiny (~3 lines) |

**Total new code: ~1,250 lines implementation + ~1,230 lines tests**
**Total modified code: ~310 lines changes across existing files**

---

## Sources

- Direct codebase analysis (HIGH confidence):
  - `src/handlers/review.ts` (~2340 lines -- full pipeline with line-level annotations)
  - `src/execution/executor.ts` (~256 lines -- timeout handling via AbortController)
  - `src/execution/types.ts` (~63 lines -- ExecutionContext/ExecutionResult types)
  - `src/execution/config.ts` (~674 lines -- Zod config schema with all sections)
  - `src/execution/diff-analysis.ts` (~366 lines -- file classification, risk signals)
  - `src/execution/review-prompt.ts` (~1300 lines -- all prompt section builders)
  - `src/lib/file-risk-scorer.ts` (~317 lines -- risk scoring and large PR triage)
  - `src/lib/auto-profile.ts` (~67 lines -- profile resolution)
  - `src/lib/pr-intent-parser.ts` (~80+ lines -- keyword parsing)
  - `src/lib/errors.ts` (~142 lines -- error classification and formatting)
  - `src/knowledge/store.ts` (~841 lines -- SQLite schema)
  - `src/knowledge/types.ts` (~189 lines -- knowledge store interface)
  - `src/learning/memory-store.ts` (~349 lines -- vec0 virtual table, retrieval)
  - `src/learning/types.ts` (~84 lines -- LearningMemoryStore interface)
  - `src/learning/embedding-provider.ts` (~88 lines -- Voyage AI wrapper)
  - `src/learning/isolation.ts` (~128 lines -- repo-scoped retrieval with provenance)
- [GitHub Advisory Database REST API](https://docs.github.com/en/rest/security-advisories/global-advisories) -- `GET /advisories` with `affects` and `ecosystem` filters (HIGH confidence)
- [npm registry API](https://registry.npmjs.org/) -- package metadata including `repository` field for changelog discovery (HIGH confidence)
- [semver npm package](https://www.npmjs.com/package/semver) -- `diff()` function for version comparison (HIGH confidence)
- `.planning/xbmc_deep_analysis.md` -- 10% timeout failure rate context (HIGH confidence, internal data)

---
*Architecture research for: Kodiai v0.9 -- Dependency Bump Analysis, Timeout Resilience, Intelligent Retrieval*
*Researched: 2026-02-14*
