# T02: 98-contributor-profiles-identity-linking 02

**Slice:** S02 — **Milestone:** M020

## Description

Build the Slack slash command endpoint and handler for identity linking, unlinking, profile viewing, and opt-out -- the user-facing interaction surface for contributor profiles.

Purpose: This is the single entry point for cross-platform identity linking (Slack is the entry point, per user decision).
Output: Hono route for slash commands, handler with subcommand dispatch, tests.

## Must-Haves

- [ ] "Slack slash command /kodiai link <github-username> creates a cross-platform identity link"
- [ ] "Slack slash command /kodiai unlink removes the Slack link but keeps expertise data"
- [ ] "Slack slash command /kodiai profile shows linked identities, expertise scores, and tier"
- [ ] "Slack slash command /kodiai profile opt-out stops data collection for the contributor"
- [ ] "All slash commands respond within 3 seconds with immediate acknowledgment"

## Files

- `src/slack/slash-command-handler.ts`
- `src/slack/slash-command-handler.test.ts`
- `src/routes/slack-commands.ts`
- `src/routes/slack-commands.test.ts`
