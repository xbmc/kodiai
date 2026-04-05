---
id: T03
parent: S02
milestone: M037
key_files:
  - scripts/verify-m037-s02.ts
  - scripts/verify-m037-s02.test.ts
  - package.json
key_decisions:
  - Safety guard proof uses scoreFindingEmbedding() directly (pure sync) to exercise the guard without embedding I/O
  - Sequential EmbeddingProvider pattern for multi-finding scoreFindings() tests — queue of pre-computed embeddings dispatched per call
  - EmbeddingProvider stub requires model and dimensions properties on the object itself matching full interface shape
duration: 
verification_result: passed
completed_at: 2026-04-05T08:04:18.998Z
blocker_discovered: false
---

# T03: Built verify-m037-s02.ts harness and 24-test suite proving cluster scoring changes the finding set relative to the naive path, CRITICAL findings are protected, and null-model fail-open preserves all findings unchanged

**Built verify-m037-s02.ts harness and 24-test suite proving cluster scoring changes the finding set relative to the naive path, CRITICAL findings are protected, and null-model fail-open preserves all findings unchanged**

## What Happened

Created scripts/verify-m037-s02.ts with three machine-checkable proof checks: M037-S02-SCORING-CHANGES-FINDINGS (suppression and boosting vs naive path), M037-S02-SAFETY-GUARD-CRITICAL (CRITICAL findings protected at threshold boundary using scoreFindingEmbedding() directly), and M037-S02-FAIL-OPEN (null model preserves all findings). Harness follows the verify-m037-s01.ts pattern with injectable _runFn overrides, evaluateM037S02(), buildM037S02ProofHarness(), text/JSON output modes. Added both verify:m037:s01 and verify:m037:s02 to package.json. Fixed EmbeddingProvider type shape (requires model/dimensions on the object) and FindingSeverity (no 'suggestion' value).

## Verification

bun test ./scripts/verify-m037-s02.test.ts — 24/24 pass (193ms). bun run verify:m037:s02 -- --json — exits 0, all three checks PASS with machine-readable JSON. bun run tsc --noEmit — exit 0.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m037-s02.test.ts` | 0 | ✅ pass | 193ms |
| 2 | `bun run verify:m037:s02 -- --json` | 0 | ✅ pass | 2700ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 6900ms |

## Deviations

Added verify:m037:s01 to package.json alongside verify:m037:s02 — it was missing.

## Known Issues

None.

## Files Created/Modified

- `scripts/verify-m037-s02.ts`
- `scripts/verify-m037-s02.test.ts`
- `package.json`
