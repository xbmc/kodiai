---
id: S01
parent: M047
milestone: M047
provides:
  - A reusable persisted-row trust seam in `src/contributor/profile-trust.ts` and `m047-calibrated-v1` marker semantics for downstream surfaces.
  - A shared trust-aware author-resolution module that downstream Slack/retrieval/profile work can mirror instead of reimplementing.
  - `verify:m047:s01`, the canonical nested proof surface for stored-profile runtime truth on the review path.
requires:
  []
affects:
  - S02
  - S03
key_files:
  - src/db/migrations/037-contributor-profile-trust.sql
  - src/db/migrations/037-contributor-profile-trust.down.sql
  - src/contributor/profile-trust.ts
  - src/contributor/profile-store.ts
  - src/contributor/review-author-resolution.ts
  - src/handlers/review.ts
  - scripts/verify-m047-s01.ts
  - package.json
  - .gsd/KNOWLEDGE.md
  - .gsd/PROJECT.md
key_decisions:
  - Persist a versioned `trust_marker` (`m047-calibrated-v1`) and derive stored-profile trust from that marker plus freshness instead of inferring trust from raw `overall_tier`.
  - Route review-time contributor classification through a shared `resolveReviewAuthorClassification` seam so the handler, prompt shaping, Review Details, and fallback paths all consume the same trust-aware resolution.
  - Model the runtime verifier as one stable scenario-level check per stored-profile state while embedding trust, contract, source, fallback, degradation, prompt, and Review Details diagnostics for later milestone composition.
patterns_established:
  - Versioned persisted trust metadata is the trust boundary; raw tier labels alone are not trustworthy.
  - Trust-aware review classification now lives in one shared resolver instead of duplicated inline handler logic.
  - Runtime proof harnesses should emit stable scenario-level checks plus embedded diagnostics so later milestone verifiers can compose them mechanically.
observability_surfaces:
  - `bun run verify:m047:s01` runtime stored-profile truth matrix with stable scenario check IDs and trust/contract/source/fallback/degradation diagnostics.
  - Author-classification log entries from `src/handlers/review.ts`, which now expose stored-profile trust state, reason, marker/version, source, fallback path, and degradation path.
  - `src/handlers/review.test.ts` integration coverage for fail-open behavior, prompt/Review Details coherence, and trust-aware logging assertions.
drill_down_paths:
  - .gsd/milestones/M047/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M047/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M047/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-11T01:09:04.940Z
blocker_discovered: false
---

# S01: Truthful contributor resolution on GitHub review

**GitHub review-time contributor resolution now treats stored profiles as `profile-backed` only when a current trusted calibration marker proves the row is trustworthy; linked-unscored, legacy, stale, malformed, and opted-out rows fail open truthfully instead of masquerading as newcomer guidance.**

## What Happened

S01 closed the root-cause trust gap on the GitHub review surface. The slice added persisted contributor-profile trust metadata, introduced `src/contributor/profile-trust.ts` as the canonical classifier for calibrated versus linked-unscored/legacy/stale/malformed rows, and taught the profile store to stamp the current `m047-calibrated-v1` marker on fresh scoring updates. Review-time author classification now flows through `resolveReviewAuthorClassification`, which preserves opt-out precedence, allows only trustworthy calibrated rows to stay `profile-backed`, and forces untrusted stored rows to fail open into author-cache, GitHub search, or generic/degraded behavior. The review handler now keeps prompt shaping, Review Details, and author-classification logs coherent across linked-unscored, legacy, stale, calibrated, opt-out, and coarse-fallback scenarios while keeping public output redacted from Slack IDs, profile IDs, raw expertise scores, and calibration-only internals. The slice also shipped `verify:m047:s01`, an operator-facing runtime proof harness with six stable scenario checks (`linked-unscored`, `legacy`, `stale`, `calibrated`, `opt-out`, and `coarse-fallback-cache`) so downstream S03 work can compose this seam into integrated milestone proof.

## Verification

Fresh slice-close verification passed: `bun test ./src/contributor/profile-trust.test.ts ./src/contributor/profile-store.test.ts ./src/contributor/review-author-resolution.test.ts ./src/handlers/review.test.ts ./scripts/verify-m047-s01.test.ts`, `bun run verify:m045:s01 && bun run verify:m047:s01`, and `bun run tsc --noEmit`. The runtime verifier reported PASS for linked-unscored, legacy, stale, calibrated, opt-out, and coarse-fallback-cache scenarios with the expected trust/contract/source/fallback matrix, and the review handler test suite confirmed fail-open behavior plus trust-aware author-classification logging.

## Requirements Advanced

- R046 — The live GitHub review path now honors the contributor-experience contract truthfully against persisted contributor state instead of trusting raw stored tiers.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None.

## Known Limitations

Slack/profile continuity and retrieval hint surfaces still need the same trust-aware rollout in S02. The milestone still lacks the integrated `verify:m047` composition layer planned for S03. Runtime regression detection is currently verifier-and-log driven rather than backed by a dedicated production alert.

## Follow-ups

Roll the same trust-aware resolver semantics through retrieval hints and Slack/profile continuity in S02. Compose `verify:m047:s01` with the M045 and M046 proof surfaces in S03, and add milestone-level observability for unexpected `profile-backed` resolution from untrusted stored rows.

## Files Created/Modified

- `src/db/migrations/037-contributor-profile-trust.sql` — Added persisted nullable trust metadata for contributor profiles.
- `src/db/migrations/037-contributor-profile-trust.down.sql` — Added down migration for the contributor profile trust marker.
- `src/contributor/profile-trust.ts` — Added the canonical persisted-row trust classifier for calibrated, linked-unscored, legacy, stale, and malformed states.
- `src/contributor/profile-store.ts` — Taught the profile store to read/write trust markers, fail fast when the column is missing, and stamp fresh scoring updates.
- `src/contributor/review-author-resolution.ts` — Centralized trust-aware review-time author resolution with fail-open fallback behavior.
- `src/handlers/review.ts` — Updated the GitHub review handler to consume the shared resolver and emit trust-aware author-classification diagnostics while keeping Review Details redacted.
- `scripts/verify-m047-s01.ts` — Added the operator-facing runtime truth harness for stored-profile review resolution.
- `package.json` — Wired the new verifier into package scripts.
- `.gsd/KNOWLEDGE.md` — Recorded reusable execution gotchas for this slice.
- `.gsd/PROJECT.md` — Refreshed project state to show M047/S01 complete and M047 remaining work.
