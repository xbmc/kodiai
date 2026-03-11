# M009: Smart Dependencies & Resilience

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Timeout Resilience** `risk:medium` `depends:[]`
  > After this: Create the timeout estimation engine and wire dynamic timeouts into the executor.
- [x] **S02: Intelligent Retrieval** `risk:medium` `depends:[S01]`
  > After this: Build and test two pure functions: `buildRetrievalQuery()` for multi-signal query construction (RET-01) and `rerankByLanguage()` for post-retrieval language-aware re-ranking (RET-02).
- [x] **S03: Dependency Bump Detection** `risk:medium` `depends:[S02]`
  > After this: Implement the dependency bump detection pipeline as a pure-function module with three stages: detect (DEP-01), extract (DEP-02), and classify (DEP-03).
- [x] **S04: Security Advisory Changelog** `risk:medium` `depends:[S03]`
  > After this: Create the dep-bump-enrichment module with security advisory lookup, changelog fetching, package-to-repo resolution, and breaking change detection using TDD.
- [x] **S05: Merge Confidence Scoring** `risk:medium` `depends:[S04]`
  > After this: Create the `computeMergeConfidence` pure function that maps dependency bump signal combinations (semver classification, advisory status, breaking change detection) to a categorical confidence level (high/medium/low) with rationale strings.
