---
id: T02
parent: S04
milestone: M061
key_files:
  - src/execution/mention-context.ts
  - src/handlers/mention.ts
  - src/execution/mention-context.test.ts
  - src/handlers/mention.test.ts
key_decisions:
  - Used a fingerprint-first, fail-open cache policy: any missing admitted-state signal or cache bookkeeping error bypasses reuse and rebuilds directly instead of risking a stale hit.
  - Recorded mention derived-context reuse truthfully on the handler completion log with explicit `hit`, `miss`, `degraded`, and `bypass` states so later proof/report work can consume the same surface.
duration: 
verification_result: mixed
completed_at: 2026-04-24T02:46:27.506Z
blocker_discovered: false
---

# T02: Added truthful mention derived-context fingerprint caching with hit/miss/degraded coverage.

**Added truthful mention derived-context fingerprint caching with hit/miss/degraded coverage.**

## What Happened

Updated `src/execution/mention-context.ts` to export a stable mention derived-context fingerprint builder that hashes admitted conversation, PR, inline-review, and review-thread state without caching raw GitHub payloads. Wired `src/handlers/mention.ts` to create a fail-open in-memory derived-context cache keyed by that fingerprint, record truthful `hit` / `miss` / `degraded` / `bypass` status on the existing mention completion log surface, and fall back to direct rebuild whenever fingerprint inputs are incomplete or cache bookkeeping throws. Extended `src/execution/mention-context.test.ts` with fingerprint drift and incomplete-input coverage, and added handler-level regressions in `src/handlers/mention.test.ts` proving identical-state reuse, drift-triggered misses, and degraded cache fallback while keeping prompt content stable.

## Verification

Task verification passed with `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts` and lint passed with `bun run lint`. As slice-level spot checks, the retrieval suite also passed unchanged, while the broader review-side S04 verification command still fails in pre-existing `src/handlers/review.test.ts` multi-query/author-tier cases unrelated to this mention-side task. LSP diagnostics were unavailable because no TypeScript language server was running in this environment.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts` | 0 | ✅ pass | 13128ms |
| 2 | `bun test src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts` | 0 | ✅ pass | 158ms |
| 3 | `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts && bun scripts/verify-m061-s04.ts --json` | 1 | ❌ fail | 10309ms |
| 4 | `bun run lint` | 0 | ✅ pass | 10350ms |

## Deviations

Cached the bounded mention-context artifact at the expensive GitHub-derived seam and left the final mention prompt builder as a direct recomputation step; this still satisfies the task’s reuse goal while keeping prompt parity simple and bounded.

## Known Issues

The broader slice verification command `bun test src/execution/review-prompt.test.ts src/handlers/review.test.ts scripts/usage-report.test.ts scripts/verify-m061-s04.test.ts && bun scripts/verify-m061-s04.ts --json` still fails in unrelated review-side tests (`createReviewHandler multi-query retrieval orchestration` and `author-tier search cache integration`). Also, LSP diagnostics could not run because no language server was available in this environment.

## Files Created/Modified

- `src/execution/mention-context.ts`
- `src/handlers/mention.ts`
- `src/execution/mention-context.test.ts`
- `src/handlers/mention.test.ts`
