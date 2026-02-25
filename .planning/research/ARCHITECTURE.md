# Architecture Patterns

**Domain:** v0.19 -- Intelligent Retrieval Enhancements (language-aware boosting, hunk-level embedding, [depends] PR deep review, CI failure recognition)
**Researched:** 2026-02-25
**Confidence:** HIGH (based on direct codebase analysis of all integration points: retrieval.ts, retrieval-rerank.ts, dep-bump-detector.ts, ci-status-server.ts, review.ts, review-prompt.ts, cross-corpus-rrf.ts, and database migrations)

## Recommended Architecture

v0.19 adds four capabilities to the existing pipeline. Three are modifications to existing components; one ([depends] PR deep review) requires meaningful new logic. No new services, databases, or runtime processes are needed. The core design principle continues: **fail-open enrichment stages that add context without blocking the pipeline.**

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
|  |-  [NEW] detectDependsPrefix() -- extends dep-bump detection for [depends]      |
|  |-  analyzeDiff() + classifyLanguages()                                          |
|                                                                                   |
|  STAGE 3: ENRICHMENT (all fail-open)                                              |
|  |-  fetchSecurityAdvisories() + fetchChangelog()                                 |
|  |-  computeMergeConfidence()                                                     |
|  |-  analyzePackageUsage()                                                        |
|  |-  [NEW] fetchUpstreamChangelog() -- for [depends] non-npm deps (CMake/vcpkg)   |
|  |-  [NEW] analyzeDependencyImpact() -- hash/URL/patch/build verification         |
|                                                                                   |
|  STAGE 4: RETRIEVAL                                                               |
|  |-  buildRetrievalVariants()                                                     |
|  |-  createRetriever().retrieve()                                                 |
|  |     |-  [MODIFIED] rerankByLanguage() -- uses DB language column                |
|  |     |-  [MODIFIED] crossCorpusRRF() -- language-aware weight boost              |
|  |-  [EXPLORATORY] hunk-level snippet embedding                                   |
|                                                                                   |
|  STAGE 5: PROMPT ASSEMBLY                                                         |
|  |-  buildReviewPrompt()                                                          |
|  |     |-  [MODIFIED] buildDepBumpSection() -- [depends] deep review template      |
|  |     |-  [NEW] buildCIFailureAnalysisSection()                                  |
|  |-  [NEW] buildDependsDeepReviewPrompt() -- specialized prompt for [depends] PRs |
|                                                                                   |
|  STAGE 6: EXECUTION                                                               |
|  |-  executor.execute()                                                           |
|  |     |-  [MODIFIED] ci-status-server.ts -- adds failure classification tool      |
|  |-  Post-execution enforcement + publishing                                      |
|  |-  [NEW] CI failure annotation step (post-review)                               |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

## Component Boundaries

### Feature 1: Language-Aware Retrieval Boosting

| Component | Type | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| `007-language-column.sql` (migration) | NEW | Add `language TEXT` column to `learning_memories` table | Database |
| `memory-store.ts` | MODIFIED | Populate language column on write, expose in retrieval results | `learning_memories` table |
| `retrieval-rerank.ts` | MODIFIED | Use DB language column instead of runtime file-path classification | `memory-store.ts` results |
| `cross-corpus-rrf.ts` | MODIFIED | Add optional language-aware weight multiplier to source weights | `retrieval.ts` |
| `retrieval.ts` | MODIFIED | Pass PR languages through to cross-corpus RRF for weighting | `cross-corpus-rrf.ts`, `retrieval-rerank.ts` |

**Data Flow:**

```
1. On memory write: classifyFileLanguage(record.filePath) -> store as `language` column
2. On retrieval: learning_memories query returns language per row
3. rerankByLanguage() uses stored language (no runtime re-classification)
4. Unified pipeline: crossCorpusRRF receives prLanguages, applies boost multiplier
   to chunks where chunk.metadata.language matches PR languages
```

**Key Design Decision:** The existing `rerankByLanguage()` in `retrieval-rerank.ts` already does language-based distance adjustment (0.85x boost / 1.15x penalty) but derives language from `classifyFileLanguage(result.record.filePath)` at query time. Adding a `language` column to `learning_memories` eliminates this runtime derivation and makes language a first-class indexed field -- enabling future SQL-level filtering (WHERE language = 'TypeScript') without embedding recomputation.

The cross-corpus extension is more impactful: currently `SOURCE_WEIGHTS` in `retrieval.ts` only weight by corpus type (code/review/wiki). Adding a language dimension means code chunks in the PR's language(s) get boosted in the unified ranking. This is a multiplicative modifier on the existing RRF score.

**Schema Change:**

```sql
-- Migration 007-language-column.sql
ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS language TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_language ON learning_memories(language);

-- Backfill from file_path (one-time, can run async)
UPDATE learning_memories
SET language = CASE
  WHEN file_path LIKE '%.ts' OR file_path LIKE '%.tsx' THEN 'TypeScript'
  WHEN file_path LIKE '%.py' THEN 'Python'
  WHEN file_path LIKE '%.go' THEN 'Go'
  WHEN file_path LIKE '%.rs' THEN 'Rust'
  WHEN file_path LIKE '%.cpp' OR file_path LIKE '%.cc' THEN 'C++'
  WHEN file_path LIKE '%.c' OR file_path LIKE '%.h' THEN 'C'
  WHEN file_path LIKE '%.java' THEN 'Java'
  ELSE NULL
END
WHERE language IS NULL;
```

### Feature 2: Hunk-Level Code Snippet Embedding (Exploratory)

| Component | Type | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| `hunk-embedder.ts` | NEW | Extract diff hunks, chunk at function/block boundaries, embed | `embeddings.ts`, `memory-store.ts` |
| `007-code-snippets.sql` (or same migration) | NEW | `code_snippets` table for hunk-level embeddings | Database |
| `retrieval.ts` | MODIFIED | Fan-out to code_snippets corpus in parallel search | `hunk-embedder.ts` store |

**Data Flow:**

```
1. During review: diff hunks extracted from PR
2. Each hunk parsed into sub-function chunks (split at function/class/block boundaries)
3. Each chunk embedded via Voyage AI and stored in code_snippets table
4. On subsequent reviews: retrieval fans out to code_snippets alongside existing 3 corpora
5. Results merge via existing crossCorpusRRF (new source type: "code_snippet")
```

**Key Design Decision:** This is exploratory. The current `learning_memories` corpus stores finding-level text (what Kodiai observed about code). Code snippets would store actual code fragments at hunk/function granularity. This is a different semantic space -- findings are opinions about code, snippets are the code itself.

**Recommended approach:** Start with a standalone `code_snippets` table sharing the same schema pattern as `review_comments` (text + embedding + metadata). Add as a 4th corpus in `crossCorpusRRF` with source type `"code_snippet"`. The `SourceType` union in `cross-corpus-rrf.ts` needs extending from `"code" | "review_comment" | "wiki"` to include `"code_snippet"`.

**Defer if:** Embedding costs are a concern. Each PR hunk gets embedded on every review, which multiplies Voyage API calls. Consider caching by file+hunk content hash.

### Feature 3: [depends] PR Deep Review Pipeline

This is the most substantial new capability. The existing dep-bump pipeline handles npm/pip/cargo Dependabot/Renovate PRs. The `[depends]` pattern is Kodi-specific: PRs like `[depends] Bump zlib 1.3.2` or `[Windows] Refresh fstrcmp 0.7` that update C/C++ library dependencies managed via CMake/vcpkg, not package managers.

| Component | Type | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| `dep-bump-detector.ts` | MODIFIED | Detect `[depends]` prefix and platform-specific patterns | `review.ts` |
| `depends-deep-review.ts` | NEW | Orchestrate the deep review pipeline | Multiple enrichment modules |
| `depends-changelog-fetcher.ts` | NEW | Fetch upstream changelog/release notes for C/C++ libs | GitHub API, upstream repos |
| `depends-impact-analyzer.ts` | NEW | Analyze impact on Kodi codebase (consumers, patches, build) | Workspace filesystem |
| `depends-build-verifier.ts` | NEW | Verify hash/URL changes, patch status, build config | Workspace filesystem |
| `review-prompt.ts` | MODIFIED | `buildDependsDeepReviewPrompt()` for structured output | `depends-deep-review.ts` |
| `review.ts` | MODIFIED | Route [depends] PRs through deep review pipeline | `depends-deep-review.ts` |

**Detection Extension:**

```typescript
// In dep-bump-detector.ts -- new detection patterns for Kodi-style deps
const DEPENDS_PREFIX_RE = /^\[depends\]\s+/i;
const PLATFORM_DEP_RE = /^\[(Windows|Linux|macOS|Android|iOS|all)\]\s+(Refresh|Bump|Update)\s+/i;
const KODI_DEP_TITLE_RE = /\b(bump|refresh|update)\s+\S+\s+(?:\d[\d.]*)/i;

export function detectDependsPrefix(params: {
  prTitle: string;
  changedFiles: string[];
}): DependsDetection | null {
  // Signal 1: [depends] prefix
  if (DEPENDS_PREFIX_RE.test(params.prTitle)) return { type: "depends-prefix" };
  // Signal 2: Platform prefix + dependency verb
  if (PLATFORM_DEP_RE.test(params.prTitle)) return { type: "platform-dep" };
  // Signal 3: Changed files in cmake/ or tools/depends/
  if (params.changedFiles.some(f =>
    f.startsWith("cmake/") || f.startsWith("tools/depends/"))) {
    return { type: "build-system-change" };
  }
  return null;
}
```

**Deep Review Pipeline:**

```
detectDependsPrefix() triggers:
  1. Parse dependency name + versions from title/changed files
  2. Parallel enrichment (all fail-open):
     a. Fetch upstream changelog (GitHub releases API, project website)
     b. Scan changed CMake/build files for hash changes
     c. Detect removed/added patches in tools/depends/
     d. Find Kodi source files that #include or link this dependency
     e. Check for transitive dependency additions
  3. Assemble DependsDeepReviewContext
  4. Build specialized prompt with structured sections:
     - Version diff summary
     - Upstream changelog highlights relevant to Kodi
     - Impact assessment (which Kodi files consume this dep)
     - Hash/URL verification status
     - Patch status (removed/added/modified)
     - Build config changes
     - Action items
```

**Integration Point in review.ts:**

```typescript
// After existing depBumpContext detection, add [depends] detection
let dependsContext: DependsDeepReviewContext | null = null;

if (!depBumpContext) {
  // Not a standard Dependabot/Renovate PR; try [depends] detection
  const dependsDetection = detectDependsPrefix({
    prTitle: pr.title,
    changedFiles: allChangedFiles,
  });
  if (dependsDetection) {
    dependsContext = await buildDependsDeepReviewContext({
      prTitle: pr.title,
      prBody: pr.body ?? "",
      changedFiles: allChangedFiles,
      workspaceDir: workspace.dir,
      octokit: idempotencyOctokit,
      owner,
      repo,
      logger,
    });
  }
}
```

**Prompt specialization:** When `dependsContext` is present, inject a specialized deep review prompt section via `buildDependsDeepReviewSection(dependsContext)` in `review-prompt.ts`. This replaces the standard `buildDepBumpSection()` since the review should be MORE thorough, not lighter.

### Feature 4: Unrelated CI Failure Recognition

| Component | Type | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| `ci-failure-analyzer.ts` | NEW | Classify CI failures as related/unrelated to PR scope | GitHub Actions API |
| `ci-status-server.ts` | MODIFIED | Add `classify_ci_failures` tool for structured analysis | `ci-failure-analyzer.ts` |
| `review-prompt.ts` | MODIFIED | Add CI failure context section to prompt | `ci-failure-analyzer.ts` results |
| `review.ts` | MODIFIED | Fetch CI status post-review, annotate if unrelated failures | `ci-failure-analyzer.ts` |

**Data Flow:**

```
1. After Claude execution completes, fetch CI status for the PR head SHA
2. If failures exist:
   a. For each failed workflow run, fetch job details (existing MCP tool)
   b. Extract failed step names and log snippets
   c. Compare failure context against PR changed files/scope:
      - Does the failed job test files this PR touches? -> RELATED
      - Is this a known flaky workflow (gradle parallel, infra timeouts)? -> UNRELATED
      - Does the failure pre-date this PR's commits? -> UNRELATED
   d. Classify each failure as: RELATED | UNRELATED | UNCERTAIN
3. If unrelated failures detected:
   a. Post a comment noting which failures appear unrelated with reasoning
   b. Do NOT block approval verdict on unrelated failures
```

**Classification Heuristics:**

```typescript
export type CIFailureClassification = {
  runId: number;
  workflowName: string;
  conclusion: "related" | "unrelated" | "uncertain";
  reasoning: string;
  failedJobs: Array<{
    jobName: string;
    failedSteps: string[];
  }>;
};

export function classifyCIFailure(params: {
  workflowRun: WorkflowRunSummary;
  failedJobs: JobDetail[];
  changedFiles: string[];
  prLanguages: string[];
}): CIFailureClassification {
  // Heuristic 1: Job name contains platform not in changed files
  //   e.g., "Android Build" but PR only touches Linux CMake -> UNRELATED
  // Heuristic 2: Failed step is a known infra issue
  //   e.g., "gradle" + "parallel" -> UNRELATED (known flaky)
  // Heuristic 3: No changed files overlap with job's test scope
  //   Based on workflow path filters vs. PR changed files
  // Heuristic 4: Same workflow failed on main branch recently -> UNRELATED
  // Default: UNCERTAIN (let Claude's review decide)
}
```

**Post-Review Annotation:**

Rather than injecting CI failure context into the review prompt (which would consume tokens for every review), the CI failure analysis runs as a post-review step. If unrelated failures are detected, a separate comment is posted:

```markdown
### CI Status Note

The following CI failures appear **unrelated** to this PR's changes:

| Workflow | Status | Reasoning |
|----------|--------|-----------|
| Android Build | :red_circle: Failed | Gradle parallel build issue (known flaky) |
| iOS Package | :red_circle: Failed | Pre-existing failure on `main` branch |

These failures should not block merge of this PR.
```

**Alternative considered:** Inject into the review prompt so Claude reasons about CI. Rejected because: (1) CI data is large and token-expensive, (2) Claude is not well-suited to diagnosing build system failures, (3) deterministic heuristics are more reliable for "is this failure related to the PR?" classification.

## Patterns to Follow

### Pattern 1: Fail-Open Enrichment

**What:** Every new enrichment stage wraps in try/catch and returns null on failure. The review pipeline continues without that enrichment.

**When:** All enrichment steps (changelog fetch, impact analysis, CI failure classification).

**Example:**
```typescript
let dependsContext: DependsDeepReviewContext | null = null;
try {
  dependsContext = await buildDependsDeepReviewContext({ ... });
} catch (err) {
  logger.warn({ err, gate: "depends-deep-review" }, "Deep review enrichment failed (fail-open)");
}
```

### Pattern 2: Parallel Promise.allSettled for Independent Enrichments

**What:** Independent enrichment operations run in parallel via `Promise.allSettled`, each fail-open independently.

**When:** Multiple enrichment operations that don't depend on each other.

**Example (already used in review.ts for dep-bump enrichment):**
```typescript
const [changelogResult, impactResult, patchResult] = await Promise.allSettled([
  fetchUpstreamChangelog({ ... }),
  analyzeDependencyImpact({ ... }),
  verifyBuildChanges({ ... }),
]);
```

### Pattern 3: Detection Cascade (Not Parallel)

**What:** Detection stages run sequentially -- first check standard dep-bump, then check [depends] prefix. Only one fires.

**When:** Mutually exclusive detection paths.

**Rationale:** A PR cannot be both a Dependabot PR and a [depends] PR. The detection is cheap (regex), so sequential is fine.

### Pattern 4: Migration + Backfill Pattern

**What:** Schema migrations add nullable columns with indexes. A separate backfill step populates existing rows. Write path immediately populates for new rows.

**When:** Adding language column to learning_memories.

**Example:**
```sql
-- Migration: add column (nullable, no default -- doesn't lock table)
ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS language TEXT;

-- Backfill script (runs separately, can be interrupted/resumed)
UPDATE learning_memories SET language = ... WHERE language IS NULL LIMIT 1000;
```

### Pattern 5: Source Type Extension for Cross-Corpus

**What:** New knowledge sources integrate by: (1) implementing the search interface, (2) adding a source type to `SourceType`, (3) providing a `RankedSourceList` entry in the retrieval pipeline.

**When:** Adding code_snippets as a 4th corpus.

**Example:**
```typescript
// In cross-corpus-rrf.ts
export type SourceType = "code" | "review_comment" | "wiki" | "code_snippet";

// In retrieval.ts, add to parallel fan-out
const snippetVectorResult = deps.codeSnippetStore
  ? searchCodeSnippets({ ... })
  : Promise.resolve([]);
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Token-Heavy CI Context in Review Prompt

**What:** Injecting full CI run logs or detailed job output into the review prompt.

**Why bad:** CI output is verbose (thousands of lines), highly structured (not prose), and poorly suited to LLM analysis. It wastes context window budget and produces unreliable conclusions.

**Instead:** Use deterministic heuristics for CI failure classification. Only inject a brief summary (2-3 lines) if needed for verdict context.

### Anti-Pattern 2: Blocking on Enrichment Failures

**What:** Making the review pipeline fail if changelog fetch or impact analysis throws.

**Why bad:** Network failures, API rate limits, and missing upstream repos are common. A review that takes 30 seconds is better than no review at all.

**Instead:** Every enrichment stage is fail-open. Missing context leads to a less detailed review, not a failed review.

### Anti-Pattern 3: Re-embedding Existing Memories for Language Column

**What:** Updating embeddings when adding the language column to learning_memories.

**Why bad:** Language is metadata about the file path, not about the embedding content. Re-embedding is expensive and unnecessary.

**Instead:** Backfill the language column from file_path using a simple SQL CASE expression.

### Anti-Pattern 4: Coupling [depends] Detection to Existing Dep-Bump Pipeline

**What:** Trying to make `[depends]` PRs flow through the existing Dependabot/Renovate pipeline.

**Why bad:** The existing pipeline assumes npm/pip/cargo ecosystem semantics (semver parsing, package registry lookups, lockfile analysis). Kodi's `[depends]` PRs use CMake, vcpkg, and custom build scripts -- completely different tooling.

**Instead:** Create a separate detection path (`detectDependsPrefix()`) that triggers a distinct enrichment pipeline (`buildDependsDeepReviewContext()`). The two pipelines share the same review handler integration point but are otherwise independent.

## Data Model Changes

### New Tables

```sql
-- code_snippets (exploratory -- only if hunk embedding feature proceeds)
CREATE TABLE IF NOT EXISTS code_snippets (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  repo TEXT NOT NULL,
  owner TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hunk_content TEXT NOT NULL,
  language TEXT,
  chunk_text TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding vector(1024),
  embedding_model TEXT,
  stale BOOLEAN NOT NULL DEFAULT false,
  content_hash TEXT NOT NULL,
  UNIQUE(repo, file_path, content_hash)
);
```

### Schema Modifications

```sql
-- learning_memories: add language column
ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS language TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_language ON learning_memories(language);
```

### No Schema Changes Needed For

- CI failure recognition (ephemeral -- classify at review time, post comment, no persistence)
- [depends] deep review (enrichment context assembled at review time, injected into prompt)

## Scalability Considerations

| Concern | Current State | After v0.19 |
|---------|--------------|-------------|
| Retrieval fan-out latency | 6 parallel searches (3 vector + 3 BM25) | 8 parallel searches if code_snippets added; marginal increase |
| Embedding API calls | 1 per retrieval query | +N per PR if hunk embedding enabled; cache by content_hash mitigates |
| CI API calls | 0 per review | 2-3 per review (list runs + list jobs for failures); within rate limits |
| Database size | ~10K learning_memories, ~50K review_comments | language column: trivial. code_snippets: ~5K rows/month if enabled |
| Prompt token usage | ~4K-8K tokens | [depends] deep review may add ~2K tokens of context; CI annotation is post-review (separate comment) |

## Build Order and Dependencies

```
Phase 1: Language-Aware Boosting (schema + retrieval)
  ├── Migration 007: ADD COLUMN language
  ├── memory-store.ts: populate on write
  ├── Backfill script: populate existing rows
  ├── retrieval-rerank.ts: use stored language
  └── retrieval.ts + cross-corpus-rrf.ts: language weight in unified pipeline

Phase 2: [depends] PR Deep Review
  ├── dep-bump-detector.ts: add detectDependsPrefix()
  ├── depends-changelog-fetcher.ts: upstream changelog for C/C++ deps
  ├── depends-impact-analyzer.ts: Kodi consumer analysis
  ├── depends-build-verifier.ts: hash/URL/patch verification
  ├── depends-deep-review.ts: orchestrator
  ├── review-prompt.ts: buildDependsDeepReviewSection()
  └── review.ts: route [depends] PRs through deep review

Phase 3: CI Failure Recognition
  ├── ci-failure-analyzer.ts: classification heuristics
  ├── ci-status-server.ts: add classify_ci_failures tool (optional)
  ├── review.ts: post-review CI failure annotation step
  └── review-prompt.ts: brief CI status summary (optional)

Phase 4: Code Snippet Embedding (Exploratory)
  ├── Migration: code_snippets table
  ├── hunk-embedder.ts: diff parsing + chunking + embedding
  ├── code-snippet-store.ts: CRUD + search
  ├── cross-corpus-rrf.ts: add "code_snippet" source type
  └── retrieval.ts: fan-out to code_snippets in parallel search
```

**Phase ordering rationale:**

1. **Language-aware boosting first** because it is the smallest, most self-contained change (one migration, two module modifications). It also validates the schema extension pattern used by Phase 4.

2. **[depends] deep review second** because it is the highest-value feature (from issue #42 description: "not a lighter review -- should be MORE thorough") and has no dependency on other features.

3. **CI failure recognition third** because it is independent of retrieval changes and can be developed in parallel with Phase 2 if capacity allows. It has the simplest codebase footprint (one new module, one handler modification).

4. **Code snippet embedding last** because it is explicitly exploratory, has the highest cost (embedding API calls), and its value is uncertain. It depends on Phase 1's language column pattern being validated first.

## Sources

- Direct codebase analysis of `/home/keith/src/kodiai/src/knowledge/retrieval.ts` (unified retrieval pipeline)
- Direct codebase analysis of `/home/keith/src/kodiai/src/knowledge/retrieval-rerank.ts` (language re-ranking)
- Direct codebase analysis of `/home/keith/src/kodiai/src/knowledge/cross-corpus-rrf.ts` (RRF merging)
- Direct codebase analysis of `/home/keith/src/kodiai/src/lib/dep-bump-detector.ts` (dep-bump detection)
- Direct codebase analysis of `/home/keith/src/kodiai/src/execution/mcp/ci-status-server.ts` (CI status MCP)
- Direct codebase analysis of `/home/keith/src/kodiai/src/handlers/review.ts` (review handler pipeline)
- Direct codebase analysis of `/home/keith/src/kodiai/src/execution/review-prompt.ts` (prompt assembly)
- Direct codebase analysis of `/home/keith/src/kodiai/src/db/migrations/` (all 6 existing migrations)
- Issue #42: v0.19 Intelligent Retrieval Enhancements (feature requirements)
