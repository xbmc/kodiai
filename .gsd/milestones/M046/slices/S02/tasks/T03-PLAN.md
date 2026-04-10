---
estimated_steps: 31
estimated_files: 4
skills_used: []
---

# T03: Ship verify:m046:s02 with stable per-contributor verdict reporting

---
estimated_steps: 22
estimated_files: 4
skills_used:
  - test-driven-development
  - verification-before-completion
---

Expose the evaluator as the slice’s operator-facing proof harness. The verifier should first confirm the S01 fixture dependency is still sound, then load the checked-in snapshot, run the evaluator, and emit human-readable plus `--json` output with stable check IDs / status codes. The shipped report must show each retained contributor’s fixture evidence, modeled live-path outcome, modeled intended-path outcome, contract projection, percentile/tie-instability results, and freshness/unscored findings, while keeping excluded identities visible as explicit controls. Exit non-zero when prerequisite fixture validity fails, when the evaluator cannot produce a recommendation, or when retained/excluded contributor truth drifts from the S01 contract.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Upstream fixture verifier `verify:m046:s01` / shared snapshot loader | Fail with a named prerequisite status code rather than printing a misleading calibration verdict. | Use the existing bounded S01 verifier behavior; do not add new polling or live retries in S02. | Reject malformed snapshot/evaluator inputs as verifier failures with actionable detail. |
| Calibration evaluator in `src/contributor/calibration-evaluator.ts` | Bubble evaluator failures into stable check IDs / status codes instead of swallowing them in prose. | N/A — pure local evaluation. | Treat missing recommendation, missing retained rows, or contract-state drift as failing checks. |
| Package script wiring in `package.json` | Keep one canonical `verify:m046:s02` entrypoint so downstream slices do not reconstruct the proof flow ad hoc. | N/A — local config only. | Treat broken CLI args or mismatched human/JSON shapes as regression-test failures. |

## Load Profile

- **Shared resources**: local snapshot file, evaluator output, and one prerequisite S01 verifier invocation.
- **Per-operation cost**: one proof script, one test file, one package script entry, and one evaluation pass.
- **10x breakpoint**: human-readable output clarity degrades before compute does, so keep check IDs/status codes and contributor summaries concise.

## Negative Tests

- **Malformed inputs**: corrupted snapshot JSON, missing retained contributors, and excluded identities leaking into the evaluated cohort.
- **Error paths**: failed upstream fixture verification, evaluator exceptions, and missing keep/retune/replace recommendation all produce non-zero exits with named status codes.
- **Boundary conditions**: `--json` and human output stay aligned, and the report remains useful when the snapshot is degraded but still loadable.

## Steps

1. Write failing verifier tests that pin JSON structure, human-readable report sections, stable check IDs/status codes, and non-zero exits for prerequisite/evaluator failures.
2. Implement `scripts/verify-m046-s02.ts` to call the shared snapshot loader and evaluator, compose per-contributor + report-level checks, and render human / JSON output from one report object.
3. Add the `verify:m046:s02` package script and keep the report shape close to `verify:m046:s01` / `verify:m045:s03` patterns so future slices can consume it mechanically.
4. Run the shipped verifier against the checked-in fixture snapshot and keep the final output explicit about live-path compression, intended-path gaps, instability, freshness, and the final recommendation.

## Must-Haves

- [ ] `bun run verify:m046:s02 -- --json` returns a stable machine-readable report with per-contributor diagnostics and a final keep/retune/replace recommendation.
- [ ] Human-readable output and JSON are generated from the same report object so drift is testable.
- [ ] Prerequisite fixture failures, evaluator failures, and missing recommendations all exit non-zero with named status codes.

## Inputs

- ``src/contributor/xbmc-fixture-snapshot.ts` — shared snapshot loader from T01.`
- ``src/contributor/calibration-evaluator.ts` — evaluator/report logic from T02.`
- ``scripts/verify-m046-s01.ts` — prerequisite proof-harness pattern and stable check/report conventions.`
- ``package.json` — canonical verifier script wiring.`

## Expected Output

- ``scripts/verify-m046-s02.ts` — shipped S02 proof harness for human and JSON calibration reports.`
- ``scripts/verify-m046-s02.test.ts` — regression tests for report shape, status codes, and non-zero failure behavior.`
- ``package.json` — `verify:m046:s02` script entrypoint.`
- ``src/contributor/calibration-evaluator.ts` — any report-shape adjustments required to support the final verifier output.`

## Verification

bun test ./scripts/verify-m046-s02.test.ts && bun run verify:m046:s02 -- --json

## Observability Impact

Exposes stable verifier check IDs/status codes plus per-contributor live/intended diagnostics so future agents can tell whether failures come from fixture truth, evaluator assumptions, or verdict generation.
