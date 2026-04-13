---
id: T02
parent: S02
milestone: M049
key_files:
  - scripts/verify-m049-s02.ts
  - scripts/verify-m049-s02.test.ts
  - package.json
  - .gsd/DECISIONS.md
key_decisions:
  - D119 — Map low-level invalid artifact metadata into the stable operator-facing wrong_review_state/body_drift statuses while preserving raw issues plus artifact/bodyContract report fields.
duration: 
verification_result: mixed
completed_at: 2026-04-13T15:40:54.362Z
blocker_discovered: false
---

# T02: Added the read-only `verify:m049:s02` explicit clean-approval verifier and its contract tests.

**Added the read-only `verify:m049:s02` explicit clean-approval verifier and its contract tests.**

## What Happened

I added `scripts/verify-m049-s02.test.ts` first and verified the red state while the verifier module and package script were still missing. The new tests pin CLI parsing, invalid-argument rejection for missing/non-explicit/repo-mismatched keys, the named GitHub proof failure branches, Azure unavailable versus audit mismatch behavior, the accepted clean publish resolutions, the human report surface, and the `package.json` script wiring.

I then implemented `scripts/verify-m049-s02.ts` as a read-only explicit clean-approval verifier using the existing GitHub App bootstrap pattern from the earlier live verifiers plus the new exact-match artifact helpers from T01. The command now requires `--review-output-key`, defaults `--repo` to `xbmc/kodiai`, rejects malformed or non-`mention-review` keys before any live lookup, scopes GitHub reads to the repo/PR encoded in the key, evaluates exact visible-artifact proof, and exposes stable named statuses for missing GitHub access, GitHub unavailability, no match, duplicates, wrong surface, wrong review state, body drift, Azure unavailability, audit unavailability, and audit mismatch.

For the success path, the verifier joins GitHub proof to Azure Log Analytics evidence with `queryReviewAuditLogs(...)` plus `buildExplicitLaneEvidenceFromLogs(...)`, and only returns success when the publish resolution is one of `approval-bridge`, `idempotency-skip`, or `duplicate-suppressed`. Both JSON and human output now carry the required observability fields: `status_code`, per-surface `artifactCounts`, the operator-facing review URL and review state, body-contract booleans, Azure source availability, matched-row counts, `publishResolution`, and `issues[]`. I also wired `package.json` with `verify:m049:s02` and recorded D119 for the public status-surface mapping decision.

## Verification

Ran the focused verifier suite with the explicit Azure evidence tests and all checks passed. Ran the slice-level artifact/evidence/verifier test command and all three suites passed. Ran `bun run tsc --noEmit` and the workspace typecheck passed cleanly. Finally exercised the live command with a syntactically valid explicit `reviewOutputKey`; the verifier failed closed with `m049_s02_github_unavailable` after GitHub returned 403 during review-comment collection, which confirms the live degradation path but leaves the final operational proof pending working repo access and a real clean approval key.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./scripts/verify-m049-s02.test.ts ./src/review-audit/evidence-correlation.test.ts` | 0 | ✅ pass | 76ms |
| 2 | `bun test ./src/review-audit/review-output-artifacts.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m049-s02.test.ts` | 0 | ✅ pass | 68ms |
| 3 | `bun run tsc --noEmit` | 0 | ✅ pass | 7979ms |
| 4 | `bun run verify:m049:s02 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-review:delivery-delivery-101:head-head-101 --json` | 1 | ❌ fail | 1316ms |

## Deviations

None.

## Known Issues

The live sample verifier run is still blocked by current GitHub access for `xbmc/kodiai`: GitHub returned 403 while listing PR review comments, so the command failed closed with `m049_s02_github_unavailable` before artifact proof or Azure correlation could complete. A fresh real explicit clean `reviewOutputKey` plus working GitHub App access is still required for the final operational slice proof.

## Files Created/Modified

- `scripts/verify-m049-s02.ts`
- `scripts/verify-m049-s02.test.ts`
- `package.json`
- `.gsd/DECISIONS.md`
