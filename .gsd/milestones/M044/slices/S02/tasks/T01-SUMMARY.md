---
id: T01
parent: S02
milestone: M044
key_files:
  - src/review-audit/log-analytics.ts
  - src/review-audit/log-analytics.test.ts
key_decisions:
  - Use the Azure CLI Log Analytics extension as the adapter boundary instead of adding a new SDK dependency; S02 only needs bounded workspace discovery and query execution.
  - Treat the first workspace as primary and union the rest through `--workspaces`, matching the current CLI contract and allowing the audit to search all discovered rg-kodiai workspaces in one query.
duration: 
verification_result: mixed
completed_at: 2026-04-09T08:05:18.170Z
blocker_discovered: false
---

# T01: Added a tested Azure Log Analytics adapter for review-audit evidence queries.

**Added a tested Azure Log Analytics adapter for review-audit evidence queries.**

## What Happened

Implemented the Azure Log Analytics adapter needed for S02. The new `src/review-audit/log-analytics.ts` builds bounded `ContainerAppConsoleLogs_CL` queries, discovers workspace customer IDs from `rg-kodiai` unless explicit IDs are provided, executes `az monitor log-analytics query`, and normalizes returned rows into typed audit records with parsed JSON payloads, extracted `deliveryId`, `reviewOutputKey`, and malformed-row flags. I wrote the adapter tests first, then implemented only the discovery/query/normalization surface needed for the audit so later classifier code can stay focused on review semantics rather than shelling details.

## Verification

`bun test ./src/review-audit/log-analytics.test.ts` passed with 5 passing tests and 0 failures, covering query construction, explicit workspace override, row normalization, malformed log handling, and query argument wiring across multiple workspaces.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-audit/log-analytics.test.ts -> 5 pass, 0 fail` | -1 | unknown (coerced from string) | 0ms |

## Deviations

None.

## Known Issues

The adapter normalizes raw log rows and workspace discovery, but it does not yet interpret `Evidence bundle` or explicit mention publish-resolution semantics. That happens in T02.

## Files Created/Modified

- `src/review-audit/log-analytics.ts`
- `src/review-audit/log-analytics.test.ts`
