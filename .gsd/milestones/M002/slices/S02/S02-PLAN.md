# S02: Fork Pr Robustness

**Goal:** Make fork PR reviews robust by cloning the base repo and fetching PR head refs, rather than cloning the fork directly.
**Demo:** Make fork PR reviews robust by cloning the base repo and fetching PR head refs, rather than cloning the fork directly.

## Must-Haves


## Tasks

- [x] **T01: 12-fork-pr-robustness 01** `est:3 min`
  - Make fork PR reviews robust by cloning the base repo and fetching PR head refs, rather than cloning the fork directly.

Purpose: Ensure xbmc/xbmc external contributor PRs are reliably reviewable under GitHub App token constraints.
Output: Updated review workspace strategy + tests.
- [x] **T02: 12-fork-pr-robustness 02** `est:5 min`
  - Ensure mention flows that need workspace/diff context work reliably for fork PRs by using base-clone + refs/pull fetch strategy.

Purpose: Avoid fork access assumptions and keep contextual mention answers available in xbmc/xbmc.
Output: Mention flow workspace robustness.
- [x] **T03: 12-fork-pr-robustness 03** `est:6 min`
  - Add scale guardrails so xbmc-sized PRs and long comment threads remain reliable: paginate list APIs, cap context size, and degrade gracefully.

Purpose: Prevent timeouts and noisy failures in production.
Output: Bounded context, pagination, and a scale runbook.

## Files Likely Touched

- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/jobs/workspace.ts`
- `src/handlers/mention.ts`
- `src/execution/mention-context.ts`
- `src/jobs/workspace.ts`
- `src/execution/mention-context.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `docs/runbooks/scale.md`
