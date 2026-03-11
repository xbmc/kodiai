# S03: Slack Read Only Assistant Routing

**Goal:** Build the core Slack assistant domain logic: deterministic repo-context resolution and a read-only handler that executes only when context is unambiguous.
**Demo:** Build the core Slack assistant domain logic: deterministic repo-context resolution and a read-only handler that executes only when context is unambiguous.

## Must-Haves


## Tasks

- [x] **T01: 79-slack-read-only-assistant-routing 01** `est:2 min`
  - Build the core Slack assistant domain logic: deterministic repo-context resolution and a read-only handler that executes only when context is unambiguous.

Purpose: This delivers the core SLK-04 and SLK-05 behavior before wiring so execution semantics are test-locked and reusable from route integration.
Output: Pure repo-context resolver + tests, assistant handler read-only execution flow + tests.
- [x] **T02: 79-slack-read-only-assistant-routing 02** `est:4 min`
  - Wire Slack ingress and runtime dependencies into the Phase 79 assistant core so allowed Slack thread traffic reaches the read-only assistant end-to-end.

Purpose: This completes SLK-04 and SLK-05 by connecting route/index/runtime plumbing to the already-tested assistant core without regressing Phase 77/78 safety semantics.
Output: Slack client + runtime config wiring, repo installation lookup support, route/index integration, and regressions proving allowed forwarding and fail-open acknowledgments.

## Files Likely Touched

- `src/slack/repo-context.ts`
- `src/slack/repo-context.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
- `src/config.ts`
- `src/auth/github-app.ts`
- `src/slack/client.ts`
- `src/slack/client.test.ts`
- `src/routes/slack-events.ts`
- `src/routes/slack-events.test.ts`
- `src/index.ts`
