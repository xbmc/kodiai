---
id: S01
parent: M046
milestone: M046
provides:
  - A checked-in xbmc contributor fixture pack that separates curated contributor selection/exclusions from generated live evidence.
  - A reusable `verify:m046:s01` refresh/verify entrypoint for downstream calibration work and operator reruns.
  - Deterministic snapshot semantics, source-availability diagnostics, and alias-collision reporting that S02 can consume without reconstructing contributor truth ad hoc.
requires:
  []
affects:
  - S02
  - S03
  - M046 milestone validation/completion
key_files:
  - src/contributor/fixture-set.ts
  - src/contributor/fixture-set.test.ts
  - src/contributor/xbmc-fixture-refresh.ts
  - src/contributor/xbmc-fixture-refresh.test.ts
  - src/auth/github-app.ts
  - scripts/verify-m046-s01.ts
  - scripts/verify-m046-s01.test.ts
  - fixtures/contributor-calibration/xbmc-manifest.json
  - fixtures/contributor-calibration/xbmc-snapshot.json
  - package.json
  - .gsd/DECISIONS.md
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D075 — Persist xbmc contributor calibration truth as a checked-in manifest plus generated snapshot refreshed and verified by `verify:m046:s01`.
  - D076 — Derive snapshot `generatedAt` deterministically from provenance evidence, with `curatedAt` fallback, instead of wall-clock time.
  - D077 — Bound live GitHub evidence collection with explicit request timeouts and degrade to named `github-timeout` failures instead of hanging the refresh.
patterns_established:
  - Separate human-curated contributor truth from generated evidence: keep retained/excluded identity decisions in the manifest and regenerate the snapshot from live/public sources.
  - Expose one stable proof harness with named `check_ids` and `status_code` values shared across human-readable and JSON modes so downstream slices can consume the same verifier surface programmatically.
  - Treat source degradation explicitly rather than silently shrinking the corpus: keep unavailable GitHub or local-git evidence visible in provenance and diagnostics.
  - Parse local git shortlog rows one-by-one and ignore malformed rows unless the entire shortlog is unusable.
observability_surfaces:
  - `fixtures/contributor-calibration/xbmc-manifest.json` — human-curated retained/excluded selection, cohort anchors, and explicit exclusion reasons.
  - `fixtures/contributor-calibration/xbmc-snapshot.json` — checked-in refreshed contributor snapshot with provenance records, source-availability counts, alias diagnostics, and ready/degraded status.
  - `bun run verify:m046:s01 -- --json` — machine-readable proof report with stable `check_ids`, `status_code`, retained/excluded counts, cohort coverage, provenance completeness, and refresh diagnostics.
  - `bun run verify:m046:s01 -- --refresh --json` — refreshes the checked-in snapshot through the shipped CLI path and re-verifies the same proof surface end-to-end.
drill_down_paths:
  - .gsd/milestones/M046/slices/S01/tasks/T01-SUMMARY.md
  - .gsd/milestones/M046/slices/S01/tasks/T02-SUMMARY.md
  - .gsd/milestones/M046/slices/S01/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-10T21:11:56.757Z
blocker_discovered: false
---

# S01: xbmc Fixture Set and Provenance Collector

**Built and verified a checked-in xbmc contributor fixture pack plus `verify:m046:s01`, giving downstream calibration work a deterministic manifest/snapshot/provenance contract with explicit cohort coverage and exclusion truth.**

## What Happened


S01 turned xbmc contributor calibration inputs into a checked-in proof surface instead of an ad hoc research artifact. The slice introduced a typed fixture contract in `src/contributor/fixture-set.ts`, validated by `src/contributor/fixture-set.test.ts`, and seeded `fixtures/contributor-calibration/xbmc-manifest.json` with three retained anchor contributors and six explicit exclusions. The retained set now covers the milestone’s required cohorts with one clear senior (`fuzzard`), one clear newcomer (`fkoemep`), and one ambiguous-middle sample (`KOPRajs`). Bot rows, alias-collision rows, and ambiguous-identity rows remain explicit in the manifest with reason codes and notes instead of being silently dropped or guessed into a merged identity.

The slice then implemented `src/contributor/xbmc-fixture-refresh.ts` to materialize that curated truth into a checked-in snapshot. Refresh now reads the manifest, normalizes identities, validates retained GitHub usernames, collects GitHub commit/PR/review evidence, enriches from local `tmp/xbmc` shortlog data, and writes a sorted snapshot with machine-readable provenance for both retained and excluded contributors. The refresh path also records source availability and alias diagnostics directly in the snapshot so downstream consumers do not need to reverse-engineer whether data was missing, unavailable, or intentionally excluded.

During live verification work, the slice fixed two root-cause stability problems that would have made the proof surface untrustworthy for S02. First, GitHub enrichment is now bounded through the shared GitHub App seam so a slow API call degrades with a named `github-timeout` failure instead of hanging the refresh. Second, snapshot `generatedAt` is derived deterministically from the latest observed provenance timestamp, with `curatedAt` fallback, so two refreshes with unchanged evidence no longer create meaningless byte drift.

Finally, S01 shipped `scripts/verify-m046-s01.ts` and the `verify:m046:s01` package entrypoint. The verifier exposes one stable human/JSON proof harness with named check IDs for manifest validity, refresh execution, snapshot validity, curated sync, snapshot status, cohort coverage, provenance completeness, source availability, and alias diagnostics. The final checked-in snapshot is in `ready` state with 3 retained contributors, 6 excluded contributors, complete provenance arrays for every row, cohort coverage of 1 senior / 1 ambiguous-middle / 1 newcomer, GitHub source availability of 5 available and 4 unavailable records, local-git availability of 9 available and 0 unavailable records, and explicit alias diagnostics for the `kai-sommerfeld`↔`ksooo` and `keith`↔`keith-herrington` identity-risk pairs.

## Operational Readiness

- **Health signal:** `bun run verify:m046:s01 -- --json` exits 0 with `overallPassed: true`, `counts.retained: 3`, `counts.excluded: 6`, `diagnostics.statusCode: "snapshot-refreshed"`, complete cohort coverage, and zero provenance-completeness failures.
- **Failure signal:** the verifier exits non-zero with named `check_ids` / `status_code` values when manifest validity, curated sync, snapshot readiness, provenance completeness, source availability recording, or alias diagnostics drift. Refresh-time operational failures surface as named diagnostics such as `github-timeout`, `github-request-failed`, `local-git-workspace-missing`, `local-git-command-failed`, or `local-git-shortlog-unparseable`.
- **Recovery procedure:** inspect `fixtures/contributor-calibration/xbmc-manifest.json`, rerun `bun run verify:m046:s01 -- --refresh --json`, review the emitted diagnostics/failures, fix missing GitHub auth or `tmp/xbmc` availability if those sources should be present, correct any manifest identity/exclusion drift, and rerun until the snapshot returns to `ready` with all checks passing.
- **Monitoring gaps:** this slice provides a manual proof command, not scheduled monitoring. There is no automatic alert if GitHub evidence goes stale, if local `tmp/xbmc` disappears, or if the checked-in snapshot drifts from the curated manifest between runs.


## Verification

Fresh slice verification passed:
- `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts` → exit 0, 21 pass, 0 fail.
- `bun run verify:m046:s01 -- --json` → exit 0, `overallPassed: true`, 9 stable `check_ids`, `counts.retained: 3`, `counts.excluded: 6`.
- `bun run verify:m046:s01 -- --refresh --json` → exit 0, refreshed the checked-in snapshot through the shipped CLI and re-verified it successfully.
- `bun run tsc --noEmit` → exit 0.

## Requirements Advanced

- R047 — Created the reusable xbmc fixture corpus, refresh path, and verifier that S02 will consume when comparing live incremental-path outcomes against the intended full-signal model.

## Requirements Validated

None.

## New Requirements Surfaced

- None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

None from the slice goal. Full slice verification did expose two root-cause stability issues — unbounded GitHub evidence collection and non-deterministic snapshot timestamps — and both were fixed inside the shipped refresh path because leaving either in place would have violated the slice contract.

## Known Limitations

- The fixture pack is intentionally curated, not comprehensive: it provides three retained anchor contributors plus six explicit exclusions for downstream calibration proof, not a statistically complete xbmc population sample.
- Snapshot freshness is manual. The slice ships a repeatable refresh/verify command, but it does not schedule refreshes or alert automatically on staleness.
- Alias-collision and ambiguous-identity rows remain excluded until a later slice or milestone decides how to resolve them; S02 must preserve that exclusion truth rather than infer merges.

## Follow-ups

- S02 should consume the checked-in manifest/snapshot/provenance contract directly and preserve retained vs excluded contributor truth.
- Use the verifier’s stable `check_ids` and `status_code` values as the contract surface for downstream calibration reporting.
- Rerun `bun run verify:m046:s01 -- --refresh --json` before live calibration analysis whenever GitHub evidence or the local `tmp/xbmc` workspace may have changed.

## Files Created/Modified

- `src/contributor/fixture-set.ts` — Added the typed xbmc fixture manifest/snapshot contract, identity normalization, validation, sorting, and manifest summary helpers.
- `src/contributor/fixture-set.test.ts` — Pinned duplicate-identity, exclusion-reason, cohort, and provenance-placeholder contract failures plus the happy-path manifest checks.
- `src/contributor/xbmc-fixture-refresh.ts` — Implemented live GitHub/local-git evidence collection, deterministic snapshot generation, provenance diagnostics, timeout/degrade behavior, and alias handling.
- `src/contributor/xbmc-fixture-refresh.test.ts` — Added regression coverage for stable refresh output, deterministic timestamps, alias collisions, missing sources, timeouts, and malformed shortlog tolerance.
- `src/auth/github-app.ts` — Added optional request-timeout plumbing so the refresh collector can bound GitHub App API calls.
- `scripts/verify-m046-s01.ts` — Shipped the human/JSON proof harness with refresh support and named verifier checks.
- `scripts/verify-m046-s01.test.ts` — Pinned report shape, drift detection, refresh behavior, and non-zero failure behavior for the verifier.
- `fixtures/contributor-calibration/xbmc-manifest.json` — Checked in the curated retained/excluded xbmc contributor truth set with cohort anchors and explicit exclusion reasons.
- `fixtures/contributor-calibration/xbmc-snapshot.json` — Checked in the refreshed xbmc contributor snapshot with machine-readable provenance, source availability, and alias diagnostics.
- `package.json` — Added the `verify:m046:s01` package script.
- `.gsd/DECISIONS.md` — Recorded D077 for bounded GitHub evidence collection during fixture refresh.
- `.gsd/KNOWLEDGE.md` — Recorded deterministic snapshot timestamping, timeout/degrade handling, and malformed shortlog parsing rules.
