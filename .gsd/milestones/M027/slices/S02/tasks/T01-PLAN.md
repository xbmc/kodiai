---
estimated_steps: 4
estimated_files: 3
---

# T01: Lock wiki repair contracts with failing tests

**Slice:** S02 — Timeout-Hardened Wiki Repair Path
**Milestone:** M027

## Description

Define the S02 boundary before implementation by adding failing tests that lock the bounded-window repair contract, durable checkpoint semantics, CLI progress/status output, and the representative proof harness envelope.

## Steps

1. Add `src/knowledge/wiki-embedding-repair.test.ts` covering degraded-row selection, conservative page window splitting, timeout-vs-size failure routing, batched write grouping, and sub-page resume cursor advancement.
2. Add `scripts/wiki-embedding-repair.test.ts` covering JSON and human CLI output, `--status`, `--resume`, and stable progress/failure fields.
3. Add `scripts/verify-m027-s02.test.ts` covering the representative proof harness envelope, check IDs, audit/repair evidence preservation, and failure-state reporting.
4. Run the targeted suite and confirm it fails only because the repair engine and proof commands are not implemented yet.

## Must-Haves

- [ ] Tests explicitly distinguish retryable transient failures from size-triggered split/fallback behavior.
- [ ] Resume coverage asserts checkpoint advancement at the page-window level rather than page-only or process-only state.
- [ ] CLI and proof-harness tests lock stable machine-readable fields for progress, cursor state, and failure summaries.

## Verification

- `bun test src/knowledge/wiki-embedding-repair.test.ts scripts/wiki-embedding-repair.test.ts scripts/verify-m027-s02.test.ts`
- The suite exits non-zero because implementation is missing, while failures point to specific contract expectations rather than placeholders.

## Observability Impact

- Signals added/changed: Test-locked progress and failure fields for repair runs, resume cursors, and proof-harness verdicts.
- How a future agent inspects this: Read the named tests to see the exact operator contract and failure-path expectations before changing the repair path.
- Failure state exposed: Contract drift becomes a deterministic test failure instead of an operator-visible behavior surprise.

## Inputs

- `src/knowledge/review-comment-embedding-sweep.ts` — existing batch/progress pattern worth mirroring at the operator-contract level.
- S02 research summary — repair must separate timeout/transient failures from size-based fallback and persist checkpoints outside `wiki_sync_state`.

## Expected Output

- `src/knowledge/wiki-embedding-repair.test.ts` — failing repair-engine contract tests.
- `scripts/wiki-embedding-repair.test.ts` — failing CLI/status/resume contract tests.
- `scripts/verify-m027-s02.test.ts` — failing proof-harness contract tests.
