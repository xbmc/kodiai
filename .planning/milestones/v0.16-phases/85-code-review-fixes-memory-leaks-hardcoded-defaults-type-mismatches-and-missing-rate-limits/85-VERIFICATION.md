---
phase: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits
verified: 2026-02-19T00:00:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 85: Code Review Fixes Verification Report

**Phase Goal:** Eliminate memory leak vectors, fix hardcoded defaults, improve type safety, and add operational guardrails identified by code review
**Verified:** 2026-02-19T00:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                       | Status     | Evidence                                                                                              |
|----|----------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------|
| 1  | All in-memory stores have bounded size and cannot grow without limit                        | VERIFIED   | All 4 stores use `createInMemoryCache` with explicit `maxSize`; no unbounded `new Map`/`new Set` remain |
| 2  | Expired entries are automatically evicted on access, not requiring manual pruning           | VERIFIED   | `InMemoryCache.get()`, `has()`, `set()` all lazily delete expired entries on access                   |
| 3  | ThreadSessionStore, WriteConfirmationStore, Deduplicator, and Slack installation cache use the shared InMemoryCache | VERIFIED | Each file imports `createInMemoryCache` at line 1 and constructs cache with explicit bounds             |
| 4  | Existing tests continue to pass after migration                                             | VERIFIED   | `bun test` passes 1112 tests, 0 failures                                                              |
| 5  | Slack repo context default is loaded from config, not hardcoded                             | VERIFIED   | `DEFAULT_REPO` constant removed; `resolveSlackRepoContext` accepts `defaultRepo: string` parameter    |
| 6  | Tooling detection uses structured logger instead of console.warn                            | VERIFIED   | No `console.warn` in `tooling-detection.ts`; uses `logger?.warn({ err: error }, "...")` pattern      |
| 7  | Dep-bump-enrichment has typed Octokit calls instead of any casts                           | VERIFIED   | Local types `GitHubAdvisoryResponse`, `GitHubReleaseResponse`, `GitHubContentResponse` defined; no `as any` in data processing |
| 8  | Telemetry purge uses DELETE with COUNT instead of RETURNING                                 | VERIFIED   | `purgeOlderThan` uses `db.run(DELETE ...)` + `SELECT changes() as cnt`; no `RETURNING` clause        |
| 9  | Slack client has configurable request timeout                                               | VERIFIED   | `timeoutMs?: number` in `CreateSlackClientInput`, defaults to `10_000`; all 4 `fetchImpl` calls have `signal: AbortSignal.timeout(timeoutMs)` |
| 10 | Slack event processing has basic rate limiting                                              | VERIFIED   | Per-channel sliding window rate limiter (30 events / 60s) at lines 26-54 of `slack-events.ts`, applied after signature verification at line 126 |

**Score:** 10/10 truths verified

---

### Required Artifacts

**Plan 01**

| Artifact                               | Expected                                          | Status     | Details                                                               |
|----------------------------------------|---------------------------------------------------|------------|-----------------------------------------------------------------------|
| `src/lib/in-memory-cache.ts`           | Generic InMemoryCache<K,V> with TTL and maxSize   | VERIFIED   | 105-line full implementation; exports `createInMemoryCache` and interfaces |
| `src/lib/in-memory-cache.test.ts`      | Tests for TTL, maxSize, expiry, clear, size       | VERIFIED   | 155-line test file; 8 tests covering all behaviors                    |
| `src/slack/thread-session-store.ts`    | Bounded store using InMemoryCache                 | VERIFIED   | Imports `createInMemoryCache`; `maxSize: 10_000`, `ttlMs: 24h`        |
| `src/slack/write-confirmation-store.ts`| Bounded store using InMemoryCache                 | VERIFIED   | Imports `createInMemoryCache`; `maxSize: 1_000`, `ttlMs: 15min`       |
| `src/webhook/dedup.ts`                 | Bounded deduplicator using InMemoryCache          | VERIFIED   | Imports `createInMemoryCache`; `maxSize: 50_000`, `ttlMs: 24h`; no manual cleanup loop |
| `src/index.ts`                         | Slack installation cache uses InMemoryCache       | VERIFIED   | Imports and uses `createInMemoryCache` at line 179; `maxSize: 500`, `ttlMs: 1h` |

**Plan 02**

| Artifact                               | Expected                                          | Status     | Details                                                               |
|----------------------------------------|---------------------------------------------------|------------|-----------------------------------------------------------------------|
| `src/slack/repo-context.ts`            | Config-driven default repo via `defaultRepo` param | VERIFIED  | No `DEFAULT_REPO` constant; accepts `defaultRepo: string` param       |
| `src/config.ts`                        | `slackDefaultRepo` field with env var backing     | VERIFIED   | `slackDefaultRepo: z.string().default("xbmc/xbmc")` at line 11; reads `SLACK_DEFAULT_REPO` env var |
| `src/enforcement/tooling-detection.ts` | Structured logger; no console.warn                | VERIFIED   | `logger?: { warn: ... }` optional param; uses `logger?.warn(...)` on error |
| `src/enforcement/index.ts`             | Passes logger to detectRepoTooling                | VERIFIED   | Calls `detectRepoTooling(params.workspaceDir, params.logger)` at line 77 |
| `src/lib/dep-bump-enrichment.ts`       | Typed GitHub API interfaces; no `as any` in data  | VERIFIED   | Defines `GitHubAdvisoryResponse`, `GitHubReleaseResponse`, `GitHubContentResponse`; cast only once at untyped Octokit boundary |
| `src/telemetry/store.ts`               | Purge uses DELETE + changes() without RETURNING   | VERIFIED   | Three `db.run(DELETE ...)` followed by `SELECT changes() as cnt` each; no RETURNING |
| `src/slack/client.ts`                  | `timeoutMs` option; AbortSignal on all fetches    | VERIFIED   | `timeoutMs?: number` defaults to 10s; lines 51, 82, 107, 137 all have `signal: AbortSignal.timeout(timeoutMs)` |
| `src/routes/slack-events.ts`           | Per-channel rate limiter 30/60s                   | VERIFIED   | `channelEventTimestamps: Map<string, number[]>` with lazy cleanup; applied after verification, before async dispatch |

---

### Key Link Verification

**Plan 01 key links**

| From                                       | To                            | Via                      | Status   | Evidence                                          |
|--------------------------------------------|-------------------------------|--------------------------|----------|---------------------------------------------------|
| `src/slack/thread-session-store.ts`        | `src/lib/in-memory-cache.ts`  | `import createInMemoryCache` | WIRED  | Line 1: `import { createInMemoryCache } from "../lib/in-memory-cache.ts"` |
| `src/slack/write-confirmation-store.ts`    | `src/lib/in-memory-cache.ts`  | `import createInMemoryCache` | WIRED  | Line 1: `import { createInMemoryCache } from "../lib/in-memory-cache.ts"` |
| `src/webhook/dedup.ts`                     | `src/lib/in-memory-cache.ts`  | `import createInMemoryCache` | WIRED  | Line 1: `import { createInMemoryCache } from "../lib/in-memory-cache.ts"` |
| `src/index.ts`                             | `src/lib/in-memory-cache.ts`  | `import createInMemoryCache` | WIRED  | Line 5: `import { createInMemoryCache } from "./lib/in-memory-cache.ts"` |

**Plan 02 key links**

| From                             | To                 | Via                              | Status | Evidence                                                                   |
|----------------------------------|--------------------|----------------------------------|--------|----------------------------------------------------------------------------|
| `src/slack/repo-context.ts`      | `src/config.ts`    | `defaultRepo` config parameter   | WIRED  | `resolveSlackRepoContext(text, defaultRepo)` signature; wired at `src/index.ts:323` passing `config.slackDefaultRepo` |
| `src/enforcement/index.ts`       | `tooling-detection.ts` | `logger` parameter to detectRepoTooling | WIRED | `detectRepoTooling(params.workspaceDir, params.logger)` at line 77 |
| `src/slack/assistant-handler.ts` | `src/config.ts`    | `defaultRepo` in handler deps    | WIRED  | `defaultRepo: string` in deps interface (line 61); `config.slackDefaultRepo` wired at `src/index.ts:323` |

---

### Requirements Coverage

No requirement IDs are declared in either plan's `requirements` field. Both plans state `requirements: []`. No REQUIREMENTS.md entries were found for phase 85 in project requirements file.

---

### Anti-Patterns Found

None. No TODOs, FIXMEs, placeholders, empty implementations, or stub patterns found in any phase-modified file.

---

### Human Verification Required

None required. All behavioral changes are verifiable programmatically:
- Memory bounds are deterministic (maxSize, ttlMs values are constants in code)
- Timeout is configured at construction time (AbortSignal.timeout is present)
- Rate limiter logic is pure in-memory (no external service)
- Tests cover the core behaviors end-to-end

---

### Summary

Phase 85 achieved its goal completely. All 10 observable truths verified:

**Memory leak vectors (Plan 01):**
- `InMemoryCache<K,V>` utility created with TTL expiry and LRU-style maxSize eviction
- All 4 unbounded stores (`ThreadSessionStore`, `WriteConfirmationStore`, `Deduplicator`, Slack installation cache) migrated to use `createInMemoryCache` with explicit `maxSize` and `ttlMs` bounds
- No `new Map` or `new Set` remains in any store implementation

**Hardcoded defaults, type safety, guardrails (Plan 02):**
- Hardcoded `DEFAULT_REPO = "xbmc/xbmc"` removed; configurable via `SLACK_DEFAULT_REPO` env var with same default
- `console.warn` in tooling detection replaced with optional structured `logger.warn`
- GitHub Advisory, Release, and Content API response types defined locally; `as any` removed from data processing paths
- Telemetry `purgeOlderThan` optimized to `DELETE` + `changes()` — no RETURNING clause
- Slack client timeout (10s default) via `AbortSignal.timeout` on all 4 fetch calls
- Per-channel sliding window rate limiter (30 events / 60s) wired into slack events route after signature verification

Full test suite passes: 1112 tests, 0 failures.

---

_Verified: 2026-02-19T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
