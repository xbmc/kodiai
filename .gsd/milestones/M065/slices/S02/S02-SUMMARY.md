---
id: S02
parent: M065
milestone: M065
provides:
  - A machine-readable live large-PR proof verifier that can be rerun from stable review identity.
  - Top-level M065 composition of the authoritative S02 report under a stable drill-down key for downstream S03 packaging.
requires:
  - slice: S01
    provides: The top-level M065 composition pattern and stable milestone-level drill-down contract that S02 now populates with authoritative live-proof evidence.
affects:
  - S03
key_files:
  - scripts/verify-m065-s02.ts
  - scripts/verify-m065-s02.test.ts
  - scripts/verify-m065.ts
  - scripts/verify-m065.test.ts
  - package.json
key_decisions:
  - Use the base `reviewOutputKey` as the authoritative identity for M065 S02 and treat `--repo` / `--delivery-id` as cross-checks rather than alternate truth sources.
  - Preserve nested M048/M049/M064 reports verbatim and add only wrapper-level identity correlation plus representative-bundle sufficiency at the S02 layer.
  - Thread the authoritative S02 report into `nested_reports.s02` in `verify:m065` rather than flattening live-proof evidence into prose or synthetic summary fields.
patterns_established:
  - Wrapper composition over nested authoritative verifiers: preserve existing verifier payloads and add only cross-cutting checks at the new slice boundary.
  - Normalize retry-suffixed review identities back to the canonical base `reviewOutputKey` before correlating runtime, visible, and operator evidence.
observability_surfaces:
  - `bun run verify:m065:s02 -- --json` exposes stable proof-target identity, failing check id, nested report payloads, and representative-bundle issues for live large-PR proof.
  - `bun run verify:m065 -- --json` now preserves `nested_reports.s02` and points operators to the exact drill-down command and report key for live-proof failures.
drill_down_paths:
  - .gsd/milestones/M065/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M065/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M065/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-24T09:08:57.744Z
blocker_discovered: false
---

# S02: Representative live large-PR proof

**Added the dedicated M065 S02 live-proof verifier and wired its authoritative nested report into verify:m065 so operators can localize representative large-PR proof failures from stable review identity.**

## What Happened

This slice delivered the real M065 S02 proof surface instead of a placeholder. `scripts/verify-m065-s02.ts` now accepts an operator-supplied `reviewOutputKey` as the authoritative proof target, normalizes retry-suffixed keys back to the base review identity, cross-checks optional `--delivery-id` and `--repo` overrides, and composes the existing runtime timing (`verify:m048:s01`), visible review artifact (`verify:m049:s02`), and canonical operator evidence (`verify:m064:s03`) seams without flattening their authority. The wrapper preserves the three nested reports verbatim, adds stable M065 S02 check ids for identity correlation and representative-bundle sufficiency, and fails explicitly when runtime evidence is missing, visible GitHub proof is unavailable or wrong-surface, operator truth is missing/degraded/superseded, or any nested report is malformed.

The slice also wired that authoritative S02 report into `scripts/verify-m065.ts`. Top-level M065 composition now preserves `nested_reports.s02`, maps its result into `M065-LIVE-LARGE-PR-PROOF`, and keeps drill-down metadata intact so operators can move from the milestone surface to the exact failing sub-contract mechanically. When S02 proof is satisfied, `M065-FRESH-REGRESSION-PROOF` remains the only intended pending obligation for S03. In the unattended validation environment used for slice closeout, the representative sample key still fails truthfully because live Azure/GitHub/canonical evidence for that sample is not available; importantly, the new verifier now reports those gaps precisely (`m048_s01_no_matching_phase_timing`, `m049_s02_github_unavailable`, missing canonical operator row) instead of producing a false green or hiding which subproof failed.

A key pattern established by this slice is “wrapper composition, not new truth sources”: M065 S02 adds only identity-correlation and representative-bundle checks at the wrapper layer, while preserving M048/M049/M064 nested payloads as authoritative evidence. Another pattern is base-key normalization for continuation families: retry-shaped `reviewOutputKey` inputs are reduced to the canonical base key before any nested proof lookup so runtime, visible, and operator surfaces correlate on one identity.

## Verification

Ran the slice-plan verification commands after the final code state. `bun test scripts/verify-m065-s02.test.ts` passed (16/16), proving the dedicated live-proof verifier contract covers malformed identifiers, delivery/repo mismatches, malformed nested reports, runtime/visible/operator failures, canonical-operator-only sufficiency, retry-key normalization, and representative-bundle truthfulness. `bun test scripts/verify-m065.test.ts` passed (9/9), proving top-level M065 composition preserves nested S02 evidence, surfaces malformed/failing S02 reports truthfully, and leaves only fresh regression pending when S02 succeeds. Exercised the operator-facing CLIs with `bun run verify:m065:s02 -- --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --repo xbmc/kodiai --json` and `bun run verify:m065 -- --json`; both returned machine-readable drill-down reports that localized the live-proof failure to missing phase timing evidence, GitHub artifact access failure, and absent canonical operator row for the representative sample. Those CLI runs exited non-zero, but that was the expected truthful result for the current unattended environment and confirms the observability contract required by the slice.

## Requirements Advanced

- R070 — Added the dedicated live-proof verifier surface that composes runtime timing, visible review, and canonical operator evidence around a real `reviewOutputKey`-anchored large-PR identity, so rollout proof can now be evaluated on a live captured run instead of only deterministic fixtures.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Operational Readiness

None.

## Deviations

The unattended closeout environment did not provide a passing live representative bundle for the seeded sample key, so the CLI smoke verification proved truthful failure localization rather than a green live rollout proof. This did not block the slice because the slice deliverable is the live-proof verifier/reporting surface itself, and the new surface now exposes the missing runtime/visible/operator evidence mechanically instead of masking it.

## Known Limitations

A genuinely passing S02 live-proof run still depends on an operator supplying a captured large-PR `reviewOutputKey` with matching Azure phase timing evidence, visible GitHub review artifacts, and canonical continuation-family truth available to the verifier. In the current unattended environment, GitHub artifact collection returned 403/unavailable and the canonical operator record for the seeded sample was absent.

## Follow-ups

S03 should package the rerun path in milestone-level operator documentation and add fresh non-large regression proof so `verify:m065` can move from nested-live-proof truth plus pending regression to final milestone-close readiness.

## Files Created/Modified

- `scripts/verify-m065-s02.ts` — Implemented the dedicated S02 live-proof verifier, identity normalization/correlation, nested report preservation, and representative-bundle evaluation.
- `scripts/verify-m065-s02.test.ts` — Pinned the S02 CLI/report contract and representative-bundle failure/success scenarios with focused tests.
- `scripts/verify-m065.ts` — Wired the authoritative S02 report into top-level M065 composition and preserved stable drill-down metadata.
- `scripts/verify-m065.test.ts` — Updated milestone-level composition tests to cover nested S02 success, malformed/failing reports, and pending-only semantics.
- `package.json` — Exposed the dedicated `verify:m065:s02` package script used by operators and automated verification.
