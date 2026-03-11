# M012: Operator Reliability & Retrieval Quality

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Search Cache Foundation** `risk:medium` `depends:[]`
  > After this: Create a deterministic, repository-scoped Search API cache primitive that supports bounded TTL and concurrent request de-duplication.
- [x] **S02: Rate Limit Resilience Telemetry** `risk:medium` `depends:[S01]`
  > After this: Add Search API rate-limit resilience so review enrichment performs a single bounded retry, then fails open into a clearly communicated partial-analysis path.
- [x] **S03: Multi Query Retrieval Core** `risk:medium` `depends:[S02]`
  > After this: Build the RET-07 algorithmic core with TDD: deterministic multi-query expansion plus deterministic merged ranking behavior.
- [x] **S04: Snippet Anchors Prompt Budgeting** `risk:medium` `depends:[S03]`
  > After this: Build the RET-08 utility core with TDD: snippet-anchor extraction plus deterministic budget trimming.
- [x] **S05: Cross Surface Conversational Ux** `risk:medium` `depends:[S04]`
  > After this: Unify conversational response behavior across issue, PR, and review-thread mention surfaces.
- [x] **S06: Search Cache Telemetry Wiring Fix** `risk:medium` `depends:[S05]`
  > After this: Close OPS-03 blocker gaps by rewiring cache-hit telemetry to the actual Search API cache behavior from author-tier enrichment.
