# S02: Project review orchestration into canonical state with supersession-safe writes

**Goal:** Project the real timeout/retry review orchestration path into canonical continuation-family state so enqueue failures, retry failures, telemetry/checkpoint degradation, and stale superseded attempts leave one truthful durable lifecycle record instead of optimistic or stale authority.
**Demo:** After this slice, running the real continuation path through timeout, retry, quiet settlement, and supersession scenarios updates one canonical lifecycle record while stale attempts are unable to overwrite authority or falsely report checkpoint durability.

## Must-Haves

- `save_review_checkpoint` reports success only after the underlying checkpoint write resolves, and rejection paths surface a non-success/error result instead of `saved: true`.
- Real review-handler timeout/retry orchestration updates canonical continuation-family state for retry enqueue failure, retry execution failure, telemetry projection failure, and stale retry supersession without letting older attempts overwrite newer authority.
- Slice proof exercises the live orchestration scenarios and shows canonical outcome, final stop reason, attempt identity, and projection status remain truthful even when projections fail or retries are superseded.

## Proof Level

- This slice proves: This slice proves: integration
Real runtime required: no
Human/UAT required: no

## Integration Closure

Upstream surfaces consumed: `src/handlers/review.ts`, `src/jobs/review-work-coordinator.ts`, `src/knowledge/store.ts`, `src/execution/mcp/checkpoint-server.ts`, `src/telemetry/store.ts`.
New wiring introduced in this slice: truthful checkpoint save acknowledgement, canonical-state transition/degradation handling for real retry orchestration failures, and deterministic proof coverage for orchestration failure/supersession scenarios.
What remains before the milestone is truly usable end-to-end: S03 must make operator-facing reporting/projection surfaces canonical-state-first and expose degraded projection status directly in the report output.

## Verification

- Runtime signals: canonical continuation-family rows must show `projectionStatus`, `finalStopReason`, `authoritativeAttemptId`, and `supersededByAttemptId` for real orchestration failure paths.
- Inspection surfaces: `src/handlers/review.test.ts`, `src/execution/mcp/checkpoint-server.test.ts`, and `bun run verify:m064:s02 -- --json` should let a future agent inspect retry enqueue failure, retry execution failure, telemetry degradation, and supersession outcomes.
- Failure visibility: enqueue failure, retry failure, and projection-write degradation should be explicit in durable canonical state instead of only in logs.
- Redaction constraints: verification and canonical state assertions must avoid comment-body secrets and only assert on lifecycle metadata plus tracked test fixtures.

## Tasks

- [x] **T01: Make checkpoint persistence acknowledgements truthful** `est:45m`
  Patch the MCP checkpoint tool so it does not claim durable progress before the write has actually completed. This task closes owned requirement R075 and removes the false-success path that would otherwise undermine every later continuation-family proof in this slice.

## Steps
1. Read `createCheckpointServer` and update `save_review_checkpoint` so it awaits `knowledgeStore.saveCheckpoint(...)`, preserves the existing degraded-storage branch, and routes rejected saves through the existing `isError` response path instead of returning optimistic success JSON.
2. Expand `src/execution/mcp/checkpoint-server.test.ts` with one test that proves the handler promise stays pending until an async `saveCheckpoint` resolver is released, and a second negative-path test that proves a rejected save does not return `saved: true`.
3. Keep the tool contract narrow: do not add new MCP tools or schema fields unless the current response shape cannot express truthful failure.

## Must-Haves
- [ ] `save_review_checkpoint` only returns `saved: true` after the awaited checkpoint write resolves.
- [ ] A rejected checkpoint write returns a non-success/error response and never reports false durability.
- [ ] Existing unavailable-storage degradation behavior remains intact.

## Verification
- `bun test src/execution/mcp/checkpoint-server.test.ts`
- Handler-level async test proves the tool promise does not resolve before the checkpoint write finishes.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `knowledgeStore.saveCheckpoint` | Return MCP tool error / non-success result; do not claim saved | Leave tool call unresolved until runtime timeout rather than fabricating success | N/A — local function call |

## Negative Tests
- **Malformed inputs**: Reuse tool schema validation; no new malformed-input surface is added.
- **Error paths**: Rejected `saveCheckpoint` promise returns an error result and does not increment success assertions.
- **Boundary conditions**: Deferred promise test proves success is emitted only after the async write settles.

## Inputs
- `src/execution/mcp/checkpoint-server.ts` — current non-awaited checkpoint tool implementation.
- `src/execution/mcp/checkpoint-server.test.ts` — existing positive-path-only MCP checkpoint tests.

## Expected Output
- `src/execution/mcp/checkpoint-server.ts` — awaited, truthful checkpoint persistence acknowledgement.
- `src/execution/mcp/checkpoint-server.test.ts` — async-resolution and rejection regression coverage.
  - Files: `src/execution/mcp/checkpoint-server.ts`, `src/execution/mcp/checkpoint-server.test.ts`
  - Verify: bun test src/execution/mcp/checkpoint-server.test.ts

- [x] **T02: Harden canonical-state transitions for retry enqueue, retry execution, and projection failures** `est:2h`
  Wire the real review timeout/retry path so canonical continuation-family state stays truthful when downstream projections or retry execution fail. This task advances R067 by extending supersession-safe authority writes to the live orchestration gaps, and supports R074 by degrading projection status instead of leaving ambiguity in logs.

## Steps
1. Refactor the continuation-family helper seam in `src/handlers/review.ts` just enough to express "same authoritative outcome, degraded projection status" updates and final fallback outcomes for retry enqueue failure and retry execution failure without changing public PR behavior.
2. Update the timeout scheduling path so telemetry-write failures and retry enqueue failures correct the canonical family row rather than leaving `continuation-pending` as the last durable truth. Preserve ordinal-guarded writes and keep `ReviewWorkCoordinator` as the runtime publish gate from D188.
3. Update the queued retry execution path so thrown retry work finalizes canonical state before cleanup, and stale/superseded retries cannot overwrite a newer authoritative row or leave a misleading checkpoint-durability story.
4. Add/expand `src/handlers/review.test.ts` coverage for retry enqueue failure, retry execution failure, telemetry projection degradation, and stale retry supersession under canonical-state assertions.

## Must-Haves
- [ ] Retry enqueue failure does not leave canonical state stuck at `continuation-pending`.
- [ ] Retry execution failure records a truthful final canonical outcome/stop reason before retry/base checkpoint cleanup runs.
- [ ] Telemetry projection failure degrades canonical `projectionStatus` while preserving the correct authoritative outcome.
- [ ] Stale retry attempts remain unable to overwrite newer authoritative rows or imply durable success after supersession.

## Verification
- `bun test src/handlers/review.test.ts`
- Canonical-state assertions cover enqueue failure, retry failure, telemetry degradation, and superseded stale retry scenarios.

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `jobQueue.enqueue` | Finalize canonical row with truthful non-pending lifecycle state and release retry claim | Same canonical fallback path should win if enqueue never completes | N/A — local queue API |
| `executor.execute` | Persist canonical terminal/degraded state before cleanup and log the retry failure | Preserve canonical truth for timed-out retry before cleanup | N/A — typed execution result |
| `telemetryStore.recordResilienceEvent` / related projection writes | Mark canonical `projectionStatus` degraded and continue | Same degraded canonical projection status | N/A — local projection call |

## Load Profile
- **Shared resources**: review work coordinator family claims, canonical store row, checkpoint rows, telemetry writes.
- **Per-operation cost**: one canonical upsert per lifecycle transition plus best-effort projection writes; test coverage exercises one retry family at a time.
- **10x breakpoint**: duplicate retry attempts contending on the same family row; ordinal-guarded upserts must continue preventing stale writes from overtaking newer authority.

## Negative Tests
- **Malformed inputs**: Invalid/sparse checkpoint state should still avoid crashing canonical fallback paths.
- **Error paths**: queue rejection, thrown retry execution, and telemetry-write exceptions each assert the resulting canonical row.
- **Boundary conditions**: stale attempt finishing after supersession cannot change the family row away from the newer authoritative attempt.

## Inputs
- `src/handlers/review.ts` — current continuation scheduling, telemetry projection, and retry cleanup logic.
- `src/handlers/review.test.ts` — existing canonical-state success-path coverage and supersession behavior tests.
- `src/knowledge/types.ts` — current authoritative outcome, stop reason, and projection-status contracts.
- `src/knowledge/store.ts` — ordinal-guarded continuation-family upsert semantics.
- `src/jobs/review-work-coordinator.ts` — runtime publish-rights/supersession contract.

## Expected Output
- `src/handlers/review.ts` — hardened canonical transition/degradation handling for real orchestration failures.
- `src/handlers/review.test.ts` — regression coverage for enqueue failure, retry failure, projection degradation, and stale supersession.
  - Files: `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/knowledge/types.ts`, `src/knowledge/store.ts`, `src/jobs/review-work-coordinator.ts`
  - Verify: bun test src/handlers/review.test.ts

- [x] **T03: Add deterministic proof for orchestration failure and supersession scenarios** `est:1.5h`
  Close the slice with a machine-checkable proof surface that exercises the real orchestration failure paths rather than relying on ad hoc log inspection. This task packages the slice demo into a deterministic verifier/regression command that future agents can rerun when continuation-family truth looks suspicious.

## Steps
1. Add a focused verifier script and tests that drive the real handler/orchestration seams for retry enqueue failure, retry execution failure, telemetry degradation, and superseded stale retry scenarios, then read back canonical continuation-family state as the answer source.
2. Expose the verifier through `package.json` so slice-close verification can run one command after the unit suites.
3. Keep the verifier canonical-state-first: it may mention projection degradation, but it must not derive authority from checkpoint JSON or telemetry rows.

## Must-Haves
- [ ] A deterministic `verify:m064:s02` command exists and emits canonical-state answers for the slice scenarios.
- [ ] Verifier tests assert the reported authoritative attempt, outcome, stop reason, and projection status for each scenario.
- [ ] The verifier reuses tracked source/test fixtures only; no `.gsd/` or ignored-path fixtures are required.

## Verification
- `bun test scripts/verify-m064-s02.test.ts`
- `bun run verify:m064:s02 -- --json`
- `bun test src/execution/mcp/checkpoint-server.test.ts && bun test src/handlers/review.test.ts && bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json`

## Failure Modes
| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| verifier scenario harness in `scripts/verify-m064-s02.ts` | Exit non-zero with scenario failure details | Treat as failed proof and report timeout in test output | Fail parsing/validation and surface scenario name + mismatch |
| canonical store/query seam used by verifier | Fail fast; verifier must not silently fall back to checkpoints or telemetry | N/A in local harness | Reject unexpected shape and fail the scenario |

## Load Profile
- **Shared resources**: local test harnesses and canonical-state fixtures only.
- **Per-operation cost**: a few scenario executions plus one canonical-state read/assert per scenario.
- **10x breakpoint**: mostly test runtime; no production hot-path load risk.

## Negative Tests
- **Malformed inputs**: verifier rejects missing/invalid canonical fields instead of printing partial success.
- **Error paths**: each orchestration-failure scenario must prove the verifier still returns a truthful canonical answer.
- **Boundary conditions**: superseded stale retry scenario must confirm older-attempt proof output cannot win after a newer attempt is authoritative.

## Inputs
- `src/handlers/review.ts` — canonical orchestration behavior under test.
- `src/handlers/review.test.ts` — scenario setup patterns for continuation-family runtime tests.
- `src/execution/mcp/checkpoint-server.ts` — truthful checkpoint acknowledgement contract from T01.
- `scripts/verify-m064-s01.ts` — prior canonical-state verifier pattern to extend, not re-derive.
- `scripts/verify-m064-s01.test.ts` — verifier test structure to mirror.
- `package.json` — script wiring surface.

## Expected Output
- `scripts/verify-m064-s02.ts` — deterministic orchestration-failure/supersession verifier.
- `scripts/verify-m064-s02.test.ts` — verifier regression coverage.
- `package.json` — `verify:m064:s02` command wiring.
  - Files: `scripts/verify-m064-s02.ts`, `scripts/verify-m064-s02.test.ts`, `package.json`, `src/handlers/review.ts`, `src/handlers/review.test.ts`, `src/execution/mcp/checkpoint-server.ts`
  - Verify: bun test scripts/verify-m064-s02.test.ts && bun run verify:m064:s02 -- --json

## Files Likely Touched

- src/execution/mcp/checkpoint-server.ts
- src/execution/mcp/checkpoint-server.test.ts
- src/handlers/review.ts
- src/handlers/review.test.ts
- src/knowledge/types.ts
- src/knowledge/store.ts
- src/jobs/review-work-coordinator.ts
- scripts/verify-m064-s02.ts
- scripts/verify-m064-s02.test.ts
- package.json
