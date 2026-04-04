---
id: T02
parent: S01
milestone: M036
key_files:
  - src/knowledge/generated-rule-proposals.ts
  - src/knowledge/generated-rule-proposals.test.ts
  - src/knowledge/index.ts
  - .gsd/DECISIONS.md
key_decisions:
  - Score proposal signal as positive-ratio × support so minimum-size clusters stay pending while larger, cleaner clusters can cross later activation thresholds.
  - Build pending-rule proposals from repo-scoped learning_memories directly, reusing cosineSimilarity from the cluster pipeline and deterministic representative-sample extraction rather than depending on persisted review-comment clusters.
duration: 
verification_result: passed
completed_at: 2026-04-04T22:27:26.089Z
blocker_discovered: false
---

# T02: Added deterministic pending-rule proposal generation from clustered learning-memory feedback.

**Added deterministic pending-rule proposal generation from clustered learning-memory feedback.**

## What Happened

Added a deterministic generated-rule proposal layer that reads recent repo-scoped learning memories, clusters them by cosine similarity, filters out sparse or noisy clusters, and emits bounded pending-rule proposal candidates from representative positive samples. The generator now logs cluster-size, proposal-count, and skipped-cluster signals, exports its public types through the knowledge index, and records the proposal signal-score formula for downstream activation work. Tests cover strong positive clusters, noisy negative-heavy clusters, sanitization bounds, proposal-count caps, and fail-open query failures.

## Verification

Ran the task verification gate and a compatibility typecheck. `bun test ./src/knowledge/generated-rule-proposals.test.ts` passed, covering strong-cluster proposal generation, noisy-cluster rejection, text sanitization bounds, max-proposal capping, and fail-open query handling. `bun run tsc --noEmit` also passed, confirming the new generator and exports typecheck cleanly.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/knowledge/generated-rule-proposals.test.ts` | 0 | ✅ pass | 216ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 6797ms |

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `src/knowledge/generated-rule-proposals.ts`
- `src/knowledge/generated-rule-proposals.test.ts`
- `src/knowledge/index.ts`
- `.gsd/DECISIONS.md`
