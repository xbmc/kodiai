import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  IssueInput,
  IssueRecord,
  IssueSearchResult,
  IssueCommentInput,
  IssueCommentRecord,
  IssueCommentSearchResult,
  IssueStore,
} from "./issue-types.ts";

/**
 * Convert a Float32Array to pgvector-compatible string format: [0.1,0.2,...]
 */
function float32ArrayToVectorString(arr: Float32Array): string {
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    parts[i] = String(arr[i]);
  }
  return `[${parts.join(",")}]`;
}

type IssueRow = {
  id: number;
  created_at: string;
  repo: string;
  owner: string;
  issue_number: number;
  title: string;
  body: string | null;
  state: string;
  author_login: string;
  author_association: string | null;
  label_names: string[];
  template_slug: string | null;
  comment_count: number;
  assignees: Array<{ id: number; login: string }> | string;
  milestone: string | null;
  reaction_count: number;
  is_pull_request: boolean;
  locked: boolean;
  embedding: unknown;
  embedding_model: string | null;
  github_created_at: string;
  github_updated_at: string | null;
  closed_at: string | null;
};

type IssueCommentRow = {
  id: number;
  created_at: string;
  repo: string;
  issue_number: number;
  comment_github_id: string | number;
  author_login: string;
  author_association: string | null;
  body: string;
  embedding: unknown;
  embedding_model: string | null;
  github_created_at: string;
  github_updated_at: string | null;
};

function rowToRecord(row: IssueRow): IssueRecord {
  const assignees = typeof row.assignees === "string"
    ? JSON.parse(row.assignees)
    : (row.assignees ?? []);

  return {
    id: row.id,
    createdAt: row.created_at,
    repo: row.repo,
    owner: row.owner,
    issueNumber: row.issue_number,
    title: row.title,
    body: row.body,
    state: row.state,
    authorLogin: row.author_login,
    authorAssociation: row.author_association,
    labelNames: row.label_names ?? [],
    templateSlug: row.template_slug,
    commentCount: row.comment_count,
    assignees,
    milestone: row.milestone,
    reactionCount: row.reaction_count,
    isPullRequest: row.is_pull_request,
    locked: row.locked,
    embedding: row.embedding,
    embeddingModel: row.embedding_model,
    githubCreatedAt: row.github_created_at,
    githubUpdatedAt: row.github_updated_at,
    closedAt: row.closed_at,
  };
}

function commentRowToRecord(row: IssueCommentRow): IssueCommentRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    repo: row.repo,
    issueNumber: row.issue_number,
    commentGithubId: Number(row.comment_github_id),
    authorLogin: row.author_login,
    authorAssociation: row.author_association,
    body: row.body,
    embedding: row.embedding,
    embeddingModel: row.embedding_model,
    githubCreatedAt: row.github_created_at,
    githubUpdatedAt: row.github_updated_at,
  };
}

/**
 * Create an issue store backed by PostgreSQL with pgvector.
 * Follows the same factory pattern as createReviewCommentStore.
 */
export function createIssueStore(opts: {
  sql: Sql;
  logger: Logger;
}): IssueStore {
  const { sql, logger } = opts;

  const store: IssueStore = {
    async upsert(issue: IssueInput): Promise<void> {
      const embeddingValue = issue.embedding
        ? float32ArrayToVectorString(issue.embedding)
        : null;
      const embeddingModel = issue.embedding ? "voyage-code-3" : null;

      await sql`
        INSERT INTO issues (
          repo, owner, issue_number, title, body,
          state, author_login, author_association,
          label_names, template_slug, comment_count,
          assignees, milestone, reaction_count,
          is_pull_request, locked,
          embedding, embedding_model,
          github_created_at, github_updated_at, closed_at
        ) VALUES (
          ${issue.repo}, ${issue.owner}, ${issue.issueNumber}, ${issue.title}, ${issue.body},
          ${issue.state}, ${issue.authorLogin}, ${issue.authorAssociation ?? null},
          ${issue.labelNames}, ${issue.templateSlug ?? null}, ${issue.commentCount},
          ${JSON.stringify(issue.assignees)}, ${issue.milestone ?? null}, ${issue.reactionCount},
          ${issue.isPullRequest}, ${issue.locked},
          ${embeddingValue}::vector, ${embeddingModel},
          ${issue.githubCreatedAt}, ${issue.githubUpdatedAt ?? null}, ${issue.closedAt ?? null}
        )
        ON CONFLICT (repo, issue_number) DO UPDATE SET
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          state = EXCLUDED.state,
          author_association = EXCLUDED.author_association,
          label_names = EXCLUDED.label_names,
          template_slug = EXCLUDED.template_slug,
          comment_count = EXCLUDED.comment_count,
          assignees = EXCLUDED.assignees,
          milestone = EXCLUDED.milestone,
          reaction_count = EXCLUDED.reaction_count,
          is_pull_request = EXCLUDED.is_pull_request,
          locked = EXCLUDED.locked,
          embedding = EXCLUDED.embedding,
          embedding_model = EXCLUDED.embedding_model,
          github_updated_at = EXCLUDED.github_updated_at,
          closed_at = EXCLUDED.closed_at
      `;
    },

    async delete(repo: string, issueNumber: number): Promise<void> {
      // Delete comments first
      await sql`
        DELETE FROM issue_comments
        WHERE repo = ${repo} AND issue_number = ${issueNumber}
      `;
      await sql`
        DELETE FROM issues
        WHERE repo = ${repo} AND issue_number = ${issueNumber}
      `;
    },

    async getByNumber(repo: string, issueNumber: number): Promise<IssueRecord | null> {
      const rows = await sql`
        SELECT * FROM issues
        WHERE repo = ${repo} AND issue_number = ${issueNumber}
      `;
      if (rows.length === 0) return null;
      return rowToRecord(rows[0] as unknown as IssueRow);
    },

    async searchByEmbedding(params: {
      queryEmbedding: Float32Array;
      repo: string;
      topK: number;
    }): Promise<IssueSearchResult[]> {
      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);

      const rows = await sql`
        SELECT *,
          embedding <=> ${queryEmbeddingString}::vector AS distance
        FROM issues
        WHERE repo = ${params.repo}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${queryEmbeddingString}::vector
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        record: rowToRecord(row as unknown as IssueRow),
        distance: Number((row as Record<string, unknown>).distance),
      }));
    },

    async searchByFullText(params: {
      query: string;
      repo: string;
      topK: number;
    }): Promise<IssueSearchResult[]> {
      if (!params.query.trim()) return [];

      const rows = await sql`
        SELECT *,
          ts_rank(search_tsv, plainto_tsquery('english', ${params.query})) AS rank
        FROM issues
        WHERE repo = ${params.repo}
          AND search_tsv @@ plainto_tsquery('english', ${params.query})
        ORDER BY rank DESC
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        record: rowToRecord(row as unknown as IssueRow),
        distance: 1 - Number((row as Record<string, unknown>).rank),
      }));
    },

    async findSimilar(
      repo: string,
      issueNumber: number,
      threshold: number = 0.7,
    ): Promise<IssueSearchResult[]> {
      // Get the source issue's embedding
      const sourceRows = await sql`
        SELECT embedding FROM issues
        WHERE repo = ${repo} AND issue_number = ${issueNumber} AND embedding IS NOT NULL
      `;

      if (sourceRows.length === 0) return [];

      const sourceEmbedding = sourceRows[0]!.embedding as string;

      const rows = await sql`
        SELECT *,
          embedding <=> ${sourceEmbedding}::vector AS distance
        FROM issues
        WHERE repo = ${repo}
          AND issue_number != ${issueNumber}
          AND embedding IS NOT NULL
          AND embedding <=> ${sourceEmbedding}::vector <= ${threshold}
        ORDER BY embedding <=> ${sourceEmbedding}::vector
        LIMIT 10
      `;

      return rows.map((row) => ({
        record: rowToRecord(row as unknown as IssueRow),
        distance: Number((row as Record<string, unknown>).distance),
      }));
    },

    async countByRepo(repo: string): Promise<number> {
      const rows = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM issues
        WHERE repo = ${repo}
      `;
      return rows[0]!.cnt as number;
    },

    async upsertComment(comment: IssueCommentInput): Promise<void> {
      const embeddingValue = comment.embedding
        ? float32ArrayToVectorString(comment.embedding)
        : null;
      const embeddingModel = comment.embedding ? "voyage-code-3" : null;

      await sql`
        INSERT INTO issue_comments (
          repo, issue_number, comment_github_id,
          author_login, author_association, body,
          embedding, embedding_model,
          github_created_at, github_updated_at
        ) VALUES (
          ${comment.repo}, ${comment.issueNumber}, ${comment.commentGithubId},
          ${comment.authorLogin}, ${comment.authorAssociation ?? null}, ${comment.body},
          ${embeddingValue}::vector, ${embeddingModel},
          ${comment.githubCreatedAt}, ${comment.githubUpdatedAt ?? null}
        )
        ON CONFLICT (repo, comment_github_id) DO UPDATE SET
          body = EXCLUDED.body,
          embedding = EXCLUDED.embedding,
          embedding_model = EXCLUDED.embedding_model,
          github_updated_at = EXCLUDED.github_updated_at
      `;
    },

    async deleteComment(repo: string, commentGithubId: number): Promise<void> {
      await sql`
        DELETE FROM issue_comments
        WHERE repo = ${repo} AND comment_github_id = ${commentGithubId}
      `;
    },

    async getCommentsByIssue(repo: string, issueNumber: number): Promise<IssueCommentRecord[]> {
      const rows = await sql`
        SELECT * FROM issue_comments
        WHERE repo = ${repo} AND issue_number = ${issueNumber}
        ORDER BY github_created_at ASC
      `;
      return rows.map((row) => commentRowToRecord(row as unknown as IssueCommentRow));
    },

    async searchCommentsByEmbedding(params: {
      queryEmbedding: Float32Array;
      repo: string;
      topK: number;
    }): Promise<IssueCommentSearchResult[]> {
      const queryEmbeddingString = float32ArrayToVectorString(params.queryEmbedding);

      const rows = await sql`
        SELECT *,
          embedding <=> ${queryEmbeddingString}::vector AS distance
        FROM issue_comments
        WHERE repo = ${params.repo}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${queryEmbeddingString}::vector
        LIMIT ${params.topK}
      `;

      return rows.map((row) => ({
        record: commentRowToRecord(row as unknown as IssueCommentRow),
        distance: Number((row as Record<string, unknown>).distance),
      }));
    },
  };

  logger.debug("IssueStore initialized with pgvector HNSW index");
  return store;
}
