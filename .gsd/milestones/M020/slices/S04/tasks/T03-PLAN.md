# T03: 100-review-pattern-clustering 03

**Slice:** S04 — **Milestone:** M020

## Description

Implement the full clustering pipeline: fetch embeddings, UMAP reduce, HDBSCAN cluster, LLM label, persist.

Purpose: Core engine that discovers and labels review patterns from historical comments.
Output: Pipeline module with comprehensive TDD tests.

## Must-Haves

- [ ] Pipeline fetches 6-month review comment embeddings, reduces with UMAP, clusters with HDBSCAN
- [ ] Cluster labels auto-generated from 3-5 representative samples via LLM task router
- [ ] Labels only regenerated when cluster membership changes by >20%
- [ ] Incremental merge assigns new embeddings to existing clusters before discovering new ones
- [ ] Results persisted to cluster store

## Files

- `src/knowledge/cluster-pipeline.ts`
- `src/knowledge/cluster-pipeline.test.ts`
