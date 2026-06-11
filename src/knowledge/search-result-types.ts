/**
 * Consolidated search-result types across knowledge corpora.
 *
 * Each corpus defines its own `*SearchResult` shape next to its record type.
 * This barrel re-exports them under one import so cross-corpus call sites
 * (retrieval, RRF merging) can reference the search-result surface without
 * reaching into each corpus module. The `record.embedding` field is `null`
 * on every search result: embeddings are never hydrated into search results
 * (see search-result-types.test.ts for the compile-time guarantee).
 */

export type { IssueSearchResult, IssueCommentSearchResult } from "./issue-types.ts";
export type { ReviewCommentSearchResult } from "./review-comment-types.ts";
export type { WikiPageSearchResult } from "./wiki-types.ts";
