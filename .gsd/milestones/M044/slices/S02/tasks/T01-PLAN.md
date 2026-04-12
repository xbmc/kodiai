---
estimated_steps: 1
estimated_files: 2
skills_used: []
---

# T01: Build the Azure log-analytics evidence adapter for review audits

Add a focused Azure Log Analytics adapter for review auditing. Discover or accept the correct workspace/customer id, run bounded `ContainerAppConsoleLogs_CL` queries, and normalize JSON log rows into typed evidence records keyed by `deliveryId` and `reviewOutputKey`. Cover workspace selection, empty-result handling, malformed log rows, and stable query construction in unit tests.

## Inputs

- `docs/runbooks/review-requested-debug.md`
- `docs/runbooks/mentions.md`
- `docs/deployment.md`

## Expected Output

- `src/review-audit/log-analytics.ts`
- `src/review-audit/log-analytics.test.ts`

## Verification

bun test ./src/review-audit/log-analytics.test.ts

## Observability Impact

Makes Azure log evidence an explicit, typed inspection surface for the audit instead of an operator-only manual query recipe.
