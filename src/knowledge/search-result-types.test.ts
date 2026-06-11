import type {
  IssueCommentSearchResult,
  IssueSearchResult,
  ReviewCommentSearchResult,
  WikiPageSearchResult,
} from "./search-result-types.ts";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

type _WikiSearchEmbeddingIsNull = Expect<Equal<WikiPageSearchResult["record"]["embedding"], null>>;
type _IssueSearchEmbeddingIsNull = Expect<Equal<IssueSearchResult["record"]["embedding"], null>>;
type _IssueCommentSearchEmbeddingIsNull = Expect<Equal<IssueCommentSearchResult["record"]["embedding"], null>>;
type _ReviewCommentSearchEmbeddingIsNull = Expect<Equal<ReviewCommentSearchResult["record"]["embedding"], null>>;
