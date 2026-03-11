# M005: Advanced Learning & Language Support

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: State Memory And Isolation Foundation** `risk:medium` `depends:[]`
  > After this: Add durable SHA-keyed run state to the knowledge store and integrate it into the review handler for idempotent webhook processing.
- [x] **S02: Incremental Re Review With Retrieval Context** `risk:medium` `depends:[S01]`
  > After this: Add config schema extensions and KnowledgeStore query methods for incremental re-review.
- [x] **S03: Multi Language Context And Localized Output** `risk:medium` `depends:[S02]`
  > After this: Add programming language classification to diff analysis and outputLanguage to the config schema.
- [x] **S04: Explainable Learning And Delta Reporting** `risk:medium` `depends:[S03]`
  > After this: Create a delta classification module that compares current review findings against prior review findings using filePath:titleFingerprint composite keys to label each finding as `new`, `still-open`, or `resolved`.
