# M025: Wiki Content Updates

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Embedding Migration** `risk:medium` `depends:[]`
  > After this: Create the contextualized embedding provider, parameterize wiki-store to accept embedding model name, and wire per-corpus model routing through the retrieval pipeline.
- [x] **S02: Page Popularity** `risk:medium` `depends:[S01]`
  > After this: Create the database schema, popularity store, config constants, and retrieval pipeline citation instrumentation for the wiki page popularity system.
- [x] **S03: Enhanced Staleness** `risk:medium` `depends:[S02]`
  > After this: Create the database schema for PR evidence storage, enhance heuristicScore with domain stopwords and section-heading weighting, and build the PR fetching and evidence persistence functions.
- [x] **S04: Update Generation** `risk:medium` `depends:[S03]`
  > After this: Create the type contracts, database migration, and task type registration for wiki update suggestion generation.
- [x] **S05: Publishing** `risk:medium` `depends:[S04]`
  > After this: Create the wiki publisher module that posts update suggestions as structured comments on a GitHub tracking issue.
