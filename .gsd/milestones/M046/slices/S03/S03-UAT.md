# S03: Explicit Calibration Verdict and M047 Change Contract — UAT

**Milestone:** M046
**Written:** 2026-04-10T23:14:35.818Z

# S03: Explicit Calibration Verdict and M047 Change Contract — UAT

**Milestone:** M046  
**Written:** 2026-04-10T23:10:48Z

# S03 UAT — Integrated `verify:m046` proof harness and M047 change contract

## Preconditions

- Repository root is `/home/keith/src/kodiai`.
- Dependencies are installed (`bun install`).
- The checked-in fixture files exist at `fixtures/contributor-calibration/xbmc-manifest.json` and `fixtures/contributor-calibration/xbmc-snapshot.json`.
- The S01 and S02 verifier entrypoints already exist and pass independently.
- No network access or secrets are required; this proof surface is intentionally snapshot-only.

## Test Case 1 — Machine-readable milestone-closeout proof

1. Run `bun run verify:m046 -- --json`.
2. Confirm the command exits with code 0.
3. Inspect the JSON output.

### Expected Results

- `command` is `verify:m046`.
- `overallPassed` is `true`.
- `check_ids` exactly contain:
  - `M046-S03-FIXTURE-REPORT`
  - `M046-S03-CALIBRATION-REPORT`
  - `M046-S03-COUNT-CONSISTENCY`
  - `M046-S03-VERDICT`
  - `M046-S03-M047-CHANGE-CONTRACT`
- `verdict.value` is `replace` and `verdict.statusCode` is `replace_recommended`.
- `fixture.overallPassed` is `true` and `fixture.counts` reports `retained=3` and `excluded=6`.
- `calibration.overallPassed` is `true`, `calibration.prerequisite.counts` reports `retained=3` and `excluded=6`, and `calibration.calibration.recommendation.verdict` is `replace`.
- `m047ChangeContract.verdict` is `replace`.
- `m047ChangeContract.keep` contains exactly one mechanism: `m045-contributor-experience-contract-vocabulary`.
- `m047ChangeContract.change` contains exactly one mechanism: `stored-tier-consumer-surfaces`.
- `m047ChangeContract.replace` contains exactly one mechanism: `live-incremental-pr-authored-scoring`.
- The impacted surfaces include `src/contributor/experience-contract.ts`, `src/handlers/review.ts`, and `src/slack/slash-command-handler.ts` markers.

## Test Case 2 — Human-readable operator report

1. Run `bun run verify:m046`.
2. Confirm the command exits with code 0.
3. Review the rendered report text.

### Expected Results

- The header identifies the command as the M046 integrated proof harness.
- The report includes `Proof surface: PASS`.
- The report includes `Verdict: replace` and `Verdict status: replace_recommended`.
- The rationale block contains the three current reasons: live incremental compression, intended full-signal differentiation for `fuzzard`/`koprajs`, and the `fkoemep` freshness caveat.
- The fixture line reports `retained=3 excluded=6`.
- The calibration line reports `recommendation=replace retained=3 excluded=6`.
- The M047 change-contract section includes one `keep`, one `change`, and one `replace` entry with the same summaries shown in JSON mode.
- The checks section shows all five `M046-S03-*` checks as `PASS`.

## Test Case 3 — Nested proof preservation and count consistency

1. Run `bun run verify:m046:s01 -- --json`.
2. Run `bun run verify:m046:s02 -- --json`.
3. Run `bun run verify:m046 -- --json`.
4. Compare the nested reports.

### Expected Results

- S01 reports `retained=3` and `excluded=6`.
- S02 reports the same counts in both `prerequisite.counts` and `snapshot.counts`.
- The integrated `verify:m046` report preserves the same S01/S02 counts without recomputing divergent values.
- The integrated top-level verdict rationale matches the S02 recommendation rationale.
- The integrated report does not flatten or omit the nested fixture and calibration `checks` arrays.

## Test Case 4 — Regression and compile gates

1. Run `bun test ./scripts/verify-m046.test.ts`.
2. Run `bun test ./src/contributor/xbmc-fixture-snapshot.test.ts ./src/contributor/calibration-evaluator.test.ts ./scripts/verify-m046-s01.test.ts ./scripts/verify-m046-s02.test.ts ./scripts/verify-m046.test.ts`.
3. Run `bun run tsc --noEmit`.

### Expected Results

- The focused integrated verifier test passes and proves the integrated harness actually exists.
- The broader regression bundle passes with no failures across the fixture, calibration, and integrated proof surfaces.
- TypeScript exits cleanly with no diagnostics.
- The direct single-file `verify-m046` test is required in addition to the broader bundle, because Bun can ignore one unmatched test filter if other file paths still match.

## Edge Conditions to Watch

- `overallPassed: true` together with `verdict: replace` is the expected success case; the proof surface is healthy even though the current domain outcome is negative.
- `M046-S01-REFRESH-EXECUTED` should remain `SKIP` with `refresh_not_requested` unless `--refresh` is explicitly supplied.
- `fkoemep` should remain in the report with stale-evidence and missing-review caveats; that is expected and should not be normalized away.
- Any contradictory keep/change/replace bucket assignment or missing impacted-surface evidence should fail the integrated verifier non-zero instead of being rendered as a passing contract.
