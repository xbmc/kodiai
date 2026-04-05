---
id: T03
parent: S02
milestone: M041
key_files:
  - scripts/verify-m041-s02.ts
  - scripts/verify-m041-s02.test.ts
  - src/knowledge/retrieval.ts
  - package.json
  - .gsd/milestones/M041/slices/S02/tasks/T03-SUMMARY.md
key_decisions:
  - Extended unified retrieval to accept a caller-supplied canonical ref so canonical current-code search follows the repo's actual default branch instead of assuming `main`.
  - Verified canonical retrieval with a non-`main` fixture branch and explicit historical snippet corpus so the proof catches provenance or corpus-boundary regressions.
duration: 
verification_result: passed
completed_at: 2026-04-05T14:30:09.239Z
blocker_discovered: false
---

# T03: Added a deterministic end-to-end verifier for canonical default-branch backfill and retrieval, including non-`main` default-branch propagation and corpus-separation proof output.

**Added a deterministic end-to-end verifier for canonical default-branch backfill and retrieval, including non-`main` default-branch propagation and corpus-separation proof output.**

## What Happened

Implemented `scripts/verify-m041-s02.ts` as a deterministic proof harness that creates a production-like fixture repository on a non-`main` default branch, runs the real `backfillCanonicalCodeSnapshot(...)` path, then exercises the real unified retriever against both canonical current-code rows and a historical diff-hunk snippet fixture. The harness emits four stable checks covering canonical backfill persistence, canonical retrieval evidence, preserved separation between canonical and historical corpora, and end-to-end propagation of a non-`main` default branch. Added `scripts/verify-m041-s02.test.ts` to lock the harness contract, JSON/text output, failure signaling, and check semantics. While implementing the proof, found and fixed a real retrieval orchestration bug in `src/knowledge/retrieval.ts`: canonical retrieval was hard-coded to `main` instead of using the resolved canonical ref. Added the `verify:m041:s02` script entrypoint to `package.json`.

## Verification

Ran the task verification command from the plan: `bun test ./scripts/verify-m041-s02.test.ts && bun run verify:m041:s02 -- --json`. The test suite passed all 15 assertions, and the verifier returned `overallPassed: true` with four passing checks proving canonical snapshot persistence, canonical current-code retrieval evidence, corpus separation, and non-`main` default-branch propagation.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m041-s02.test.ts` | 0 | ✅ pass | 213ms |
| 2 | `bun run verify:m041:s02 -- --json` | 0 | ✅ pass | 93ms |

## Deviations

Updated `src/knowledge/retrieval.ts` and `package.json` in addition to the planned new verifier files because the end-to-end proof exposed a real canonical-ref propagation bug in the existing retrieval orchestration and required a runnable script entrypoint.

## Known Issues

The deterministic verifier proves that canonical current-code is returned with correct provenance and preserved corpus boundaries, but its fixture does not require canonical results to outrank every historical snippet globally. That stricter ranking policy would require a more opinionated scoring contract than this slice committed to. None.

## Files Created/Modified

- `scripts/verify-m041-s02.ts`
- `scripts/verify-m041-s02.test.ts`
- `src/knowledge/retrieval.ts`
- `package.json`
- `.gsd/milestones/M041/slices/S02/tasks/T03-SUMMARY.md`
