/**
 * Type definitions for GitHub issue corpus storage, search, and retrieval.
 */

/** Input for upserting an issue into the corpus. */
export type IssueInput = {
  repo: string;
  owner: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  authorLogin: string;
  authorAssociation: string | null;
  labelNames: string[];
  templateSlug: string | null;
  commentCount: number;
  assignees: Array<{ id: number; login: string }>;
  milestone: string | null;
  reactionCount: number;
  isPullRequest: boolean;
  locked: boolean;
  githubCreatedAt: Date;
  githubUpdatedAt: Date | null;
  closedAt: Date | null;
  embedding?: Float32Array | null;
};

/** Full database row type with all columns. */
export type IssueRecord = {
  id: number;
  createdAt: string;
  repo: string;
  owner: string;
  issueNumber: number;
  title: string;
  body: string | null;
  state: string;
  authorLogin: string;
  authorAssociation: string | null;
  labelNames: string[];
  templateSlug: string | null;
  commentCount: number;
  assignees: Array<{ id: number; login: string }>;
  milestone: string | null;
  reactionCount: number;
  isPullRequest: boolean;
  locked: boolean;
  embedding: unknown;
  embeddingModel: string | null;
  githubCreatedAt: string;
  githubUpdatedAt: string | null;
  closedAt: string | null;
};

/** Search result with cosine distance score. */
export type IssueSearchResult = {
  record: IssueRecord;
  distance: number;
};

/** Input for upserting an issue comment. */
export type IssueCommentInput = {
  repo: string;
  issueNumber: number;
  commentGithubId: number;
  authorLogin: string;
  authorAssociation: string | null;
  body: string;
  githubCreatedAt: Date;
  githubUpdatedAt: Date | null;
  embedding?: Float32Array | null;
};

/** Full issue comment database row. */
export type IssueCommentRecord = {
  id: number;
  createdAt: string;
  repo: string;
  issueNumber: number;
  commentGithubId: number;
  authorLogin: string;
  authorAssociation: string | null;
  body: string;
  embedding: unknown;
  embeddingModel: string | null;
  githubCreatedAt: string;
  githubUpdatedAt: string | null;
};

/** Comment search result with cosine distance. */
export type IssueCommentSearchResult = {
  record: IssueCommentRecord;
  distance: number;
};

/** Store interface for issue corpus CRUD and search operations. */
export type IssueStore = {
  /** Upsert an issue (ON CONFLICT UPDATE). */
  upsert(issue: IssueInput): Promise<void>;

  /** Delete an issue and its comments by repo + issue number. */
  delete(repo: string, issueNumber: number): Promise<void>;

  /** Get a single issue by repo + issue number. */
  getByNumber(repo: string, issueNumber: number): Promise<IssueRecord | null>;

  /** Vector similarity search scoped by repo. */
  searchByEmbedding(params: {
    queryEmbedding: Float32Array;
    repo: string;
    topK: number;
  }): Promise<IssueSearchResult[]>;

  /** Full-text search using tsvector GIN index. */
  searchByFullText(params: {
    query: string;
    repo: string;
    topK: number;
  }): Promise<IssueSearchResult[]>;

  /** Find issues similar to a given issue by its embedding. Excludes the source issue. */
  findSimilar(repo: string, issueNumber: number, threshold?: number): Promise<IssueSearchResult[]>;

  /** Count issues for a repo. */
  countByRepo(repo: string): Promise<number>;

  /** Upsert a single issue comment. */
  upsertComment(comment: IssueCommentInput): Promise<void>;

  /** Delete a comment by repo + GitHub comment ID. */
  deleteComment(repo: string, commentGithubId: number): Promise<void>;

  /** Get all comments for an issue, ordered by creation time. */
  getCommentsByIssue(repo: string, issueNumber: number): Promise<IssueCommentRecord[]>;

  /** Vector similarity search on issue comments. */
  searchCommentsByEmbedding(params: {
    queryEmbedding: Float32Array;
    repo: string;
    topK: number;
  }): Promise<IssueCommentSearchResult[]>;
};
