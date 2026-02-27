---
phase: 105-triage-agent-wiring
plan: 03
status: complete
---

# Plan 105-03 Summary: Triage Agent Wiring

## What was built
- Extended triage config schema with `labelAllowlist` (string[]) and `cooldownMinutes` (number, default 30)
- Wired `enableIssueTools` and `triageConfig` into executor's `buildMcpServers()` for issue mentions with triage enabled
- Integrated triage validation into mention handler: validates issue body, generates guidance context and label recommendation
- Added per-issue cooldown with body-hash reset to prevent triage spam
- Added `triageContext` parameter to `buildMentionPrompt()` with issue template compliance instructions
- Added `issueBody` field to `MentionEvent` interface for triage validation

## Key files
- `src/execution/config.ts` — triageSchema extended with labelAllowlist, cooldownMinutes
- `src/execution/executor.ts` — issue tool wiring when triage.enabled + issue mention
- `src/execution/mention-prompt.ts` — triageContext injection in prompt
- `src/handlers/mention.ts` — triage validation + cooldown logic
- `src/handlers/mention-types.ts` — issueBody field added to MentionEvent

## Test results
- 79/79 config tests pass
- 57/57 mention tests pass
- 102/102 MCP tests pass
- 41/41 triage tests pass

## Decisions
- Triage context injected as prompt context (not post-execution append) per CONTEXT.md: "the triage nudge should be a single sentence appended to whatever the bot's primary response is"
- Cooldown uses SHA-256 hash of issue body (first 16 chars) for edit detection
- Fail-open: triage errors logged but don't block primary mention response
