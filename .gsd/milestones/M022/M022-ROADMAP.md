# M022: Issue Intelligence

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Historical Corpus Population** `risk:medium` `depends:[]`
  > After this: Build the issue backfill engine: migration for sync state tracking, comment chunker with issue context prefix, and the core backfill function that paginates GitHub Issues API, filters PRs, embeds issues, and persists sync state for resume.
- [x] **S02: Duplicate Detection Auto Triage** `risk:medium` `depends:[S01]`
  > After this: Create the duplicate detection foundation: DB migration for triage state tracking, config schema extension with new auto-triage fields, pure duplicate detection function, and triage comment formatter.
- [x] **S03: Pr Issue Linking** `risk:medium` `depends:[S02]`
  > After this: Create the two core modules for PR-issue linking: a pure regex-based reference parser and an orchestrator that resolves parsed references to issue records with semantic search fallback.
- [x] **S04: Issue Corpus Retrieval Integration** `risk:medium` `depends:[S03]`
  > After this: Wire the issue corpus into the unified cross-corpus retrieval pipeline so that PR reviews, @mention responses, and Slack queries can find and cite related issues via hybrid (vector + BM25) search.
