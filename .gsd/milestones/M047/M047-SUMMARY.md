---
id: M047
title: "Contributor Experience Redesign and Calibration Rollout"
status: complete
completed_at: 2026-04-11T04:07:07.363Z
key_decisions:
  - D085 — Stage M047 as review trust repair first, downstream Slack/retrieval/profile rollout second, and integrated milestone verification last.
  - D086/D089 — Treat persisted contributor profiles as trustworthy only when a current versioned trust marker proves the row is calibrated; raw stored tiers alone are never enough.
  - D090 — Route GitHub review-time contributor resolution through the shared `resolveReviewAuthorClassification` seam so prompt shaping, Review Details, fallback behavior, and diagnostics stay coherent.
  - D092 — Resolve Slack/profile continuity through a dedicated stored-profile surface resolver instead of raw tier reads or review-time fallback semantics.
  - D094 — Compose `verify:m047:s02` from the authoritative embedded `verify:m047:s01` runtime report plus a local downstream scenario matrix rather than duplicating resolution logic.
  - D095/D096 — Compose `verify:m047` only from `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()`, preserving nested evidence verbatim and marking coarse-fallback Slack/profile continuity as `not_applicable` instead of fabricating evidence.
  - D097 — Treat leaked opt-out linked-continuity evidence as a hard milestone-drift failure with explicit diagnostics.
key_files:
  - src/db/migrations/037-contributor-profile-trust.sql
  - src/db/migrations/037-contributor-profile-trust.down.sql
  - src/contributor/profile-trust.ts
  - src/contributor/profile-store.ts
  - src/contributor/review-author-resolution.ts
  - src/handlers/review.ts
  - src/contributor/profile-surface-resolution.ts
  - src/slack/slash-command-handler.ts
  - src/handlers/identity-suggest.ts
  - scripts/verify-m047-s01.ts
  - scripts/verify-m047-s02.ts
  - scripts/verify-m047.ts
  - package.json
lessons_learned:
  - Persisted contributor guidance needs explicit versioned trust metadata; raw stored tiers or default newcomer values are not a trustworthy public contract.
  - Cross-surface contributor behavior stays coherent only when review, Slack/profile, retrieval, and identity flows consume shared resolver seams instead of re-deriving tier semantics independently.
  - Milestone-close verifiers should compose authoritative nested reports, preserve negative domain verdicts as data, and fail on forbidden evidence so cross-surface drift cannot go false-green.
---

# M047: Contributor Experience Redesign and Calibration Rollout

**M047 shipped a trustworthy persisted-profile trust boundary, rolled that contributor-experience truth through review, Slack/profile, retrieval, and identity surfaces, and closed with a canonical integrated `verify:m047` coherence report.**

## What Happened

M047 took the M045 contributor-experience contract and the M046 replacement contract from design/proof into shipped runtime behavior. S01 added persisted trust metadata (`trust_marker`) plus a reusable classifier/resolver seam so linked-unscored, legacy, stale, malformed, calibrated, and opted-out contributor rows no longer masquerade as trustworthy `profile-backed` guidance on the live GitHub review path. Review-time prompt shaping, Review Details, fallback behavior, and handler diagnostics now flow through the same trust-aware `resolveReviewAuthorClassification` seam.

S02 carried that truth boundary through every downstream stored-profile surface. Slack/profile continuity now resolves persisted contributor rows through `resolveContributorProfileSurface(...)` instead of raw tier state, expertise is shown only for current trusted calibrated rows, retrieval hints stay aligned with the same contract states, and system-view opted-out lookups suppress duplicate identity-link DMs without re-enabling contributor-specific guidance.

S03 closed the milestone with `verify:m047`, the canonical milestone-level coherence verifier. It composes only `verify:m047:s02`, `verify:m045:s03`, and `verify:m046`, preserves their nested reports verbatim, maps five operator-facing scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`), treats the M046 `replace` recommendation as machine-readable data rather than harness failure, and fails loudly on malformed nested evidence, mapping drift, or leaked forbidden opt-out continuity. Fresh milestone-close verification reran the dedicated `verify:m047` regression suite, the integrated verifier, the prerequisite verifier bundle, and `bun run tsc --noEmit`, all of which passed.

## Decision Re-evaluation

| Decision | Re-evaluation | Result |
| --- | --- | --- |
| D085 | The risk-ordered slice plan held: S01 fixed the live review trust boundary first, S02 rolled that same seam through downstream surfaces, and S03 closed with the integrated verifier. The executed work matched the planned dependency order and retired the highest-risk false-`profile-backed` failure before broader rollout. | Keep |
| D086 | Persisted contributor rows still required an explicit trust boundary separate from raw tier labels. Fresh runtime and downstream verification showed linked-unscored, legacy, stale, malformed, and opted-out rows no longer overclaim trustworthy guidance. | Keep |
| D087 | Composing M045 and M046 proof surfaces with new runtime source-resolution scenarios remained the right M047 proof strategy. `verify:m047 -- --json` preserved nested M045/M046 evidence while adding the new five-scenario milestone matrix. | Keep |
| D088 | Explicit persisted calibration metadata remained necessary for review-time truth. The milestone shipped the trust seam in persistence and reused it across live review and downstream surfaces without falling back to raw stored tiers. | Keep |
| D089 | The single nullable versioned `trust_marker` (`m047-calibrated-v1`) remained the correct minimum persistence change. It cleanly distinguished calibrated rows from linked-unscored and legacy rows, and the S01/S02 verifiers passed against that seam. | Keep |
| D090 | The shared `resolveReviewAuthorClassification` resolver proved correct in production-facing code: prompt shaping, Review Details, fallback behavior, and diagnostics stayed aligned under one trust-aware path. | Keep |
| D091 | Stable scenario-level runtime checks with embedded diagnostics remained the right verifier design. S02 and S03 consumed the nested S01 report mechanically instead of rebuilding its logic. | Keep |
| D092 | A dedicated stored-profile surface resolver remained the correct downstream model. Slack/profile continuity stayed truthful because S02 treated persisted rows as persisted-profile states, not as review-time fallback states. | Keep |
| D093 | Proving signed slash-command continuity and identity suppression through a focused downstream verifier remained valid. The route and identity seams stayed narrow while still producing operator-facing evidence. | Keep |
| D094 | Composing `verify:m047:s02` from the embedded S01 report plus a local downstream matrix remained the right anti-drift pattern. The milestone reused authoritative review/runtime evidence instead of duplicating resolution rules in a second harness. | Keep |
| D095 | Restricting `verify:m047` composition to `evaluateM047S02()`, `evaluateM045S03()`, and `evaluateM046()` remained the right milestone-close contract. The final verifier stayed honest by preserving nested evidence instead of reaching beneath those reports. | Keep |
| D096 | Mapping `coarse-fallback` to S01 cache/runtime plus M045 retrieval evidence while marking Slack/profile continuity `not_applicable` remained correct. Fresh milestone verification stayed truthful without fabricating a nonexistent linked-profile Slack surface. | Keep |
| D097 | Failing the milestone on leaked opt-out linked continuity remained essential. The dedicated regression suite and fresh `verify:m047 -- --json` run both preserved that hard-failure behavior, closing the false-green hole. | Keep |

No M047 decision needs immediate re-scoping. Future contributor-resolution work should extend the existing verifier and shared resolver seams rather than creating parallel truth paths.

## Success Criteria Results

- ✅ **Truthful review-path resolution shipped:** S01 delivered the persisted trust seam and shared review resolver, and fresh verification reconfirmed it. `bun run verify:m047:s02 -- --json` preserved the embedded `verify:m047:s01` report with all six runtime scenarios passing (`linked-unscored`, `legacy`, `stale`, `calibrated`, `opt-out`, `coarse-fallback-cache`). Those scenarios showed linked-unscored and legacy rows failing open to coarse fallback, stale trusted rows degrading truthfully, calibrated retained rows staying `profile-backed`, and opted-out rows staying generic.
- ✅ **Downstream Slack/profile, retrieval, and identity behavior stayed coherent:** S02 rolled the same stored-profile truth boundary through `/kodiai profile`, link/opt continuity, retrieval hints, and identity suppression. Fresh prerequisite verification passed `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`, confirming generic continuity for untrusted rows, `profile-backed` continuity only for current trusted calibrated rows, retrieval hint alignment without raw-tier leakage, and duplicate-DM suppression for opted-out linked contributors.
- ✅ **Canonical operator-facing milestone proof surface shipped:** `bun run verify:m047 -- --json` passed during milestone closeout and preserved nested S02/M045/M046 evidence while reporting the four stable top-level checks (`M047-S03-S02-REPORT-COMPOSED`, `M047-S03-M045-REPORT-COMPOSED`, `M047-S03-M046-REPORT-COMPOSED`, `M047-S03-MILESTONE-SCENARIOS`). The five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`) all resolved coherently across review/runtime, Review Details, retrieval hints, Slack/profile output, identity behavior, and contributor-model evidence.
- ✅ **Code changes exist outside `.gsd/`:** `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` returned a non-empty diff spanning 79 non-`.gsd/` files, including `src/contributor/profile-trust.ts`, `src/contributor/review-author-resolution.ts`, `src/contributor/profile-surface-resolution.ts`, `src/slack/slash-command-handler.ts`, `src/handlers/identity-suggest.ts`, `scripts/verify-m047-s01.ts`, `scripts/verify-m047-s02.ts`, `scripts/verify-m047.ts`, and `package.json`.

## Definition of Done Results

- ✅ **All slices are complete:** `gsd_milestone_status(M047)` reported S01, S02, and S03 all `complete`, with task counts 3/3, 3/3, and 2/2 respectively.
- ✅ **All slice summaries exist:** `find .gsd/milestones/M047/slices -maxdepth 2 -type f -name 'S*-SUMMARY.md' | sort` returned `S01-SUMMARY.md`, `S02-SUMMARY.md`, and `S03-SUMMARY.md`.
- ✅ **Cross-slice integration works correctly:** Fresh `bun run verify:m047 -- --json` passed and preserved the nested S02, M045, and M046 reports while verifying the five milestone scenarios end to end. The prerequisite bundle (`bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`) also passed, confirming the shared trust seam stays coherent across review/runtime, downstream Slack/profile continuity, retrieval, identity behavior, and contributor-model proof surfaces.
- ✅ **Implementation remains type-safe:** `bun run tsc --noEmit` exited 0 during milestone closeout.
- ℹ️ **Horizontal checklist:** `.gsd/milestones/M047/M047-ROADMAP.md` contains no separate Horizontal Checklist section, so there were no unchecked horizontal items to audit.

## Requirement Outcomes

- **R046 — validated.** Fresh milestone-close verification passed `bun run verify:m047 -- --json` and the prerequisite bundle (`bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`), proving the contributor-experience contract remains truthful across review prompt/Review Details, retrieval hints, Slack/profile output, identity suppression, and contributor-model evidence without raw-tier drift.
- **R048 — validated.** Fresh milestone-close verification passed `bun test ./scripts/verify-m047.test.ts`, `bun run verify:m047 -- --json`, `bun run verify:m047:s02 -- --json && bun run verify:m045:s03 -- --json && bun run verify:m046 -- --json`, and `bun run tsc --noEmit`. The integrated `verify:m047` report preserved nested S02/M045/M046 evidence and the five milestone scenarios (`linked-unscored`, `calibrated-retained`, `stale-degraded`, `opt-out`, `coarse-fallback`) across review/runtime, Review Details, retrieval hints, Slack/profile output, identity behavior, and contributor-model evidence.
- No other requirements were deferred, blocked, invalidated, or moved out of scope during milestone closeout.

## Deviations

None.

## Follow-ups

Use `verify:m047` as the canonical proof surface for future contributor-resolution changes. If later work changes review/runtime, Slack/profile, retrieval, or identity behavior, extend the existing scenario matrix instead of creating a parallel verifier. Consider adding live operational alerting for false active linked guidance or leaked opt-out continuity if those regressions become production concerns.
