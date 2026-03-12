---
id: T01
parent: S02
milestone: M027
provides:
  - Failing contract tests that lock S02 wiki repair engine, CLI, and proof-harness behavior before implementation
key_files:
  - src/knowledge/wiki-embedding-repair.test.ts
  - scripts/wiki-embedding-repair.test.ts
  - scripts/verify-m027-s02.test.ts
key_decisions:
  - Lock S02 around explicit engine exports, JSON-first CLI fields, and proof-harness check IDs before runtime code exists
patterns_established:
  - Missing S02 modules fail with targeted contract errors instead of vague placeholder assertions
observability_surfaces:
  - Test-locked progress/cursor/failure fields in engine, CLI, and proof-harness contracts
duration: 45m
verification_result: passed
completed_at: 2026-03-12
blocker_discovered: false
---

# T01: Lock wiki repair contracts with failing tests

**Added failing contract tests for the S02 wiki repair engine, operator CLI, and proof harness.**

## What Happened

Added three new failing test files:

- `src/knowledge/wiki-embedding-repair.test.ts` locks the engine contract for degraded-row selection, conservative page-window splitting, size-triggered split fallback vs transient timeout retry behavior, batched writes per bounded unit, and sub-page checkpoint advancement on resume.
- `scripts/wiki-embedding-repair.test.ts` locks the operator CLI contract for `--json`, `--status`, `--resume`, `--page-title`, stable human-readable progress output, cursor fields, and failure summaries.
- `scripts/verify-m027-s02.test.ts` locks the slice proof harness contract for stable check IDs, preserved raw repair/status/audit evidence, resume-required failure reporting, and deterministic exit behavior.

Each test file uses targeted module loader errors so the suite stays red specifically because the S02 engine/CLI/proof modules do not exist yet, not because of vague placeholders.

## Verification

Verified the new contract suite fails for the intended reason:

- `bun test src/knowledge/wiki-embedding-repair.test.ts scripts/wiki-embedding-repair.test.ts scripts/verify-m027-s02.test.ts` → non-zero; surfaced the missing `src/knowledge/wiki-embedding-repair.ts` contract first.
- `bun test ./src/knowledge/wiki-embedding-repair.test.ts ./scripts/wiki-embedding-repair.test.ts ./scripts/verify-m027-s02.test.ts` → non-zero with all 11 contract failures localized to the missing S02 implementation modules:
  - `src/knowledge/wiki-embedding-repair.ts`
  - `scripts/wiki-embedding-repair.ts`
  - `scripts/verify-m027-s02.ts`
- Slice verification commands currently fail as expected because T03/T04 scripts are not shipped yet:
  - `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --json` → `Script not found "repair:wiki-embeddings"`
  - `bun run repair:wiki-embeddings -- --status --json` → `Script not found "repair:wiki-embeddings"`
  - `bun run repair:wiki-embeddings -- --page-title "JSON-RPC API/v8" --resume --json` → `Script not found "repair:wiki-embeddings"`
  - `bun run verify:m027:s02 -- --page-title "JSON-RPC API/v8" --json` → `Script not found "verify:m027:s02"`

## Diagnostics

Future agents can inspect the exact S02 operator/runtime contract by reading:

- `src/knowledge/wiki-embedding-repair.test.ts` for target selection, windowing, retry-vs-split routing, batch-write behavior, and checkpoint semantics
- `scripts/wiki-embedding-repair.test.ts` for JSON/human output fields and CLI exit signaling
- `scripts/verify-m027-s02.test.ts` for proof-harness check IDs, evidence preservation, and failure-state reporting

The failure messages are explicit enough to show which missing module or export must be implemented next.

## Deviations

- Used `./`-prefixed paths for the all-files Bun test run because this Bun version treated the script-path arguments as filters unless forced to path mode. The underlying verification intent stayed the same.

## Known Issues

- `repair:wiki-embeddings` and `verify:m027:s02` do not exist yet, so the slice-level runtime commands remain red until T03/T04.
- `src/knowledge/wiki-embedding-repair.ts` does not exist yet, so the engine contract suite is intentionally red until T02.

## Files Created/Modified

- `src/knowledge/wiki-embedding-repair.test.ts` — failing engine contract tests for bounded windows, failure routing, batched writes, and resume checkpoints
- `scripts/wiki-embedding-repair.test.ts` — failing CLI contract tests for JSON/human/status/resume output
- `scripts/verify-m027-s02.test.ts` — failing proof-harness contract tests for evidence preservation and machine-checkable verdicts
- `.gsd/milestones/M027/slices/S02/S02-PLAN.md` — marked T01 complete
- `.gsd/STATE.md` — advanced active task/state to T02
