# M034: Claude Code Usage Visibility

**Vision:** Surface Claude Code usage context from the agent run itself so operators can see how much of their weekly limit they are using, alongside token usage, directly under the Review Details collapsible in the GitHub PR comment. Slack is a later surface, not this milestone.

## Success Criteria

- A review execution that receives a Claude Code rate-limit event produces a Review Details block that shows the current usage percentage and reset timing.
- The same Review Details block shows token usage and cost context without breaking the existing comment structure.
- If no rate-limit event is available (for example API-key auth rather than OAuth/subscription), the Review Details block omits the usage line cleanly.

## Key Risks / Unknowns

- `SDKRateLimitEvent` only appears on some auth paths and may not exist for API-key usage — the code must omit it cleanly instead of rendering broken text.
- The agent entrypoint currently only captures `result` messages from the SDK stream; adding rate-limit capture must not disturb the success/error write path.
- The usage event is a stream signal, not part of `SDKResultMessage`, so it has to be threaded through `result.json` and the host-side comment builder.
- The GitHub comment already uses a `<details>` block for Review Details; the new content has to stay inside that block and preserve current formatting.

## Proof Strategy

- `SDKRateLimitEvent` capture → retire in S01 by proving the agent entrypoint records the last seen usage event into `ExecutionResult` and writes it to `result.json`.
- Review Details rendering → retire in S02 by proving `formatReviewDetailsSummary()` and the review handler produce the usage line, token line, and graceful omission behavior in the posted comment body.

## Verification Classes

- Contract verification: unit tests for the agent entrypoint and Review Details formatter/handler.
- Integration verification: handler-level test that exercises the stitched result object through to the GitHub comment body.
- Operational verification: none beyond the existing review pipeline.
- UAT / human verification: none for this milestone.

## Milestone Definition of Done

This milestone is complete only when all are true:

- The agent entrypoint captures Claude Code rate-limit events without breaking existing result handling.
- The result payload carries usage-limit data through to the host process.
- The Review Details collapsible shows usage percentage, reset timing, token usage, and cost context.
- Missing usage data is handled by omission, not error.
- Tests pass for both the capture path and the comment-rendering path.

## Requirement Coverage

- Covers: R001, R002
- Partially covers: none
- Leaves for later: R003
- Orphan risks: none

## Slices

- [ ] **S01: Capture Claude Code usage events** `risk:high` `depends:[]`
  > After this: the agent run records Claude Code usage-limit data in `result.json`, and tests prove the last seen rate-limit event survives serialization.
- [ ] **S02: Render usage and tokens in Review Details** `risk:medium` `depends:[S01]`
  > After this: the GitHub PR comment shows usage percentage, reset timing, token usage, and cost inside the existing Review Details `<details>` block.

## Horizontal Checklist

- [ ] Every active R### re-read against new code — still fully satisfied?
- [ ] Every D### from prior milestones re-evaluated — still valid at new scope?
- [ ] Graceful shutdown / cleanup on termination verified
- [ ] Revenue / billing path impact assessed (or N/A)
- [ ] Auth boundary documented — what's protected vs public
- [ ] Shared resource budget confirmed — connection pools, caches, rate limits hold under peak
- [ ] Reconnection / retry strategy verified for every external dependency

## Boundary Map

### S01 → S02

Produces:
- `ExecutionResult.usageLimit` — structured Claude Code usage metadata (`utilization`, `rateLimitType`, `resetsAt`) written by the agent entrypoint and serialized into `result.json`
- `result.json` — host-readable execution payload with usage data available to the review handler

Consumes:
- nothing (first slice)
