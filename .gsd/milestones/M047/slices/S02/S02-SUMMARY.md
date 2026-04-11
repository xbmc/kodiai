---
id: S02
parent: M047
milestone: M047
provides:
  - A reusable stored-profile surface resolver for Slack/profile continuity and expertise gating.
  - System-view opted-out identity suppression that prevents duplicate link DMs for existing opted-out contributors.
  - `verify:m047:s02`, the canonical downstream proof surface for Slack/profile, continuity, retrieval, and identity alignment.
requires:
  - slice: S01
    provides: Persisted-row trust classification, trust-aware review-time resolution, and the embedded `verify:m047:s01` runtime proof surface.
affects:
  - S03
key_files:
  - src/contributor/profile-surface-resolution.ts
  - src/contributor/profile-surface-resolution.test.ts
  - src/slack/slash-command-handler.ts
  - src/slack/slash-command-handler.test.ts
  - src/handlers/identity-suggest.ts
  - src/handlers/identity-suggest.test.ts
  - src/routes/slack-commands.test.ts
  - scripts/verify-m047-s02.ts
  - scripts/verify-m047-s02.test.ts
  - scripts/verify-m045-s03.ts
  - scripts/verify-m045-s03.test.ts
  - package.json
key_decisions:
  - Use a dedicated stored-profile surface resolver instead of reading raw `overallTier` directly on Slack/profile surfaces.
  - Use system-view `getByGithubUsername(..., { includeOptedOut: true })` lookups in the identity-suggestion path so opted-out linked contributors suppress DMs without re-enabling profile-backed guidance.
  - Compose `verify:m047:s02` from the embedded `verify:m047:s01` runtime report plus a local downstream scenario matrix instead of re-implementing review-resolution logic.
patterns_established:
  - Persisted-profile Slack/profile surfaces must resolve full stored rows through `resolveContributorProfileSurface(...)`; only `profile-backed` surfaces may claim active linked guidance or fetch expertise.
  - Identity-suggestion suppression for linked contributors must use system-view opted-out lookups to distinguish an opted-out existing profile from an absent contributor.
  - Downstream proof harnesses should compose authoritative upstream verifier reports plus a local scenario matrix, rather than deriving expectations from the same helpers under test.
observability_surfaces:
  - `bun run verify:m047:s02 -- --json` exposes the downstream stored-profile matrix with stable check IDs and scenario status codes.
  - `bun run verify:m045:s03 -- --json` remains the cross-surface contract-drift guard for retrieval, Slack, and identity behavior.
  - `bun run verify:m047:s01 -- --json` remains the authoritative embedded source-resolution proof that S02 composes rather than re-derives.
  - `src/slack/slash-command-handler.test.ts` and `src/routes/slack-commands.test.ts` prove direct-handler and signed-route continuity copy stay aligned.
  - `src/handlers/identity-suggest.test.ts` exposes opt-out suppression, fail-open warning, and duplicate-DM diagnostics for the identity path.
drill_down_paths:
  - .gsd/milestones/M047/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M047/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M047/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-11T02:28:08.576Z
blocker_discovered: false
---

# S02: Contract-first Slack, retrieval, and profile continuity rollout

**Slack/profile continuity, retrieval hints, and identity-suggestion suppression now consume the stored-profile trust seam, keeping downstream contributor output truthful for calibrated, untrusted, and opted-out states.**

## What Happened

S02 carried the S01 stored-profile truth boundary through every downstream persisted-profile surface. `src/contributor/profile-surface-resolution.ts` now classifies full contributor rows through `classifyContributorProfileTrust(...)` and is the only path Slack/profile continuity uses before rendering copy or looking up expertise. `/kodiai profile`, `link`, and `profile opt-in` now show active linked guidance and expertise only for current trusted calibrated rows; linked-unscored, legacy, stale, malformed, and fail-open rows collapse to generic continuity, while opted-out rows stay generic-opt-out. This removed raw-tier optimism from Slack/profile output and kept persisted-profile copy distinct from review-time fallback and degradation semantics.

The slice also fixed downstream continuity behavior that still treated opted-out linked contributors as absent. `src/handlers/identity-suggest.ts` now performs system-view profile lookups with `includeOptedOut: true`, which suppresses duplicate link DMs for opted-out linked rows without re-enabling profile-backed guidance. Signed slash-route coverage in `src/routes/slack-commands.test.ts` proves the truthful continuity copy reaches the real Hono response surface, and Slack API failures remain fail-open with warnings instead of blocking the handler.

Finally, S02 shipped the operator-facing downstream proof surface. `scripts/verify-m047-s02.ts` composes the embedded `verify:m047:s01` runtime report with a local stored-profile scenario matrix covering linked-unscored, legacy, stale, calibrated, malformed, and opt-out states across Slack/profile output, link/opt continuity, retrieval hints, and opt-out identity suppression. `scripts/verify-m045-s03.ts` was updated so the existing contract verifier stays trust-aware rather than certifying pre-S02 raw-tier optimism. The result is one consistent contract-first downstream story for review-time resolution, Slack/profile output, retrieval hints, and identity suggestions, leaving only S03’s top-level `verify:m047` composition layer.

## Verification

Fresh slice-close verification passed:

- `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts`
- `bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02`
- `bun run verify:m047:s01 -- --json`
- `bun run verify:m045:s03 -- --json`
- `bun run verify:m047:s02 -- --json`
- `bun run tsc --noEmit`

The regression bundle reported 64 passing tests and 0 failures across the focused Slack/profile, route, identity, retrieval, and verifier suites. `verify:m047:s02 -- --json` passed all six top-level checks and showed the expected stored-profile matrix: linked-unscored, legacy, and malformed rows stayed generic on Slack while retrieval used only coarse `returning contributor` hints; stale rows stayed generic with retrieval author hints suppressed under degraded fallback; calibrated rows stayed `profile-backed` across Slack/profile, continuity, and retrieval; and opted-out rows stayed generic, suppressed retrieval hints, and skipped identity DMs. `verify:m045:s03 -- --json` also remained green, confirming the older contract verifier now reads trusted Slack fixtures and continues to pass retrieval, Slack, and identity drift checks.

### Operational Readiness
- **Health signal:** `bun run verify:m047:s02 -- --json` reports PASS for `M047-S02-SLACK-PROFILE-CONTRACT`, `M047-S02-CONTINUITY-CONTRACT`, `M047-S02-RETRIEVAL-MULTI-QUERY-CONTRACT`, `M047-S02-RETRIEVAL-LEGACY-QUERY-CONTRACT`, and `M047-S02-IDENTITY-SUPPRESSION-CONTRACT`; the signed route and identity-suggestion test suites stay green.
- **Failure signal:** regressions surface as false “Linked contributor guidance is active” Slack/profile copy for untrusted rows, unexpected expertise exposure on generic states, author hints appearing for generic/opt-out/degraded retrieval queries, or an identity DM being sent to an opted-out linked contributor.
- **Recovery procedure:** rerun the focused regression bundle plus `bun run verify:m047:s02 -- --json`, inspect the failing scenario/status code, then repair the relevant seam (`resolveContributorProfileSurface(...)`, slash-command continuity copy, retrieval hint mapping, or `getByGithubUsername(..., { includeOptedOut: true })`) and rerun until all scenarios return PASS.
- **Monitoring gaps:** these protections are still verifier- and test-driven; there is no live production alert yet for downstream false active linked guidance, so S03 remains the next place to consolidate milestone-level proof and inspection.

## Requirements Advanced

- R046 — Rolled the contributor-experience contract through Slack/profile continuity, retrieval hints, and identity-suggestion suppression using the stored-profile trust seam instead of raw stored tiers.
- R048 — Added the downstream `verify:m047:s02` proof surface and aligned Slack/profile, retrieval, and identity behavior with the same stored-profile scenario matrix that S03 will compose into milestone-level coherence proof.

## Requirements Validated

None.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None. The existing narrower `verify:m047:s02` stub from T02 was extended into the final slice-close downstream proof harness, but the slice scope and promised outputs did not change.

## Known Limitations

S03 still needs to compose `verify:m047:s01`, `verify:m045:s03`, `verify:m047:s02`, and the M046 proof surfaces into the milestone-level `verify:m047` command. Downstream protection is still verifier-driven rather than backed by live production alerting, and Slack/profile continuity intentionally stays generic for linked-unscored, legacy, stale, and malformed stored rows even when review-time fallback can still derive coarse or degraded context from cache/search.

## Follow-ups

Build the milestone-level `verify:m047` composition harness in S03, preserve the nested `verify:m047:s01` and `verify:m047:s02` evidence surfaces inside it, and consider adding operator-facing alerting if any downstream surface reintroduces false active linked guidance.

## Files Created/Modified

- `src/contributor/profile-surface-resolution.ts` — Added the stored-profile Slack/profile resolver that classifies persisted rows through the S01 trust seam and gates active linked guidance plus expertise lookup.
- `src/contributor/profile-surface-resolution.test.ts` — Added matrix coverage for calibrated, opted-out, linked-unscored, legacy, stale, malformed, and fail-open surface projections.
- `src/slack/slash-command-handler.ts` — Rewired `/kodiai profile`, `link`, and `profile opt-in` to use the stored-profile surface resolver before rendering continuity copy or fetching expertise.
- `src/slack/slash-command-handler.test.ts` — Added contract-first Slack/profile regression coverage for generic continuity, trusted active continuity, and expertise lookup fail-open behavior.
- `src/handlers/identity-suggest.ts` — Switched existing-profile checks to system-view `includeOptedOut: true` lookups so opted-out linked contributors suppress DMs.
- `src/handlers/identity-suggest.test.ts` — Added suppression, duplicate-DM, malformed Slack response, and fail-open warning coverage for the identity-suggestion path.
- `src/routes/slack-commands.test.ts` — Proved the truthful continuity copy through the signed Hono slash-command route.
- `scripts/verify-m047-s02.ts` — Added the downstream S02 proof harness across Slack/profile output, continuity copy, retrieval hints, and opt-out identity suppression.
- `scripts/verify-m047-s02.test.ts` — Pinned the scenario matrix, JSON schema, and prerequisite drift behavior for the S02 proof harness.
- `scripts/verify-m045-s03.ts` — Updated the existing cross-surface verifier so Slack and retrieval fixtures remain trust-aware after the S02 rollout.
- `scripts/verify-m045-s03.test.ts` — Added regression guards for trusted Slack fixtures and downstream contract drift.
- `package.json` — Wired the `verify:m047:s02` package script for operator and slice-close verification.
