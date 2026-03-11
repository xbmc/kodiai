# T01: 19-write-confirmation 01

**Slice:** S09 — **Milestone:** M002

## Description

Add an explicit plan-only mention mode so maintainers can ask "what would you change" before triggering write-mode.

## Must-Haves

- [ ] "Users can request a plan without performing writes"
- [ ] "Plan output is concise and uses explicit files/steps"
- [ ] "Existing apply/change write workflow is unchanged"

## Files

- `src/handlers/mention.ts`
- `src/execution/mention-prompt.ts`
- `docs/runbooks/mentions.md`
