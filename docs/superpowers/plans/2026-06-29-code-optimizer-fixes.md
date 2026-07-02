# Code Optimizer Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the high/medium performance issues found by the code optimizer audit without broad rewrites.

**Architecture:** Keep fixes local to existing modules. Use bounded concurrency for I/O paths, explicit projections for database reads, buffered writes for diagnostics, and a conservative dimensionality reduction step before suggestion HDBSCAN.

**Tech Stack:** Bun, TypeScript, PostgreSQL/pgvector, Docker, Azure Container Apps.

---

### Task 1: High-impact knowledge pipeline fixes

**Files:**
- Modify: `src/knowledge/suggestion-cluster-builder.ts`
- Modify: `src/knowledge/suggestion-cluster-builder.test.ts`
- Modify: `src/knowledge/wiki-linkshere-fetcher.ts`
- Modify: `src/knowledge/wiki-linkshere-fetcher.test.ts`
- Modify: `src/knowledge/canonical-code-backfill.ts`
- Modify: `src/knowledge/canonical-code-backfill.test.ts`

- [ ] Add tests for dimension-capped clustering, non-compounding linkshere pacing, and bounded chunk writes.
- [ ] Implement deterministic embedding projection/sampling before HDBSCAN.
- [ ] Replace batch-index sleep with shared request pacing.
- [ ] Add bounded concurrent canonical chunk upserts after per-file deletion.
- [ ] Run changed knowledge tests.

### Task 2: Database projections and sequential async paths

**Files:**
- Modify: `src/knowledge/cluster-store.ts`
- Modify: `src/knowledge/cluster-store.test.ts`
- Modify: `src/knowledge/suggestion-cluster-store.ts`
- Modify: `src/knowledge/suggestion-cluster-store.test.ts`
- Modify: `src/knowledge/code-snippet-store.ts`
- Modify: `src/knowledge/wiki-sync.ts`
- Modify: `src/knowledge/wiki-backfill.ts`

- [ ] Add or update tests that assert metadata paths do not load centroid/vector payloads.
- [ ] Replace `SELECT *` with explicit projections.
- [ ] Add bounded/rate-limited workers for wiki sync/backfill where existing behavior allows fail-open processing.
- [ ] Run changed knowledge tests.

### Task 3: Runtime, deployment, and retry fixes

**Files:**
- Modify: `src/index.ts`
- Modify: `src/lib/depends-bump-enrichment.ts`
- Modify: `src/lib/depends-bump-enrichment.test.ts`
- Modify: `src/execution/agent-entrypoint.ts`
- Modify: `src/execution/agent-entrypoint.test.ts`
- Modify: `Dockerfile`
- Modify: `Dockerfile.agent`
- Modify: `deploy.sh`
- Modify: `.github/workflows/ci.yml`

- [ ] Change runtime import to the narrow contributor store module.
- [ ] Retry transient dependency enrichment fetch failures.
- [ ] Buffer diagnostic log appends.
- [ ] Build container entrypoints before runtime and run compiled JS.
- [ ] Gate multi-replica deployment on durable MCP registry configuration until process-local state is replaced.
- [ ] Persist ESLint cache in CI.
- [ ] Run affected unit tests plus typecheck.

### Task 4: Low-impact cleanup

**Files:**
- Modify: `src/review-graph/query.ts`
- Modify: `src/handlers/review.ts`
- Modify: `src/review-orchestration/review-candidate-approval.ts`
- Modify: `src/review-orchestration/review-candidate-publication-adapter.ts`
- Modify: `src/lib/addon-check-classification.ts`
- Modify: `src/knowledge/generated-rule-proposals.ts`
- Modify: `src/db/migrate.ts`
- Modify: `src/contributor/xbmc-fixture-refresh.ts`
- Modify or delete unused exported helpers after confirming no references.

- [ ] Replace repeated filter counts with single-pass counters.
- [ ] Convert tooling sync filesystem reads to async where local.
- [ ] Remove unused exports only when no tests or callers depend on them.
- [ ] Run targeted tests and lint/typecheck.
