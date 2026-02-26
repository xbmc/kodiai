# Phase 100: Review Pattern Clustering - Research

**Researched:** 2026-02-25
**Domain:** HDBSCAN clustering on review comment embeddings, UMAP dimensionality reduction, cluster labeling, pattern injection into PR reviews
**Confidence:** MEDIUM

## Summary

Phase 100 adds review pattern clustering to Kodiai: HDBSCAN clustering over stored review comment embeddings (1024-dim voyage-code-3) discovers emergent review themes, auto-labels them via the LLM task router, and injects relevant patterns as subtle footnotes in PR reviews. The existing `review_comments` table already stores embeddings in pgvector; this phase adds a clustering pipeline that reads those embeddings, reduces dimensionality with UMAP, clusters with HDBSCAN, persists cluster assignments and labels, and matches incoming PR diffs against known clusters.

The TypeScript ecosystem has viable UMAP and HDBSCAN libraries (`umap-js` by Google PAIR, `hdbscanjs`), though both are relatively thin wrappers compared to the Python originals. The STATE.md research flag notes "Python sidecar vs `umap-js` TypeScript-native UMAP needs spike evaluation" — the research here favors TypeScript-native given the project is Bun-only and a Python sidecar adds operational complexity (process management, interprocess communication, separate dependency chain).

**Primary recommendation:** Use `umap-js` for dimensionality reduction and implement HDBSCAN directly from the algorithm (mutual reachability graph + minimum spanning tree + cluster extraction) since existing JS packages are immature. The algorithm is well-documented and the data volumes (hundreds to low thousands of review comments per repo) are manageable in-process.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Patterns appear as inline comments on relevant code lines, not as a summary section
- Format: subtle footnote at the end of a review comment, not a standalone tagged comment
- Proactive surfacing: patterns appear even when the reviewer didn't flag the area, acting as a second pair of eyes
- Max 3 pattern footnotes per PR review to avoid noise — only the most relevant clusters shown
- Two-layer labels: short technical slug for storage/filtering (e.g., `null-check-missing`) + natural language description for display (e.g., "Missing null checks on API response fields")
- LLM sees 3-5 representative samples from the cluster to generate labels
- Labels regenerated only when cluster membership changes significantly (>20% gain/loss), not every refresh cycle
- Labels go live automatically but can be manually overridden/pinned via configuration
- Rolling 6-month window for clustering input — only embeddings from last 6 months processed
- Weekly scheduled job (cron) plus on-demand triggering via CLI/API for testing or after bulk imports
- Incremental merge strategy: new embeddings merged into existing clusters rather than full atomic re-cluster each run
- Matching uses both signals: embedding cosine similarity to PR diff + file path overlap with clustered comments
- Moderate confidence threshold — some false positives acceptable to catch most real patterns
- Recency weighting within the 60-day surfacing window: recent comments weigh more than older ones

### Claude's Discretion
- HDBSCAN min_cluster_size parameter tuning
- Cluster retirement behavior when dropping below 3 members in 60-day window
- UMAP hyperparameters (n_neighbors, min_dist, n_components)
- Exact similarity/confidence threshold values
- Incremental merge algorithm details

### Deferred Ideas (OUT OF SCOPE)
- ECLST-01: Trend detection showing cluster growth/shrinkage over time — future enhancement
- ECLST-02: Cross-repo pattern comparison — future enhancement
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLST-01 | HDBSCAN batch clustering job runs on review comment embeddings to discover emergent review themes without predefined categories | HDBSCAN algorithm implementation with UMAP pre-processing; weekly scheduler pattern from wiki staleness detector |
| CLST-02 | Cluster labels auto-generated from representative samples using cheap LLM via task router | `cluster.label` task type already registered in task-types.ts; generateWithFallback for LLM calls; 3-5 representative samples per cluster |
| CLST-03 | Clusters with 3+ members in the last 60 days surfaced in PR review context as recurring patterns | Pattern matcher comparing PR diff embeddings + file paths against active clusters; footnote injection into review prompt |
| CLST-04 | Cluster assignments and labels persisted in Postgres with scheduled refresh (weekly) | New migration for `review_clusters` and `review_cluster_assignments` tables; scheduler using setInterval pattern |
| CLST-05 | Dimensionality reduction (UMAP or equivalent) applied before clustering to handle 1024-dim embeddings | umap-js library for TypeScript-native UMAP; reduce 1024 -> ~15 dimensions before HDBSCAN |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| umap-js | 1.2.2 | Dimensionality reduction from 1024 to ~15 dims | Google PAIR implementation, TypeScript-native, well-tested API with fit/transform |
| postgres (existing) | 3.4.8 | Persistence layer for clusters, assignments, labels | Already in stack via `src/db/client.ts` |
| voyageai (existing) | 0.1.0 | Embedding generation for PR diff matching | Already in stack via `src/knowledge/embeddings.ts` |
| ai (existing) | 6.0 | LLM calls for cluster label generation | Already in stack via `src/llm/generate.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-queue (existing) | 9.1.0 | Concurrency control for batch embedding lookups | Already in stack |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| umap-js (TypeScript) | Python sidecar with umap-learn | Better perf for >100k points, but adds process management, IPC complexity, separate dependency chain |
| Custom HDBSCAN | hdbscanjs npm package | Package is WIP, limited to KD-tree dense input, 19 commits, no TypeScript types |
| Custom HDBSCAN | hdbscan-ts npm package | Newer but very low usage, unproven at scale |
| UMAP | PCA (simpler) | PCA is linear, loses manifold structure critical for cluster quality on high-dim embeddings |

**Installation:**
```bash
bun add umap-js
```

## Architecture Patterns

### Recommended Project Structure
```
src/knowledge/
├── cluster-types.ts              # Types: ClusterRecord, ClusterAssignment, ClusterLabel
├── cluster-store.ts              # Postgres CRUD for clusters/assignments/labels
├── cluster-store.test.ts         # Store unit tests
├── cluster-pipeline.ts           # UMAP + HDBSCAN pipeline: reduce -> cluster -> label
├── cluster-pipeline.test.ts      # Pipeline unit tests
├── cluster-matcher.ts            # Match PR diff against active clusters
├── cluster-matcher.test.ts       # Matcher unit tests
├── cluster-scheduler.ts          # Weekly setInterval scheduler + on-demand trigger
├── hdbscan.ts                    # Pure HDBSCAN implementation (mutual reachability + MST)
├── hdbscan.test.ts               # HDBSCAN algorithm tests
```

### Pattern 1: Scheduler Pattern (from wiki-staleness-detector.ts)
**What:** Weekly setInterval with startup delay, run-state persistence, stop/start lifecycle
**When to use:** The cluster refresh job follows the exact same pattern as the wiki staleness detector
**Example:**
```typescript
// Follow wiki-staleness-detector.ts scheduler pattern:
const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_STARTUP_DELAY_MS = 120_000; // 2 minutes (stagger after wiki staleness)

export function createClusterScheduler(opts: ClusterSchedulerOptions): ClusterScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      timer = setTimeout(async () => {
        await runClusterPipeline(opts);
        intervalTimer = setInterval(() => runClusterPipeline(opts), DEFAULT_INTERVAL_MS);
      }, DEFAULT_STARTUP_DELAY_MS);
    },
    stop() {
      if (timer) clearTimeout(timer);
      if (intervalTimer) clearInterval(intervalTimer);
    },
    async runNow() { return runClusterPipeline(opts); },
  };
}
```

### Pattern 2: Store Factory Pattern (from review-comment-store.ts)
**What:** `createXxxStore(opts: { sql, logger })` factory returning typed interface
**When to use:** For cluster-store.ts — consistent with every other store in the codebase

### Pattern 3: Review Prompt Injection (from formatReviewPrecedents)
**What:** Function that formats context into prompt section, returns empty string when no data
**When to use:** Pattern footnotes injected via `formatClusterPatterns()` similar to `formatReviewPrecedents()`
**Example:**
```typescript
export function formatClusterPatterns(patterns: ClusterPatternMatch[]): string {
  if (patterns.length === 0) return "";
  const capped = patterns.slice(0, 3); // Max 3 per user decision
  // Format as footnote-style inline annotations
  return capped.map(p =>
    `*(Recurring pattern: ${p.label} — seen ${p.memberCount} times in last 60 days)*`
  ).join("\n");
}
```

### Pattern 4: LLM Label Generation via Task Router
**What:** Use existing `TASK_TYPES.CLUSTER_LABEL` + `generateWithFallback()` for cluster label generation
**When to use:** When generating/regenerating labels from representative samples
**Example:**
```typescript
const resolved = taskRouter.resolve(TASK_TYPES.CLUSTER_LABEL);
const result = await generateWithFallback({
  taskType: TASK_TYPES.CLUSTER_LABEL,
  resolved,
  prompt: `Given these ${samples.length} review comments from the same cluster, generate:
1. A short technical slug (e.g., "null-check-missing")
2. A natural language description (e.g., "Missing null checks on API response fields")

Comments:
${samples.map((s, i) => `${i + 1}. ${s.chunkText}`).join("\n")}`,
  system: "You generate concise labels for clusters of code review comments. Return JSON: { slug: string, description: string }",
  logger,
  repo,
});
```

### Anti-Patterns to Avoid
- **Full re-cluster every run:** The user locked "incremental merge strategy" — always merge new embeddings into existing clusters, don't re-cluster from scratch
- **Summary-style pattern display:** User locked "inline footnote" format — never a standalone summary section
- **Auto-triggering pattern refresh on every PR:** HDBSCAN is expensive; scheduled batch only (weekly + on-demand)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dimensionality reduction | Custom PCA/random projection | umap-js | Manifold-aware reduction preserves cluster structure; PCA loses non-linear relationships |
| Distance matrix computation | Naive O(n^2) pairwise | Batch computation with Float32Arrays | Memory efficiency matters for thousands of 1024-dim vectors |
| JSON parsing from LLM | String splitting/regex | Zod schema validation | Already in stack; LLM output parsing is error-prone |
| Scheduled job orchestration | Custom timer logic | Follow wiki-staleness-detector pattern | Proven pattern with run-state persistence, startup delay, stop lifecycle |

**Key insight:** The HDBSCAN algorithm itself IS worth implementing from scratch because JS ecosystem packages are immature, but the implementation is well-documented (Campello et al. 2013) and the data volumes are small enough that algorithmic efficiency is not critical.

## Common Pitfalls

### Pitfall 1: UMAP Seeding Non-Determinism
**What goes wrong:** umap-js uses random initialization (not spectral), so cluster boundaries shift between runs
**Why it happens:** JS implementation lacks efficient eigenvector computation for spectral initialization
**How to avoid:** Seed the random number generator with a fixed seed for reproducible results; accept minor variation between runs since cluster membership is the output, not exact positions
**Warning signs:** Unit tests failing intermittently due to different cluster assignments

### Pitfall 2: Empty Embedding Columns
**What goes wrong:** Some review_comments rows have NULL embeddings (fail-open VoyageAI policy)
**Why it happens:** Embedding generation is fail-open per project constraint
**How to avoid:** Filter `WHERE embedding IS NOT NULL` when fetching embeddings for clustering; log count of skipped rows
**Warning signs:** NaN values in distance matrix, UMAP crashing on null input

### Pitfall 3: Cluster Label Drift
**What goes wrong:** Labels become stale as cluster membership evolves
**Why it happens:** User decision: "Labels regenerated only when cluster membership changes significantly (>20% gain/loss)"
**How to avoid:** Track cluster member count at label generation time; on each refresh, compare current count vs label-time count; regenerate if |delta/original| > 0.2
**Warning signs:** Labels that describe patterns no longer present in the cluster

### Pitfall 4: Over-matching Patterns to PRs
**What goes wrong:** Every PR gets 3 pattern footnotes regardless of relevance
**Why it happens:** Low confidence threshold + broad cosine similarity matching
**How to avoid:** Require BOTH signals (embedding similarity + file path overlap) as the user decided; set minimum cosine similarity threshold (recommend 0.75); rank by combined score and only surface if above minimum threshold
**Warning signs:** Developers complaining about irrelevant pattern footnotes

### Pitfall 5: Memory Pressure During Clustering
**What goes wrong:** Loading all 6-month embeddings into memory at once crashes the process
**Why it happens:** Each 1024-dim Float32Array is 4KB; 10,000 comments = 40MB; UMAP fitting creates additional matrices
**How to avoid:** Stream embeddings from Postgres in batches; pre-allocate typed arrays; consider per-repo clustering rather than global
**Warning signs:** Out-of-memory errors during weekly clustering job

### Pitfall 6: Incremental Merge Complexity
**What goes wrong:** Incremental merge produces poor cluster quality over time compared to full re-cluster
**Why it happens:** New embeddings are assigned to nearest existing cluster centroid but may actually form a new cluster
**How to avoid:** Hybrid approach: assign new embeddings to nearest cluster if distance < threshold; accumulate unassigned embeddings; when unassigned count exceeds threshold, run full HDBSCAN on unassigned + recent cluster members to discover new clusters. Periodically (monthly?) do a full re-cluster as a quality reset.
**Warning signs:** Growing "noise" set that never gets clustered; stale cluster centroids

## Code Examples

### HDBSCAN Core Algorithm (TypeScript)
```typescript
// Core HDBSCAN steps (simplified):
// 1. Compute mutual reachability distances
// 2. Build minimum spanning tree (Prim's algorithm)
// 3. Build cluster hierarchy (single linkage from MST)
// 4. Extract stable clusters (excess of mass method)

type HdbscanOptions = {
  minClusterSize: number; // Recommend: 3 (matches CLST-03 surfacing threshold)
  minSamples?: number;    // Defaults to minClusterSize
};

type HdbscanResult = {
  labels: number[];       // -1 = noise, 0+ = cluster ID
  probabilities: number[]; // Membership strength 0..1
  clusterCount: number;
};

export function hdbscan(distances: Float64Array[], opts: HdbscanOptions): HdbscanResult {
  // Implementation follows Campello et al. 2013
  // Step 1: mutual reachability graph
  // Step 2: MST via Prim's
  // Step 3: hierarchy extraction
  // Step 4: EOMF cluster extraction with minClusterSize
}
```

### Fetching Embeddings for Clustering
```typescript
// Query review_comments for 6-month window with non-null embeddings
const rows = await sql`
  SELECT id, embedding, file_path, chunk_text, github_created_at, repo
  FROM review_comments
  WHERE repo = ${repo}
    AND deleted = false
    AND stale = false
    AND embedding IS NOT NULL
    AND github_created_at >= NOW() - INTERVAL '6 months'
  ORDER BY github_created_at DESC
`;
```

### Pattern Matching for PR Review
```typescript
// Dual-signal matching: embedding similarity + file path overlap
type ClusterPatternMatch = {
  clusterId: number;
  slug: string;
  label: string;
  memberCount: number;
  similarityScore: number; // cosine similarity to PR diff embedding
  filePathOverlap: number; // fraction of cluster file paths matching PR
  combinedScore: number;
};

function matchPatterns(
  prEmbedding: Float32Array,
  prFilePaths: string[],
  activeClusters: ActiveCluster[],
): ClusterPatternMatch[] {
  // 1. Compute cosine similarity between PR embedding and each cluster centroid
  // 2. Compute file path overlap (Jaccard) between PR files and cluster file paths
  // 3. Combined score = 0.6 * cosineSim + 0.4 * filePathOverlap
  // 4. Filter by minimum threshold, sort descending, take top 3
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| K-means with fixed K | HDBSCAN (density-based, no K needed) | HDBSCAN stable since scikit-learn 1.3 (2023) | Automatically discovers cluster count; handles noise |
| t-SNE for reduction | UMAP for reduction | UMAP widespread since 2018 | Preserves global structure better; has transform() for new data |
| Full re-cluster each run | Incremental merge with periodic full re-cluster | Emerging pattern | Reduces compute cost; user decision for this project |

**Deprecated/outdated:**
- hdbscan Python package: merged into scikit-learn 1.3+; standalone package still works but sklearn is preferred in Python
- t-SNE for pre-clustering reduction: UMAP is strictly better for clustering use cases

## Open Questions

1. **Exact HDBSCAN min_cluster_size value**
   - What we know: User decided 3+ members for surfacing (CLST-03); min_cluster_size=3 aligns
   - What's unclear: Whether 3 is too small for noisy embedding data
   - Recommendation: Start with min_cluster_size=3, tune based on quality of discovered clusters

2. **Cluster centroid representation**
   - What we know: Need a representative vector per cluster for matching against PR diffs
   - What's unclear: Mean embedding vs medoid vs other centroid strategy
   - Recommendation: Use mean of member embeddings as centroid; simple, effective, cheap to compute

3. **Incremental merge threshold for "assign vs accumulate"**
   - What we know: User wants incremental merge, not full re-cluster each run
   - What's unclear: What cosine distance threshold separates "belongs to existing cluster" from "might be new cluster"
   - Recommendation: Use 0.5 cosine distance as threshold; accumulate unassigned; trigger new-cluster discovery when >20 unassigned

4. **UMAP n_components for clustering (not visualization)**
   - What we know: 1024 dims is too high for HDBSCAN; 2-3 dims is for visualization
   - What's unclear: Optimal dimensionality for clustering quality
   - Recommendation: n_components=15, n_neighbors=15, min_dist=0.0 (tighter clusters for HDBSCAN)

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/knowledge/review-comment-store.ts`, `src/knowledge/review-comment-types.ts` — review comment schema and store patterns
- Existing codebase: `src/knowledge/wiki-staleness-detector.ts` — scheduler pattern, run-state persistence
- Existing codebase: `src/llm/task-types.ts` — `CLUSTER_LABEL` task type already registered
- Existing codebase: `src/llm/generate.ts` — `generateWithFallback()` for LLM calls
- Existing codebase: `src/execution/review-prompt.ts` — `formatReviewPrecedents()` for injection pattern
- Existing codebase: `src/db/migrations/005-review-comments.sql` — review_comments schema with pgvector

### Secondary (MEDIUM confidence)
- [umap-js GitHub](https://github.com/PAIR-code/umap-js) — Google PAIR implementation, v1.2.2, TypeScript, Apache-2.0
- [HDBSCAN scikit-learn docs](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html) — reference algorithm documentation
- Campello et al. 2013 — "Density-Based Clustering Based on Hierarchical Density Estimates" — canonical HDBSCAN paper

### Tertiary (LOW confidence)
- [hdbscanjs npm](https://www.npmjs.com/package/hdbscanjs) — JS HDBSCAN, WIP status, limited testing
- [hdbscan-ts npm](https://www.npmjs.com/package/hdbscan-ts) — TypeScript HDBSCAN, very low adoption

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - umap-js is stable but last updated 2019; HDBSCAN will be custom implementation
- Architecture: HIGH - follows existing codebase patterns exactly (store factory, scheduler, prompt injection)
- Pitfalls: HIGH - well-understood from clustering domain knowledge and codebase constraints

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days — stable domain, libraries not fast-moving)
