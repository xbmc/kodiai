---
id: T02
parent: S02
milestone: M044
key_files:
  - src/review-audit/log-analytics.ts
  - src/review-audit/log-analytics.test.ts
  - src/review-audit/evidence-correlation.ts
  - src/review-audit/evidence-correlation.test.ts
  - scripts/verify-m044-s01.ts
  - scripts/verify-m044-s01.test.ts
  - .gsd/KNOWLEDGE.md
key_decisions:
  - Use Azure `Evidence bundle` outcomes as the first internal classification source for automatic reviews when they are present, ahead of DB fallbacks.
  - Use `Mention execution completed` `publishResolution` as the explicit review classifier source instead of waiting for a new persistence layer.
duration: 
verification_result: mixed
completed_at: 2026-04-09T08:22:02.511Z
blocker_discovered: false
---

# T02: Used Azure publication signals to classify automatic and explicit review outcomes in the audit.

**Used Azure publication signals to classify automatic and explicit review outcomes in the audit.**

## What Happened

Implemented the actual S02 repair by wiring Azure publication signals into the audit path. I added a log-analytics adapter that discovers rg-kodiai workspaces, runs bounded `ContainerAppConsoleLogs_CL` queries, and normalizes JSON log rows. On top of that I extended the evidence correlator to interpret automatic `Evidence bundle` outcomes (`submitted-approval`, `published-output`) and explicit mention `publishResolution` values from Azure logs. Finally, I updated `scripts/verify-m044-s01.ts` so it discovers Azure workspaces once per run, loads log-backed evidence per sampled artifact, exposes `azureLogAccess` in preflight, and prefers Azure classification signals before DB fallbacks.

## Verification

`bun test ./src/review-audit/log-analytics.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts` passed with 19 passing tests and 0 failures, covering workspace discovery, log normalization, Azure evidence interpretation, and verifier wiring.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun test ./src/review-audit/log-analytics.test.ts ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts -> 19 pass, 0 fail` | -1 | unknown (coerced from string) | 0ms |

## Deviations

None.

## Known Issues

The verifier still reports `databaseAccess=unavailable` in this environment, but Azure evidence now resolves recent automatic and explicit cases beyond `indeterminate`.

## Files Created/Modified

- `src/review-audit/log-analytics.ts`
- `src/review-audit/log-analytics.test.ts`
- `src/review-audit/evidence-correlation.ts`
- `src/review-audit/evidence-correlation.test.ts`
- `scripts/verify-m044-s01.ts`
- `scripts/verify-m044-s01.test.ts`
- `.gsd/KNOWLEDGE.md`
