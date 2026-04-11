# S02: Contract-first Slack, retrieval, and profile continuity rollout

**Goal:** Roll the persisted contributor-profile truth boundary from S01 through Slack/profile continuity, link/opt messaging, identity-suggestion suppression, and retrieval proof so downstream surfaces no longer trust raw stored tiers or overclaim active linked guidance.
**Demo:** The same contributor state produces consistent `/kodiai profile`, link/opt continuity messaging where applicable, and review retrieval hints with no raw-tier leakage or false 'active profile-backed' claims.

## Must-Haves

- `/kodiai profile`, `link`, and `profile opt-in` resolve contributor guidance from stored-profile trust state rather than raw `overallTier`, and linked-unscored, legacy, stale, or malformed rows never claim active linked guidance.
- Slack profile output only shows expertise for trustworthy calibrated profiles; opted-out or generic states stay redacted and truthful.
- Identity-link suggestions treat opted-out linked rows as existing profiles and suppress new DMs instead of pretending the contributor is absent.
- Retrieval-hint proof stays aligned with S01's contract-first review resolver, and trust-aware verifier fixtures stop certifying unmarked stored tiers as active linked profiles.
- `verify:m047:s02` proves Slack/profile continuity, retrieval alignment, and opted-out identity behavior while `verify:m047:s01` and `verify:m045:s03` remain green.

## Threat Surface

- **Abuse**: Linked-but-unscored, legacy, stale, or malformed stored rows can still masquerade as active linked guidance on Slack or mis-shape retrieval proof unless every downstream surface reclassifies stored state through the S01 trust seam; slash-command inputs must not bypass that resolver.
- **Data exposure**: Slack responses, DM copy, and verifier output may mention GitHub usernames, contract states, and scenario diagnostics, but must not leak Slack IDs, contributor profile IDs, raw expertise scores, or calibration-only internals beyond the versioned trust marker already shipped.
- **Input trust**: Slash-command text, stored `contributor_profiles` rows, `optedOut` state, `trustMarker`, retrieval author hints, and Slack Web API responses are all untrusted until normalized through the stored-profile resolver or fail-open logic.

## Requirement Impact

- **Requirements touched**: R046 directly; R048 as downstream milestone coherence proof this slice supports.
- **Re-verify**: `src/slack/slash-command-handler.test.ts`, `src/routes/slack-commands.test.ts`, `src/handlers/identity-suggest.test.ts`, `src/knowledge/retrieval-query.test.ts`, `src/knowledge/multi-query-retrieval.test.ts`, `scripts/verify-m045-s03.test.ts`, `scripts/verify-m047-s02.test.ts`, `bun run verify:m047:s01`, `bun run verify:m045:s03`, and `bun run verify:m047:s02` must agree on the same contributor-state matrix.
- **Decisions revisited**: D085, D086, D090, D091.

## Proof Level

- This slice proves: integration proof on deterministic slash-command, identity-suggestion, retrieval, and verifier scenarios seeded from stored contributor-profile states; real runtime required: no; human/UAT required: no.

## Verification

- `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts ./src/routes/slack-commands.test.ts ./src/handlers/identity-suggest.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts`
- `bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: slash-command text and identity-suggestion behavior should drift only through explicit contract-state changes, trusted/untrusted surface resolution, or named verifier status codes.
- Inspection surfaces: `bun run verify:m047:s02 -- --json`, `bun run verify:m045:s03 -- --json`, `bun run verify:m047:s01 -- --json`, and the focused handler/unit test suites.
- Failure visibility: regressions should surface as false active Slack/profile copy, unexpected expertise exposure, an identity-suggestion DM that should have been suppressed, or a verifier scenario/status-code mismatch tied to a named contributor state.
- Redaction constraints: keep proof and plan output limited to GitHub usernames and contract/trust diagnostics; never echo Slack tokens, Slack IDs, raw expertise scores, or private store identifiers.

## Integration Closure

- Upstream surfaces consumed: `src/contributor/profile-trust.ts`, `src/contributor/review-author-resolution.ts`, `src/contributor/experience-contract.ts`, `src/slack/slash-command-handler.ts`, `src/handlers/identity-suggest.ts`, `src/routes/slack-commands.ts`, `scripts/verify-m045-s03.ts`, and `scripts/verify-m047-s01.ts`.
- New wiring introduced in this slice: a stored-profile surface resolver feeds Slack/profile continuity, opted-out identity suppression uses system-view profile lookups, and a new `verify:m047:s02` harness proves retrieval/Slack/profile alignment against the S01 trust seam.
- What remains before the milestone is truly usable end-to-end: S03 must compose `verify:m047:s01` and `verify:m047:s02` into the final milestone-level `verify:m047` proof surface.

## Tasks

- [x] **T01: Roll stored-profile trust through Slack/profile continuity** `est:2h`
  - Why: `/kodiai profile`, `link`, and `profile opt-in` still overclaim active linked guidance from raw stored tiers, so this task moves those surfaces onto the same stored-profile trust seam S01 established for review-time resolution.
  - Files: `src/contributor/profile-surface-resolution.ts`, `src/contributor/profile-surface-resolution.test.ts`, `src/slack/slash-command-handler.ts`, `src/slack/slash-command-handler.test.ts`, `src/contributor/index.ts`
  - Do: Add a narrow stored-profile surface resolver that classifies full `ContributorProfile` rows through `classifyContributorProfileTrust(...)`, maps opted-out/calibrated/untrusted states to contract-safe Slack output, and rewire `/kodiai profile`, `link`, and `profile opt-in` to use it before any expertise lookup or success copy is emitted.
  - Verify: `bun test ./src/contributor/profile-surface-resolution.test.ts ./src/slack/slash-command-handler.test.ts`
  - Done when: Slack profile cards and link/opt-in responses only claim active linked guidance for trusted calibrated profiles, and generic states never show expertise or raw-tier copy.

- [ ] **T02: Suppress opted-out identity suggestions and prove route continuity** `est:90m`
  - Why: Opted-out linked contributors are still treated as absent by the identity-suggestion path, and the signed slash-command HTTP surface needs an end-to-end continuity check for the updated truthful copy.
  - Files: `src/handlers/identity-suggest.ts`, `src/handlers/identity-suggest.test.ts`, `src/routes/slack-commands.test.ts`
  - Do: Switch identity suggestions onto `includeOptedOut: true` system-view lookups, suppress DMs when an opted-out linked row already exists, keep Slack API failures fail-open, and extend signed-route coverage so the updated continuity copy is proven over the real Hono JSON response.
  - Verify: `bun test ./src/handlers/identity-suggest.test.ts ./src/routes/slack-commands.test.ts`
  - Done when: Opted-out linked contributors no longer receive link suggestions, Slack API failures remain non-blocking, and route tests confirm the truthful continuity copy reaches the slash-command HTTP response.

- [ ] **T03: Ship trust-aware Slack/retrieval proof for S02** `est:90m`
  - Why: S02 needs an operator-facing proof surface and trust-aware fixture updates so retrieval, Slack/profile, and identity continuity stay aligned with the S01 resolver instead of certifying legacy raw-tier optimism.
  - Files: `scripts/verify-m047-s02.ts`, `scripts/verify-m047-s02.test.ts`, `scripts/verify-m045-s03.ts`, `scripts/verify-m045-s03.test.ts`, `package.json`
  - Do: Make `verify:m045:s03` fixtures truth-aware, add a new `verify:m047:s02` harness that composes S01 scenarios with Slack/profile output, link/opt continuity, retrieval author hints, and opted-out identity suppression, and wire the new script into `package.json`.
  - Verify: `bun test ./scripts/verify-m045-s03.test.ts ./scripts/verify-m047-s02.test.ts ./src/knowledge/retrieval-query.test.ts ./src/knowledge/multi-query-retrieval.test.ts && bun run verify:m047:s01 && bun run verify:m045:s03 && bun run verify:m047:s02 && bun run tsc --noEmit`
  - Done when: The trust-aware proof bundle passes and reports stable scenario diagnostics for calibrated, linked-unscored, legacy, stale, malformed, and opted-out contributor states across Slack/profile, retrieval, and identity surfaces.

## Files Likely Touched

- `src/contributor/profile-surface-resolution.ts`
- `src/contributor/profile-surface-resolution.test.ts`
- `src/slack/slash-command-handler.ts`
- `src/slack/slash-command-handler.test.ts`
- `src/contributor/index.ts`
- `src/handlers/identity-suggest.ts`
- `src/handlers/identity-suggest.test.ts`
- `src/routes/slack-commands.test.ts`
- `scripts/verify-m047-s02.ts`
- `scripts/verify-m047-s02.test.ts`
- `scripts/verify-m045-s03.ts`
- `scripts/verify-m045-s03.test.ts`
- `package.json`
