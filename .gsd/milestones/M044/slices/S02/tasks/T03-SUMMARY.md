---
id: T03
parent: S02
milestone: M044
key_files:
  - scripts/verify-m044-s01.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Use the existing `verify:m044:s01` command as the live proof surface instead of creating a separate `verify:m044:s02` script; the repair should prove itself by upgrading the current audit output, not by adding a parallel verifier.
duration: 
verification_result: mixed
completed_at: 2026-04-09T08:22:25.524Z
blocker_discovered: false
---

# T03: Reran the live recent-review audit and confirmed Azure evidence now resolves real sample verdicts beyond indeterminate.

**Reran the live recent-review audit and confirmed Azure evidence now resolves real sample verdicts beyond indeterminate.**

## What Happened

Reran the live recent-sample audit after Azure evidence was wired in. The updated `verify:m044:s01` command completed successfully against xbmc/xbmc with `githubAccess=available`, `databaseAccess=unavailable`, and `azureLogAccess=available`. Unlike the S01 run, the recent sample no longer collapsed to all-`indeterminate`: explicit mention-review PRs `#28143` and `#28086` now classify `clean-valid` from `publishResolution=approval-bridge`, most recent automatic reviews classify `clean-valid` from `submitted-approval`, and PR `#28135` classifies `findings-published` from `outcome=published-output`. That proves the repaired evidence path is retiring the ambiguity the first audit exposed.

## Verification

`bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` completed with `status_code=m044_s01_ok`, `azureLogAccess=available`, and multiple non-`indeterminate` verdicts in the live sample: explicit `clean-valid` for PRs `#28143` and `#28086`, automatic `clean-valid` for recent approval outcomes, and `findings-published` for PR `#28135`.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json -> status_code=m044_s01_ok, azureLogAccess=available, PR#28143 clean-valid, PR#28086 clean-valid, PR#28135 findings-published` | -1 | unknown (coerced from string) | 0ms |

## Deviations

The live rerun still reported `databaseAccess=unavailable`, but that no longer blocked meaningful classification because Azure evidence was available and correctly used. This is a truthful environmental limitation, not a plan-invalidating blocker for S02.

## Known Issues

The current live sample classified as `clean-valid` or `findings-published`; no publish-failure-shaped case appeared in this recent sample, so failure-path proof remains covered by tests rather than the current live window.

## Files Created/Modified

- `scripts/verify-m044-s01.ts`
- `.gsd/KNOWLEDGE.md`
