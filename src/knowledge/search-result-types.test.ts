import type { IssueCommentSearchResult, IssueSearchResult } from "./issue-types.ts";
import type { ReviewCommentSearchResult } from "./review-comment-types.ts";
import type { WikiPageSearchResult } from "./wiki-types.ts";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

// Exported so `noUnusedLocals` does not flag them: these declarations *are* the
// test -- they assert at compile time that each search result's `embedding` is
// null -- so they are unused by design rather than dead.
export type _WikiSearchEmbeddingIsNull = Expect<Equal<WikiPageSearchResult["record"]["embedding"], null>>;
export type _IssueSearchEmbeddingIsNull = Expect<Equal<IssueSearchResult["record"]["embedding"], null>>;
export type _IssueCommentSearchEmbeddingIsNull = Expect<Equal<IssueCommentSearchResult["record"]["embedding"], null>>;
export type _ReviewCommentSearchEmbeddingIsNull = Expect<Equal<ReviewCommentSearchResult["record"]["embedding"], null>>;
