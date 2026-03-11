# T02: 81-slack-write-mode-enablement 02

**Slice:** S01 — **Milestone:** M015

## Description

Implement the Slack write execution pipeline so clear write intents can safely produce repository changes, PR outputs, and mirrored comment links while preserving policy and permission guardrails.

Purpose: Phase 81's core outcome is enabling Slack-triggered write workflows (including PR creation and comment publication) without weakening existing deterministic write safety.
Output: Dedicated Slack write runner, runtime wiring, and tests proving policy/permission/refusal contracts plus PR/comment reporting.

## Must-Haves

- [ ] "Slack write-capable runs can edit files, run relevant build/test commands, and publish PR-only outputs without pushing default/protected branches directly"
- [ ] "Slack write runs enforce existing write-policy and permission gates with actionable refusal guidance"
- [ ] "Slack write runs can target any app-accessible owner/repo when explicitly specified"
- [ ] "When a write run posts a GitHub issue/PR comment, Slack mirrors the result in-thread with the GitHub link and comment content/excerpt"

## Files

- `src/slack/write-runner.ts`
- `src/slack/write-runner.test.ts`
- `src/slack/assistant-handler.ts`
- `src/slack/assistant-handler.test.ts`
- `src/index.ts`
- `src/execution/executor.ts`
- `src/execution/types.ts`
