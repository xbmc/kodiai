# Architecture Patterns

**Domain:** v0.10 -- Advanced Dependency Signals, Checkpoint Publishing, Advanced Retrieval
**Researched:** 2026-02-15
**Confidence:** HIGH (based on direct codebase analysis of review.ts, knowledge/store.ts, learning/, execution/executor.ts, and all supporting modules)

## Recommended Architecture

v0.10 adds depth to three existing subsystems: dependency analysis, execution resilience, and retrieval intelligence. All nine integration questions resolve to modifications of existing pipeline stages or small new modules that plug into well-defined extension points. No new services, no new databases, no new runtime processes.

The core design principle remains: **fail-open enrichment stages that add context without blocking the pipeline.**

### System Integration Map

```
+-----------------------------------------------------------------------------------+
| Review Pipeline (handleReview in review.ts)                                       |
|                                                                                   |
| [Webhook] -> [Router] -> [Job Queue] -> [handleReview()]                          |
|                                                                                   |
|  STAGE 1: WORKSPACE + CONFIG                                                      |
|  |-  workspaceManager.create()                                                    |
|  |-  loadRepoConfig()                                                             |
|  |-  parsePRIntent()                                                              |
|  |-  resolveAuthorTier()                                                          |
|                                                                                   |
|  STAGE 2: DIFF + DETECTION                                                        |
|  |-  computeIncrementalDiff()                                                     |
|  |-  collectDiffContext()                                                          |
|  |-  detectDepBump() + extractDepBumpDetails() + classifyDepBump()                |
|  |-* analyzeAPIUsage()              [NEW - Q1, needs workspace]                   |
|  |-* correlateMultiPackage()        [NEW - Q3, groups related bumps]              |
|                                                                                   |
|  STAGE 3: ENRICHMENT                                                              |
|  |-  fetchSecurityAdvisories() + fetchChangelog()                                 |
|  |-  computeMergeConfidence()                                                     |
|  |-* recordDepHistory()             [NEW - Q2, persist to knowledge store]        |
|  |-* applyAdaptiveThresholds()      [NEW - Q6, adjusts confidence]               |
|  |-  analyzeDiff()                                                                |
|  |-  computeFileRiskScores() + triageFilesByRisk()                                |
|                                                                                   |
|  STAGE 4: RETRIEVAL                                                               |
|  |-  buildRetrievalQuery() + embeddingProvider.generate()                         |
|  |-  isolationLayer.retrieveWithIsolation()                                       |
|  |-  rerankByLanguage()                                                           |
|  |-* applyRecencyWeight()           [NEW - Q7, at query time]                     |
|  |-* mapCrossLanguageEquivalence()  [NEW - Q9, lookup table]                      |
|                                                                                   |
|  STAGE 5: PROMPT + EXECUTION                                                      |
|  |-  buildReviewPrompt()                                                          |
|  |-  executor.execute()  <-- Claude Code CLI via Agent SDK                        |
|  |-*   checkpoint mid-execution     [NEW - Q4, via MCP tool]                      |
|                                                                                   |
|  STAGE 6: POST-PROCESSING                                                         |
|  |-  extractFindingsFromReviewComments()                                          |
|  |-  applyEnforcement()                                                           |
|  |-  suppression pipeline                                                         |
|  |-  prioritizeFindings()                                                         |
|  |-  removeFilteredInlineComments()                                               |
|  |-  review details publication                                                   |
|  |-  telemetry + knowledge store writes                                           |
|  |-* recordRetrievalTelemetry()     [NEW - Q8, inline collection]                 |
|  |-* timeoutRetry()                 [NEW - Q5, re-enter via queue]                |
+-----------------------------------------------------------------------------------+
```

## Component Boundaries and Integration Answers

### Q1: API Usage Analysis -- After Dep Bump Detection, Before Enrichment

**Where:** Between `classifyDepBump()` and `fetchSecurityAdvisories()` in Stage 2 (approximately line 1430 in review.ts).

**Why this location:**
- API usage analysis needs the cloned workspace (available since Stage 1)
- It needs `depBumpContext.details.packageName` and `depBumpContext.details.ecosystem` (produced by dep bump detection)
- Its output (import counts, usage patterns) feeds into merge confidence scoring and the review prompt
- It does NOT need enrichment results (advisories, changelog), so it can run in parallel with them

**Component:** New `src/lib/dep-bump-usage-analyzer.ts` module.

```typescript
// Integration point in review.ts (conceptual)
if (depBumpContext && depBumpContext.details.packageName && !depBumpContext.details.isGroup) {
  // Run usage analysis in parallel with enrichment
  const [secResult, clogResult, usageResult] = await Promise.allSettled([
    fetchSecurityAdvisories({ ... }),
    fetchChangelog({ ... }),
    analyzeAPIUsage({
      workspaceDir: workspace.dir,
      packageName: depBumpContext.details.packageName,
      ecosystem: depBumpContext.details.ecosystem,
      timeoutMs: 5000,
    }),
  ]);
  depBumpContext.usage = usageResult.status === "fulfilled" ? usageResult.value : null;
}
```

**Why parallel with enrichment:** Both enrichment and usage analysis are independent I/O-bound tasks. Running them in the existing `Promise.allSettled` block adds zero latency. The workspace is alive throughout Stage 2-3 since cleanup happens in the `finally` block.

**Fail-open pattern:** Returns `null` on any error, consistent with `fetchSecurityAdvisories` and `fetchChangelog`.

---

### Q2: Dependency History Persistence -- Extend Knowledge Store, New Table

**Decision:** New `dep_bump_history` table in the EXISTING knowledge store SQLite database. NOT a separate database, NOT extending the `reviews` or `findings` tables.

**Why new table in existing DB:**
- The knowledge store already owns the `repo` partitioning concept
- SQLite WAL mode handles concurrent reads/writes across tables
- The knowledge store's `checkpoint()` and `close()` lifecycle covers all tables
- A separate DB would require separate lifecycle management, connection pooling, and migration logic -- unnecessary complexity
- Extending `reviews` would bloat the generic review table with dep-bump-specific columns (only ~15-20% of reviews are dep bumps)

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS dep_bump_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  review_id INTEGER REFERENCES reviews(id),
  package_name TEXT NOT NULL,
  ecosystem TEXT,
  old_version TEXT,
  new_version TEXT,
  bump_type TEXT,           -- major/minor/patch/unknown
  is_breaking INTEGER DEFAULT 0,
  is_security_bump INTEGER DEFAULT 0,
  merge_confidence TEXT,    -- high/medium/low
  source TEXT,              -- dependabot/renovate/unknown
  usage_import_count INTEGER,
  usage_api_surface TEXT    -- JSON: top API patterns found
);

CREATE INDEX IF NOT EXISTS idx_dep_history_repo_pkg
  ON dep_bump_history(repo, package_name);
CREATE INDEX IF NOT EXISTS idx_dep_history_repo_created
  ON dep_bump_history(repo, created_at);
```

**Write point:** After `knowledgeStore.recordReview()` in post-processing (Stage 6, approximately line 2302 in review.ts). The `reviewId` returned by `recordReview()` links the dep history to the review.

**Interface extension:** Add `recordDepBumpHistory()` and `getDepBumpHistory()` methods to the `KnowledgeStore` type.

---

### Q3: Multi-Package Correlation -- Pre-Processing Step (Before Enrichment)

**Decision:** Pre-processing grouping step that runs AFTER dep bump detection but BEFORE enrichment. NOT post-classification grouping.

**Why pre-processing:**
- Multi-package bumps (Renovate group updates, monorepo dependency sets) need to be identified before enrichment so that the enrichment loop can process each package individually but tag them with a correlation ID
- Post-classification grouping would mean running enrichment without knowing packages are related, then retroactively trying to correlate -- this loses the ability to cross-reference changelog entries or share advisory context
- The existing `isGroup: true` flag from `extractDepBumpDetails()` already detects group bumps but currently skips enrichment entirely. Multi-package correlation allows partial enrichment of group bumps

**Component:** New `src/lib/dep-bump-correlator.ts` module.

```typescript
// Integration concept
if (depBumpContext && depBumpContext.details.isGroup) {
  const correlated = correlateGroupPackages({
    workspaceDir: workspace.dir,
    changedFiles: allChangedFiles,
    ecosystem: depBumpContext.details.ecosystem,
  });
  depBumpContext.correlatedPackages = correlated; // Array of per-package details
}
```

**Why this is practical:** The workspace has the actual lockfile diffs (package-lock.json, yarn.lock, etc.) which contain the individual package changes even in group bumps. Parsing the lockfile diff to extract individual packages is deterministic and fast.

---

### Q4: Checkpoint Publishing -- MCP Tool During Execution

**Decision:** New MCP tool that Claude can invoke during execution to save partial results. NOT file-based checkpointing, NOT streaming interception.

**Why MCP tool:**
- The executor uses the Agent SDK's `query()` which streams messages. We already track `published` via an `onPublish` callback in MCP server setup (line 76 in executor.ts)
- Adding a `checkpoint` MCP tool follows the exact same pattern as `comment-server.ts` and `inline-review-server.ts`
- The executor's `for await (const message of sdkQuery)` loop streams messages -- intercepting partial results there is fragile and couples checkpoint logic to message parsing
- An MCP tool lets Claude explicitly decide when to checkpoint (e.g., "I've reviewed half the files, saving progress")
- The checkpoint data goes to the knowledge store, associated with the `reviewOutputKey`

**Component:** New `src/execution/mcp/checkpoint-server.ts`.

```typescript
// MCP tool signature
{
  name: "save_review_checkpoint",
  description: "Save partial review progress that can be resumed if the session times out",
  inputSchema: {
    type: "object",
    properties: {
      filesReviewed: { type: "array", items: { type: "string" } },
      findingsSoFar: { type: "number" },
      summaryDraft: { type: "string" },
    },
  },
}
```

**Storage:** New `review_checkpoints` table in the knowledge store:

```sql
CREATE TABLE IF NOT EXISTS review_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  review_output_key TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  checkpoint_data TEXT NOT NULL,  -- JSON blob
  UNIQUE(review_output_key)      -- one checkpoint per review attempt
);
```

**Write mechanism:** The MCP tool handler writes directly to the knowledge store. The `knowledgeStore` reference is passed through the MCP server builder, matching the existing pattern where `getOctokit` is injected.

**Read mechanism:** On timeout retry (Q5), the handler reads the checkpoint before building the prompt to know which files were already reviewed.

---

### Q5: Timeout Retry -- Re-Enter Pipeline via Job Queue

**Decision:** Re-enter the pipeline through the job queue. NOT spawn a separate process.

**Why re-enter via queue:**
- The job queue already handles per-installation concurrency (`PQueue({ concurrency: 1 })`). Spawning a separate process would bypass this, potentially running two reviews on the same PR simultaneously
- The retry needs access to all the same context: workspace, config, dep bump context, etc. Re-entering the handler function with retry state is simpler than serializing context to a separate process
- The existing idempotency check (`checkAndClaimRun`) already handles re-runs by checking SHA pairs. A retry needs a distinct run key (e.g., appending `-retry-1`)

**Mechanism:**

```typescript
// In review.ts, after executor.execute() returns
if (result.isTimeout && !result.published) {
  // Full timeout with no output: retry with reduced scope
  const checkpoint = knowledgeStore?.getCheckpoint?.(reviewOutputKey);
  const retryConfig = {
    maxRetries: config.timeout.maxRetries ?? 1,
    currentRetry: (retryCount ?? 0) + 1,
    checkpoint,  // Files already reviewed
    reducedScope: true,  // Force minimal profile
  };

  if (retryConfig.currentRetry <= retryConfig.maxRetries) {
    // Re-enqueue with retry metadata
    await jobQueue.enqueue(event.installationId, async () => {
      await handleReviewRetry(event, retryConfig);
    });
  }
} else if (result.isTimeout && result.published) {
  // Partial timeout: results already published, just log
  // (existing TMO-03 "timeout_partial" telemetry handles this)
}
```

**Why NOT a new job type:** The retry IS a review job -- it uses the same workspace setup, same config, same enrichment pipeline. The only differences are: (1) a checkpoint provides already-reviewed files, (2) the profile is forced to `minimal`, (3) the prompt includes "continue from where you left off" context. These are parameters to the existing flow, not a different flow.

**Retry limit:** Configurable via `.kodiai.yml` (`timeout.maxRetries`, default 1). Prevents infinite retry loops on genuinely large PRs.

---

### Q6: Adaptive Thresholds -- Calibrated Over Time, Applied Per-Query

**Decision:** Calibrated over time using historical dep bump data, applied per-query when computing merge confidence. NOT recomputed from scratch each time.

**Why calibrated + cached:**
- Per-query computation from raw history would require scanning all historical dep bump records on every review -- expensive for repos with hundreds of dep bumps
- The calibration produces a small set of per-repo, per-ecosystem threshold adjustments that change slowly (weekly cadence is fine)
- Applied per-query means the `computeMergeConfidence()` function receives the current thresholds as a parameter, keeping it pure

**Component:** New `src/lib/adaptive-thresholds.ts` module.

```typescript
export type AdaptiveThreshold = {
  repo: string;
  ecosystem: string;
  patchAutoMergeRate: number;    // % of patches that were merged without issues
  minorBreakingRate: number;     // % of minor bumps that had breaking changes
  majorSafeRate: number;         // % of major bumps that were safe
  calibratedAt: string;
};

export function calibrateThresholds(params: {
  depBumpHistory: DepBumpHistoryRecord[];
  minSampleSize: number;  // default 10
}): AdaptiveThreshold;

export function applyAdaptiveThresholds(params: {
  baseConfidence: MergeConfidence;
  thresholds: AdaptiveThreshold | null;
  bumpType: string;
  ecosystem: string;
}): MergeConfidence;
```

**Storage:** Calibrated thresholds stored in a new `adaptive_thresholds` table in the knowledge store. Recalculated when `dep_bump_history` has 10+ new entries since last calibration.

**Integration point:** Between `computeMergeConfidence()` and `buildReviewPrompt()` in the review handler. The merge confidence result is adjusted by the adaptive thresholds before being passed to the prompt builder.

---

### Q7: Recency Weighting -- Applied at Query Time

**Decision:** Applied at query time as a distance multiplier during retrieval reranking. NOT stored as metadata.

**Why query-time:**
- Recency is relative to "now," which changes continuously. Storing a pre-computed recency weight as metadata means it's stale by the next query
- The `learning_memories` table already has `created_at` timestamps. The reranker already adjusts distances via multipliers (see `rerankByLanguage` which applies `sameLanguageBoost: 0.85` and `crossLanguagePenalty: 1.15`)
- Adding recency weighting to the same reranking step is natural: older memories get a distance penalty, newer memories get a boost

**Component:** Extend `src/learning/retrieval-rerank.ts` with recency factor.

```typescript
export type RecencyConfig = {
  halfLifeDays: number;     // default 90 -- memory at 50% weight after 90 days
  minWeight: number;        // default 0.5 -- floor to prevent ancient memories from vanishing
};

// Inside rerankByLanguage (or a new rerankWithRecency wrapper):
const ageInDays = (Date.now() - new Date(result.record.createdAt).getTime()) / 86400000;
const recencyMultiplier = Math.max(
  config.minWeight,
  Math.exp(-0.693 * ageInDays / config.halfLifeDays)  // exponential decay, ln(2) = 0.693
);
const adjustedDistance = result.distance * languageMultiplier / recencyMultiplier;
```

**Why NOT store as metadata:** The `stale` boolean already exists on `LearningMemoryRecord` for model-migration invalidation. Recency is orthogonal -- a fresh memory from a deprecated model is stale but recent. Mixing these concerns in stored metadata creates conflicting signals.

---

### Q8: Retrieval Telemetry -- Inline Collection in Review Pipeline

**Decision:** Inline collection within the review pipeline, writing to the existing telemetry store. NOT a separate collection path.

**Why inline:**
- Retrieval happens once per review, in a specific pipeline stage (Stage 4). There is no parallel or background retrieval that would benefit from a separate collector
- The telemetry store already has fire-and-forget writes (WAL mode, synchronous NORMAL). Adding retrieval metrics to the same write is zero additional I/O
- A separate collection path would need its own store reference, error handling, and lifecycle -- all already present in the review handler

**Component:** Extend `TelemetryRecord` with optional retrieval fields.

```typescript
// Extension to TelemetryRecord in telemetry/types.ts
export type TelemetryRecord = {
  // ... existing fields ...
  retrievalQueryMs?: number;        // Time to generate embedding + query
  retrievalCandidates?: number;     // Total candidates before reranking
  retrievalReturned?: number;       // Results after reranking + threshold
  retrievalAvgDistance?: number;     // Average distance of returned results
  retrievalLanguageMatches?: number; // How many results matched PR language
};
```

**Collection point:** Wrap the retrieval block (approximately lines 1588-1633 in review.ts) with timing:

```typescript
const retrievalStart = Date.now();
// ... existing retrieval logic ...
const retrievalMs = Date.now() - retrievalStart;
// Store metrics for later telemetry write
retrievalTelemetry = {
  retrievalQueryMs: retrievalMs,
  retrievalCandidates: retrieval.provenance.totalCandidates,
  retrievalReturned: reranked.length,
  // etc.
};
```

**Why NOT extend the telemetry table:** The telemetry table uses `ALTER TABLE ADD COLUMN` migration pattern (same as knowledge store). Adding nullable columns for retrieval metrics is backward-compatible and follows existing patterns.

---

### Q9: Cross-Language Equivalence -- Lookup Table

**Decision:** Static lookup table mapping equivalent concepts across languages. NOT embedding space, NOT LLM-based.

**Why lookup table:**
- Cross-language equivalence for dependency analysis is a bounded problem: "express" (npm) has no equivalent in Python, but "lodash" (npm) maps to "underscore" patterns in Python. These mappings are ecosystem-specific and relatively stable
- Embedding space similarity would conflate semantically similar but functionally different packages (e.g., "flask" and "express" are both web frameworks but have completely different APIs and review implications)
- LLM-based mapping would add latency and cost to every dep bump review for a lookup that can be precomputed
- The retrieval reranker already uses a simple mapping (`classifyFileLanguage` in diff-analysis.ts). Extending this pattern to package equivalence is consistent

**Component:** New `src/lib/cross-language-equivalence.ts` module.

```typescript
// Static mapping of equivalent package patterns across ecosystems
const EQUIVALENCE_MAP: Record<string, Record<string, string[]>> = {
  "web-framework": {
    npm: ["express", "fastify", "koa", "hapi"],
    python: ["flask", "django", "fastapi", "starlette"],
    ruby: ["rails", "sinatra"],
    go: ["gin", "echo", "fiber"],
  },
  "orm": {
    npm: ["prisma", "typeorm", "sequelize", "drizzle-orm"],
    python: ["sqlalchemy", "django-orm", "peewee"],
    ruby: ["activerecord"],
    go: ["gorm", "ent"],
  },
  // ... bounded set of ~20-30 categories
};

export function findEquivalentPackages(params: {
  packageName: string;
  sourceEcosystem: string;
  targetEcosystem?: string;
}): { category: string; equivalents: Record<string, string[]> } | null;
```

**Usage:** When building the retrieval query for dep bump PRs, include equivalent package names to find relevant memories from other ecosystems. This feeds into `buildRetrievalQuery()` as additional context.

**Why bounded:** The lookup table covers common categories (web frameworks, ORMs, test frameworks, linters, etc.) and explicitly returns `null` for unknown packages. This is intentional -- for niche packages, cross-language equivalence is meaningless. The table can be extended incrementally.

---

## Data Flow Changes

### New Data Written Per Review

| Data | Destination | When | Fail Behavior |
|------|-------------|------|---------------|
| API usage analysis | `depBumpContext.usage` (in-memory) | Stage 2, parallel with enrichment | `null` (fail-open) |
| Dep bump history | `dep_bump_history` table | Stage 6, after `recordReview()` | Warn + continue |
| Multi-package correlation | `depBumpContext.correlatedPackages` (in-memory) | Stage 2, after detection | `null` (fail-open) |
| Checkpoint | `review_checkpoints` table | Stage 5, during execution (MCP) | Warn + continue |
| Adaptive thresholds | `adaptive_thresholds` table | Lazy recalibration | Use defaults |
| Retrieval telemetry | `executions` table (existing) | Stage 6, with telemetry write | Warn + continue |

### New Data Read Per Review

| Data | Source | When | Fallback |
|------|--------|------|----------|
| Checkpoint (on retry) | `review_checkpoints` table | Stage 1, before prompt build | Full re-review |
| Adaptive thresholds | `adaptive_thresholds` table | Stage 3, after merge confidence | Unadjusted confidence |
| Dep bump history | `dep_bump_history` table | Stage 3, for threshold calibration | No adaptive adjustment |
| Cross-language map | Static in-memory lookup | Stage 4, during query build | No cross-language results |

---

## Patterns to Follow

### Pattern 1: Fail-Open Enrichment Stage
**What:** Every new pipeline stage returns `null` on error and logs a warning. The pipeline continues with degraded context rather than failing the review.
**When:** All nine new integration points follow this pattern.
**Why:** The existing codebase uses this pattern consistently (see `fetchSecurityAdvisories`, `fetchChangelog`, `resolveAuthorTier`, retrieval context). Breaking this pattern for new features would create inconsistent failure modes.

### Pattern 2: Promise.allSettled for Independent I/O
**What:** Group independent async operations in `Promise.allSettled()` blocks.
**When:** API usage analysis runs alongside enrichment (both need workspace + dep bump context, neither needs the other's output).
**Why:** Lines 1439-1456 already use this pattern for security + changelog fetching. Adding usage analysis as a third parallel operation is zero-cost.

### Pattern 3: Knowledge Store Table Extension
**What:** New tables in the existing SQLite database, with `ensureTableColumn` migrations for backward compatibility.
**When:** Dep bump history, checkpoints, adaptive thresholds.
**Why:** The knowledge store already manages 5+ tables with this pattern. `CREATE TABLE IF NOT EXISTS` + `ensureTableColumn()` handles schema evolution without formal migrations.

### Pattern 4: MCP Tool for Execution-Time Communication
**What:** New MCP tools registered with the executor to enable Claude to save state during execution.
**When:** Checkpoint publishing.
**Why:** MCP servers are the only sanctioned way to extend Claude's capabilities during execution. The pattern is established by `comment-server.ts`, `inline-review-server.ts`, and `review-comment-thread-server.ts`.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Separate Process for Retry
**What:** Spawning a new Node/Bun process for timeout retry.
**Why bad:** Bypasses per-installation concurrency control (PQueue), loses injected dependencies, requires serialization of workspace/config state.
**Instead:** Re-enqueue through the existing job queue with retry metadata.

### Anti-Pattern 2: Stored Recency Weights
**What:** Pre-computing and storing recency scores on learning memory records.
**Why bad:** Recency is relative to "now" -- stored scores are stale immediately. Would require periodic batch updates or accept inaccurate weights.
**Instead:** Compute recency multiplier at query time from the existing `created_at` timestamp.

### Anti-Pattern 3: LLM-Based Cross-Language Mapping
**What:** Using Claude to map package equivalences at review time.
**Why bad:** Adds 1-3 seconds latency and API cost per dep bump review for a lookup that can be precomputed. The mapping domain is bounded (common package categories) not open-ended.
**Instead:** Static lookup table, extended incrementally as needed.

### Anti-Pattern 4: New SQLite Database for Dep History
**What:** Creating a separate SQLite file for dependency bump data.
**Why bad:** Requires separate lifecycle management (open/close/checkpoint), separate connection handling, separate backup strategy. The knowledge store already manages partitioned data across tables.
**Instead:** New table in the existing knowledge store database.

---

## Suggested Build Order

The nine features have these dependency relationships:

```
INDEPENDENT:
  Q9 (cross-language lookup) -- no deps, pure utility module
  Q8 (retrieval telemetry)   -- extends existing types, no new tables

Q2 DEPENDS ON: nothing (new table + write logic)
Q1 DEPENDS ON: nothing (new module + parallel integration)
Q3 DEPENDS ON: Q1 loosely (uses same workspace analysis patterns)

Q6 DEPENDS ON: Q2 (reads dep_bump_history for calibration)
Q7 DEPENDS ON: nothing (extends reranker)

Q4 DEPENDS ON: nothing (new MCP tool + checkpoint table)
Q5 DEPENDS ON: Q4 (reads checkpoints for retry context)
```

**Recommended phase ordering:**

1. **Foundation layer** (Q2, Q8, Q9) -- New tables, type extensions, utility modules. No pipeline changes.
2. **Analysis layer** (Q1, Q3, Q7) -- New analysis modules that plug into existing pipeline stages.
3. **Intelligence layer** (Q6) -- Adaptive thresholds that consume dep history from Phase 1.
4. **Resilience layer** (Q4, Q5) -- Checkpoint MCP tool and retry logic. These are the most complex integration points and benefit from all other features being stable.

---

## Scalability Considerations

| Concern | At 100 reviews/day | At 1K reviews/day | At 10K reviews/day |
|---------|--------------------|--------------------|---------------------|
| dep_bump_history table size | ~500 rows/month | ~5K rows/month | ~50K rows/month, add retention purge |
| Checkpoint writes during execution | Negligible (1-2 per review) | Negligible | Add bulk insert |
| Adaptive threshold recalibration | On every dep bump review | Every 10th dep bump | Background job with caching |
| Cross-language lookup | In-memory, instant | In-memory, instant | In-memory, instant |
| Retrieval with recency weighting | +1ms per result | +1ms per result | Consider pre-filtering by date |

All scalability concerns are manageable at projected usage levels. The `dep_bump_history` table is the only one that grows unboundedly and should get the same `purgeOlderThan(days)` pattern used by the telemetry store.

## Sources

- Direct codebase analysis: `src/handlers/review.ts` (2500+ lines, complete pipeline)
- Direct codebase analysis: `src/knowledge/store.ts` and `src/knowledge/types.ts`
- Direct codebase analysis: `src/learning/memory-store.ts`, `src/learning/retrieval-query.ts`, `src/learning/retrieval-rerank.ts`
- Direct codebase analysis: `src/execution/executor.ts` and `src/execution/mcp/` directory
- Direct codebase analysis: `src/lib/dep-bump-detector.ts`, `src/lib/dep-bump-enrichment.ts`, `src/lib/merge-confidence.ts`
- Direct codebase analysis: `src/jobs/queue.ts` (PQueue per-installation concurrency model)
- Direct codebase analysis: `src/telemetry/store.ts` and `src/telemetry/types.ts`
- Confidence: HIGH -- all recommendations based on actual code patterns observed in the codebase, not training data assumptions
