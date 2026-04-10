---
id: S01
parent: M045
milestone: M045
provides:
  - A typed contributor-experience contract seam for the GitHub review path.
  - Contract-driven prompt and Review Details projections that stay truthful across profile-backed, coarse fallback, unknown, opt-out, and degraded states.
  - A reusable five-scenario proof harness that downstream slices can extend instead of recreating GitHub review fixtures from scratch.
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/contributor/experience-contract.ts
  - src/contributor/profile-store.ts
  - src/handlers/review.ts
  - src/execution/review-prompt.ts
  - src/lib/review-utils.ts
  - scripts/verify-m045-s01.ts
  - scripts/verify-m042-s02.ts
  - scripts/verify-m042-s03.ts
  - package.json
  - src/handlers/review-idempotency.ts
key_decisions:
  - Model GitHub contributor experience as explicit contract states instead of exposing raw mixed tier strings on the review surface.
  - Use `getByGithubUsername(..., { includeOptedOut: true })` for system review-time lookups, then collapse opted-out profiles to a generic contract state.
  - Derive runtime prompt author-experience wording from contract-level `promptPolicy` projections while keeping `authorTier` as a temporary compatibility path for non-runtime callers.
  - Use `scripts/verify-m045-s01.ts` as the shared source of contributor-experience scenario fixtures and wording expectations for both the new M045 proof surface and the older M042 continuity verifiers.
patterns_established:
  - Separate contributor signal provenance/coarseness from behavior with one typed contract seam, then project both prompt instructions and Review Details wording from that shared contract.
  - Handle opted-out profiles by explicitly including them in system lookup and immediately collapsing them back to generic behavior so detection does not accidentally restore contributor-specific adaptation.
  - Keep truthfulness verifiers on one shared scenario matrix so legacy continuity checks and new proof surfaces cannot drift phrase-by-phrase.
observability_surfaces:
  - Structured handler logs with `contributorExperienceState`, `contributorExperienceSource`, and `contributorExperienceDegradationPath`.
  - Review Details contract line rendered by `formatReviewDetailsSummary()`.
  - `bun run verify:m045:s01 -- --json` scenario output with `contractState`, `contractSource`, and phrase-level mismatch diagnostics.
drill_down_paths:
  - .gsd/milestones/M045/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M045/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M045/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-09T16:07:04.567Z
blocker_discovered: false
---

# S01: Contract-Driven GitHub Review Behavior

**Shipped one explicit contributor-experience contract for the GitHub review surface, aligned prompt shaping and Review Details to it, and packaged a five-scenario verifier with M042 continuity guards.**

## What Happened

S01 introduced `src/contributor/experience-contract.ts` as the typed seam that separates contributor signal provenance/coarseness from GitHub review behavior. Review-time resolution in `src/handlers/review.ts` now distinguishes `profile-backed`, `coarse-fallback`, `generic-unknown`, `generic-opt-out`, and `generic-degraded` states even when `knowledgeStore` is unavailable. System contributor-profile lookup uses `getByGithubUsername(..., { includeOptedOut: true })` so opted-out profiles can be detected and deliberately collapsed to generic behavior instead of reviving profile-backed guidance. The handler threads the resolved contract through both primary and retry prompt construction, logs `contributorExperienceState`, `contributorExperienceSource`, and `contributorExperienceDegradationPath`, and keeps the earlier M042 precedence guarantees intact.

On the presentation side, `src/execution/review-prompt.ts` now derives runtime author-experience instructions from contract-level `promptPolicy` projections, while `src/lib/review-utils.ts` renders one truthful Review Details contract line instead of leaking raw mixed tier strings. Coarse fallback no longer overclaims established/senior familiarity, unknown and opted-out paths stay neutral, and degraded search enrichment discloses partial analysis without claiming contributor certainty. `scripts/verify-m045-s01.ts` became the canonical proof harness for the five in-scope scenarios and exposes both human and JSON diagnostics. The existing M042 truthfulness verifiers now import the same fixtures and expectations so prompt wording and Review Details wording cannot drift independently. To finish the slice with a clean verification bar, T03 also fixed two unrelated strictness blockers in `scripts/verify-m044-s01.test.ts` and `src/handlers/review-idempotency.ts`.

## Operational Readiness
- **Health signal:** `bun run verify:m045:s01 -- --json` returns `overallPassed: true`, all five scenarios, and empty `missingPhrases`/`unexpectedPhrases`; handler tests confirm the structured contributor-experience log fields are emitted.
- **Failure signal:** any verifier result that reports a failed `scenarioId`/`surface`, any Review Details output that reintroduces raw tier strings, or any handler regression that drops `contributorExperienceState`, `contributorExperienceSource`, or `contributorExperienceDegradationPath` from logs.
- **Recovery procedure:** rerun `bun run verify:m045:s01 -- --json`, inspect the failing scenario and surface, repair the shared contract projections in `experience-contract.ts`, `review-prompt.ts`, or `review-utils.ts`, then rerun the targeted tests plus `verify:m042:s02`, `verify:m042:s03`, and `verify:m045:s01`.
- **Monitoring gaps:** this slice proves only the GitHub review surface. Slack/profile semantics, retrieval shaping, and cross-surface drift detection still need S02/S03 before the milestone has a full operator-ready contract monitor.

## Verification

Fresh slice verification passed:
- `bun test ./src/contributor/experience-contract.test.ts ./src/handlers/review.test.ts ./src/execution/review-prompt.test.ts ./src/lib/review-utils.test.ts ./scripts/verify-m045-s01.test.ts`
- `bun run verify:m042:s02 && bun run verify:m042:s03 && bun run verify:m045:s01`
- `bun run verify:m045:s01 -- --json`
- `bun run tsc --noEmit`

Evidence highlights:
- 320/320 targeted tests passed across contract, handler, prompt, Review Details, and verifier files.
- `verify:m045:s01` passed all 10 prompt/review-details checks across the five scenarios: profile-backed, coarse-fallback, generic-unknown, generic-opt-out, and generic-degraded.
- The JSON verifier surface returned `overallPassed: true`, scenario-level `contractState`/`contractSource`, and empty `missingPhrases`/`unexpectedPhrases` arrays.
- `createReviewHandler auto profile selection > logs contributor-experience state, source, and degradation path for inspection` passed, confirming the planned observability hook.

## Requirements Advanced

- R046 — Defined and proved the GitHub review contributor-experience contract seam, including five explicit states, contract-driven prompt/details projections, and a shared verifier matrix for the first in-scope surface.

## Requirements Validated

None.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

To get the final slice verification bar clean, T03 also fixed two small strictness blockers outside the planned slice file list: `scripts/verify-m044-s01.test.ts` now uses a type-correct M044 report stub, and `src/handlers/review-idempotency.ts` narrows parsed key segments before splitting the repo segment.

## Known Limitations

- This slice proves only the GitHub review surface. Slack/profile semantics, retrieval shaping, and cross-surface drift verification remain for S02 and S03.
- `buildReviewPrompt()` still accepts legacy `authorTier` inputs for compatibility, so downstream slices should continue migrating remaining surfaces to `contributorExperienceContract` rather than extending raw-tier behavior.

## Follow-ups

- Extend the same contract and opt-out semantics to Slack profile copy, retrieval shaping, and review-time fallback resolution in S02.
- Add the cross-surface verifier in S03 so operators can detect contract drift outside the GitHub review path.
- Remove residual legacy raw-tier compatibility once downstream surfaces consume `contributorExperienceContract` directly.

## Files Created/Modified

- `src/contributor/experience-contract.ts` — Added the typed contributor-experience contract states, prompt-policy projections, and Review Details wording helpers for GitHub review behavior.
- `src/contributor/profile-store.ts` — Extended system contributor-profile lookup to include opted-out profiles so review-time resolution can detect opt-out and collapse it to a generic contract state.
- `src/handlers/review.ts` — Resolved contributor experience without `knowledgeStore` gating, threaded the contract through primary/retry prompt construction, and logged structured contract state/source/degradation data.
- `src/execution/review-prompt.ts` — Switched runtime author-experience prompt shaping onto contract projections and kept raw `authorTier` as a compatibility fallback.
- `src/lib/review-utils.ts` — Rendered Review Details from the contract projection instead of leaking raw mixed tier strings.
- `scripts/verify-m045-s01.ts` — Added the canonical five-scenario GitHub contributor-experience proof harness with human and JSON diagnostics.
- `scripts/verify-m042-s02.ts` — Reused the shared M045 contract fixtures and wording expectations for the existing M042 established/profile-backed truthfulness guard.
- `scripts/verify-m042-s03.ts` — Reused the shared M045 contract fixtures and wording expectations for the cache/fallback/degraded truthfulness guard.
- `package.json` — Registered `verify:m045:s01` as the stable package entrypoint for the new slice verifier.
- `src/handlers/review-idempotency.ts` — Applied a small type-narrowing fix so the finished slice could pass `bun run tsc --noEmit` cleanly.
