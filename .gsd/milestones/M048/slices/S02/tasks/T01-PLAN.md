---
estimated_steps: 4
estimated_files: 4
skills_used:
  - azure-container-apps
  - test-driven-development
  - verification-before-completion
---

# T01: Tighten ACA job polling cadence without losing truthful status handling

**Slice:** S02 — Single-Worker Path Latency Reduction
**Milestone:** M048

## Description

The cheapest likely latency win is the fixed ACA poll interval in `src/jobs/aca-launcher.ts`. This task should remove the avoidable polling tail on the existing one-worker path without changing what counts as `remote runtime`, without suppressing Azure API failures, and without widening the trust surface.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| Azure execution-status REST API in `src/jobs/aca-launcher.ts` | Retry and keep logging the HTTP failure instead of treating it as terminal success. | Return `timed-out` with the measured duration and let the caller preserve truthful timeout behavior. | Ignore the malformed payload for that poll attempt, log the drift, and continue polling until terminal state or timeout. |
| `pollUntilComplete(...)` callers in `src/execution/executor.ts` | Preserve the existing error/timeout result path; do not crash the review handler. | Keep `remote runtime` truthful when the poll loop times out. | Leave phase names/status handling unchanged so later surfaces still normalize the result. |

## Load Profile

- **Shared resources**: Azure management API rate limits, the single ACA execution slot, and the shared executor path that waits on poll completion.
- **Per-operation cost**: one status fetch per poll interval plus small debug/info log lines.
- **10x breakpoint**: Azure rate limiting or noisy retry logs will break first, so the task must keep the interval bounded, avoid tight retry loops, and retain attempt-level diagnostics.

## Negative Tests

- **Malformed inputs**: invalid JSON status bodies, missing `status` fields, and unknown status strings.
- **Error paths**: repeated 5xx responses, fetch exceptions, and timeout expiry just before the next scheduled sleep.
- **Boundary conditions**: success on the first poll, success/failure after one retry, and terminal completion with only a few milliseconds remaining before timeout.

## Steps

1. Add failing unit coverage in `src/jobs/aca-launcher.test.ts` for success, failure, timeout, and retry behavior around the current polling cadence.
2. Refactor `src/jobs/aca-launcher.ts` so the default poll interval is centralized and faster, while keeping retry logging and timeout math explicit.
3. Update any executor-facing coverage in `src/execution/executor.test.ts` and align `scripts/test-aca-job.ts` to the same shared default so smoke coverage exercises the intended cadence.
4. Re-run the focused tests and `tsc` to prove the faster cadence reduces tail latency without changing the six-phase contract.

## Must-Haves

- [ ] The default ACA poll interval is reduced from the current fixed 10s cadence on the real review path.
- [ ] Focused tests prove success, failure, timeout, and retry behavior at the new cadence.
- [ ] The task does not rename phases, move the `remote runtime` boundary, or hide Azure poll failures.

## Verification

- `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/executor.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: ACA poll attempt logs and terminal-status timing at the faster cadence.
- How a future agent inspects this: read `src/jobs/aca-launcher.test.ts`, rerun the focused Bun tests, and compare the new cadence against `scripts/test-aca-job.ts`.
- Failure state exposed: HTTP errors, malformed responses, retry loops, and timed-out executions remain explicit instead of collapsing into a silent wait.

## Inputs

- `src/jobs/aca-launcher.ts` — current polling loop and default interval.
- `src/jobs/aca-launcher.test.ts` — place to add focused cadence/retry coverage.
- `src/execution/executor.test.ts` — continuity coverage for executor-visible timeout/runtime behavior.
- `scripts/test-aca-job.ts` — live smoke script that already uses a faster cadence and should align with the shared default.

## Expected Output

- `src/jobs/aca-launcher.ts` — centralized faster default poll cadence with truthful retry/timeout behavior.
- `src/jobs/aca-launcher.test.ts` — deterministic coverage for success, failure, timeout, and malformed-response polling paths.
- `src/execution/executor.test.ts` — continuity coverage proving executor-facing phase semantics did not drift.
- `scripts/test-aca-job.ts` — smoke script aligned to the same poll cadence contract used in production.
