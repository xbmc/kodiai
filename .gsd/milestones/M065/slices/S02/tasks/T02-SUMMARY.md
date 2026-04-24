---
id: T02
parent: S02
milestone: M065
key_files:
  - scripts/verify-m065-s02.ts
  - scripts/verify-m065-s02.test.ts
key_decisions:
  - Normalized retry-suffixed reviewOutputKey inputs back to the base key before invoking nested proof seams so all composed evidence correlates on one authoritative identity.
  - Kept the wrapper layer narrow: preserve nested M048/M049/M064 reports verbatim and add only stable identity-correlation and representative-bundle checks at the M065 S02 layer.
  - Counted only canonical operator truth as sufficient for representative live proof; pending, degraded, and superseded operator states remain explicit failing bundle states.
duration: 
verification_result: passed
completed_at: 2026-04-24T08:56:11.910Z
blocker_discovered: false
---

# T02: Implemented verify:m065:s02 as a composed live-proof verifier that normalizes base review identity, preserves nested M048/M049/M064 evidence, and fails explicitly on contradictory or non-representative bundles.

**Implemented verify:m065:s02 as a composed live-proof verifier that normalizes base review identity, preserves nested M048/M049/M064 evidence, and fails explicitly on contradictory or non-representative bundles.**

## What Happened

I followed the TDD/debugging contract from the task instructions. First I replaced the T01 placeholder tests with RED coverage for the full composed verifier: base-key normalization from retry reviewOutputKey inputs, injected runtime/visible/operator subproof composition, strict identity correlation, malformed nested-report handling, explicit failure propagation from Azure/GitHub/operator seams, and representative-bundle sufficiency rules. The initial red run showed the real gaps clearly: scripts/verify-m065-s02.ts was still treating the nested seams as optional report blobs, never invoking them, and it had no identity-correlation or representative-bundle evaluation beyond the T01 pending placeholder.

I then rewrote scripts/verify-m065-s02.ts to compose the real verifier seams instead of changing review behavior. The implementation now imports and invokes verify:m048:s01, verify:m049:s02, and verify:m064:s03 by default, while still allowing injected evaluators for deterministic tests. It derives the authoritative base identity from parseReviewOutputKey(...), normalizes retry-suffixed input back to the base reviewOutputKey, uses the base delivery id and repo for nested lookups, preserves the three nested reports verbatim, and adds only wrapper-layer checks for identity correlation and representative-bundle sufficiency.

The wrapper now validates each nested contract separately, localizes malformed reports to the correct stable subcheck id, and reports nested verifier failures truthfully without flattening their status codes or issues. It also compares runtime, visible-review, and operator-evidence identities against the same normalized target (base reviewOutputKey, delivery id, repo, and PR number), so contradictory bundles fail at M065-S02-IDENTITY-CORRELATION instead of producing a misleading generic failure. Finally, it enforces a conservative representative live-proof rule for this slice: runtime evidence must show a successful published lifecycle, visible review proof must resolve to the canonical APPROVED review surface with a valid body contract, and operator truth must resolve to canonical state; pending/degraded/superseded operator statuses remain explicit machine-readable failures rather than accidental greens.

After the implementation passed the expanded test suite, I ran the real CLI surface with a sample valid key to verify the new observability contract outside the harness. The command failed as expected in the current environment, but it failed usefully: the JSON output preserved normalized identity, per-subproof status codes, failing_check_id, and nested reports showing Azure no-match, GitHub-unavailable, and missing canonical-row operator truth. That smoke run confirmed the operator-facing drill-down surface works as intended even when live evidence is absent. I also attempted to store a reusable verifier-composition pattern in memory, but the memory store rejected the write, so that note is preserved here instead of in durable memory.

## Verification

Verified the expanded verifier contract with bun test scripts/verify-m065-s02.test.ts, which passed all 16 tests covering happy-path composition, retry-key normalization, malformed nested reports, nested seam failures, identity mismatches, operator-state boundary conditions, and CLI invalid-arg/help behavior. Re-ran the task’s focused verification command bun test scripts/verify-m065-s02.test.ts --filter "representative live bundle"; in this Bun environment the filter still executed the file’s full suite, but it passed cleanly with exit code 0 after the final code changes. Exercised the real operator surface with bun run verify:m065:s02 -- --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --repo xbmc/kodiai --json; it returned the expected machine-readable failing report with normalized identity, per-subproof statuses, failing_check_id, and nested runtime/visible/operator evidence, confirming the observability shape for live troubleshooting. LSP diagnostics could not be run because no language server is available in this workspace.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test scripts/verify-m065-s02.test.ts` | 0 | ✅ pass | 140ms |
| 2 | `bun test scripts/verify-m065-s02.test.ts --filter "representative live bundle"` | 0 | ✅ pass | 150ms |
| 3 | `bun run verify:m065:s02 -- --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --repo xbmc/kodiai --json` | 1 | ✅ pass | 2900ms |

## Deviations

None.

## Known Issues

capture_thought failed with 'failed to create memory', so the reusable verifier-composition pattern was not persisted to the memory store. Also, Bun's --filter behavior in this environment did not narrow execution to only the matching test names; it still executed the full file, but the command passed and remains a valid verification gate. The real CLI smoke command currently fails against live services because the sample reviewOutputKey does not have matching Azure/GitHub/canonical evidence in this environment, which is expected and is now reported explicitly by the new verifier.

## Files Created/Modified

- `scripts/verify-m065-s02.ts`
- `scripts/verify-m065-s02.test.ts`
