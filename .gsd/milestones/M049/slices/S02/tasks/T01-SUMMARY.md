---
id: T01
parent: S02
milestone: M049
key_files:
  - src/review-audit/review-output-artifacts.ts
  - src/review-audit/review-output-artifacts.test.ts
key_decisions:
  - Kept exact-match review-output proof logic separate from `recent-review-sample.ts` and exposed pure collection/body-validation/proof helpers so T02 can distinguish duplicate, wrong-surface/state, metadata, and body-drift failures without latest-only sampling heuristics.
duration: 
verification_result: mixed
completed_at: 2026-04-13T15:29:53.766Z
blocker_discovered: false
---

# T01: Added PR-scoped review-output artifact collection plus visible APPROVE proof helpers for exact clean-review verification.

**Added PR-scoped review-output artifact collection plus visible APPROVE proof helpers for exact clean-review verification.**

## What Happened

I wrote the new helper contract test-first in `src/review-audit/review-output-artifacts.test.ts`, covering exact marker collection across review comments, issue comments, and reviews; wrong repo/PR/action mismatches; duplicate visible outputs; wrong surface/state failures; body drift; and invalid matching metadata. The initial red run failed because `src/review-audit/review-output-artifacts.ts` did not exist yet.

I then implemented `src/review-audit/review-output-artifacts.ts` as a dedicated exact-match helper rather than overloading `recent-review-sample.ts`. The collector reuses `extractReviewOutputKey(...)` and `parseReviewOutputKey(...)`, scopes GitHub reads to the PR encoded in the requested key, preserves every matching artifact with `source`, `sourceUrl`, `updatedAt`, full `body`, `reviewState`, `action`, and `lane`, and returns exact per-surface counts. GitHub list failures are wrapped in a named `ReviewOutputArtifactCollectionError` so later verifier code can map GitHub-access failures cleanly instead of silently returning partial counts.

I also added a pure `validateVisibleApproveReviewBody(...)` helper that enforces the shipped visible APPROVE grammar (`Decision: APPROVE`, `Issues: none`, `Evidence:`, 1-3 bullet lines, exact marker, no `<details>` wrapper) and a pure `evaluateExactReviewOutputProof(...)` helper that returns deterministic proof statuses for missing artifacts, duplicates, invalid metadata, wrong surface, wrong review state, and body drift. That gives T02 a reusable proof surface with stable observability fields instead of collapsing all failures into a generic no-match result.

## Verification

Verified the focused helper behavior with `bun test ./src/review-audit/review-output-artifacts.test.ts` (11 passing tests covering exact counts, metadata preservation, wrong-key filtering, duplicate outputs, wrong surface/state, body drift, and invalid metadata). Verified project typing with `bun run tsc --noEmit`.

I also ran the slice-level test command `bun test ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts`; Bun passed the currently existing helper suites, but `scripts/verify-m049-s02.test.ts` does not exist yet, so live verifier coverage is still pending T02. Finally, `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --json` failed with `Script not found "verify:m049:s02"`, which is the expected remaining gap for this intermediate task.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-audit/review-output-artifacts.test.ts` | 0 | ✅ pass | 20ms |
| 2 | `bun run tsc --noEmit` | 0 | ✅ pass | 8189ms |
| 3 | `bun test ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts` | 0 | ✅ pass | 23ms |
| 4 | `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --json` | 1 | ❌ fail | 4ms |

## Deviations

None.

## Known Issues

`verify:m049:s02` and `scripts/verify-m049-s02.test.ts` do not exist yet, so the live slice verifier remains red until T02 adds the command/test entrypoint.

## Files Created/Modified

- `src/review-audit/review-output-artifacts.ts`
- `src/review-audit/review-output-artifacts.test.ts`
