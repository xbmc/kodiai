# S02: Rule Activation and Prompt Injection

**Goal:** Turn rule proposals into active prompt behavior through activation logic and bounded prompt injection.
**Demo:** After this: After this slice, high-confidence proposals can auto-activate and appear as sanitized active rules in the review prompt.

## Tasks
- [x] **T01: Added applyActivationPolicy and shouldAutoActivate — pending rules with signalScore ≥ threshold auto-activate with fail-open error handling and structured per-decision logging** — - Implement activation logic for pending rules based on configurable positive-signal thresholds.
- Keep activation policy explicit and testable.
- Add store tests for pending -> active transitions.
  - Estimate: 0.5-1d
  - Files: src/knowledge/generated-rule-activation.ts, src/knowledge/generated-rule-activation.test.ts, src/knowledge/generated-rule-store.ts
  - Verify: bun test ./src/knowledge/generated-rule-activation.test.ts && bun run tsc --noEmit
- [ ] **T02: Inject sanitized active rules into the review prompt** — - Add sanitization and bounded retrieval of active rules for prompt injection.
- Integrate active-rule lookup into the review prompt path without bypassing existing custom-instructions behavior.
- Add formatter/prompt tests for bounded rule injection.
  - Estimate: 1d
  - Files: src/knowledge/active-rules.ts, src/knowledge/active-rules.test.ts, src/execution/review-prompt.ts, src/execution/review-prompt.test.ts, src/handlers/review.ts
  - Verify: bun test ./src/execution/review-prompt.test.ts
- [ ] **T03: Add activation and prompt-injection verifier** — - Add a verifier showing a high-confidence proposal becomes active and appears in the next review prompt.
- Keep proof output machine-checkable and bounded.
- Cover fail-open behavior when rule lookup fails.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m036-s02.ts, scripts/verify-m036-s02.test.ts, src/knowledge/generated-rule-activation.ts, src/knowledge/active-rules.ts
  - Verify: bun test ./scripts/verify-m036-s02.test.ts && bun run verify:m036:s02 -- --json
