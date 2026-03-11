# M016: Review Coverage & Slack UX

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Draft Pr Review Coverage** `risk:medium` `depends:[]`
  > After this: unit tests prove draft-pr-review-coverage works
- [x] **S02: Slack Response Conciseness** `risk:medium` `depends:[S01]`
  > After this: Rewrite the Slack assistant system prompt so responses read like chat messages from a senior engineer teammate: answer-first, concise, no AI-isms, no trailing sections, casual tone.
- [x] **S03: Azure Deployment Health Verify Embeddings Voyageai Work On Deploy And Fix Container Log Errors** `risk:medium` `depends:[S02]`
  > After this: Add an embeddings startup smoke test and fix deploy.
- [x] **S04: Code Review Fixes Memory Leaks Hardcoded Defaults Type Mismatches And Missing Rate Limits** `risk:medium` `depends:[S03]`
  > After this: Create a shared InMemoryCache utility with configurable TTL and maxSize, then migrate all unbounded in-memory stores to use it.
