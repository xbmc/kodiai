---
estimated_steps: 19
estimated_files: 5
skills_used: []
---

# T03: Expose the complete M061 operator proof surface and prove it end-to-end

## Description
Wire the new and existing proof surfaces into `package.json`, then close the slice with the exact smoke/regression commands the roadmap promises. This task exists so operators can discover and rerun S03/S04/S05 proof entrypoints and the final regression gate without knowing script filenames.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `package.json` script wiring | Fail fast in tests/CLI execution when an alias points at the wrong file | Surface the hanging command or wrong script target during smoke verification | Treat missing aliases as a regression in operator surface coverage |
| New verifier/gate CLIs | Keep the task blocked until smoke commands either pass or fail open with explicit preflight state | Use the verifier's bounded timeout behavior and do not accept silent hangs | Treat malformed JSON/text output as failed smoke verification |

## Negative Tests
- **Malformed inputs**: missing script aliases, wrong script target names, and JSON smoke output that omits preflight/check IDs.
- **Error paths**: verifier fail-open path when DB is unavailable and regression gate non-zero exit if any pinned suite regresses.
- **Boundary conditions**: smoke verification in a no-DB environment and lint after all script wiring changes.

## Steps
1. Add package aliases for `verify:m061:s03`, `verify:m061:s04`, `verify:m061:s05`, and the M061 regression gate if any are missing.
2. Run the canonical script/unit suites plus `bun scripts/verify-m061-s05.ts --json`, `bun scripts/phase-m061-token-regression-gate.ts`, and `bun run lint`.
3. Tighten any remaining test expectations or script help text so the public operator surface matches the roadmap/research contract exactly.

## Must-Haves
- [ ] `package.json` exposes every M061 proof/regression entrypoint promised by S05.
- [ ] End-to-end verification covers both live-proof/fail-open CLI behavior and the pinned regression gate.
- [ ] The final slice verification commands are the same ones documented at slice level, so completion claims map directly to executable evidence.

## Inputs

- ``package.json``
- ``scripts/verify-m061-s03.ts``
- ``scripts/verify-m061-s04.ts``
- ``scripts/verify-m061-s05.ts``
- ``scripts/phase-m061-token-regression-gate.ts``
- ``scripts/verify-m061-s05.test.ts``
- ``scripts/phase-m061-token-regression-gate.test.ts``

## Expected Output

- ``package.json``

## Verification

bun test scripts/usage-report.test.ts scripts/verify-m061-s01.test.ts scripts/verify-m061-s02.test.ts scripts/verify-m061-s03.test.ts scripts/verify-m061-s04.test.ts scripts/verify-m061-s05.test.ts scripts/phase-m061-token-regression-gate.test.ts && bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/handlers/mention.test.ts src/execution/review-prompt.test.ts src/handlers/review.test.ts src/knowledge/retrieval.test.ts src/knowledge/retrieval.e2e.test.ts src/knowledge/multi-query-retrieval.test.ts && bun scripts/verify-m061-s05.ts --json && bun scripts/phase-m061-token-regression-gate.ts && bun run lint

## Observability Impact

- Signals added/changed: discoverable package-script entrypoints for S03/S04/S05 proof and the final regression gate.
- How a future agent inspects this: `bun run verify:m061:s03 --json`, `bun run verify:m061:s04 --json`, `bun run verify:m061:s05 --json`, and `bun run verify:m061:regression`.
- Failure state exposed: script alias drift, smoke verifier preflight detail, and named regression gate failures.
