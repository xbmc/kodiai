# T02: 46-conversational-review 02

**Slice:** S05 — **Milestone:** M008

## Description

Add outgoing mention sanitization and conversation config schema for rate limiting and context budgets.

Purpose: Defense-in-depth against self-trigger loops (P0 risk from research) via outgoing mention sanitization, plus configuration schema for conversation rate limiting and context budgets that plan 03 will wire into the handler.

Output: sanitizeOutgoingMentions utility, mention.conversation config section with maxTurnsPerPr and contextBudgetChars. All with TDD coverage.

## Must-Haves

- [ ] "Outgoing bot replies have @kodiai and @claude mentions stripped to prevent self-trigger loops"
- [ ] "Config schema includes mention.conversation.maxTurnsPerPr with sensible default"
- [ ] "Config schema includes mention.conversation.contextBudgetChars with sensible default"
- [ ] "sanitizeOutgoingMentions handles case-insensitive replacement and multiple handles"

## Files

- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
