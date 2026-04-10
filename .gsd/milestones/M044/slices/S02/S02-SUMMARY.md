---
id: S02
parent: M044
milestone: M044
provides:
  - A reusable Azure log-evidence adapter for later verifier packaging
  - A live recent xbmc/xbmc sample that now resolves beyond `indeterminate` using internal publication signals
  - Classifier logic that can distinguish clean approvals from published-output cases without DB access
requires:
  []
affects:
  - S03
key_files:
  - src/review-audit/log-analytics.ts
  - src/review-audit/log-analytics.test.ts
  - src/review-audit/evidence-correlation.ts
  - src/review-audit/evidence-correlation.test.ts
  - scripts/verify-m044-s01.ts
  - scripts/verify-m044-s01.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - D060 — use Azure Log Analytics as the first S02 evidence repair path instead of adding a new persistence layer first
patterns_established:
  - If DB-backed evidence is unavailable but Azure publication logs are reachable, prefer Azure review evidence over abandoning the audit run.
  - Automatic review `Evidence bundle` outcomes are sufficient to distinguish clean approval (`submitted-approval`) from finding publication (`published-output`) in recent-window audits.
  - Explicit mention-review `publishResolution` from `Mention execution completed` is the authoritative recent-window audit signal when available.
observability_surfaces:
  - `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` with `azureLogAccess` preflight
  - Normalized Azure review-audit log rows from `ContainerAppConsoleLogs_CL`
  - Per-PR verdict signals that disclose whether classification came from Azure evidence or DB fallback
drill_down_paths:
  - .gsd/milestones/M044/slices/S02/tasks/T01-SUMMARY.md
  - .gsd/milestones/M044/slices/S02/tasks/T02-SUMMARY.md
  - .gsd/milestones/M044/slices/S02/tasks/T03-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-04-09T08:23:04.268Z
blocker_discovered: false
---

# S02: Audit-Driven Publication/Correctness Repair

**Used Azure publication signals to turn the recent-review audit from mostly indeterminate into real clean/published classifications.**

## What Happened

S02 retired the first concrete ambiguity exposed by S01. Rather than leaving recent reviews stuck at `indeterminate` while the environment timed out on PostgreSQL and explicit publish truth remained log-only, the slice taught the audit to consume the internal publication signals that are already present in Azure. The new log-analytics adapter discovers rg-kodiai workspaces, runs bounded `ContainerAppConsoleLogs_CL` queries, and normalizes JSON application logs into typed evidence rows. The correlation layer then interprets those rows as audit truth: automatic `Evidence bundle` outcomes distinguish `submitted-approval` from `published-output`, and explicit mention `publishResolution` states distinguish `approval-bridge`, idempotent/duplicate-safe recoveries, and publish failures. With that wired into `verify:m044:s01`, a live xbmc/xbmc rerun no longer collapses to all-`indeterminate`. The recent sample now resolves real classifications from current internal evidence: explicit PRs `#28143` and `#28086` are `clean-valid`, most sampled automatic reviews are `clean-valid`, and PR `#28135` is `findings-published` from Azure `published-output` evidence.

## Verification

`bun test ./src/review-audit/log-analytics.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts` passed (19 tests, 0 failures). `bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json` then completed with `status_code=m044_s01_ok`, `azureLogAccess=available`, explicit `clean-valid` verdicts for PRs `#28143` and `#28086`, and `findings-published` for PR `#28135`.

## Requirements Advanced

- R045 — S02 turned R045 from a provisional sampler into a real evidence-backed audit over the recent xbmc/xbmc window by wiring Azure internal publication signals into the verifier and producing non-`indeterminate` live verdicts.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

S02 was originally framed as a generic repair slice. S01 made the real gap narrower: the current environment could query Azure but not PostgreSQL, so S02 used Azure publication signals as the first repair path rather than designing a new persistence layer before exhausting the existing evidence surface.

## Known Limitations

The current environment still cannot reach the configured PostgreSQL host, so DB-backed evidence remains unavailable in the live verifier. S02 solved the immediate recent-review audit gap by using Azure publication signals, but S03 still needs to package prerequisites and verdict reporting cleanly. The current recent sample also did not surface a live publish-failure-shaped PR; that path is proven by tests, not by this specific sample window.

## Follow-ups

S03 should package the now-proven audit into the final operator surface, document Azure/DB prerequisites clearly, and add final milestone-level output/reporting. If a future recent sample exposes a real publish-failure-shaped PR, S03 should ensure the final verifier/report highlights that control case explicitly.

## Files Created/Modified

- `src/review-audit/log-analytics.ts` — Added a reusable Azure Log Analytics adapter for workspace discovery, bounded query construction, and normalized review-audit log rows.
- `src/review-audit/log-analytics.test.ts` — Added tests for query construction, workspace override/discovery, normalized row parsing, and malformed/empty results.
- `src/review-audit/evidence-correlation.ts` — Extended the audit classifier with Azure log evidence for automatic `Evidence bundle` outcomes and explicit mention `publishResolution` states.
- `src/review-audit/evidence-correlation.test.ts` — Expanded correlation tests to cover Azure evidence normalization and precedence over DB fallbacks.
- `scripts/verify-m044-s01.ts` — Upgraded the live verifier to discover Azure workspaces once, query log evidence per sampled artifact, expose `azureLogAccess`, and classify from Azure when available.
- `scripts/verify-m044-s01.test.ts` — Expanded verifier tests for Azure-backed classification and preflight behavior.
- `.gsd/KNOWLEDGE.md` — Recorded the Azure evidence-bundle and explicit publish-resolution audit rules for future agents.
