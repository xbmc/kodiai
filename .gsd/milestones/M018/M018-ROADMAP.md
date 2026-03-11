# M018: Knowledge Ingestion

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Pr Review Comment Ingestion** `risk:medium` `depends:[]`
  > After this: Create the PostgreSQL schema, store module, and chunking logic for PR review comment ingestion.
- [x] **S02: Mediawiki Content Ingestion** `risk:medium` `depends:[S01]`
  > After this: Create the PostgreSQL schema, store module, and chunking logic for MediaWiki content ingestion.
- [x] **S03: Cross Corpus Retrieval Integration** `risk:medium` `depends:[S02]`
  > After this: Add hybrid search (vector + BM25 full-text) capability to each knowledge corpus store.
- [x] **S04: Wire Unified Retrieval Consumers** `risk:medium` `depends:[S03]`
  > After this: Wire the mention handler to forward unified cross-corpus retrieval results to the mention prompt builder, and update mention-prompt.
