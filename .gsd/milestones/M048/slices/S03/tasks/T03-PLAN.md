---
estimated_steps: 13
estimated_files: 8
skills_used:
  - test-driven-development
  - verification-before-completion
---

# T03: Ship verify:m048:s03 preflight and live synchronize proof without inventing a new evidence path

**Slice:** S03 — Truthful Bounded Reviews and Synchronize Continuity
**Milestone:** M048

## Description

S03 needs an operator command that can fail loudly before deploy when synchronize intent is misconfigured and can prove the live path after deploy using the same evidence seams S01 and S02 already established. This task should add a dedicated verifier for local preflight plus optional live synchronize review keys, while reusing existing `reviewOutputKey`, Review Details, and Azure-backed evidence surfaces instead of creating a parallel report.

## Steps

1. Add failing tests in `scripts/verify-m048-s03.test.ts` for config preflight pass/fail, bounded-disclosure fixture checks, empty optional live input, and rejection of non-synchronize `reviewOutputKey` values.
2. Implement `scripts/verify-m048-s03.ts` so it loads repo config and fails when synchronize intent is mis-shaped or effectively disabled, evaluates bounded-review disclosure fixtures via the shared helper from T02, and optionally accepts `--review-output-key` while requiring `action=synchronize`.
3. Reuse the existing S01/S02 verifier seams instead of inventing a new evidence store: embed the local preflight verdict plus any phase-evidence or continuity data needed for operator output, and wire `verify:m048:s03` into `package.json`.
4. Re-run focused tests, `tsc`, and the local verifier command so the slice has deterministic proof even before the post-deploy synchronize run.

## Must-Haves

- [ ] `verify:m048:s03` fails loudly when repo intent says synchronize but effective config does not enable it.
- [ ] Local or fixture output verifies the bounded-review disclosure contract without needing live GitHub or Azure data.
- [ ] Live mode only accepts `reviewOutputKey` values whose parsed action is `synchronize` and reuses the S01/S02 evidence surface rather than parallel reporting.

## Inputs

- `.kodiai.yml`
- `src/execution/config.ts`
- `src/lib/review-boundedness.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s02.ts`
- `src/handlers/review-idempotency.ts`
- `package.json`

## Expected Output

- `scripts/verify-m048-s03.ts`
- `scripts/verify-m048-s03.test.ts`
- `package.json`

## Verification

- `bun test ./scripts/verify-m048-s03.test.ts ./src/execution/config.test.ts ./src/lib/review-boundedness.test.ts`
- `bun run tsc --noEmit`
- `bun run verify:m048:s03 -- --json`

## Observability Impact

- Signals added or changed: named S03 verifier status codes for synchronize-config drift, bounded-disclosure contract failures, and live-key mismatches.
- How a future agent inspects this: run `bun run verify:m048:s03 -- --json` for local preflight and `bun run verify:m048:s03 -- --review-output-key <key> --json` after deploy.
- Failure state exposed: mis-shaped synchronize config, non-synchronize live keys, missing bounded-disclosure proof, and reused S01/S02 evidence availability all stay explicit.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `loadRepoConfig(...)` plus S03 preflight checks | Return a named config-drift failure instead of silently green-lighting synchronize proof. | N/A — local parse only. | Reject malformed trigger intent or boundedness fixture data with a named verifier status. |
| Optional live `reviewOutputKey` proof using S01/S02 evidence helpers | Surface the inherited unavailable/error state from the reused verifier helpers instead of inventing a separate success path. | Keep live mode truthful about missing Azure/GitHub evidence and report an inconclusive or unavailable status rather than broad querying. | Reject non-synchronize or malformed keys before any live evidence lookup runs. |

## Load Profile

- **Shared resources**: Azure Log Analytics query budget in reused S01/S02 helpers plus one operator proof command per deploy check.
- **Per-operation cost**: one local config parse, one boundedness fixture evaluation, and optional keyed live evidence lookups.
- **10x breakpoint**: accidental broad live queries or repeated missing-key retries would hurt first, so the command must stay scoped to explicit synchronize keys and keep the local preflight path cheap.

## Negative Tests

- **Malformed inputs**: empty `--review-output-key`, malformed review-output keys, non-synchronize actions, and config intent that uses the legacy top-level trigger shape.
- **Error paths**: missing local config, reused S01/S02 unavailable states, and fixture reports that show bounded-disclosure drift.
- **Boundary conditions**: local preflight with no live key, valid synchronize review-output keys, and live proof where the key parses but the underlying evidence is absent.
