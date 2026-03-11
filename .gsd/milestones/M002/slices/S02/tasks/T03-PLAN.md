# T03: 12-fork-pr-robustness 03

**Slice:** S02 — **Milestone:** M002

## Description

Add scale guardrails so xbmc-sized PRs and long comment threads remain reliable: paginate list APIs, cap context size, and degrade gracefully.

Purpose: Prevent timeouts and noisy failures in production.
Output: Bounded context, pagination, and a scale runbook.

## Must-Haves

- [ ] "Large PRs and long threads do not cause unbounded prompt growth"
- [ ] "When caps are hit, output degrades gracefully with an explicit note"
- [ ] "Pagination is used where GitHub APIs are paginated"

## Files

- `src/execution/mention-context.ts`
- `src/execution/review-prompt.ts`
- `src/handlers/review.ts`
- `docs/runbooks/scale.md`
