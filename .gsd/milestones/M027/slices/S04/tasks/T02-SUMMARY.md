---
id: T02
parent: S04
milestone: M027
provides:
  - Final `verify:m027:s04` acceptance harness that composes S01/S02/S03 proofs into one milestone verdict with preserved nested evidence
key_files:
  - scripts/verify-m027-s04.ts
  - package.json
  - .gsd/DECISIONS.md
key_decisions:
  - S04 repair-state checks treat `repair_not_needed` as healthy only when the durable status surface still reports `repair_completed` with zero failures, including status rows whose current run state is `not_needed`
patterns_established:
  - Milestone-closing proof commands stay JSON-first, compute top-level stable check IDs from subordinate proof envelopes, and preserve the full subordinate payloads for drill-down
observability_surfaces:
  - `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments [--json]`
  - `bun run repair:wiki-embeddings -- --status --json`
  - `bun run repair:embeddings -- --corpus review_comments --status --json`
duration: 55m
verification_result: passed
completed_at: 2026-03-12T09:33:20Z
blocker_discovered: false
---

# T02: Implement the composed S04 acceptance harness and package entrypoint

**Added the composed `verify:m027:s04` harness, package alias, and durable idempotent-rerun semantics required for the final M027 proof.**

## What Happened

Implemented `scripts/verify-m027-s04.ts` as a composition layer over the existing S01/S02/S03 proof harnesses instead of duplicating audit, retriever, or repair logic. The new harness:

- runs the existing slice proofs with explicit `repo`, `query`, `pageTitle`, and `corpus` inputs
- preserves the raw subordinate reports under top-level `s01`, `s02`, and `s03`
- computes stable milestone-level checks for `M027-S04-FULL-AUDIT`, `M027-S04-RETRIEVER`, `M027-S04-WIKI-REPAIR-STATE`, and `M027-S04-NON-WIKI-REPAIR-STATE`
- keeps `issue_comments` truthfully surfaced as `not_in_retriever`
- renders human output from the same JSON-first envelope used for `--json`
- exposes a `verify:m027:s04` package alias in `package.json`

During live verification the first S04 run exposed an important integration mismatch: the non-wiki durable status surface reported `status_code=repair_completed` with `run.status=not_needed` on a healthy rerun. The original S04 implementation treated that as a failure. I corrected the harness to accept that state as healthy only when the durable status still reports `repair_completed` and zero failure metadata, which matches the locked S04 semantics and the real persisted repair-state behavior.

I also appended the durable-rerun interpretation to `.gsd/DECISIONS.md` so later tasks do not regress the final proof semantics.

## Verification

Passed:

- `bun test ./scripts/verify-m027-s04.test.ts`
- `bun test ./scripts/verify-m027-s01.test.ts ./scripts/verify-m027-s02.test.ts ./scripts/verify-m027-s03.test.ts`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments`
- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`

Observed live result:

- Final S04 proof returned `overallPassed=true` and `status_code=m027_s04_ok`
- Nested evidence preserved `s01`, `s02`, and `s03` payloads as required
- Non-wiki durable status verified the healthy idempotent rerun shape: `status_code=repair_completed` with `run.status=not_needed`

## Diagnostics

Use the final proof command first:

- `bun run verify:m027:s04 -- --json`

Then inspect nested evidence by subsystem:

- `checks[].id === M027-S04-FULL-AUDIT` → audit drift across the full six-corpus envelope preserved from `s01.audit`
- `checks[].id === M027-S04-RETRIEVER` → live query-embedding / retriever issues plus truthful `not_in_retriever`
- `checks[].id === M027-S04-WIKI-REPAIR-STATE` → wiki repair probe plus persisted status evidence from `s02`
- `checks[].id === M027-S04-NON-WIKI-REPAIR-STATE` → non-wiki repair probe plus persisted status evidence from `s03`

For direct durable-status inspection:

- `bun run repair:wiki-embeddings -- --status --json`
- `bun run repair:embeddings -- --corpus review_comments --status --json`

## Deviations

None.

## Known Issues

None in this task. T03 still needs the operator runbook updates and the slice-level closure narrative.

## Files Created/Modified

- `scripts/verify-m027-s04.ts` — new composed milestone proof harness with stable top-level checks, nested S01/S02/S03 evidence, and JSON/human output
- `package.json` — added the `verify:m027:s04` package alias
- `.gsd/DECISIONS.md` — recorded the durable idempotent-rerun interpretation used by the final S04 repair-state checks
