# S04: Code Review Fixes Memory Leaks Hardcoded Defaults Type Mismatches And Missing Rate Limits

**Goal:** Create a shared InMemoryCache utility with configurable TTL and maxSize, then migrate all unbounded in-memory stores to use it.
**Demo:** Create a shared InMemoryCache utility with configurable TTL and maxSize, then migrate all unbounded in-memory stores to use it.

## Must-Haves


## Tasks

- [x] **T01: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits 01** `est:4min`
  - Create a shared InMemoryCache utility with configurable TTL and maxSize, then migrate all unbounded in-memory stores to use it. This eliminates 4 memory leak vectors (C-2, C-3, H-1, H-3) in one pattern.

Purpose: Prevent OOM crashes from unbounded Maps/Sets that grow indefinitely in long-running server processes.
Output: `src/lib/in-memory-cache.ts` + migrated stores with bounded memory.
- [x] **T02: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits 02** `est:6min`
  - Fix critical hardcoded default repo, replace console.warn with structured logging, eliminate unsafe `any` casts, optimize telemetry purge queries, add Slack client timeout, and add basic Slack event rate limiting. Addresses C-1, H-4, H-5, H-8, H-10, M-2.

Purpose: Eliminate production bugs (wrong repo), improve observability (structured logs), strengthen type safety, and add operational guardrails.
Output: 6 files fixed with targeted surgical changes.

## Files Likely Touched

- `src/lib/in-memory-cache.ts`
- `src/lib/in-memory-cache.test.ts`
- `src/slack/thread-session-store.ts`
- `src/slack/thread-session-store.test.ts`
- `src/slack/write-confirmation-store.ts`
- `src/slack/write-confirmation-store.test.ts`
- `src/webhook/dedup.ts`
- `src/webhook/dedup.test.ts`
- `src/index.ts`
- `src/slack/repo-context.ts`
- `src/slack/repo-context.test.ts`
- `src/config.ts`
- `src/enforcement/tooling-detection.ts`
- `src/enforcement/index.ts`
- `src/lib/dep-bump-enrichment.ts`
- `src/telemetry/store.ts`
- `src/slack/client.ts`
- `src/routes/slack-events.ts`
