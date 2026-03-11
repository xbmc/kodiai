# T02: 12-fork-pr-robustness 02

**Slice:** S02 — **Milestone:** M002

## Description

Ensure mention flows that need workspace/diff context work reliably for fork PRs by using base-clone + refs/pull fetch strategy.

Purpose: Avoid fork access assumptions and keep contextual mention answers available in xbmc/xbmc.
Output: Mention flow workspace robustness.

## Must-Haves

- [ ] "Contextual mention replies work on fork PRs"
- [ ] "Mention workspace checkout uses the same PR-ref strategy as reviews when needed"

## Files

- `src/handlers/mention.ts`
- `src/execution/mention-context.ts`
- `src/jobs/workspace.ts`
