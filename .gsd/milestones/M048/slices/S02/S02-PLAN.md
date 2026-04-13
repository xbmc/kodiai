# S02: Single-Worker Path Latency Reduction

**Goal:** Reduce fixed latency on the real single-worker `xbmc/kodiai` review path by cutting ACA polling tail and git staging/handoff overhead without changing the truthful six-phase timing contract or GitHub publication behavior.
**Demo:** Run the same live review path and see materially lower workspace, handoff, or polling overhead in the phase timing surfaces while GitHub publication and idempotency still behave normally.

## Must-Haves

- ACA polling no longer adds a fixed 10s tail to every real review and has focused regression coverage for success, failure, timeout, and retry behavior.
- Git-backed review workspaces stage only the transport/materialization work needed for the current single-worker review path while preserving tracked symlinks, origin-based `git diff/log/show`, and shallow-repo correctness.
- The six S01 phase names and timer boundaries stay truthful; `executor handoff` still starts at the beginning of `execute()` and no “improvement” comes from moving the metric boundary.
- GitHub publication and idempotency continuity remain covered by handler/executor tests while the latency work lands.
- Operators can compare a pre-S02 baseline review and a post-S02 live review on the existing Review Details / Azure evidence surfaces to show lower `workspace preparation`, `executor handoff`, or polling-driven `remote runtime` time.

## Threat Surface

- **Abuse**: The slice must not claim a latency win by moving timer boundaries later, skipping publication/idempotency checks, or treating transient Azure poll errors as terminal success.
- **Data exposure**: Optimized repo transport and compare reports may handle repo bundle metadata, workspace paths, `reviewOutputKey`, and `deliveryId`, but they must not log prompt text, tokens, or Azure mount secrets.
- **Input trust**: Azure execution-status payloads, git repo metadata/history depth, and operator-supplied baseline/candidate review keys are untrusted until normalized and correlation-checked.

## Requirement Impact

- **Requirements touched**: `R050` directly as the stable latency-proof surface; `R043` / `R044` as continuity requirements because explicit review execution and GitHub publication must behave the same after the latency work ships.
- **Re-verify**: `src/jobs/aca-launcher.test.ts`, `src/execution/prepare-agent-workspace.test.ts`, `src/execution/agent-entrypoint.test.ts`, `src/execution/executor.test.ts`, `src/handlers/review.test.ts`, `scripts/verify-m048-s01.test.ts`, `scripts/verify-m048-s02.test.ts`, plus a fresh live `verify:m048:s02` run after deploy.
- **Decisions revisited**: `D100` (measurement-first M048 strategy), `D103` / `D104` (fixed six-phase evidence contract), and the older ACA isolation decisions `D013` / `D015` that must remain true while transport gets faster.

## Proof Level

- This slice proves: operational latency reduction on the real GitHub -> queue -> workspace -> ACA single-worker review path, using the existing six-phase evidence surfaces rather than a synthetic benchmark.
- Real runtime required: yes.
- Human/UAT required: yes — trigger a fresh real review on the same path as the S01 baseline and compare the two live review keys.

## Verification

- `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts`
- `bun run tsc --noEmit`
- `bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json`

## Observability / Diagnostics

- Runtime signals: existing `Review phase timing summary` rows plus any task-local diagnostics that identify the polling cadence and repo transport path used.
- Inspection surfaces: GitHub Review Details, Azure Log Analytics via `verify:m048:s01`, the new `verify:m048:s02` compare report, and focused Bun tests for executor/polling continuity.
- Failure visibility: `reviewOutputKey`, `deliveryId`, targeted phase deltas, Azure/source availability, and repo-staging failure points must stay visible when the faster path fails.
- Redaction constraints: do not log prompt content, tokens, Azure mount secrets, or workspace internals beyond already-accepted operator identifiers.

## Integration Closure

- Upstream surfaces consumed: `src/jobs/aca-launcher.ts`, `src/execution/executor.ts`, `src/execution/agent-entrypoint.ts`, `src/handlers/review.ts`, `scripts/verify-m048-s01.ts`, and the Review Details / Azure evidence contract from S01.
- New wiring introduced in this slice: faster ACA polling defaults, a cheaper git repo transport/materialization path for review execution, and an operator compare command that evaluates baseline vs candidate live review keys on the same six-phase evidence surface.
- What remains before the milestone is truly usable end-to-end: deploy the S02 changes, trigger a fresh real review on the same path as the S01 baseline, and use the compare command plus GitHub Review Details to confirm the latency win before moving to S03 product-contract work.

## Tasks

- [x] **T01: Tighten ACA job polling cadence without losing truthful status handling** `est:75m`
  - Why: The current ACA launcher waits a fixed 10 seconds between status checks, so finished executions can sit idle before the single-worker path records `remote runtime` completion.
  - Files: `src/jobs/aca-launcher.ts`, `src/jobs/aca-launcher.test.ts`, `src/execution/executor.test.ts`, `scripts/test-aca-job.ts`
  - Do: Centralize a faster default poll cadence, add focused polling tests for retries/timeouts/malformed responses, and align the smoke script with the same default without changing executor/public phase semantics.
  - Verify: `bun test ./src/jobs/aca-launcher.test.ts ./src/execution/executor.test.ts && bun run tsc --noEmit`
  - Done when: Launcher tests prove success, failure, timeout, and retry paths settle at the new cadence without hiding API errors or changing the six-phase contract.
- [x] **T02: Reduce git repo staging and materialization overhead on the review handoff path** `est:2h`
  - Why: `executor handoff` currently pays for git bundle creation plus remote materialization work before the single worker can start reviewing, and that fixed cost is the main remaining plumbing seam after S01.
  - Files: `src/execution/executor.ts`, `src/execution/prepare-agent-workspace.test.ts`, `src/execution/agent-entrypoint.ts`, `src/execution/agent-entrypoint.test.ts`, `src/execution/executor.test.ts`, `src/handlers/review.test.ts`
  - Do: Optimize the git-backed workspace transport path in `prepareAgentWorkspace(...)` and `agent-entrypoint.ts` so review executions move only the repo state they need, while preserving symlinks, origin-based diff/log/show commands, shallow-repo correctness, and the existing publication/idempotency behavior.
  - Verify: `bun test ./src/execution/prepare-agent-workspace.test.ts ./src/execution/agent-entrypoint.test.ts ./src/execution/executor.test.ts ./src/handlers/review.test.ts && bun run tsc --noEmit`
  - Done when: Focused executor/entrypoint tests prove the faster transport still supports real review git operations and the handler-facing timing contract remains unchanged.
- [ ] **T03: Add an operator compare command for before/after S02 latency proof** `est:90m`
  - Why: S02 should close on repeatable evidence, not ad hoc manual eyeballing of two separate live review runs.
  - Files: `scripts/verify-m048-s01.ts`, `scripts/verify-m048-s01.test.ts`, `scripts/verify-m048-s02.ts`, `scripts/verify-m048-s02.test.ts`, `package.json`
  - Do: Build a small compare command that reuses `verify:m048:s01` evidence gathering to evaluate a baseline review key and a candidate review key, report per-phase deltas for the targeted latency phases, and keep publication continuity visible in the report.
  - Verify: `bun test ./scripts/verify-m048-s01.test.ts ./scripts/verify-m048-s02.test.ts && bun run tsc --noEmit && bun run verify:m048:s02 -- --baseline-review-output-key "$BASELINE_REVIEW_OUTPUT_KEY" --candidate-review-output-key "$REVIEW_OUTPUT_KEY" --json`
  - Done when: The new command has focused regression tests, is wired in `package.json`, and can compare a stored baseline review with a fresh post-deploy review using the shared six-phase evidence contract.

## Files Likely Touched

- `src/jobs/aca-launcher.ts`
- `src/jobs/aca-launcher.test.ts`
- `scripts/test-aca-job.ts`
- `src/execution/executor.ts`
- `src/execution/prepare-agent-workspace.test.ts`
- `src/execution/agent-entrypoint.ts`
- `src/execution/agent-entrypoint.test.ts`
- `src/execution/executor.test.ts`
- `src/handlers/review.test.ts`
- `scripts/verify-m048-s01.ts`
- `scripts/verify-m048-s01.test.ts`
- `scripts/verify-m048-s02.ts`
- `scripts/verify-m048-s02.test.ts`
- `package.json`
