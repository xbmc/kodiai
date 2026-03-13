---
id: T03
parent: S04
milestone: M027
provides:
  - Final operator runbook guidance for the milestone-closing `verify:m027:s04` proof, plus recorded live acceptance evidence from the production-wired S04 pass
key_files:
  - docs/operations/embedding-integrity.md
  - .gsd/milestones/M027/slices/S04/S04-PLAN.md
  - .gsd/STATE.md
key_decisions:
  - The operator runbook now treats S04 repair-state success as durable-status-backed, so healthy idempotent reruns are interpreted from the paired `--status --json` surfaces instead of requiring fresh mutations
patterns_established:
  - Milestone-closing runbooks document stable check IDs, nested proof payloads, and the exact operator localization path from top-level failing check to subordinate JSON evidence
observability_surfaces:
  - `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments [--json]`
  - `bun run repair:wiki-embeddings -- --status --json`
  - `bun run repair:embeddings -- --corpus review_comments --status --json`
  - docs/operations/embedding-integrity.md
duration: 25m
verification_result: passed
completed_at: 2026-03-12T02:36:39-07:00
blocker_discovered: false
---

# T03: Document the final operator proof and run the live acceptance pass

**Documented the S04 milestone proof for operators and verified the live production-wired acceptance pass with durable wiki/non-wiki backing surfaces.**

## What Happened

Updated `docs/operations/embedding-integrity.md` with a new S04 runbook section covering the final `verify:m027:s04` command, required inputs, stable milestone check IDs, final status codes, and interpretation guidance for live retriever failures, audited-only `issue_comments`, healthy no-op reruns, and real `repair_resume_available` regressions.

Then ran the live S04 proof in both JSON and human modes against the representative production targets:
- repo: `xbmc/xbmc`
- query: `json-rpc subtitle delay`
- wiki page: `JSON-RPC API/v8`
- non-wiki corpus: `review_comments`

The live proof passed cleanly with `m027_s04_ok`. The milestone-level checks resolved to:
- `M027-S04-FULL-AUDIT` → `audit_ok`
- `M027-S04-RETRIEVER` → `retrieval_hits`
- `M027-S04-WIKI-REPAIR-STATE` → `repair_completed`
- `M027-S04-NON-WIKI-REPAIR-STATE` → durable `repair_completed` backed by a healthy idempotent `repair_not_needed` rerun for `review_comments`

No live-only truthfulness or rendering bug surfaced during the acceptance pass, so `scripts/verify-m027-s04.ts` did not require code changes in this task.

## Verification

Passed the locked contract test:
- `bun test ./scripts/verify-m027-s04.test.ts`

Passed the live final proof in machine-readable mode:
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments --json`

Passed the live final proof in human mode:
- `bun run verify:m027:s04 -- --repo xbmc/xbmc --query "json-rpc subtitle delay" --page-title "JSON-RPC API/v8" --corpus review_comments`

Confirmed the durable repair-state backing surfaces directly:
- `bun run repair:wiki-embeddings -- --status --json` → `repair_completed`, `page_title=JSON-RPC API/v8`, `repaired=388`, `failed=0`
- `bun run repair:embeddings -- --corpus review_comments --status --json` → `repair_completed`, `run.status=not_needed`, `failed=0`

## Diagnostics

Use the updated runbook in `docs/operations/embedding-integrity.md` for the operator interpretation path.

For direct inspection:
- Run `verify:m027:s04 --json` first.
- Use failing check ID to choose the nested proof payload:
  - `M027-S04-FULL-AUDIT` / `M027-S04-RETRIEVER` → inspect `s01`
  - `M027-S04-WIKI-REPAIR-STATE` → inspect `s02`
  - `M027-S04-NON-WIKI-REPAIR-STATE` → inspect `s03`
- Confirm healthy no-op reruns from the durable status commands instead of relying only on the immediate repair probe:
  - `repair:wiki-embeddings -- --status --json`
  - `repair:embeddings -- --corpus review_comments --status --json`

## Deviations

None.

## Known Issues

None.

## Files Created/Modified

- `docs/operations/embedding-integrity.md` — added the final S04 operator runbook section, stable check IDs/status codes, and failure/localization guidance
- `.gsd/milestones/M027/slices/S04/S04-PLAN.md` — marked T03 complete
- `.gsd/STATE.md` — advanced the active task and next-action state to T04
