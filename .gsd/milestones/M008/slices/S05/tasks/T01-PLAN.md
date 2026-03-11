# T01: 46-conversational-review 01

**Slice:** S05 — **Milestone:** M008

## Description

Add thread-aware context building and finding lookup for conversational review.

Purpose: When a user replies to a Kodiai review finding with @kodiai, the bot must detect the reply context, load the original finding metadata from the knowledge store, reconstruct the review comment thread history, and include all of this in the mention context so the LLM can provide a contextual follow-up response.

Output: inReplyToId on MentionEvent, getFindingByCommentId on KnowledgeStore, thread-aware buildMentionContext, finding-aware buildMentionPrompt. All with TDD coverage.

## Must-Haves

- [ ] "MentionEvent carries inReplyToId when a review comment is a reply"
- [ ] "KnowledgeStore can look up a finding by repo + comment_id and return severity, category, filePath, startLine, title"
- [ ] "buildMentionContext includes review comment thread history when inReplyToId is present"
- [ ] "buildMentionContext includes finding metadata when parent comment is a kodiai finding"
- [ ] "buildMentionPrompt includes finding-specific preamble when finding context is available"

## Files

- `src/handlers/mention-types.ts`
- `src/knowledge/types.ts`
- `src/knowledge/store.ts`
- `src/execution/mention-context.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention-types.test.ts`
- `src/knowledge/store.test.ts`
- `src/execution/mention-context.test.ts`
