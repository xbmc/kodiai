# T02: 100-review-pattern-clustering 02

**Slice:** S04 — **Milestone:** M020

## Description

Create database schema and store implementation for cluster persistence.

Purpose: Provide durable storage for clusters, assignments, labels, and pipeline run state.
Output: Migration SQL, store factory, comprehensive tests.

## Must-Haves

- [ ] Cluster assignments and labels are persisted in PostgreSQL
- [ ] Run state tracks last pipeline execution and status
- [ ] Active clusters can be queried by repo

## Files

- `src/db/migrations/013-review-clusters.sql`
- `src/knowledge/cluster-store.ts`
- `src/knowledge/cluster-store.test.ts`
