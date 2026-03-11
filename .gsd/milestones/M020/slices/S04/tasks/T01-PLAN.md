# T01: 100-review-pattern-clustering 01

**Slice:** S04 — **Milestone:** M020

## Description

Implement core HDBSCAN algorithm and define cluster type contracts for the entire phase.

Purpose: Provide the clustering engine and type foundation that all other plans build upon.
Output: Pure HDBSCAN implementation with comprehensive tests, shared type definitions.

## Must-Haves

- [ ] HDBSCAN algorithm correctly discovers density-based clusters from pre-computed distance matrices
- [ ] UMAP reduces 1024-dim embeddings to lower dimensions before clustering
- [ ] Noise points (label -1) are correctly separated from cluster members

## Files

- `src/knowledge/cluster-types.ts`
- `src/knowledge/hdbscan.ts`
- `src/knowledge/hdbscan.test.ts`
