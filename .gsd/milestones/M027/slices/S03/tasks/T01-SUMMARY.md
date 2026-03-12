---
id: T01
parent: S03
milestone: M027
provides:
  - Failing contract tests for the shared non-wiki repair engine, unified repair CLI, and S03 proof harness envelope.
key_files:
  - src/knowledge/embedding-repair.test.ts
  - scripts/embedding-repair.test.ts
  - scripts/verify-m027-s03.test.ts
key_decisions:
  - Locked S03 around one shared non-wiki repair engine contract with corpus-specific text shaping and stale-support differences preserved in tests.
patterns_established:
  - Missing S03 runtime surfaces fail with explicit contract-oriented test errors instead of placeholder TODO assertions.
observability_surfaces:
  - Test-locked repair progress, cursor, failure_summary, and proof-evidence envelopes in the three new test files.
duration: 35m
verification_result: passed
completed_at: 2026-03-11T15:20:21-07:00
blocker_discovered: false
---

# T01: Lock shared non-wiki repair contracts with failing tests

**Added failing S03 contract tests for the shared non-wiki repair engine, unified repair CLI, and proof harness.**

## What Happened

I added three new test files that define the S03 boundary before implementation:

- `src/knowledge/embedding-repair.test.ts` locks the shared engine contract across `review_comments`, `learning_memories`, `code_snippets`, `issues`, and `issue_comments`.
  - Preserves `voyage-code-3` as the non-wiki target model.
  - Distinguishes stale-support corpora (`review_comments`, `learning_memories`, `code_snippets`) from no-stale corpora (`issues`, `issue_comments`).
  - Requires persisted-text-only adapter shaping for each corpus.
  - Locks bounded batch progression, durable cursor fields, dry-run read-only behavior, and truthful no-op results.
- `scripts/embedding-repair.test.ts` locks the operator CLI contract for `bun run repair:embeddings`.
  - Covers `--corpus`, `--status`, `--resume`, `--dry-run`, and `--json`.
  - Requires durable `run` and `failure_summary` fields.
  - Requires human-readable output to render from the same envelope as JSON.
  - Separates read-only `--status` and `--dry-run` behavior from mutating repair runs.
- `scripts/verify-m027-s03.test.ts` locks the slice proof-harness contract.
  - Requires stable check IDs.
  - Preserves raw `repair_evidence`, `status_evidence`, `noop_probe_evidence`, and `audit_evidence` envelopes.
  - Requires truthful failure-state reporting for both live repair status and the no-op corpus probe.

All three files use explicit “missing S03 implementation” import failures so the current red state points at the intended engine/CLI/proof surfaces rather than vague placeholders.

## Verification

Ran the task verification suite:

- `bun test ./src/knowledge/embedding-repair.test.ts ./scripts/embedding-repair.test.ts ./scripts/verify-m027-s03.test.ts`
  - Expected result observed: non-zero exit.
  - Failures are specific missing-S03-contract errors for:
    - `src/knowledge/embedding-repair.ts`
    - `scripts/embedding-repair.ts`
    - `scripts/verify-m027-s03.ts`

Ran the slice verification commands to record current state after T01:

- `bun run repair:embeddings -- --corpus review_comments --json` → failed as expected: script not found.
- `bun run repair:embeddings -- --corpus review_comments --status --json` → failed as expected: script not found.
- `bun run repair:embeddings -- --corpus review_comments --resume --json` → failed as expected: script not found.
- `bun run repair:embeddings -- --corpus issues --dry-run --json` → failed as expected: script not found.
- `bun run verify:m027:s03 -- --corpus review_comments --json` → failed as expected: script not found.
- `bun run audit:embeddings --json` → existing command started, then timed out in this session before producing a result.

## Diagnostics

Future agents can inspect the exact S03 contract directly in:

- `src/knowledge/embedding-repair.test.ts`
- `scripts/embedding-repair.test.ts`
- `scripts/verify-m027-s03.test.ts`

Those files now define:

- corpus-specific degraded-row selection semantics
- adapter text shaping from persisted row content
- repair progress/cursor/failure-summary fields
- CLI JSON + human envelope requirements
- proof-harness check IDs and preserved raw evidence expectations

## Deviations

None.

## Known Issues

- `repair:embeddings` and `verify:m027:s03` do not exist yet, so the new tests and slice verification commands fail until later S03 tasks implement them.
- `audit:embeddings --json` did not complete within the session timeout during this task.

## Files Created/Modified

- `src/knowledge/embedding-repair.test.ts` — failing shared-engine contract tests for all five non-wiki corpora.
- `scripts/embedding-repair.test.ts` — failing CLI contract tests for repair, status, resume, dry-run, and rendering.
- `scripts/verify-m027-s03.test.ts` — failing proof-harness contract tests with preserved raw evidence requirements.
- `.gsd/milestones/M027/slices/S03/S03-PLAN.md` — marked T01 complete.
