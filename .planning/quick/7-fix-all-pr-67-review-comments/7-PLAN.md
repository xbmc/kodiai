---
phase: quick-7
plan: 01
mode: quick
---

# Quick Task 7: Fix all PR #67 review comments

## Task 1: Fix async telemetry fire-and-forget in webhook-queue-store.ts

**Files:** `src/lifecycle/webhook-queue-store.ts`
**Action:** Replace `void telemetryStore.record(...)` wrapped in try/catch with `.catch()` on the Promise. The try/catch cannot catch async rejections from a non-awaited Promise.
**Verify:** No `void telemetryStore.record` pattern remains; all fire-and-forget calls use `.catch()`
**Done:** Both enqueue and dequeuePending telemetry calls use `.catch()` handler

## Task 2: Fix shutdown-manager.ts issues (closeDb safety + remove unused dep)

**Files:** `src/lifecycle/shutdown-manager.ts`, `src/lifecycle/types.ts`, `src/index.ts`
**Action:**
- Wrap all `closeDb()` calls in try/catch so process.exit always runs
- Remove `webhookQueueStore` from ShutdownManagerDeps interface and destructuring (unused parameter)
- Update call site in index.ts to stop passing webhookQueueStore
**Verify:** closeDb rejection cannot prevent process.exit; no `_webhookQueueStore` in codebase
**Done:** closeDb wrapped in try/catch at all 3 call sites; webhookQueueStore removed from interface

## Task 3: Amortize evictExpired() in in-memory-cache.ts

**Files:** `src/lib/in-memory-cache.ts`
**Action:** Instead of scanning entire Map on every set(), amortize by only running eviction every N sets (e.g., every 16 inserts). Track a counter and only call evictExpired when counter hits threshold.
**Verify:** set() is O(1) amortized instead of O(n) on every call
**Done:** Counter-based amortized eviction implemented

## Task 4: Clean up empty channel entries in slack-events.ts rate limiter

**Files:** `src/routes/slack-events.ts`
**Action:** After filtering old timestamps, delete the channel key from the Map if the timestamps array is empty.
**Verify:** channelEventTimestamps.delete called when array becomes empty
**Done:** Empty channel entries cleaned up to prevent unbounded Map growth

## Task 5: Fix @kodiai regex in safety-rails.ts

**Files:** `src/slack/safety-rails.ts`
**Action:** Change `/\b@kodiai\b/i` to `/(?<![\\w-])@kodiai(?![\\w-])/i` to avoid matching `@kodiai-dev` (since `\b` treats `-` as a word boundary).
**Verify:** Regex no longer matches `@kodiai-dev` but still matches `@kodiai` followed by space/punctuation/end
**Done:** Regex updated with negative lookahead/lookbehind

## Task 6: Align deploy.sh termination grace period

**Files:** `deploy.sh`
**Action:** Change `--termination-grace-period 330` to `630` (SHUTDOWN_GRACE_MS default 300s × 2 extended + 30s buffer = 630s) on both create and update paths.
**Verify:** Termination grace period accommodates extended drain (2x grace + buffer)
**Done:** Both create and update paths use 630

## Task 7: Fix provision-postgres.sh security issues

**Files:** `scripts/provision-postgres.sh`
**Action:**
- Remove `--public-access "0.0.0.0"` — leave it to operator to configure network rules explicitly
- Replace connection string echo with safe output showing only host/db (no password)
**Verify:** No password in stdout; no 0.0.0.0 public access
**Done:** Script no longer leaks credentials or opens DB to internet
