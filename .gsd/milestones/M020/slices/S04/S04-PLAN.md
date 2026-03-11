# S04: Review Pattern Clustering

**Goal:** Implement core HDBSCAN algorithm and define cluster type contracts for the entire phase.
**Demo:** Implement core HDBSCAN algorithm and define cluster type contracts for the entire phase.

## Must-Haves


## Tasks

- [x] **T01: 100-review-pattern-clustering 01**
  - Implement core HDBSCAN algorithm and define cluster type contracts for the entire phase.

Purpose: Provide the clustering engine and type foundation that all other plans build upon.
Output: Pure HDBSCAN implementation with comprehensive tests, shared type definitions.
- [x] **T02: 100-review-pattern-clustering 02**
  - Create database schema and store implementation for cluster persistence.

Purpose: Provide durable storage for clusters, assignments, labels, and pipeline run state.
Output: Migration SQL, store factory, comprehensive tests.
- [x] **T03: 100-review-pattern-clustering 03**
  - Implement the full clustering pipeline: fetch embeddings, UMAP reduce, HDBSCAN cluster, LLM label, persist.

Purpose: Core engine that discovers and labels review patterns from historical comments.
Output: Pipeline module with comprehensive TDD tests.
- [x] **T04: 100-review-pattern-clustering 04**
  - Implement pattern matching that identifies which active clusters are relevant to a given PR diff.

Purpose: Bridge between clustering pipeline and review prompt injection — finds the right patterns for each PR.
Output: Matcher module with TDD tests covering dual-signal scoring and threshold filtering.
- [x] **T05: 100-review-pattern-clustering 05**
  - Wire cluster scheduler, pattern injection into reviews, and index.ts integration.

Purpose: Complete the end-to-end flow — clusters discovered on schedule, patterns surfaced in reviews, on-demand trigger available.
Output: Scheduler, review prompt injection, full application wiring.

## Files Likely Touched

- `src/knowledge/cluster-types.ts`
- `src/knowledge/hdbscan.ts`
- `src/knowledge/hdbscan.test.ts`
- `src/db/migrations/013-review-clusters.sql`
- `src/knowledge/cluster-store.ts`
- `src/knowledge/cluster-store.test.ts`
- `src/knowledge/cluster-pipeline.ts`
- `src/knowledge/cluster-pipeline.test.ts`
- `src/knowledge/cluster-matcher.ts`
- `src/knowledge/cluster-matcher.test.ts`
- `src/knowledge/cluster-scheduler.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/index.ts`
