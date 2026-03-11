# S05: Conversational Review

**Goal:** Add thread-aware context building and finding lookup for conversational review.
**Demo:** Add thread-aware context building and finding lookup for conversational review.

## Must-Haves


## Tasks

- [x] **T01: 46-conversational-review 01** `est:4min`
  - Add thread-aware context building and finding lookup for conversational review.

Purpose: When a user replies to a Kodiai review finding with @kodiai, the bot must detect the reply context, load the original finding metadata from the knowledge store, reconstruct the review comment thread history, and include all of this in the mention context so the LLM can provide a contextual follow-up response.

Output: inReplyToId on MentionEvent, getFindingByCommentId on KnowledgeStore, thread-aware buildMentionContext, finding-aware buildMentionPrompt. All with TDD coverage.
- [x] **T02: 46-conversational-review 02** `est:2min`
  - Add outgoing mention sanitization and conversation config schema for rate limiting and context budgets.

Purpose: Defense-in-depth against self-trigger loops (P0 risk from research) via outgoing mention sanitization, plus configuration schema for conversation rate limiting and context budgets that plan 03 will wire into the handler.

Output: sanitizeOutgoingMentions utility, mention.conversation config section with maxTurnsPerPr and contextBudgetChars. All with TDD coverage.
- [x] **T03: 46-conversational-review 03** `est:6min`
  - Wire conversational review into the mention handler with rate limiting, sanitization, context budget, and finding lookup integration.

Purpose: Complete the conversational review feature by connecting all the primitives from plans 01 and 02 into the live mention handler. After this plan, a user can reply to a kodiai review finding with @kodiai and receive a contextual, rate-limited, sanitized response.

Output: Fully operational conversational review in the mention handler.

## Files Likely Touched

- `src/handlers/mention-types.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/execution/mention-context.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention-types.test.ts`
- `src/knowledge/store.test.ts`
- `src/execution/mention-context.test.ts`
- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`
- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/mention.ts`
- `src/execution/mention-context.ts`
