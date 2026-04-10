---
estimated_steps: 1
estimated_files: 4
skills_used: []
---

# T02: Use Azure publication signals to classify automatic and explicit review outcomes

Wire the normalized Azure evidence into the existing review-audit classifier. Teach the audit to resolve automatic-lane `Evidence bundle` outcomes (`published-output`, `submitted-approval`) and explicit mention publish resolutions from logs, while preserving fail-open behavior when a log record is absent, capped, or contradictory. Add regression tests for clean-valid, findings-published, publish-failure, duplicate-safe recovery, and true indeterminate outcomes.

## Inputs

- `src/review-audit/log-analytics.ts`
- `src/review-audit/evidence-correlation.ts`
- `scripts/verify-m044-s01.ts`
- `docs/runbooks/review-requested-debug.md`

## Expected Output

- `src/review-audit/evidence-correlation.ts`
- `src/review-audit/evidence-correlation.test.ts`
- `scripts/verify-m044-s01.ts`
- `scripts/verify-m044-s01.test.ts`

## Verification

bun test ./src/review-audit/evidence-correlation.test.ts ./scripts/verify-m044-s01.test.ts

## Observability Impact

The verifier will now disclose which verdicts came from Azure publication evidence and which remain indeterminate due to missing logs or DB state.
