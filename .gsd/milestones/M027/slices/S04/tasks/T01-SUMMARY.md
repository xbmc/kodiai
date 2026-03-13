---
id: T01
parent: S04
milestone: M027
provides:
  - Red contract tests for the final S04 proof harness covering the top-level verdict, stable check IDs, idempotent rerun semantics, truthful retriever scope boundaries, and preserved nested S01/S02/S03 evidence.
key_files:
  - scripts/verify-m027-s04.test.ts
  - .gsd/milestones/M027/slices/S04/S04-PLAN.md
  - .gsd/STATE.md
key_decisions:
  - The final S04 JSON envelope must preserve raw subordinate proof payloads under top-level `s01`, `s02`, and `s03` fields instead of collapsing prior slices into one boolean.
  - S04 must treat healthy idempotent reruns as success by inspecting durable repair-state evidence directly, even when the composed wiki slice report remains red because its immediate repair step returned `repair_not_needed`.
  - The final retriever check must fail if `issue_comments` disappears from `not_in_retriever`, because hiding that gap would overstate live coverage.
patterns_established:
  - Milestone-closing proof harnesses lock both machine-readable envelopes and human-readable summaries before implementation, with explicit stable check IDs and failure codes.
observability_surfaces:
  - bun test ./scripts/verify-m027-s04.test.ts
  - bun run repair:wiki-embeddings -- --status --json
  - bun run repair:embeddings -- --corpus review_comments --status --json
duration: 35m
verification_result: passed
completed_at: 2026-03-12T15:34:00-07:00
blocker_discovered: false
---

# T01: Lock the final integrated proof contract with failing tests

**Added the red S04 contract suite so the final milestone proof now has a fixed acceptance boundary before any implementation lands.**

## What Happened

I created `scripts/verify-m027-s04.test.ts` as the authoritative failing contract for the final integrated proof harness.

The new suite defines the required S04 shape and semantics:

- top-level stable check IDs:
  - `M027-S04-FULL-AUDIT`
  - `M027-S04-RETRIEVER`
  - `M027-S04-WIKI-REPAIR-STATE`
  - `M027-S04-NON-WIKI-REPAIR-STATE`
- top-level status codes including `m027_s04_ok`, `m027_s04_failed`, and `m027_s04_resume_required`
- preserved nested raw evidence under `s01`, `s02`, and `s03`
- human output that surfaces the final verdict plus the same check IDs and failure codes
- healthy idempotent rerun semantics where wiki/non-wiki durable status can still pass the final milestone proof even if the immediate rerun returned `repair_not_needed`
- explicit failure paths for:
  - full six-corpus audit regression
  - retriever `query_embedding_unavailable`
  - wiki `repair_resume_available`
  - non-wiki `repair_resume_available`
  - dishonest retriever scope where `issue_comments` disappears from `not_in_retriever`

The contract is intentionally red because `scripts/verify-m027-s04.ts` and the `verify:m027:s04` package alias do not exist yet. The test loader throws a targeted error that names the missing S04 exports and CLI contract, so failures point at the absent final-proof harness rather than vague placeholders.

## Verification

Passed as expected for this contract-first task:

- `bun test ./scripts/verify-m027-s04.test.ts`
  - fails red on purpose
  - failure text is explicit: missing `scripts/verify-m027-s04.ts` with `parseVerifyM027S04Args()`, `evaluateM027S04Checks()`, `renderM027S04Report()`, and `main()`
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`
  - fails because the package alias does not exist yet, which is the expected pre-T02 state
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments`
  - fails because the package alias does not exist yet, which is the expected pre-T02 state
- `bun run repair:wiki-embeddings -- --status --json`
  - passes and currently reports `status_code=repair_completed` for `JSON-RPC API/v8`
- `bun run repair:embeddings -- --corpus review_comments --status --json`
  - passes and currently reports `status_code=repair_completed` with `run.status=not_needed` for `review_comments`

## Diagnostics

Use these to inspect the task boundary later:

- `bun test ./scripts/verify-m027-s04.test.ts` — authoritative S04 contract drift detector
- `scripts/verify-m027-s04.test.ts` — exact locked envelope, check ID, and verdict expectations for the final proof harness
- `bun run repair:wiki-embeddings -- --status --json` — confirms the live wiki durable-status surface already matches the shape S04 will need
- `bun run repair:embeddings -- --corpus review_comments --status --json` — confirms the live non-wiki durable-status surface already exposes healthy idempotent state

## Deviations

None.

## Known Issues

- `scripts/verify-m027-s04.ts` is still missing, so every new contract test currently fails at module load time by design.
- `package.json` does not yet define `verify:m027:s04`, so the slice-level final proof commands still fail with `Script not found` until T02 lands.

## Files Created/Modified

- `scripts/verify-m027-s04.test.ts` — red contract suite for the final milestone proof envelope, stable check IDs, verdict semantics, and nested S01/S02/S03 evidence preservation.
- `.gsd/milestones/M027/slices/S04/S04-PLAN.md` — marked T01 complete.
- `.gsd/STATE.md` — advanced the active task to S04/T02 and recorded that the S04 contract suite is now landed and verified red.
