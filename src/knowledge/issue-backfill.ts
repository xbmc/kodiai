import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { IssueStore } from "./issue-types.ts";
import type { EmbeddingProvider } from "./types.ts";
import {
  buildIssueEmbeddingText,
  buildCommentEmbeddingText,
  chunkIssueComment,
  isBotComment,
} from "./issue-comment-chunker.ts";

// ── Types ───────────────────────────────────────────────────────────────────

export type IssueSyncState = {
  repo: string;
  lastSyncedAt: Date | null;
  lastPageCursor: string | null;
  totalIssuesSynced: number;
  totalCommentsSynced: number;
  backfillComplete: boolean;
};

export type IssueBackfillOptions = {
  octokit: Octokit;
  store: IssueStore;
  sql: Sql;
  embeddingProvider: EmbeddingProvider;
  repo: string; // "owner/repo"
  dryRun?: boolean;
  logger: Logger;
};

export type IssueBackfillResult = {
  totalIssues: number;
  totalComments: number;
  totalEmbeddings: number;
  pagesProcessed: number;
  failedEmbeddings: number;
  durationMs: number;
  resumed: boolean;
};

export type CommentBackfillResult = {
  totalComments: number;
  totalChunks: number;
  failedEmbeddings: number;
};

// ── Sync state helpers ──────────────────────────────────────────────────────

export async function getIssueSyncState(
  sql: Sql,
  repo: string,
): Promise<IssueSyncState | null> {
  const rows = await sql`
    SELECT repo, last_synced_at, last_page_cursor,
           total_issues_synced, total_comments_synced, backfill_complete
    FROM issue_sync_state
    WHERE repo = ${repo}
  `;
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    repo: row.repo as string,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
    lastPageCursor: (row.last_page_cursor as string) ?? null,
    totalIssuesSynced: row.total_issues_synced as number,
    totalCommentsSynced: row.total_comments_synced as number,
    backfillComplete: row.backfill_complete as boolean,
  };
}

export async function updateIssueSyncState(
  sql: Sql,
  state: IssueSyncState,
): Promise<void> {
  await sql`
    INSERT INTO issue_sync_state (
      repo, last_synced_at, last_page_cursor,
      total_issues_synced, total_comments_synced, backfill_complete, updated_at
    ) VALUES (
      ${state.repo}, ${state.lastSyncedAt}, ${state.lastPageCursor},
      ${state.totalIssuesSynced}, ${state.totalCommentsSynced},
      ${state.backfillComplete}, now()
    )
    ON CONFLICT (repo) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at,
      last_page_cursor = EXCLUDED.last_page_cursor,
      total_issues_synced = EXCLUDED.total_issues_synced,
      total_comments_synced = EXCLUDED.total_comments_synced,
      backfill_complete = EXCLUDED.backfill_complete,
      updated_at = now()
  `;
}

// ── Rate limiting ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adaptiveRateDelay(
  headers: Record<string, string | undefined> | undefined,
  logger: Logger,
  pageNum: number,
): Promise<void> {
  if (!headers) return;

  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "5000", 10);
  const limit = parseInt(headers["x-ratelimit-limit"] ?? "5000", 10);

  if (pageNum % 10 === 0) {
    logger.info({ remaining, limit, page: pageNum }, "Rate limit status");
  }

  const ratio = remaining / limit;
  if (ratio < 0.2) {
    logger.warn({ remaining, limit }, "Rate limit low (<20%) -- adding 3s delay");
    await sleep(3000);
  } else if (ratio < 0.5) {
    logger.info({ remaining, limit }, "Rate limit moderate (<50%) -- adding 1.5s delay");
    await sleep(1500);
  }
}

async function waitForRateReset(
  headers: Record<string, string | undefined> | undefined,
  logger: Logger,
): Promise<void> {
  if (!headers) return;

  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "1", 10);
  if (remaining > 0) return;

  const resetEpoch = parseInt(headers["x-ratelimit-reset"] ?? "0", 10);
  if (resetEpoch === 0) return;

  const waitMs = resetEpoch * 1000 - Date.now() + 1000; // +1s buffer
  if (waitMs > 0) {
    logger.warn({ waitMs, resetAt: new Date(resetEpoch * 1000).toISOString() }, "Rate limit exhausted -- sleeping until reset");
    await sleep(waitMs);
  }
}

// ── Issue backfill ──────────────────────────────────────────────────────────

export async function backfillIssues(opts: IssueBackfillOptions): Promise<IssueBackfillResult> {
  const { octokit, store, sql, embeddingProvider, repo, logger, dryRun = false } = opts;
  const startTime = Date.now();
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }

  // Check sync state for resume
  const syncState = await getIssueSyncState(sql, repo);
  let resumed = false;
  let sinceParam: string | undefined;

  if (syncState?.lastSyncedAt) {
    sinceParam = syncState.lastSyncedAt.toISOString();
    resumed = true;
    logger.info(
      { repo, resumeFrom: sinceParam, totalSoFar: syncState.totalIssuesSynced },
      "Resuming issue backfill from last sync point",
    );
  } else {
    logger.info({ repo }, "Starting fresh issue backfill");
  }

  let page = 1;
  let totalIssues = syncState?.totalIssuesSynced ?? 0;
  let totalEmbeddings = 0;
  let failedEmbeddings = 0;
  let pagesProcessed = 0;
  let lastUpdatedAt: Date | null = syncState?.lastSyncedAt ?? null;

  while (true) {
    const response = await octokit.rest.issues.listForRepo({
      owner,
      repo: repoName,
      state: "all",
      sort: "updated",
      direction: "asc",
      since: sinceParam,
      per_page: 100,
      page,
    });

    const items = response.data;
    pagesProcessed++;

    if (items.length === 0) {
      logger.info({ page, repo }, "Empty page -- issue backfill pagination complete");
      break;
    }

    // Check rate limit reset
    await waitForRateReset(
      response.headers as unknown as Record<string, string | undefined>,
      logger,
    );
    await adaptiveRateDelay(
      response.headers as unknown as Record<string, string | undefined>,
      logger,
      page,
    );

    let issuesOnPage = 0;
    let pageEmbeddings = 0;

    for (const item of items) {
      // Filter out PRs (INGEST-03)
      if (item.pull_request) continue;

      issuesOnPage++;

      // Build embedding text
      const embeddingText = buildIssueEmbeddingText(item.title, item.body ?? null);
      let embedding: Float32Array | null = null;

      try {
        const result = await embeddingProvider.generate(embeddingText, "document");
        if (result) {
          embedding = result.embedding;
          pageEmbeddings++;
        } else {
          failedEmbeddings++;
        }
      } catch {
        failedEmbeddings++;
      }

      if (!dryRun) {
        await store.upsert({
          repo,
          owner,
          issueNumber: item.number,
          title: item.title,
          body: item.body ?? null,
          state: item.state,
          authorLogin: item.user?.login ?? "ghost",
          authorAssociation: item.author_association ?? null,
          labelNames: (item.labels ?? []).map((l) =>
            typeof l === "string" ? l : l.name ?? "",
          ),
          templateSlug: null,
          commentCount: item.comments,
          assignees: (item.assignees ?? []).map((a) => ({
            id: a.id,
            login: a.login,
          })),
          milestone: item.milestone?.title ?? null,
          reactionCount: item.reactions?.total_count ?? 0,
          isPullRequest: false,
          locked: item.locked,
          githubCreatedAt: new Date(item.created_at),
          githubUpdatedAt: item.updated_at ? new Date(item.updated_at) : null,
          closedAt: item.closed_at ? new Date(item.closed_at) : null,
          embedding,
        });
      }

      // Track latest updated_at for sync state
      if (item.updated_at) {
        const itemDate = new Date(item.updated_at);
        if (!lastUpdatedAt || itemDate > lastUpdatedAt) {
          lastUpdatedAt = itemDate;
        }
      }
    }

    totalIssues += issuesOnPage;
    totalEmbeddings += pageEmbeddings;

    // Log structured progress (INGEST-05)
    logger.info(
      {
        page,
        issuesOnPage,
        totalProcessed: totalIssues,
        embeddingsCreated: totalEmbeddings,
        rateLimitRemaining: response.headers?.["x-ratelimit-remaining"] ?? "unknown",
      },
      "Issue backfill page processed",
    );

    // Persist sync state after each page (INGEST-04)
    if (!dryRun) {
      await updateIssueSyncState(sql, {
        repo,
        lastSyncedAt: lastUpdatedAt,
        lastPageCursor: String(page),
        totalIssuesSynced: totalIssues,
        totalCommentsSynced: syncState?.totalCommentsSynced ?? 0,
        backfillComplete: false,
      });
    }

    if (items.length < 100) break;
    page++;
  }

  // Mark backfill complete
  if (!dryRun) {
    await updateIssueSyncState(sql, {
      repo,
      lastSyncedAt: lastUpdatedAt,
      lastPageCursor: String(page),
      totalIssuesSynced: totalIssues,
      totalCommentsSynced: syncState?.totalCommentsSynced ?? 0,
      backfillComplete: true,
    });
  }

  const durationMs = Date.now() - startTime;

  logger.info(
    { repo, totalIssues, totalEmbeddings, failedEmbeddings, pagesProcessed, durationMs, resumed },
    "Issue backfill complete",
  );

  return { totalIssues, totalComments: 0, totalEmbeddings, pagesProcessed, failedEmbeddings, durationMs, resumed };
}

// ── Comment backfill ────────────────────────────────────────────────────────

export async function backfillIssueComments(opts: IssueBackfillOptions): Promise<CommentBackfillResult> {
  const { octokit, store, sql, embeddingProvider, repo, logger, dryRun = false } = opts;
  const [owner, repoName] = repo.split("/");

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
  }

  const syncState = await getIssueSyncState(sql, repo);
  const sinceParam = syncState?.lastSyncedAt?.toISOString();

  logger.info({ repo, since: sinceParam ?? "all" }, "Starting issue comment backfill");

  // Build title cache for comment embedding context
  const titleCache = new Map<number, string>();

  let page = 1;
  let totalComments = 0;
  let totalChunks = 0;
  let failedEmbeddings = 0;

  while (true) {
    // Repo-wide comment fetch (efficient: ~100 per page vs per-issue)
    const response = await octokit.rest.issues.listCommentsForRepo({
      owner,
      repo: repoName,
      sort: "created",
      direction: "asc",
      since: sinceParam,
      per_page: 100,
      page,
    });

    const comments = response.data;

    if (comments.length === 0) {
      logger.info({ page, repo }, "Empty page -- comment backfill pagination complete");
      break;
    }

    await waitForRateReset(
      response.headers as unknown as Record<string, string | undefined>,
      logger,
    );
    await adaptiveRateDelay(
      response.headers as unknown as Record<string, string | undefined>,
      logger,
      page,
    );

    for (const comment of comments) {
      // Extract issue number from issue_url
      const issueMatch = comment.issue_url?.match(/\/issues\/(\d+)$/);
      if (!issueMatch) continue;
      const issueNumber = parseInt(issueMatch[1]!, 10);

      // Skip bot comments
      const login = comment.user?.login;
      if (!login || isBotComment(login)) continue;

      // Get issue title for embedding context prefix
      let issueTitle = titleCache.get(issueNumber);
      if (!issueTitle) {
        const issue = await store.getByNumber(repo, issueNumber);
        issueTitle = issue?.title ?? `Issue ${issueNumber}`;
        titleCache.set(issueNumber, issueTitle);
      }

      // Chunk comment
      const chunks = chunkIssueComment(issueNumber, issueTitle, comment.body ?? "");

      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i]!;
        let embedding: Float32Array | null = null;

        try {
          const result = await embeddingProvider.generate(chunkText, "document");
          if (result) {
            embedding = result.embedding;
          } else {
            failedEmbeddings++;
          }
        } catch {
          failedEmbeddings++;
        }

        // Use synthetic ID for additional chunks to avoid key collision
        const commentGithubId = i === 0 ? comment.id : comment.id * 1000 + i;

        if (!dryRun) {
          await store.upsertComment({
            repo,
            issueNumber,
            commentGithubId,
            authorLogin: login,
            authorAssociation: comment.author_association ?? null,
            body: i === 0 ? (comment.body ?? "") : chunkText,
            githubCreatedAt: new Date(comment.created_at),
            githubUpdatedAt: comment.updated_at ? new Date(comment.updated_at) : null,
            embedding,
          });
        }

        totalChunks++;
      }

      totalComments++;
    }

    logger.info(
      {
        page,
        commentsOnPage: comments.length,
        totalComments,
        totalChunks,
        rateLimitRemaining: response.headers?.["x-ratelimit-remaining"] ?? "unknown",
      },
      "Comment backfill page processed",
    );

    if (comments.length < 100) break;
    page++;
  }

  // Update sync state with comment totals
  if (!dryRun && syncState) {
    await updateIssueSyncState(sql, {
      ...syncState,
      totalCommentsSynced: (syncState.totalCommentsSynced ?? 0) + totalComments,
    });
  }

  logger.info({ repo, totalComments, totalChunks, failedEmbeddings }, "Comment backfill complete");

  return { totalComments, totalChunks, failedEmbeddings };
}
