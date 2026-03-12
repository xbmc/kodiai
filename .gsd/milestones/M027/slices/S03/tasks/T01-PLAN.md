---
estimated_steps: 4
estimated_files: 3
---

# T01: Lock shared non-wiki repair contracts with failing tests

**Slice:** S03 — Unified Online Repair for Remaining Corpora
**Milestone:** M027

## Description

Define the S03 boundary before implementation by adding failing tests that lock the shared non-wiki repair contract, corpus-specific degraded selection rules, durable resume/status semantics, and the slice proof-harness envelope.

## Steps

1. Add `src/knowledge/embedding-repair.test.ts` covering corpus-scoped candidate selection, stale-support differences, persisted-text adapter shaping, bounded batch progression, durable cursor fields, and empty-corpus/no-op behavior.
2. Add `scripts/embedding-repair.test.ts` covering `--corpus`, `--status`, `--resume`, `--dry-run`, JSON output, and human-readable rendering from the same report envelope.
3. Add `scripts/verify-m027-s03.test.ts` covering stable check IDs, preserved repair/status/audit evidence, and truthful failure-state reporting for both live repair and no-op corpus probes.
4. Run the targeted suite and confirm it fails only because the new engine and operator scripts are not implemented yet.

## Must-Haves

- [ ] Tests explicitly distinguish `review_comments` / `learning_memories` / `code_snippets` stale support from `issues` / `issue_comments` no-stale semantics.
- [ ] CLI tests lock durable `run` and `failure_summary` fields plus read-only `--status` / `--dry-run` behavior separately from mutating repair runs.
- [ ] Proof-harness tests require preserved raw evidence envelopes instead of a flattened pass/fail summary.

## Verification

- `bun test src/knowledge/embedding-repair.test.ts scripts/embedding-repair.test.ts scripts/verify-m027-s03.test.ts`
- The suite exits non-zero because implementation is missing, while failures point to specific S03 contract expectations rather than placeholder TODOs.

## Observability Impact

- Signals added/changed: Test-locked repair progress, cursor, and failure-summary fields across all five remaining corpora.
- How a future agent inspects this: Read the three named test files to see the exact repair/status/proof contract before touching implementation.
- Failure state exposed: Contract drift becomes deterministic test failure output instead of an operator surprise in production.

## Inputs

- `src/knowledge/wiki-embedding-repair.ts` — the S02 repair/status contract shape S03 should mirror at the operator boundary.
- S03 research summary — remaining corpora must repair from persisted Postgres text, not GitHub re-fetch loops, and must keep repair state separate from sync-state tables.

## Expected Output

- `src/knowledge/embedding-repair.test.ts` — failing shared-engine contract tests for all five remaining corpora.
- `scripts/embedding-repair.test.ts` — failing CLI/status/dry-run contract tests.
- `scripts/verify-m027-s03.test.ts` — failing slice proof-harness contract tests.
