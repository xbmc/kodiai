# S02: Audit-Driven Publication/Correctness Repair

**Goal:** Retire the first real gap exposed by S01 by wiring Azure log-backed publication evidence into the audit path, so recent xbmc/xbmc reviews can classify beyond `indeterminate` when DB access is unavailable and explicit mention publish truth is currently log-only.
**Demo:** Rerun the audit after the first real defect or evidence gap is fixed and watch previously ambiguous or wrong cases resolve into truthful outcomes without turning valid clean approvals into false failures.

## Must-Haves

- Azure Log Analytics can be queried from code for the active Kodiai environment(s) and normalized into review-audit evidence keyed by `reviewOutputKey` and delivery identity.
- The audit distinguishes at least the known automatic-lane outcomes (`submitted-approval`, `published-output`) and explicit-lane publish resolutions (`approval-bridge`, `idempotency-skip`, `duplicate-suppressed`, `publish-failure-fallback`, `publish-failure-comment-failed`).
- A live rerun over the recent xbmc/xbmc sample produces at least one non-`indeterminate` verdict from real internal evidence in the current environment.
- The verifier still fails open and preserves `indeterminate` when Azure evidence is genuinely missing or contradictory instead of crashing or overclaiming.

## Proof Level

- This slice proves: Operational proof against live Azure log evidence plus deterministic tests for workspace discovery, log normalization, and lane-specific classification.

## Integration Closure

This slice closes the current evidence blind spot by pulling Azure `ContainerAppConsoleLogs_CL` publication signals into the audit engine and the existing `verify:m044:s01` surface. After S02, the audit should be able to distinguish clean approvals, published findings, and explicit publish failures from the live recent sample using real internal evidence in the current environment.

## Verification

- Adds a reusable log-analytics resolver, normalized publication evidence envelopes for both automatic and explicit lanes, and verifier output that exposes which classifications came from Azure log evidence versus DB or GitHub surface alone.

## Tasks

- [x] **T01: Build the Azure log-analytics evidence adapter for review audits** `est:1h15m`
  Add a focused Azure Log Analytics adapter for review auditing. Discover or accept the correct workspace/customer id, run bounded `ContainerAppConsoleLogs_CL` queries, and normalize JSON log rows into typed evidence records keyed by `deliveryId` and `reviewOutputKey`. Cover workspace selection, empty-result handling, malformed log rows, and stable query construction in unit tests.
  - Files: `src/review-audit/log-analytics.ts`, `src/review-audit/log-analytics.test.ts`
  - Verify: bun test ./src/review-audit/log-analytics.test.ts

- [x] **T02: Use Azure publication signals to classify automatic and explicit review outcomes** `est:1h30m`
  Wire the normalized Azure evidence into the existing review-audit classifier. Teach the audit to resolve automatic-lane `Evidence bundle` outcomes (`published-output`, `submitted-approval`) and explicit mention publish resolutions from logs, while preserving fail-open behavior when a log record is absent, capped, or contradictory. Add regression tests for clean-valid, findings-published, publish-failure, duplicate-safe recovery, and true indeterminate outcomes.
  - Files: `src/review-audit/evidence-correlation.ts`, `src/review-audit/evidence-correlation.test.ts`, `scripts/verify-m044-s01.ts`, `scripts/verify-m044-s01.test.ts`
  - Verify: bun test ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts

- [x] **T03: Rerun the live recent-sample audit with Azure evidence in the loop** `est:1h`
  Rerun the live recent-review audit against xbmc/xbmc after the Azure resolver is wired in. Capture the updated sample verdicts, confirm at least one case now resolves beyond `indeterminate`, and record any still-missing evidence precisely for S03 packaging. Do not create outward GitHub actions; use the existing recent sample and live internal evidence only.
  - Files: `scripts/verify-m044-s01.ts`
  - Verify: bun run verify:m044:s01 -- --repo xbmc/xbmc --limit 12 --json

## Files Likely Touched

- src/review-audit/log-analytics.ts
- src/review-audit/log-analytics.test.ts
- src/review-audit/evidence-correlation.ts
- src/review-audit/evidence-correlation.test.ts
- scripts/verify-m044-s01.ts
- scripts/verify-m044-s01.test.ts
