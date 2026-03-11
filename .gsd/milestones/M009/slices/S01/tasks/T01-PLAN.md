# T01: 51-timeout-resilience 01

**Slice:** S01 — **Milestone:** M009

## Description

Create the timeout estimation engine and wire dynamic timeouts into the executor.

Purpose: TMO-01 (estimate timeout risk from PR metrics) and TMO-04 (dynamic timeout scaling) form the foundation that Plan 02 builds on for scope reduction and informative messages.

Output: A pure-function timeout estimator module with tests, ExecutionContext extended with dynamicTimeoutSeconds, executor using the dynamic value, and config schema supporting timeout tuning flags.

## Must-Haves

- [ ] "A pure function computes timeout risk level, dynamic timeout, and scope reduction recommendation from PR metrics"
- [ ] "The executor uses a dynamic timeout passed via ExecutionContext instead of only the static config value"
- [ ] "Dynamic timeout scales between 0.5x and 1.5x of the base timeout, clamped to [30, 1800]"
- [ ] "Language complexity is computed from the existing LANGUAGE_RISK map weighted by file count per language"

## Files

- `src/lib/timeout-estimator.ts`
- `src/lib/timeout-estimator.test.ts`
- `src/execution/types.ts`
- `src/execution/executor.ts`
- `src/execution/config.ts`
