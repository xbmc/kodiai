# S02: Calibration Evaluator for Live vs Intended Model Paths — UAT

**Milestone:** M046
**Written:** 2026-04-10T22:15:34.026Z

# S02 UAT — xbmc Calibration Evaluator and Verifier

## Preconditions

- Repository root is `/home/keith/src/kodiai`.
- Dependencies are installed (`bun install`).
- The checked-in fixture files exist at `fixtures/contributor-calibration/xbmc-manifest.json` and `fixtures/contributor-calibration/xbmc-snapshot.json`.
- No network access or secrets are required; this proof is intentionally offline-only.

## Test Case 1 — Machine-readable calibration proof

1. Run `bun run verify:m046:s02 -- --json`.
2. Confirm the command exits with code 0.
3. Inspect the JSON output.

### Expected Results

- `overallPassed` is `true`.
- `check_ids` exactly contain:
  - `M046-S02-S01-PREREQUISITE`
  - `M046-S02-SNAPSHOT-VALID`
  - `M046-S02-RETAINED-COHORT-TRUTH`
  - `M046-S02-EXCLUDED-CONTROLS-TRUTH`
  - `M046-S02-EVALUATOR-REPORT`
  - `M046-S02-RECOMMENDATION`
- `prerequisite.overallPassed` is `true` and `prerequisite.counts` reports `retained=3` and `excluded=6`.
- `snapshot.isLoadable` and `snapshot.isValid` are both `true`.
- `calibration.rows` contains exactly the retained contributors `fuzzard`, `koprajs`, and `fkoemep`.
- `calibration.recommendation.verdict` is `replace`.
- `calibration.findings.liveScoreCompression` is `true`.
- `calibration.findings.divergentContributorIds` contains `fuzzard` and `koprajs`.
- `calibration.findings.staleContributorIds` contains `fkoemep`.
- Every object in `calibration.excludedControls` has `includedInEvaluation: false`.

## Test Case 2 — Human-readable operator report

1. Run `bun run verify:m046:s02`.
2. Confirm the command exits with code 0.
3. Review the rendered report text.

### Expected Results

- The header identifies the command as the M046 S02 live-vs-intended calibration verifier.
- The report includes `Recommendation: replace`.
- The retained-contributor section shows:
  - `fuzzard` live=`profile-backed/newcomer`, intended=`profile-backed/senior`
  - `koprajs` live=`profile-backed/newcomer`, intended=`profile-backed/established`
  - `fkoemep` live=`profile-backed/newcomer`, intended=`profile-backed/newcomer`
- The report calls out `Findings: liveCompression=yes divergent=fuzzard, koprajs stale=fkoemep`.
- The excluded-controls section lists all six excluded identities and their reasons.
- The checks section shows all six `M046-S02-*` checks as `PASS`.

## Test Case 3 — Upstream fixture truth remains aligned

1. Run `bun run verify:m046:s01 -- --json`.
2. Confirm the command exits with code 0.
3. Inspect the S01 JSON output.
4. Re-run `bun run verify:m046:s02 -- --json`.

### Expected Results

- S01 reports `retained=3` and `excluded=6`.
- S01 `cohortCoverage` is `senior=1`, `ambiguous-middle=1`, `newcomer=1`.
- S01 reports `retainedWithoutRecords=0` and `excludedWithoutRecords=0`.
- S01 records alias/ambiguity diagnostics for `kai-sommerfeld`/`ksooo` and `keith`/`keith-herrington`.
- The subsequent S02 report shows the same retained/excluded counts in both `prerequisite.counts` and `snapshot.counts`.

## Test Case 4 — Regression and edge-case coverage

1. Run `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts`.
2. Run `bun run tsc --noEmit`.

### Expected Results

- The focused test suite passes with no failures.
- The tests cover malformed snapshot JSON, missing diagnostics/provenance, duplicate contributor identities, retained-cohort drift, missing recommendations, human/JSON report alignment, and prerequisite failure behavior.
- TypeScript exits cleanly with no diagnostics.

## Edge Conditions to Watch

- `fkoemep` is intentionally reported with stale evidence and missing review provenance; that is expected, not a failure.
- Live-path rank ranges may be unstable because zero-score ties compress the cohort, but the report should keep that separate from contract-state drift.
- If S01 ever fails, S02 should still surface loadable snapshot diagnostics while withholding the final calibration verdict.
