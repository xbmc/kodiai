---
id: T01
parent: S03
milestone: M045
key_files:
  - scripts/verify-m045-s03.ts
  - scripts/verify-m045-s03.test.ts
  - package.json
  - .gsd/milestones/M045/slices/S03/tasks/T01-SUMMARY.md
key_decisions:
  - Kept the S01 GitHub proof report nested inside S03 and evaluated retrieval expectations from locally authored phrases so the verifier can detect drift instead of reusing the same helper logic under test.
duration: 
verification_result: passed
completed_at: 2026-04-10T11:38:59.683Z
blocker_discovered: false
---

# T01: Added the S03 operator verifier that embeds S01 GitHub proof results and checks retrieval hint drift in human and JSON modes.

**Added the S03 operator verifier that embeds S01 GitHub proof results and checks retrieval hint drift in human and JSON modes.**

## What Happened

Implemented the first S03 operator verifier as scripts/verify-m045-s03.ts. The new command composes evaluateM045S01() directly, validates that the embedded S01 report still exposes named check_ids, checks, status codes, and scenario data, and preserves that full nested GitHub report in both human-readable and JSON output. On top of the embedded S01 proof, the verifier now runs an independent retrieval drift matrix across profile-backed, coarse-fallback, generic-unknown, generic-opt-out, and generic-degraded contract states, checking both buildRetrievalVariants() and buildRetrievalQuery() for approved inclusion/omission behavior with phrase-level missingPhrases and unexpectedPhrases diagnostics. Added scripts/verify-m045-s03.test.ts to lock the happy-path report shape, malformed blank-query diagnostics, and non-zero JSON-mode exit behavior, then wired the new CLI into package.json as verify:m045:s03.

## Verification

Verified the new operator surface with bun test ./scripts/verify-m045-s03.test.ts, bun run verify:m045:s03, and bun run verify:m045:s03 -- --json. Re-ran the contributor-contract regression suite across experience-contract, retrieval helpers, Slack handler, identity-suggest, S01, and S03 tests, and finished with bun run tsc --noEmit. All commands exited 0 and the verifier emitted the expected top-level S03 check IDs plus nested S01 and retrieval diagnostics.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m045-s03.test.ts` | 0 | ✅ pass | 36ms |
| 2 | `bun run verify:m045:s03` | 0 | ✅ pass | 36ms |
| 3 | `bun run verify:m045:s03 -- --json` | 0 | ✅ pass | 35ms |
| 4 | `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts ./scripts/verify-m045-s01.test.ts ./scripts/verify-m045-s03.test.ts` | 0 | ✅ pass | 55ms |
| 5 | `bun run tsc --noEmit` | 0 | ✅ pass | 8013ms |

## Deviations

None.

## Known Issues

None within T01 scope. Slack and identity-link verifier surfaces remain intentionally deferred to T02.

## Files Created/Modified

- `scripts/verify-m045-s03.ts`
- `scripts/verify-m045-s03.test.ts`
- `package.json`
- `.gsd/milestones/M045/slices/S03/tasks/T01-SUMMARY.md`
