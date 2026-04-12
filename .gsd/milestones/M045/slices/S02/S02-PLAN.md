# S02: Unified Slack, Opt-Out, and Retrieval Semantics

**Goal:** Extend the contributor-experience contract beyond GitHub prompt/details by driving review retrieval hints, Slack `/kodiai profile` output, opt-in/out/help copy, and identity-link messaging from contract-approved projections instead of raw tier strings.
**Demo:** A contributor can inspect `/kodiai profile`, opt in or out, and trigger review-time resolution without seeing conflicting tier semantics; retrieval hints either follow the contract-approved signal or are absent by design.

## Must-Haves

- Add contract-owned downstream projections so Slack/profile copy and retrieval hints consume contract-approved signals instead of raw `overallTier` / `authorTier` values.
- Review-time retrieval passes a normalized optional hint only for `profile-backed` and `coarse-fallback` states; `generic-opt-out`, `generic-unknown`, and `generic-degraded` pass no contributor hint.
- `/kodiai profile`, `profile opt-out`, `profile opt-in`, and unknown-command help all present contract-first, non-contradictory copy; opted-out users never see raw tier/score semantics alongside generic behavior.
- Identity suggestion DMs and regression tests use truthful contributor-guidance language and preserve fail-open behavior for missing links or Slack API issues.
- Targeted tests plus `bun run verify:m045:s01 -- --json` and `bun run tsc --noEmit` keep the S01 GitHub contract green while advancing R046 on Slack and retrieval surfaces.

## Threat Surface

- **Abuse**: forged or stale contributor profile state, slash-command misuse, or projection bugs must not restore contributor-specific retrieval or Slack copy after opt-out; identity-suggestion DMs must not spam repeated matches or over-promise personalized behavior.
- **Data exposure**: Slack profile output may show contract state and top expertise, but must not expose raw profile IDs, Slack IDs, or internal score/tier semantics on generic states.
- **Input trust**: Slack slash-command text, persisted `overallTier` / `optedOut` profile fields, review-time author classification, and heuristic Slack match results are all untrusted until normalized by contract projections.

## Requirement Impact

- **Requirements touched**: R046.
- **Re-verify**: review retrieval query construction, Slack `/kodiai profile` / `profile opt-in` / `profile opt-out` / help responses, identity suggestion DM wording, and `bun run verify:m045:s01 -- --json`.
- **Decisions revisited**: D062, D064, D067.

## Proof Level

- This slice proves: integration proof on deterministic review-handler and Slack-command fixtures.
- Real runtime required: no.
- Human/UAT required: no.

## Verification

- `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts`
- `bun run verify:m045:s01 -- --json`
- `bun run tsc --noEmit`

## Observability / Diagnostics

- Runtime signals: existing `contributorExperienceState`, `contributorExperienceSource`, and `contributorExperienceDegradationPath` review logs remain the runtime classification surface; captured retrieval query strings plus Slack response/DM text become the slice's drift indicators.
- Inspection surfaces: `src/handlers/review.test.ts` captured retrieval queries, `src/slack/slash-command-handler.test.ts`, `src/handlers/identity-suggest.test.ts`, and `bun run verify:m045:s01 -- --json`.
- Failure visibility: generic-state hint leaks show up as query-string assertions; opt-out/help/DM copy drift shows up as exact response text mismatches.
- Redaction constraints: user-facing Slack copy must not expose raw profile IDs, Slack IDs, or internal score/tier details on generic states.

## Integration Closure

- Upstream surfaces consumed: `src/contributor/experience-contract.ts`, `src/handlers/review.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/slack/slash-command-handler.ts`, and `src/handlers/identity-suggest.ts`.
- New wiring introduced in this slice: review retrieval asks the contract seam for an optional hint; Slack/profile and identity-copy surfaces ask the seam for contract-first user-facing wording.
- What remains before the milestone is truly usable end-to-end: S03 still needs one operator-facing verifier that checks GitHub, Slack, retrieval, and opt-out truthfulness together.

## Tasks

- [x] **T01: Ship contract-approved retrieval hints through review-time retrieval** `est:2h`
  - Why: Review-time retrieval is still the hidden drift path because `authorClassification.tier` leaks raw contributor tiers even when the contributor-experience contract state is generic.
  - Files: `src/contributor/experience-contract.ts`, `src/contributor/experience-contract.test.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/knowledge/multi-query-retrieval.test.ts`, `src/knowledge/retrieval-query.ts`, `src/knowledge/retrieval-query.test.ts`, `src/handlers/review.ts`, `src/handlers/review.test.ts`
  - Do: Add a contract-owned retrieval-hint projection, rename the shared knowledge-builder input to an optional generic `authorHint`, wire `src/handlers/review.ts` to pass that projection instead of `authorClassification.tier`, and align the legacy single-query helper/tests so generic states cannot preserve pre-S01 raw-tier semantics. Keep `src/handlers/mention.ts` unchanged by leaving the hint optional.
  - Verify: `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts && bun run verify:m045:s01 -- --json`
  - Done when: `profile-backed` / `coarse-fallback` states emit only approved hint values, `generic-opt-out` / `generic-unknown` / `generic-degraded` emit no hint, and the GitHub contract verifier stays green.

- [x] **T02: Make Slack profile, opt-in/out, and identity suggestions contract-first** `est:2h`
  - Why: Slack `/kodiai profile`, opt-in/out responses, and identity suggestion DMs are the remaining user-visible promises that can still contradict the S01 contract.
  - Files: `src/contributor/experience-contract.ts`, `src/contributor/experience-contract.test.ts`, `src/slack/slash-command-handler.ts`, `src/slack/slash-command-handler.test.ts`, `src/handlers/identity-suggest.ts`, `src/handlers/identity-suggest.test.ts`
  - Do: Add a contract-first Slack/profile projection, replace raw `Tier` / `Score` copy with contract/status wording, align `profile opt-out`, `profile opt-in`, and unknown-command help text, and add a dedicated `identity-suggest` test harness while updating DM copy to promise linked-profile guidance plus opt-out control instead of “personalized code reviews.”
  - Verify: `bun test ./src/contributor/experience-contract.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts && bun run tsc --noEmit`
  - Done when: opted-out users never see raw tier/score or personalized-review language, help text advertises both opt-in and opt-out, and unit tests pin Slack response plus DM copy across no-profile, existing-link, and high-confidence-match cases.

## Files Likely Touched

- `src/contributor/experience-contract.ts`
- `src/contributor/experience-contract.test.ts`
- `src/knowledge/multi-query-retrieval.ts`
- `src/knowledge/multi-query-retrieval.test.ts`
- `src/knowledge/retrieval-query.ts`
- `src/knowledge/retrieval-query.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/slack/slash-command-handler.ts`
- `src/slack/slash-command-handler.test.ts`
- `src/handlers/identity-suggest.ts`
- `src/handlers/identity-suggest.test.ts`
