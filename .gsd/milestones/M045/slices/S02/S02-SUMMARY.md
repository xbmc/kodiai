---
id: S02
parent: M045
milestone: M045
provides:
  - A contract-owned retrieval-hint projection and optional `authorHint` retrieval API that suppresses contributor hints for all generic states.
  - Contract-first Slack profile, opt-in/out, and help semantics that hide raw tier/score wording whenever guidance is generic.
  - Truthful identity-link DM copy plus deterministic regression coverage for retrieval, Slack copy, and fail-open Slack suggestion behavior.
requires:
  - slice: S01
    provides: Typed contributor-experience contract states plus shared GitHub wording expectations that S02 extends into retrieval and Slack surfaces.
affects:
  - S03
key_files:
  - src/contributor/experience-contract.ts
  - src/contributor/experience-contract.test.ts
  - src/knowledge/multi-query-retrieval.ts
  - src/knowledge/multi-query-retrieval.test.ts
  - src/knowledge/retrieval-query.ts
  - src/knowledge/retrieval-query.test.ts
  - src/handlers/review.ts
  - src/handlers/review.test.ts
  - src/slack/slash-command-handler.ts
  - src/slack/slash-command-handler.test.ts
  - src/handlers/identity-suggest.ts
  - src/handlers/identity-suggest.test.ts
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D068 — Project retrieval hints from the contributor-experience contract instead of raw tiers; normalize profile-backed hints, collapse coarse fallback to `returning contributor`, and suppress hints for generic states.
  - D069 — Project Slack profile and identity-link messaging from the contributor-experience contract, hide raw tier/score semantics, and suppress expertise on generic states.
  - Expose `resetIdentitySuggestionStateForTests()` so cached Slack member/suggestion state can be reset between tests and fail-open identity-suggestion coverage stays deterministic.
patterns_established:
  - Treat every downstream contributor surface as a projection from `src/contributor/experience-contract.ts` rather than reading persisted tier strings directly.
  - Use nullable `authorHint` inputs in retrieval builders so generic states disappear cleanly instead of forcing placeholder contributor text.
  - Add narrow reset seams for stateful Slack modules with in-memory caches when deterministic test isolation matters.
observability_surfaces:
  - `src/handlers/review.test.ts` captures retrieval query strings and asserts when `author:` hints must appear or be absent.
  - `src/slack/slash-command-handler.test.ts` pins exact `/kodiai profile`, opt-in/out, and help response text.
  - `src/handlers/identity-suggest.test.ts` pins the DM body and the non-blocking Slack API failure path.
  - `bun run verify:m045:s01 -- --json` keeps the S01 GitHub contributor-experience contract green while S02 extends downstream surfaces.
drill_down_paths:
  - .gsd/milestones/M045/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M045/slices/S02/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-09T17:29:30.699Z
blocker_discovered: false
---

# S02: Unified Slack, Opt-Out, and Retrieval Semantics

**Extended the contributor-experience contract into review retrieval, Slack `/kodiai profile` flows, opt-in/out help copy, and identity-link DMs so downstream surfaces no longer rely on raw tier semantics.**

## What Happened

S02 moved the remaining contributor-experience drift surfaces onto contract-owned projections instead of raw `overallTier` or `authorTier` values. `src/contributor/experience-contract.ts` now exposes `resolveContributorExperienceRetrievalHint()`, which maps `profile-backed` states to normalized contributor-facing hints (`new contributor`, `developing contributor`, `established contributor`, `senior contributor`), collapses `coarse-fallback` to `returning contributor`, and emits no hint for `generic-opt-out`, `generic-unknown`, `generic-degraded`, or malformed inputs. The review path now passes this optional `authorHint` into both retrieval builders, so generic states stop leaking tier vocabulary while mention retrieval remains compatible through the nullable hint seam.

S02 also made Slack and identity-link messaging contract-first. `/kodiai profile` now renders status/summary lines from the contributor-experience contract, hides raw tier/score lines, and suppresses expertise whenever the resolved state is generic. `profile opt-out`, `profile opt-in`, and unknown-command help now tell the truth about generic versus linked guidance. `src/handlers/identity-suggest.ts` now sends one truthful DM that offers linked-profile guidance when available and advertises `/kodiai profile opt-out` instead of promising personalized reviews, while preserving fail-open behavior for missing links and Slack API failures. To keep the Slack/member cache behavior testable, the slice also established an explicit reset seam for identity-suggestion in-memory state.

## Operational Readiness
- **Health signal:** the fresh slice regression suite passed with 136 tests across the contract, retrieval, review, Slack, and identity-suggestion files; `bun run verify:m045:s01 -- --json` returned `overallPassed: true`; and the named tests that capture retrieval query strings, Slack response text, and DM copy all passed.
- **Failure signal:** any review retrieval query for a generic contributor state that still contains an `author:` fragment, any Slack profile/help/opt-in/out response that reintroduces raw tier or score wording, or any identity-suggest DM/log path that revives `personalized code reviews` language or stops failing open on Slack API errors.
- **Recovery procedure:** rerun the slice test command plus `bun run verify:m045:s01 -- --json`, inspect the contract projections in `src/contributor/experience-contract.ts` and their consumers in `src/handlers/review.ts`, `src/knowledge/multi-query-retrieval.ts`, `src/knowledge/retrieval-query.ts`, `src/slack/slash-command-handler.ts`, and `src/handlers/identity-suggest.ts`, then rerun `bun run tsc --noEmit`.
- **Monitoring gaps:** cross-surface truthfulness is still proven through targeted tests and the S01 GitHub verifier. S03 still needs to package these Slack/retrieval/opt-out checks into one operator-facing drift command.

## Verification

Fresh slice verification passed:
- `bun test ./src/contributor/experience-contract.test.ts ./src/knowledge/multi-query-retrieval.test.ts ./src/knowledge/retrieval-query.test.ts ./src/handlers/review.test.ts ./src/slack/slash-command-handler.test.ts ./src/handlers/identity-suggest.test.ts` → exit 0, 136 pass, 0 fail.
- `bun run verify:m045:s01 -- --json` → exit 0 with `overallPassed: true` across all 10 GitHub contract prompt/details checks.
- `bun run tsc --noEmit` → exit 0.

Evidence highlights:
- `resolveContributorExperienceRetrievalHint` tests proved only `profile-backed` and `coarse-fallback` states emit retrieval hints, while generic and malformed states emit none.
- `createReviewHandler` regression tests captured retrieval query strings and verified `author: new contributor` appears for profile-backed review retrieval while generic opt-out states emit no `author:` fragment or raw tier vocabulary.
- `handleKodiaiCommand` tests pinned exact `/kodiai profile`, `profile opt-in`, `profile opt-out`, and unknown-command help text so Slack copy cannot drift back to tier/score semantics.
- `suggestIdentityLink` tests pinned the DM body, confirmed it no longer promises personalized reviews, and proved Slack API failures remain non-blocking with a warning log.

## Requirements Advanced

- R046 — Extended the contributor-experience contract from the GitHub review surface into review retrieval hints, Slack profile/opt controls, and identity-link messaging while preserving S01 verifier truthfulness.

## Requirements Validated

None.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

- S03 still needs one operator-facing verifier that checks GitHub review behavior, Slack/profile copy, retrieval hint presence/absence, and opt-out truthfulness from a single command.
- Identity-suggestion one-shot suppression remains process-local and in-memory; a process restart clears the suppression set and can allow a future re-suggestion.

## Follow-ups

- Build S03 around the new drift indicators so operators can verify Slack/profile text and retrieval hint suppression without relying on individual test files.
- If product wants stronger anti-spam guarantees for identity suggestions, persist the one-shot suppression state instead of keeping it process-local.

## Files Created/Modified

- `src/contributor/experience-contract.ts` — Added contract-owned retrieval-hint and Slack-profile projections that normalize profile-backed states, collapse coarse fallback, and keep generic states generic.
- `src/contributor/experience-contract.test.ts` — Pinned retrieval-hint and Slack-profile behavior across profile-backed, coarse-fallback, opted-out, generic, and malformed inputs.
- `src/knowledge/multi-query-retrieval.ts` — Renamed the shared retrieval-builder contributor input to optional `authorHint` so variant generation can omit hints cleanly for generic states.
- `src/knowledge/multi-query-retrieval.test.ts` — Added regression coverage proving empty author hints are normalized away and no `author:` fragment is forced for generic states.
- `src/knowledge/retrieval-query.ts` — Normalized optional author hints into single-query retrieval text and omitted blank hints after trimming/casing normalization.
- `src/knowledge/retrieval-query.test.ts` — Added direct coverage for normalized author hints and omission of empty hints.
- `src/handlers/review.ts` — Passed the contract-approved retrieval hint from contributor resolution into review-time retrieval instead of leaking raw contributor tiers.
- `src/handlers/review.test.ts` — Captured profile-backed versus generic retrieval query strings and asserted that generic states leak no contributor-tier vocabulary.
- `src/slack/slash-command-handler.ts` — Switched `/kodiai profile`, `profile opt-in`, `profile opt-out`, and help copy onto contract-first contributor wording.
- `src/slack/slash-command-handler.test.ts` — Pinned exact Slack response text, hid raw tier/score semantics, and suppressed expertise for generic states.
- `src/handlers/identity-suggest.ts` — Updated suggestion DMs to truthful linked-profile guidance plus opt-out control and exposed a test reset seam for cached state.
- `src/handlers/identity-suggest.test.ts` — Added deterministic coverage for existing-link, no-match, high-confidence-match, and Slack API fail-open identity-suggestion flows.
- `.gsd/DECISIONS.md` — Recorded D068 and D069 for retrieval-hint and Slack contributor-surface contract decisions.
- `.gsd/KNOWLEDGE.md` — Recorded the RET-07 query-shape testing gotcha and the need to reset identity-suggestion cache state explicitly in tests.
