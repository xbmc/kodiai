# T03: 105-triage-agent-wiring 03

**Slice:** S03 — **Milestone:** M021

## Description

Wire triage validation into the @kodiai mention path for issues.

Purpose: Connect the template parser and triage agent to the existing mention handler, executor, and prompt builder so that when @kodiai is mentioned on an issue, the bot answers the question AND appends a triage nudge if template fields are missing.
Output: Modified config, executor, mention handler, and mention prompt files with integration tests.

## Must-Haves

- [ ] "Triage config schema includes labelAllowlist and cooldownMinutes fields"
- [ ] "Executor passes enableIssueTools and triageConfig to buildMcpServers when issue mention + triage.enabled"
- [ ] "Mention handler runs triage validation for issue_comment surface when triage.enabled"
- [ ] "Triage nudge appended as single sentence to mention prompt when fields are missing"
- [ ] "Per-issue cooldown prevents repeated triage nudges within cooldownMinutes"
- [ ] "Cooldown resets when issue body hash changes (edit detection)"
- [ ] "Label recommendation included in triage context for agent to apply via MCP tool"
- [ ] "No triage nudge when all template fields are present"
- [ ] "Generic nudge when issue doesn't match any template"
- [ ] "Label allowlist from .kodiai.yml triage config is respected"

## Files

- `src/execution/config.ts`
- `src/execution/executor.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
