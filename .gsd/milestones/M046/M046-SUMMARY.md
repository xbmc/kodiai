---
id: M046
title: "Contributor Tier Calibration and Fixture Audit"
status: complete
completed_at: 2026-04-10T23:47:08.808Z
key_decisions:
  - D075 — Persist xbmc fixture truth as a checked-in manifest plus refreshed snapshot verified by `verify:m046:s01`.
  - D076 — Derive snapshot `generatedAt` deterministically from provenance evidence instead of wall-clock time.
  - D077 — Bound GitHub evidence collection with explicit request timeouts and degrade to named failures instead of hanging refresh.
  - D079 — Centralize xbmc snapshot loading, validation, and provenance inspection in a shared module used by S01 and S02.
  - D080 — Model the live path as linked-but-unscored newcomer guidance unless changed-file replay is honestly available, and model the intended path from checked-in full-signal evidence.
  - D081 — Gate `verify:m046:s02` on the S01 verifier while preserving loadable snapshot diagnostics on prerequisite failure.
  - D083 — Represent the M047 change contract as a typed keep/change/replace inventory with contradiction validation.
  - D084 — Keep `verify:m046` proof-surface health separate from the calibration recommendation so a truthful `replace` verdict still exits 0.
key_files:
  - fixtures/contributor-calibration/xbmc-manifest.json
  - fixtures/contributor-calibration/xbmc-snapshot.json
  - src/contributor/fixture-set.ts
  - src/contributor/xbmc-fixture-refresh.ts
  - src/contributor/xbmc-fixture-snapshot.ts
  - src/contributor/calibration-evaluator.ts
  - src/contributor/calibration-change-contract.ts
  - src/contributor/index.ts
  - src/auth/github-app.ts
  - scripts/verify-m046-s01.ts
  - scripts/verify-m046-s02.ts
  - scripts/verify-m046.ts
  - package.json
lessons_learned:
  - Keep human-curated contributor truth separate from generated live evidence so calibration proofs can refresh without losing explicit exclusion or provenance semantics.
  - Snapshot-only calibration must report fidelity limits and degraded evidence explicitly instead of fabricating historical replay precision.
  - Milestone-closeout verifiers should separate proof-surface health from domain recommendations so a truthful negative verdict remains machine-readable without being mistaken for harness failure.
---

# M046: Contributor Tier Calibration and Fixture Audit

**M046 turned xbmc contributor-tier calibration into a repeatable proof surface with checked-in fixtures, live-vs-intended evaluation, and an explicit `replace` contract for M047.**

## What Happened

M046 converted contributor-tier calibration from an implicit runtime assumption into an audited, repeatable proof surface. S01 established the checked-in xbmc fixture corpus with an explicit retained/excluded manifest, deterministic snapshot generation, provenance records, alias diagnostics, and bounded GitHub refresh behavior. S02 then loaded that corpus through one authoritative snapshot seam and compared Kodiai’s current live incremental path against the intended full-signal model without fabricating changed-file replay. The result was an explicit calibration finding: the current live path compresses retained contributors into newcomer guidance while the intended model differentiates senior and established contributors.

S03 closed the loop by composing the S01 and S02 proof surfaces into `verify:m046`, preserving nested evidence and emitting a structured `m047ChangeContract`. Fresh closeout verification reran the milestone’s dedicated tests, reran `verify:m046 -- --json`, and reran `bun run tsc --noEmit`. The integrated verifier passed with stable nested counts (`retained=3`, `excluded=6`), a truthful `replace` verdict, and one keep / one change / one replace mechanism for M047.

## Decision Re-evaluation

| Decision | Re-evaluation | Result |
| --- | --- | --- |
| D075 | The checked-in manifest + generated snapshot split remained the right persistence model; S02 and S03 consumed it directly without reconstructing contributor truth. | Keep |
| D076 | Deterministic `generatedAt` timestamping remained necessary; the verifier continues to rely on byte-stable snapshots instead of wall-clock drift. | Keep |
| D077 | Timeout-bounded GitHub enrichment remained valid; refresh proof surfaces need degraded truth, not hanging API calls. | Keep |
| D079 | The shared snapshot loader/validator proved its value by keeping S01 and S02 on one authoritative validation seam. | Keep |
| D080 | Modeling the live path as linked-but-unscored newcomer guidance was still the honest choice; fresh verification preserved the same live-path compression finding. | Keep |
| D081 | Gating S02 on S01 while still surfacing loadable snapshot diagnostics remained the right operator experience. | Keep |
| D083 | The typed keep/change/replace contract inventory remained the correct end-state for M047 handoff; the integrated verifier emitted a complete contract without contradiction. | Keep |
| D084 | Separating proof-surface health from the `replace` recommendation remained necessary; `verify:m046 -- --json` exited successfully while still truthfully recommending replacement. | Keep |

No M046 decision needs immediate re-scoping, but D080 and D084 should be revisited in M047 once the replacement runtime path exists and can be verified against live behavior rather than snapshot-only modeling.

## Success Criteria Results

- ✅ **Fixture proof surface shipped:** S01 produced the checked-in xbmc manifest/snapshot corpus plus `verify:m046:s01`; fresh milestone verification reran the full M046 test suite and `verify:m046 -- --json`, which preserved nested S01 evidence with `retained=3`, `excluded=6`, complete provenance, recorded source availability, and alias diagnostics.
- ✅ **Calibration comparison shipped:** S02 produced the snapshot loader, pure evaluator, and `verify:m046:s02`; fresh `verify:m046 -- --json` preserved the per-contributor live-vs-intended report showing `fuzzard` diverging to senior, `koprajs` diverging to established, and `fkoemep` remaining newcomer with stale/missing-review caveats.
- ✅ **Explicit verdict and handoff shipped:** S03 produced `verify:m046` and the structured `m047ChangeContract`; fresh `verify:m046 -- --json` reported `overallPassed: true`, `statusCode: replace_recommended`, and a complete keep/change/replace inventory.
- ✅ **Code changes exist outside `.gsd/`:** `git diff --stat HEAD $(git merge-base HEAD main) -- ':!.gsd/'` returned a non-empty diff across 64 non-`.gsd/` files, including `src/contributor/*`, `scripts/verify-m046*.ts`, `fixtures/contributor-calibration/*`, `src/auth/github-app.ts`, and `package.json`.

## Definition of Done Results

- ✅ **All slices complete:** `gsd_milestone_status(M046)` reported S01, S02, and S03 all `complete`, with task counts 3/3, 3/3, and 2/2 respectively.
- ✅ **All slice summaries exist:** `find .gsd/milestones/M046/slices -maxdepth 2 -name 'S*-SUMMARY.md' | sort` returned `S01-SUMMARY.md`, `S02-SUMMARY.md`, and `S03-SUMMARY.md`.
- ✅ **Cross-slice integration works:** `bun run verify:m046 -- --json` passed and preserved nested S01 and S02 reports, retained/excluded count consistency (`3/6`), the `replace` verdict, and a complete `m047ChangeContract`.
- ✅ **Implementation remains type-safe:** `bun run tsc --noEmit` exited 0 during milestone closeout.
- ℹ️ **Horizontal checklist:** `.gsd/milestones/M046/M046-ROADMAP.md` contains no separate Horizontal Checklist section, so there were no unchecked horizontal items to audit.

## Requirement Outcomes

- **R047 — remains validated.** The milestone re-confirmed the reusable xbmc fixture corpus, snapshot loader, calibration evaluator, verifier surfaces, and integrated M046 contract. Fresh evidence: `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s02.test.ts ./src/contributor/calibration-change-contract.test.ts ./scripts/verify-m046.test.ts`, `bun run verify:m046 -- --json`, and `bun run tsc --noEmit` all passed.
- No requirements were deferred, blocked, invalidated, or moved out of scope during milestone closeout.

## Deviations

None.

## Follow-ups

M047 should implement the `m047ChangeContract`: preserve the M045 contributor-experience vocabulary, rewire review and Slack consumer surfaces onto the future calibrated contract, and replace the live incremental `pr_authored`-only scoring path with the intended full-signal model while preserving explicit freshness/degradation reporting.
