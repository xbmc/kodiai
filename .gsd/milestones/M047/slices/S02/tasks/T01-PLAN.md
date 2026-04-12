---
estimated_steps: 4
estimated_files: 5
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T01: Roll stored-profile trust through Slack/profile continuity

**Slice:** S02 — Contract-first Slack, retrieval, and profile continuity rollout
**Milestone:** M047

## Description

Roll the S01 stored-profile truth boundary into the Slack/profile surface without importing review-time author-cache or GitHub-search fallback behavior. Assume untrusted stored-profile states (`linked-unscored`, `legacy`, `stale`, and `malformed`) should collapse to generic Slack/profile continuity rather than `generic-degraded`, because this surface is describing the linked persisted profile itself, not transient search degradation.

## Steps

1. Add a focused `src/contributor/profile-surface-resolution.ts` helper and tests that classify full `ContributorProfile` rows through `classifyContributorProfileTrust(...)` and map opted-out, calibrated, linked-unscored, legacy, stale, and malformed states to contract-safe Slack/profile output.
2. Rewire `src/slack/slash-command-handler.ts` so `/kodiai profile`, `link`, and `profile opt-in` resolve the stored-profile surface state before rendering copy or fetching expertise.
3. Skip `getExpertise(...)` for any non-`profile-backed` surface so generic or opted-out responses cannot leak trusted-looking expertise data.
4. Update handler fixtures so only trusted rows carry `CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER`, and add explicit assertions for newly linked, legacy, stale, malformed, and opted-out continuity copy.

## Must-Haves

- [ ] `/kodiai profile`, `link`, and `profile opt-in` only claim active linked guidance when the stored profile is currently trusted.
- [ ] Linked-unscored, legacy, stale, malformed, and opted-out rows render generic-safe Slack/profile copy and never show expertise.
- [ ] The new resolver stays narrow and reusable so later proof code can consume it without pulling in review-time fallback logic.

## Verification

- `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts`
- `bun run verify:m047:s02 -- --json`

## Observability Impact

- Signals added/changed: stored-profile surface resolution becomes explicit in deterministic profile-card and continuity-message assertions rather than leaking through raw tier strings.
- How a future agent inspects this: run `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts` or inspect the Slack/profile scenarios in `bun run verify:m047:s02 -- --json`.
- Failure state exposed: false linked-active copy or unexpected expertise sections on untrusted rows.

## Inputs

- `src/contributor/profile-trust.ts` — provides the trusted/untrusted stored-profile classifier from S01.
- `src/contributor/experience-contract.ts` — defines the shipped Slack/profile projection vocabulary that the new resolver must reuse.
- `src/contributor/types.ts` — supplies the `ContributorProfile` shape for the new resolver seam.
- `src/slack/slash-command-handler.ts` — still trusts raw stored tiers for profile cards and continuity copy.
- `src/slack/slash-command-handler.test.ts` — existing Slack handler coverage that needs trust-aware fixtures.

## Expected Output

- `src/contributor/profile-surface-resolution.ts` — new stored-profile surface resolver for Slack/profile continuity.
- `src/contributor/profile-surface-resolution.test.ts` — unit coverage for calibrated, opted-out, linked-unscored, legacy, stale, and malformed states.
- `src/slack/slash-command-handler.ts` — handler logic rewritten to resolve surface state before copy or expertise lookup.
- `src/slack/slash-command-handler.test.ts` — trust-aware Slack continuity tests that prove generic states stay generic.
- `src/contributor/index.ts` — exports the new resolver if shared proof code needs it.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `src/contributor/profile-trust.ts` / stored contributor profile row | Fail open to generic Slack/profile copy instead of throwing or keeping stale `profile-backed` wording. | N/A — local helper and store row only. | Treat unsupported trust markers, invalid tiers, and missing timestamps as untrusted states rather than reviving linked-active copy. |
| `profileStore.getExpertise(...)` / `src/slack/slash-command-handler.ts` | Do not block the profile card; keep generic copy and hide expertise if the lookup fails or should not run. | Preserve the current synchronous slash-command behavior and avoid extra retries. | Skip expertise rendering for any non-`profile-backed` state so malformed or stale rows cannot leak trusted-looking expertise. |

## Load Profile

- **Shared resources**: `contributor_profiles`, the expertise lookup path, and the Slack slash-command response surface.
- **Per-operation cost**: one stored-profile read plus at most one expertise query for a trusted profile; generic states should stay lookup-light.
- **10x breakpoint**: repeated expertise reads for generic or opted-out states become the first waste point, so the resolver must short-circuit before fetching expertise.

## Negative Tests

- **Malformed inputs**: unsupported `overallTier`, unsupported `trustMarker`, null `lastScoredAt`, and partially populated stored-profile rows.
- **Error paths**: expertise lookup failure, resolver/classifier failure, and newly linked rows that still have default newcomer data.
- **Boundary conditions**: calibrated trusted row, opted-out trusted row, linked-unscored row, legacy scored row, stale row, and malformed row.
