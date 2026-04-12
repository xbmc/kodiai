---
id: T01
parent: S02
milestone: M047
key_files:
  - src/contributor/profile-surface-resolution.ts
  - src/contributor/profile-surface-resolution.test.ts
  - src/slack/slash-command-handler.ts
  - src/slack/slash-command-handler.test.ts
  - src/contributor/index.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Use a dedicated stored-profile Slack/profile surface resolver instead of reading raw `overallTier` directly.
  - Only `profile-backed` stored-profile surfaces may claim active linked guidance or fetch expertise; all untrusted persisted states collapse to generic continuity on Slack/profile surfaces.
  - Fail open to the generic profile card if expertise lookup cannot safely support active linked guidance.
duration: 
verification_result: mixed
completed_at: 2026-04-11T01:43:57.788Z
blocker_discovered: false
---

# T01: Added a stored-profile Slack/profile resolver so link, profile, and opt-in only claim active linked guidance for trusted calibrated rows and never fetch expertise for generic states.

**Added a stored-profile Slack/profile resolver so link, profile, and opt-in only claim active linked guidance for trusted calibrated rows and never fetch expertise for generic states.**

## What Happened

Added `src/contributor/profile-surface-resolution.ts` as the narrow Slack/profile seam for persisted contributor rows. It classifies full stored profiles through `classifyContributorProfileTrust(...)`, maps calibrated rows to `profile-backed`, keeps opted-out rows on `generic-opt-out`, and collapses linked-unscored, legacy, stale, malformed, and classifier-failure cases to `generic-unknown` for this surface. Rewired `src/slack/slash-command-handler.ts` so `/kodiai profile`, `link`, and `profile opt-in` resolve that surface before rendering copy or fetching expertise. The handler now skips `getExpertise(...)` unless the surface is `profile-backed`, and fails open to the generic profile card if expertise lookup throws. Added focused resolver coverage in `src/contributor/profile-surface-resolution.test.ts`, updated `src/slack/slash-command-handler.test.ts` so only trusted fixtures carry `CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER`, and added explicit coverage for newly linked, opted-out, legacy, stale, malformed, and expertise-failure scenarios. Exported the new resolver from `src/contributor/index.ts` and recorded the seam rule in `.gsd/KNOWLEDGE.md`.

## Verification

Focused task verification passed with `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts`, `bun run verify:m047:s01`, and `bun run tsc --noEmit`. Slice-level follow-on verification is partially green as expected for T01: `bun run verify:m047:s02 -- --json` fails because the verifier script does not exist yet, and `bun run verify:m045:s03` plus the broader slice bundle still fail because the existing Slack verifier fixtures encode pre-S02 linked-profile/profile-opt-in copy that T03 is planned to update.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts` | 0 | ✅ pass | 40ms |
| 2 | `bun run verify:m047:s02 -- --json` | 1 | ❌ fail | 22ms |
| 3 | `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts` | 1 | ❌ fail | 98ms |
| 4 | `bun run verify:m047:s01` | 0 | ✅ pass | 69ms |
| 5 | `bun run verify:m045:s03` | 1 | ❌ fail | 60ms |
| 6 | `bun run tsc --noEmit` | 0 | ✅ pass | 8240ms |

## Deviations

None.

## Known Issues

`verify:m047:s02` is not wired yet, so that command currently fails with `Script not found "verify:m047:s02"`. `scripts/verify-m045-s03.ts` and `scripts/verify-m045-s03.test.ts` still assert the pre-S02 Slack continuity copy, so they currently report `slack_surface_contract_drift` for `linked-profile` and `profile-opt-in` until T03 updates the proof bundle.

## Files Created/Modified

- `src/contributor/profile-surface-resolution.ts`
- `src/contributor/profile-surface-resolution.test.ts`
- `src/slack/slash-command-handler.ts`
- `src/slack/slash-command-handler.test.ts`
- `src/contributor/index.ts`
- `.gsd/KNOWLEDGE.md`
