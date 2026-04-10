# S01: xbmc Fixture Set and Provenance Collector — UAT

**Milestone:** M046
**Written:** 2026-04-10T21:11:56.757Z

## Preconditions

- Run from the repository root with Bun installed.
- If live GitHub enrichment is expected, GitHub App configuration is already available to the process; if it is unavailable, the verifier must report that state explicitly rather than hanging or silently shrinking the fixture set.
- Local `tmp/xbmc` may be present for enrichment; if it is absent, the verifier must record that as source unavailability.
- The shipped artifacts exist at `fixtures/contributor-calibration/xbmc-manifest.json`, `fixtures/contributor-calibration/xbmc-snapshot.json`, `src/contributor/fixture-set.ts`, `src/contributor/xbmc-fixture-refresh.ts`, and `scripts/verify-m046-s01.ts`.

## Test Case 1 — Curated manifest exposes retained cohort anchors and explicit exclusions

1. Open `fixtures/contributor-calibration/xbmc-manifest.json`.
2. Confirm the `retained` section contains exactly three contributors.
3. Expected outcome:
   - one retained row has `cohort: "senior"` (`fuzzard`), one has `cohort: "newcomer"` (`fkoemep`), and one has `cohort: "ambiguous-middle"` (`KOPRajs`).
   - every retained row has `normalizedId`, `displayName`, `selectionNotes`, `observedCommitCounts`, and placeholder `provenance.github` / `provenance.localGit` data.
4. Confirm the `excluded` section contains explicit bot, alias-collision, and ambiguous-identity cases.
5. Edge-case guard:
   - `kai-sommerfeld` / `ksooo` remain explicit `alias-collision` exclusions.
   - `keith` / `keith-herrington` remain explicit `ambiguous-identity` exclusions.
   - no exclusion row is missing `exclusionReason`, `exclusionNotes`, or `relatedNormalizedIds`.

## Test Case 2 — JSON verifier passes against the checked-in snapshot

1. Run `bun run verify:m046:s01 -- --json`.
2. Confirm the command exits 0.
3. Expected outcome:
   - the JSON root contains `"command": "verify:m046:s01"` and `"overallPassed": true`.
   - `check_ids` lists exactly these nine checks:
     - `M046-S01-MANIFEST-VALID`
     - `M046-S01-REFRESH-EXECUTED`
     - `M046-S01-SNAPSHOT-VALID`
     - `M046-S01-CURATED-SYNC`
     - `M046-S01-SNAPSHOT-STATUS`
     - `M046-S01-COHORT-COVERAGE`
     - `M046-S01-PROVENANCE-COMPLETE`
     - `M046-S01-SOURCE-AVAILABILITY`
     - `M046-S01-ALIAS-DIAGNOSTICS`
   - `counts.retained` is `3` and `counts.excluded` is `6`.
   - `diagnostics.cohortCoverage` reports `senior: 1`, `ambiguous-middle: 1`, and `newcomer: 1`.
4. Edge-case guard:
   - `M046-S01-REFRESH-EXECUTED` is `skipped: true` with `status_code: "refresh_not_requested"` in no-refresh mode.
   - `diagnostics.failures` is empty.

## Test Case 3 — Refresh mode rebuilds the snapshot through the shipped entrypoint

1. Run `bun run verify:m046:s01 -- --refresh --json`.
2. Confirm the command exits 0.
3. Expected outcome:
   - the JSON root contains `"refreshed": true`.
   - `M046-S01-REFRESH-EXECUTED` is present with `passed: true`, `skipped: false`, and `status_code: "snapshot_refreshed_before_verify"`.
   - the final `counts` and `diagnostics.cohortCoverage` values still match the checked-in truth set from Test Case 2.
   - `diagnostics.statusCode` remains `"snapshot-refreshed"` and the verifier does not invent or delete contributors during refresh.
4. Edge-case guard:
   - rerunning the refresh with unchanged evidence should not cause semantic drift in the snapshot structure; deterministic `generatedAt` must come from evidence timestamps rather than wall-clock time.

## Test Case 4 — Snapshot exposes machine-readable provenance, source availability, and alias diagnostics

1. Open `fixtures/contributor-calibration/xbmc-snapshot.json` after Test Case 3.
2. Confirm `status` is `"ready"` and `refreshCommand` is `"bun run verify:m046:s01 -- --refresh --json"`.
3. Expected outcome:
   - each retained contributor has a non-empty `provenanceRecords` array.
   - each excluded contributor also has a non-empty `provenanceRecords` array.
   - the retained rows include GitHub and local-git provenance metadata such as commit SHAs, PR numbers, review links, local author emails, or commit counts when available.
   - `diagnostics.sourceAvailability.github` and `diagnostics.sourceAvailability.localGit` are present and machine-readable.
   - `diagnostics.aliasCollisionDiagnostics` lists the `kai-sommerfeld` / `ksooo` and `keith` / `keith-herrington` pairs.
4. Edge-case guard:
   - unavailable GitHub review evidence for a contributor appears as an explicit `status: "unavailable"` provenance record, not as a missing array element.
   - excluded rows stay visible in the snapshot instead of disappearing during refresh.

## Test Case 5 — Regression suite and typecheck stay green

1. Run `bun test ./src/contributor/fixture-set.test.ts ./src/contributor/xbmc-fixture-refresh.test.ts ./scripts/verify-m046-s01.test.ts`.
2. Confirm the command exits 0.
3. Expected outcome:
   - all 21 tests pass.
   - fixture-contract tests fail if duplicate normalized IDs, unsupported cohorts, missing exclusion reasons, or missing provenance placeholders are introduced.
   - refresh tests fail if alias collisions are silently merged, if GitHub timeout handling regresses, or if local-git shortlog parsing stops tolerating malformed rows.
4. Run `bun run tsc --noEmit`.
5. Confirm the command exits 0.
6. Edge-case guard:
   - the verifier, refresh module, and GitHub timeout plumbing compile cleanly together; no type drift is introduced between `fixture-set.ts`, `xbmc-fixture-refresh.ts`, and `scripts/verify-m046-s01.ts`.

