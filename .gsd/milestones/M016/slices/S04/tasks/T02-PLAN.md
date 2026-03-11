# T02: 85-code-review-fixes-memory-leaks-hardcoded-defaults-type-mismatches-and-missing-rate-limits 02

**Slice:** S04 — **Milestone:** M016

## Description

Fix critical hardcoded default repo, replace console.warn with structured logging, eliminate unsafe `any` casts, optimize telemetry purge queries, add Slack client timeout, and add basic Slack event rate limiting. Addresses C-1, H-4, H-5, H-8, H-10, M-2.

Purpose: Eliminate production bugs (wrong repo), improve observability (structured logs), strengthen type safety, and add operational guardrails.
Output: 6 files fixed with targeted surgical changes.

## Must-Haves

- [ ] "Slack repo context default is loaded from config, not hardcoded"
- [ ] "Tooling detection uses structured logger instead of console.warn"
- [ ] "Dep-bump-enrichment has typed Octokit calls instead of any casts"
- [ ] "Telemetry purge uses DELETE with COUNT instead of RETURNING"
- [ ] "Slack client has configurable request timeout"
- [ ] "Slack event processing has basic rate limiting"

## Files

- `src/slack/repo-context.ts`
- `src/slack/repo-context.test.ts`
- `src/config.ts`
- `src/enforcement/tooling-detection.ts`
- `src/enforcement/index.ts`
- `src/lib/dep-bump-enrichment.ts`
- `src/telemetry/store.ts`
- `src/slack/client.ts`
- `src/routes/slack-events.ts`
