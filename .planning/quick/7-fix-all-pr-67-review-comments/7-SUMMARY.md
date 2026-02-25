---
phase: quick-7
plan: 01
subsystem: lifecycle, cache, slack, deploy
tags: [pr-review, fire-and-forget, shutdown, cache, rate-limit, regex, security]
---

# Quick Task 7: Fix all PR #67 review comments

## Changes

1. **webhook-queue-store.ts**: Replaced `void telemetryStore.record()` wrapped in try/catch with `.catch()` handler — try/catch cannot catch async rejections from non-awaited Promises
2. **shutdown-manager.ts**: Wrapped all `closeDb()` calls in try/catch so `process.exit()` always runs even if DB close fails; removed unused `webhookQueueStore` parameter
3. **in-memory-cache.ts**: Amortized `evictExpired()` to run every 16 inserts instead of on every `set()` — O(1) amortized vs O(n) per write
4. **slack-events.ts**: Added stale channel pruning when rate limiter Map exceeds 100 entries — prevents unbounded memory growth
5. **safety-rails.ts**: Changed `\b@kodiai\b` regex to `(?<![\w-])@kodiai(?![\w-])` — prevents false match on `@kodiai-dev`
6. **deploy.sh**: Changed `--termination-grace-period` from 330s to 630s (2x SHUTDOWN_GRACE_MS + buffer) on both create and update paths
7. **provision-postgres.sh**: Changed `--public-access "0.0.0.0"` to `"none"` and removed credential echo from stdout

## Verification

- 1,129 tests pass (0 failures)
- Regex verified: matches `@kodiai`, `@Kodiai`, `hey @kodiai!` but NOT `@kodiai-dev`
