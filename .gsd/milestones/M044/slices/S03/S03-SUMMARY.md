---
id: S03
parent: M044
milestone: M044
provides:
  - A stable `verify:m044` operator surface for recent xbmc/xbmc review auditing
  - A durable runbook for prerequisites, verdict meanings, and drill-down
  - The final packaged report used to close M044
requires:
  []
affects:
  []
key_files:
  - scripts/verify-m044-s01.ts
  - scripts/verify-m044-s01.test.ts
  - package.json
  - docs/runbooks/recent-review-audit.md
key_decisions:
  - D061 — final operator entrypoint is `verify:m044`
patterns_established:
  - Promote a slice-level verifier to the final operator surface by adding a stable package entrypoint and summary contract, not by cloning the script into a parallel final implementation.
  - Milestone closure for operator tooling should run through the same packaged command the runbook documents, not through internal helper commands.
observability_surfaces:
  - `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json`
  - Milestone-level `summary` block with verdict counts and lane counts
  - `docs/runbooks/recent-review-audit.md` drill-down procedure keyed on `reviewOutputKey` and Azure logs
drill_down_paths:
  - .gsd/milestones/M044/slices/S03/tasks/T01-SUMMARY.md
  - .gsd/milestones/M044/slices/S03/tasks/T02-SUMMARY.md
  - .gsd/milestones/M044/slices/S03/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-09T08:39:37.333Z
blocker_discovered: false
---

# S03: Repeatable Audit Verifier and Runbook

**Packaged the recent-review audit into the final operator command and runbook, then proved it live.**

## What Happened

S03 turned the repaired audit seam into the final operator-facing milestone surface. The verifier now has a stable package entrypoint, milestone-level summary counts, and a dedicated runbook that documents prerequisites, marker shapes, Azure evidence signals, verdict meanings, and how to investigate a flagged PR. The slice then reran the final `verify:m044` command against the live recent xbmc/xbmc sample so the milestone could close on the same packaged surface the runbook describes. The result is a repeatable audit command that no longer requires manual GitHub scrolling or remembered log queries: it samples the recent window deterministically, reports preflight truthfully, and returns per-PR verdicts with internal evidence attached.

## Verification

`bun test ./scripts/verify-m044-s01.test.ts` passed, then `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json` completed with `summary.totalArtifacts=12`, `clean-valid=11`, `findings-published=1`, `publish-failure=0`, `suspicious-approval=0`, and `indeterminate=0`. The runbook `docs/runbooks/recent-review-audit.md` exists and documents the final command and verdict taxonomy.

## Requirements Advanced

- R045 — S03 completed R045 by packaging the audit into the final operator command and runbook, preserving truthful preflight and per-PR evidence while proving the final surface live against the recent xbmc/xbmc sample.

## Requirements Validated

- R045 — `bun run verify:m044 -- --repo xbmc/xbmc --limit 12 --json` succeeded with a 12-PR recent sample and resolved the final report to 11 `clean-valid`, 1 `findings-published`, and 0 `indeterminate`, using GitHub-visible output plus Azure internal publication evidence as documented in `docs/runbooks/recent-review-audit.md`.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

The final operator command is `verify:m044`, but the implementation file and JSON `command` field still use `verify:m044:s01`. That does not block the milestone because the operator-facing package script and runbook both point to the stable final entrypoint, but it is worth noting as a naming mismatch rather than pretending the file-level label changed.

## Known Limitations

The current environment still reports `databaseAccess=unavailable`, so the final verifier relies on Azure publication evidence rather than DB-backed review rows. That is now a truthful and sufficient path for the recent-window audit, but the DB limitation remains an environment fact rather than a code fix.

## Follow-ups

None required for M044 closure. If future work wants cleaner naming, it can rename `scripts/verify-m044-s01.ts` or align the JSON `command` field with `verify:m044`, but that is cosmetic rather than a milestone blocker.

## Files Created/Modified

- `scripts/verify-m044-s01.ts` — Promoted the audit to the final `verify:m044` package entrypoint, added milestone-level summary counts, and kept the verifier contract testable in both JSON and human output.
- `scripts/verify-m044-s01.test.ts` — Expanded verifier tests for the final summary contract and packaged command behavior.
- `package.json` — Added the final package alias `verify:m044`.
- `docs/runbooks/recent-review-audit.md` — Added the dedicated operator runbook for the recent-review audit, prerequisites, verdict meanings, and drill-down steps.
