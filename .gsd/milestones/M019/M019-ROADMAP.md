# M019: Intelligent Retrieval Enhancements

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Language Aware Retrieval Boosting** `risk:medium` `depends:[]`
  > After this: Add language column to learning_memories, expand the language classification taxonomy to 30+ languages, add context-aware classification for ambiguous extensions, and populate the language column on new memory writes.
- [x] **S02: Depends Pr Deep Review** `risk:medium` `depends:[S01]`
  > After this: Create the `[depends]` PR title detection module with comprehensive test coverage.
- [x] **S03: Ci Failure Recognition** `risk:medium` `depends:[S02]`
  > After this: Create the CI check history database table, flakiness store module, and pure classification logic for comparing PR check failures against base-branch results.
- [x] **S04: Code Snippet Embedding** `risk:medium` `depends:[S03]`
  > After this: Create the foundation types, database schema, and config extension for code snippet embedding.
