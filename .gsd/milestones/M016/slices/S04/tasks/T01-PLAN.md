# T01: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits 01

**Slice:** S04 — **Milestone:** M016

## Description

Create a shared InMemoryCache utility with configurable TTL and maxSize, then migrate all unbounded in-memory stores to use it. This eliminates 4 memory leak vectors (C-2, C-3, H-1, H-3) in one pattern.

Purpose: Prevent OOM crashes from unbounded Maps/Sets that grow indefinitely in long-running server processes.
Output: `src/lib/in-memory-cache.ts` + migrated stores with bounded memory.

## Must-Haves

- [ ] "All in-memory stores have bounded size and cannot grow without limit"
- [ ] "Expired entries are automatically evicted on access, not requiring manual pruning"
- [ ] "ThreadSessionStore, WriteConfirmationStore, Deduplicator, and Slack installation cache use the shared InMemoryCache"
- [ ] "Existing tests continue to pass after migration"

## Files

- `src/lib/in-memory-cache.ts`
- `src/lib/in-memory-cache.test.ts`
- `src/slack/thread-session-store.ts`
- `src/slack/thread-session-store.test.ts`
- `src/slack/write-confirmation-store.ts`
- `src/slack/write-confirmation-store.test.ts`
- `src/webhook/dedup.ts`
- `src/webhook/dedup.test.ts`
- `src/index.ts`
