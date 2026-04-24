---
estimated_steps: 24
estimated_files: 7
skills_used: []
---

# T01: Build the integrated M061 token-reduction verifier

## Description
Create the milestone-level proof entrypoint that turns the existing S01-S04 proof seams into one operator-facing verdict. This task closes the main S05 gap: there is no current `verify:m061:s05` surface that proves baseline visibility, mention-path reduction, review-path compaction/truncation, truthful reuse evidence, and an integrated lower-token story on representative mention/review deliveries.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `scripts/usage-report.ts` query helpers | Return a preflight-only fail-open report with explicit database access detail | Use the existing bounded timeout path and surface `databaseAccess: unavailable` instead of hanging | Treat missing/partial rows as failed checks with explicit check details, not silent success |
| `scripts/verify-m061-s01.ts` / `scripts/verify-m061-s03.ts` / `scripts/verify-m061-s04.ts` evaluators | Bubble the failure into named S05 checks and keep the report renderable | Stop composition and emit explicit preflight/check failure detail | Mark the affected integrated check failed with the missing evidence spelled out |
| Live Postgres telemetry | Fail open and preserve local verifier/test execution | Fail open via bounded timeout | Report malformed evidence as a failed proof, not a pass |

## Load Profile
- **Shared resources**: Postgres connections through the canonical usage-report query path.
- **Per-operation cost**: one bounded usage-report query plus in-process evaluation over delivery/prompt/reuse aggregates.
- **10x breakpoint**: slow/unavailable telemetry becomes the first failure mode, so the script must keep the existing timeout + explicit shutdown discipline.

## Negative Tests
- **Malformed inputs**: invalid `--since`, empty result sets, partial prompt/reuse rows, and delivery sets with no representative mention/review mix.
- **Error paths**: missing DB URL, unreachable Postgres, and composed sub-proof failures.
- **Boundary conditions**: telemetry that contains only mention or only review rows, telemetry with named sections but no truncation, and telemetry with reuse rows but no retrieval hits.

## Steps
1. Add `scripts/verify-m061-s05.ts` that parses the same CLI filters as prior slice verifiers and queries telemetry only through `queryUsageReportWithTimeout()`.
2. Compose existing proof evaluators where practical, then add S05-only integrated checks that compare representative `mention.response` and `review.full` delivery rows/section counts to prove the lower-token story without hardcoded historical thresholds.
3. Add `scripts/verify-m061-s05.test.ts` covering pass, fail, and fail-open cases, including explicit checks for token-signal reasoning and composed evidence reporting.

## Must-Haves
- [ ] `verify-m061-s05` stays on the canonical usage-report telemetry path and does not add a second data source.
- [ ] The report distinguishes preflight availability from proof failure and never treats unavailable telemetry as PASS.
- [ ] Integrated checks name the exact missing evidence so operators can tell whether the gap is baseline, mention reduction, review compaction, reuse truthfulness, or token-signal composition.

## Inputs

- ``scripts/usage-report.ts``
- ``scripts/verify-m061-s01.ts``
- ``scripts/verify-m061-s02.ts``
- ``scripts/verify-m061-s03.ts``
- ``scripts/verify-m061-s04.ts``
- ``scripts/usage-report.test.ts``
- ``scripts/verify-m061-s01.test.ts``
- ``scripts/verify-m061-s02.test.ts``
- ``scripts/verify-m061-s03.test.ts``
- ``scripts/verify-m061-s04.test.ts``

## Expected Output

- ``scripts/verify-m061-s05.ts``
- ``scripts/verify-m061-s05.test.ts``

## Verification

bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts scripts/verify-m061-s05.test.ts

## Observability Impact

- Signals added/changed: a milestone-level verdict over existing prompt-section, delivery, and reuse telemetry with explicit check IDs and fail-open preflight state.
- How a future agent inspects this: run `bun scripts/verify-m061-s05.ts --json` and compare the named integrated checks.
- Failure state exposed: whether proof failed because telemetry is unavailable, baseline coverage is incomplete, token-signal evidence is missing, or reuse/reporting evidence regressed.
