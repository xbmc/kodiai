---
estimated_steps: 4
estimated_files: 6
skills_used:
  - azure-container-apps
  - test-driven-development
  - verification-before-completion
---

# T02: Reduce git repo staging and materialization overhead on the review handoff path

**Slice:** S02 — Single-Worker Path Latency Reduction
**Milestone:** M048

## Description

This task targets the fixed git transport cost inside `executor handoff`. The review path already has the right public phase boundary; the work here is to make the git-backed workspace handoff cheaper while preserving the actual repo capabilities the remote agent needs: tracked symlinks, origin-based `git diff/log/show`, shallow-repo correctness, and unchanged review publication/idempotency behavior.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|-----------|----------------------|
| `prepareAgentWorkspace(...)` git transport path | Fail the executor handoff truthfully and surface the staging error instead of publishing a fake success. | Respect the existing overall review timeout; do not hang indefinitely during repo staging. | Reject malformed transport config and fall back only to known-safe behavior, never to a silent partial checkout. |
| `materializeRepoBundle(...)` / remote repo setup in `src/execution/agent-entrypoint.ts` | Return an execution error with diagnostics rather than invoking the SDK against a broken cwd. | Preserve the timeout/error result path without swallowing the failure. | Refuse invalid origin/bundle metadata and keep `git diff/log/show` correctness pinned in tests. |
| Review publication/idempotency flow covered by `src/handlers/review.test.ts` | Publication semantics must remain unchanged; faster handoff may not create duplicate or missing reviews. | Timeout publication stays truthful and uses the existing degraded/unavailable surfaces. | N/A — publication continuity is test-driven at the handler boundary. |

## Load Profile

- **Shared resources**: orchestrator temp storage, Azure Files workspace I/O, container local temp storage, and git object transfer between orchestrator and worker.
- **Per-operation cost**: one repo staging step plus one remote materialization/setup step per review execution.
- **10x breakpoint**: repo object volume and shared-storage bandwidth become the bottleneck first, so the task must remove unnecessary transfer/work while keeping the current single-worker topology intact.

## Negative Tests

- **Malformed inputs**: missing `repoOriginUrl`, malformed transport metadata in `agent-config.json`, and non-git workspace fallbacks.
- **Error paths**: shallow repositories, bundle/materialization failures, and staging errors before ACA launch.
- **Boundary conditions**: tracked symlinks survive, `git diff origin/<base>...HEAD` still works remotely, and the executor still reports the same two executor-owned phases on success/failure/timeout.

## Steps

1. Add failing coverage in `src/execution/prepare-agent-workspace.test.ts` and `src/execution/agent-entrypoint.test.ts` that pins the intended faster git transport contract for real review workspaces.
2. Refactor `src/execution/executor.ts` so `prepareAgentWorkspace(...)` stages only the repo transport/materialization work the current review path actually needs, while leaving the `executor handoff` timer boundary at the start of `execute()`.
3. Update `src/execution/agent-entrypoint.ts` so the remote worker consumes the optimized transport artifact and still runs against a repo cwd that supports the existing review git commands.
4. Extend `src/execution/executor.test.ts` and `src/handlers/review.test.ts` to prove success/failure/timeout phase semantics and publication/idempotency behavior remain unchanged.

## Must-Haves

- [ ] The git-backed review transport path does less fixed work than the current staging/materialization seam.
- [ ] Tracked symlinks and origin-based `git diff/log/show` continue to work from the remote repo cwd.
- [ ] The task does not move the `executor handoff` timer boundary or regress review publication/idempotency continuity.

## Verification

- `bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts`
- `bun run tsc --noEmit`

## Observability Impact

- Signals added/changed: executor/agent diagnostics that identify which transport/materialization path ran.
- How a future agent inspects this: inspect `agent-config.json` expectations in the focused tests and review any added agent diagnostics for the chosen transport path.
- Failure state exposed: repo staging failures, materialization failures, and continuity regressions stay visible instead of being collapsed into a generic runtime error.

## Inputs

- `src/execution/executor.ts` — current `prepareAgentWorkspace(...)` implementation and handoff timer boundary.
- `src/execution/prepare-agent-workspace.test.ts` — existing symlink/shallow bundle correctness tests.
- `src/execution/agent-entrypoint.ts` — current remote materialization path for git-backed workspaces.
- `src/execution/agent-entrypoint.test.ts` — remote repo setup regression coverage.
- `src/execution/executor.test.ts` — executor handoff/runtime continuity coverage.
- `src/handlers/review.test.ts` — publication/idempotency continuity coverage on the live review path.

## Expected Output

- `src/execution/executor.ts` — cheaper git transport/staging path that preserves the truthful handoff timer boundary.
- `src/execution/prepare-agent-workspace.test.ts` — focused coverage for the optimized git transport contract.
- `src/execution/agent-entrypoint.ts` — remote repo setup that consumes the optimized transport artifact without losing git capabilities.
- `src/execution/agent-entrypoint.test.ts` — regression coverage for remote repo cwd correctness after the transport change.
- `src/execution/executor.test.ts` — continuity coverage for executor phase semantics after the faster handoff path lands.
- `src/handlers/review.test.ts` — coverage proving publication/idempotency behavior stays unchanged.
