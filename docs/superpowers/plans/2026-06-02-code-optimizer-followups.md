# Code Optimizer Followups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved code-optimizer fixes across operational bounds, caches, DB batching, clustering limits, network concurrency, and build/infra hygiene.

**Architecture:** Keep changes split by subsystem so each slice is independently reviewable and testable. Prefer small shared helpers only where multiple hot paths need the same bound, timeout, or concurrency primitive. Avoid broad rewrites of the review handler unless a slice directly touches that code.

**Tech Stack:** Bun 1.3.8, TypeScript ESM, Hono, Octokit, Postgres via `postgres`, Pino, Docker.

---

### Task 1: Operational Bounds And Stuck-Worker Protection

**Files:**
- Modify: `src/auth/github-app.ts`
- Modify: `src/jobs/aca-launcher.ts`
- Modify: `src/knowledge/embeddings.ts`
- Modify: `src/lib/search-cache.ts`
- Modify tests near each module.

- [ ] Add a default Octokit request timeout while preserving explicit overrides.
- [ ] Add per-request timeout helpers to Azure Container Apps/MSI fetch calls.
- [ ] Keep Voyage request timeout active through body parsing and add jittered retry delay.
- [ ] Add `maxSize` and amortized cleanup to `createSearchCache`.
- [ ] Verify targeted tests and `bun run lint`.

### Task 2: Ingress And Slack Identity Cache Bounds

**Files:**
- Modify: `src/routes/webhooks.ts`
- Modify: `src/routes/slack-commands.ts`
- Modify: `src/routes/slack-relay-webhooks.ts`
- Modify: `src/execution/mcp/http-server.ts`
- Modify: `src/handlers/identity-suggest.ts`
- Modify tests near each module.

- [ ] Add cheap pre-body/IP or route limiters for public raw-body routes.
- [ ] Add verified-key/source limiters where the identity is known after auth.
- [ ] Key Slack member cache by workspace/token fingerprint and bound it.
- [ ] Replace process-lifetime identity suggestion set with bounded TTL cache.
- [ ] Verify targeted tests and `bun run lint`.

### Task 3: DB Write And Query Batching

**Files:**
- Modify: `src/review-graph/store.ts`
- Modify: `src/knowledge/wiki-store.ts`
- Modify: `src/knowledge/review-comment-store.ts`
- Modify: `src/knowledge/store.ts`
- Modify: `src/knowledge/cluster-store.ts`
- Modify: `src/knowledge/cluster-matcher.ts`
- Modify: `src/knowledge/cluster-pipeline.ts`
- Modify tests near each module.

- [ ] Bulk insert review graph nodes and edges while preserving stable-key ID mapping.
- [ ] Bulk insert wiki/review-comment chunks with existing conflict semantics.
- [ ] Batch review findings/reactions/suppression writes.
- [ ] Batch cluster assignment/stat lookups.
- [ ] Verify store/cluster/review-graph tests and `bun run lint`.

### Task 4: Clustering Memory Bounds

**Files:**
- Modify: `src/knowledge/cluster-pipeline.ts`
- Modify: `src/knowledge/suggestion-cluster-builder.ts`
- Modify: `src/knowledge/hdbscan.ts` only if needed for guardrails.
- Modify tests near each module.

- [ ] Add explicit candidate caps before UMAP/HDBSCAN.
- [ ] Add logging/summary fields when caps sample or truncate candidates.
- [ ] Ensure HDBSCAN rejects or bypasses inputs above configured hard limits.
- [ ] Verify cluster/suggestion-cluster tests and `bun run lint`.

### Task 5: Network Concurrency And Repeated Fetch Reduction

**Files:**
- Modify: `src/knowledge/wiki-publisher.ts`
- Modify: `src/knowledge/wiki-staleness-detector.ts`
- Modify: `src/handlers/feedback-sync.ts`
- Modify: `src/lib/depends-impact-analyzer.ts`
- Modify: `src/handlers/ci-failure.ts`
- Modify tests near each module.

- [ ] Fetch wiki preview issue comments once per issue and resolve groups locally.
- [ ] Use bounded concurrency for PR file, reaction, CMake content, and base-commit check fetches.
- [ ] Preserve existing permission/rate-limit short-circuits.
- [ ] Verify targeted tests and `bun run lint`.

### Task 6: Build, Dependency, And Low-Risk Data-Structure Cleanup

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `Dockerfile`
- Modify: `Dockerfile.agent`
- Modify: `src/knowledge/cluster-pipeline.ts`
- Create/modify: `src/knowledge/vector-math.ts`
- Modify: small `Map`/`Set` lookup sites from the audit where tests exist.

- [ ] Remove unused `voyageai` dependency.
- [ ] Split `cosineSimilarity` into lightweight `vector-math.ts`; lazy-load `UMAP` in clustering path if straightforward.
- [ ] Pin Docker Bun image and `kodi-addon-checker` version after checking current installed version.
- [ ] Add service image healthcheck if compatible with deploy flow.
- [ ] Convert obvious repeated `.find`/`.includes` hot paths to `Map`/`Set`.
- [ ] Verify targeted tests, install/lockfile consistency, and `bun run lint`.
