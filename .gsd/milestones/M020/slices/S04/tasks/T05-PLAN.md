# T05: 100-review-pattern-clustering 05

**Slice:** S04 — **Milestone:** M020

## Description

Wire cluster scheduler, pattern injection into reviews, and index.ts integration.

Purpose: Complete the end-to-end flow — clusters discovered on schedule, patterns surfaced in reviews, on-demand trigger available.
Output: Scheduler, review prompt injection, full application wiring.

## Must-Haves

- [ ] Weekly scheduled job runs cluster pipeline automatically
- [ ] On-demand triggering available via Slack command
- [ ] Pattern footnotes appear in PR review prompts as subtle inline annotations
- [ ] Max 3 pattern footnotes per review
- [ ] Patterns surface proactively even without reviewer flagging

## Files

- `src/knowledge/cluster-scheduler.ts`
- `src/execution/review-prompt.ts`
- `src/execution/review-prompt.test.ts`
- `src/index.ts`
