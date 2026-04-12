---
estimated_steps: 4
estimated_files: 6
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Ship the M048 S01 operator latency verifier

**Slice:** S01 — Live Phase Timing and Operator Evidence Surfaces
**Milestone:** M048

## Description

Turn the structured log evidence into a repeatable operator check that can answer one question after a live review: where did the time go for this exact `reviewOutputKey`? The verifier should stay narrow, deterministic, and keyed to one real review run instead of sampling broad history.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Azure Log Analytics query helpers | Return a named unavailable state and keep the verifier report truthful about missing live evidence. | Respect explicit query time bounds and fail with a named Azure-unavailable status instead of hanging. | Reject rows whose `reviewOutputKey` / `deliveryId` do not match the requested review rather than merging unrelated evidence. |
| `scripts/verify-m048-s01.ts` CLI args | Exit non-zero with a named invalid-arg status for missing `--review-output-key` or contradictory filters. | N/A — local CLI parsing only. | Treat malformed JSON/human report shape as test failures, not soft warnings. |
| Review-phase log payloads | Surface missing required phases as failing checks or explicit unavailable evidence; do not invent a passing phase matrix from partial rows. | Keep the report readable when the underlying review timed out — timeout is data, not a verifier crash. | Reject unknown phase names or missing totals so the proof surface cannot go false-green. |

## Load Profile

- **Shared resources**: Azure Log Analytics query budget and one bounded verifier report per requested live review.
- **Per-operation cost**: one log query by `reviewOutputKey` / `deliveryId`, one normalization pass, and one human/JSON render.
- **10x breakpoint**: wide log scans and row duplication become the problem before local compute does, so the script should stay keyed to a single review and bounded timespan.

## Negative Tests

- **Malformed inputs**: missing `--review-output-key`, contradictory `--delivery-id`, malformed Azure rows, or unknown phase names.
- **Error paths**: Azure unavailable, no matching logs, mismatched correlation ids, and live timeout reviews still report truthful evidence states.
- **Boundary conditions**: one matching live review with all six phases, partial evidence with explicit unavailable phases, and duplicate rows that must collapse into one normalized report.

## Steps

1. Add `src/review-audit/phase-timing-evidence.ts` plus focused tests to normalize structured review-phase timing rows from Azure Log Analytics and enforce correlation by `reviewOutputKey` / `deliveryId`.
2. Create `scripts/verify-m048-s01.ts` with `--review-output-key`, optional `--delivery-id`, and `--json` handling, plus a report shape that surfaces the required phase matrix, total wall-clock time, and unavailable states.
3. Add `scripts/verify-m048-s01.test.ts` for happy-path normalization, missing/invalid arg handling, malformed/mismatched log rows, and timeout/unavailable evidence cases.
4. Wire `verify:m048:s01` into `package.json` and keep the command scoped to a single live review so operators can paste one key after triggering `@kodiai review`.

## Must-Haves

- [ ] `verify:m048:s01` resolves one live review by `reviewOutputKey` and reports the same six required phases used on Review Details.
- [ ] Azure/log unavailability and correlation drift surface as named verifier states instead of false-green passes.
- [ ] The verifier has focused regression tests plus package-script wiring and supports machine-readable `--json` output for milestone proof.

## Verification

- `bun test ./src/review-audit/phase-timing-evidence.test.ts ./scripts/verify-m048-s01.test.ts`
- `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json`

## Observability Impact

- Signals added/changed: `verify:m048:s01` becomes the operator-facing proof command for one live review's phase timings.
- How a future agent inspects this: run `bun run verify:m048:s01 -- --review-output-key "$REVIEW_OUTPUT_KEY" --json` and compare it to the PR's Review Details block.
- Failure state exposed: missing logs, mismatched correlation ids, unavailable Azure access, and missing phases become named report states instead of manual log archaeology.

## Inputs

- `src/review-audit/log-analytics.ts` — Azure Log Analytics query helper reused for keyed evidence lookup.
- `src/handlers/review-idempotency.ts` — `reviewOutputKey` parsing and normalization helpers.
- `src/review-audit/recent-review-sample.ts` — existing review-audit report patterns worth matching where useful.
- `scripts/verify-m044-s01.ts` — prior operator verifier structure and degraded-source handling patterns.
- `package.json` — package-script contract that must expose `verify:m048:s01`.

## Expected Output

- `src/review-audit/log-analytics.ts` — any query-builder updates needed for keyed timing evidence lookup.
- `src/review-audit/phase-timing-evidence.ts` — normalization and correlation helpers for structured phase-timing rows.
- `src/review-audit/phase-timing-evidence.test.ts` — focused normalization and drift tests.
- `scripts/verify-m048-s01.ts` — operator-facing verifier for one live review's phase timings.
- `scripts/verify-m048-s01.test.ts` — CLI/report regression coverage for happy path, malformed rows, and unavailable evidence.
- `package.json` — `verify:m048:s01` script wiring.
