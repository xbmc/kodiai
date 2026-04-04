# S03: Retirement, Notification, and Lifecycle Proof

**Goal:** Complete the lifecycle with retirement, notifications, and machine-checkable proof for the durable rule loop.
**Demo:** After this: After this slice, generated rules can retire when their signal decays, operators can see activation/retirement events, and the verifier proves the lifecycle end to end.

## Tasks
- [x] **T01: Added generated-rule-retirement module with signal-floor and member-decay criteria, plus 35 passing tests** — - Implement retirement policy for active rules when recent negative signal or decay crosses the configured floor.
- Keep retirement state explicit and reversible only through future regeneration.
- Add tests for active -> retired transitions.
  - Estimate: 0.5-1d
  - Files: src/knowledge/generated-rule-retirement.ts, src/knowledge/generated-rule-retirement.test.ts, src/knowledge/generated-rule-store.ts
  - Verify: bun test ./src/knowledge/generated-rule-retirement.test.ts && bun run tsc --noEmit
- [x] **T02: Added generated-rule-notify module with fail-open activation/retirement notification and 25 passing tests** — - Add bounded activation/retirement notifications and logs for operator visibility.
- Reuse existing background-sweep patterns and keep notifications fail-open.
- Add tests or stubs proving notification does not block lifecycle transitions.
  - Estimate: 0.5-1d
  - Files: src/knowledge/generated-rule-notify.ts, src/knowledge/generated-rule-notify.test.ts, src/knowledge/generated-rule-sweep.ts
  - Verify: bun test ./src/knowledge/generated-rule-notify.test.ts
- [x] **T03: Added lifecycle verifier for M036 S03 with 3 proof checks (retirement, notify-lifecycle, notify-fail-open) and 21 passing tests** — - Add the milestone-level verifier for proposal, activation, retirement, and fail-open behavior.
- Keep proof output stable enough to close M036 without hand inspection.
- Cover notification failure as a non-blocking path.
  - Estimate: 0.5-1d
  - Files: scripts/verify-m036-s03.ts, scripts/verify-m036-s03.test.ts, src/knowledge/generated-rule-retirement.ts, src/knowledge/generated-rule-notify.ts
  - Verify: bun test ./scripts/verify-m036-s03.test.ts && bun run verify:m036:s03 -- --json
