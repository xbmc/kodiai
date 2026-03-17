/**
 * Wiki update publisher — posts generated suggestions as structured
 * comments on a GitHub tracking issue in the wiki repository.
 *
 * Flow: pre-flight check → fetch unpublished → group by page →
 *       create issue → post comments → update issue body → mark published.
 *
 * Phase 124: Publishing.
 */

import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type {
  WikiPublisherOptions,
  PublishResult,
  PublishRunOptions,
  PageSuggestionGroup,
  PagePostResult,
  RetrofitPageAction,
  RetrofitPreviewResult,
} from "./wiki-publisher-types.ts";

// ── Helpers (exported for testing) ──────────────────────────────────────

/** Simple promise-based delay. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a single page's suggestions as a GitHub issue comment body. */
export function formatPageComment(
  group: PageSuggestionGroup,
  prOwner: string,
  prRepo: string,
): string {
  const wikiUrl = `https://kodi.wiki/view/${encodeURIComponent(group.pageTitle.replace(/ /g, "_"))}`;
  const lines: string[] = [
    `<!-- kodiai:wiki-modification:${group.pageId} -->`,
    "",
    `## ${group.pageTitle}`,
    "",
    `**Wiki page:** [View on wiki](${wikiUrl})`,
    "",
    "---",
  ];

  for (const s of group.suggestions) {
    const heading = s.sectionHeading ?? "Introduction";
    lines.push("", `### ${heading}`, "");
    lines.push(s.suggestion);

    if (s.citingPrs.length > 0) {
      const prLinks = s.citingPrs
        .map(
          (pr) =>
            `[#${pr.prNumber}](https://github.com/${prOwner}/${prRepo}/pull/${pr.prNumber}) (${pr.prTitle})`,
        )
        .join(", ");
      lines.push(`**PRs:** ${prLinks}`);
    }

    lines.push("", "---");
  }

  return lines.join("\n");
}

/** Build the issue body summary table. */
export function formatSummaryTable(
  date: string,
  pageResults: PagePostResult[],
  totalSuggestions: number,
): string {
  const posted = pageResults.filter((r) => r.success).length;
  const skipped = pageResults.filter((r) => !r.success).length;

  const lines: string[] = [
    `# Wiki Modification Artifacts — ${date}`,
    "",
    `**Generated:** ${date}`,
    `**Pages evaluated:** ${pageResults.length}`,
    `**Modifications posted:** ${totalSuggestions}`,
    `**Pages skipped:** ${skipped}`,
    "",
    "| # | Page | Wiki Link | Sections | PRs Cited | Comment |",
    "|---|------|-----------|----------|-----------|---------|",
  ];

  for (let i = 0; i < pageResults.length; i++) {
    const r = pageResults[i]!;
    const num = i + 1;
    const wikiUrl = `https://kodi.wiki/view/${encodeURIComponent(r.pageTitle.replace(/ /g, "_"))}`;
    const wikiLink = `[View](${wikiUrl})`;

    let commentCol: string;
    if (r.success && r.commentId != null) {
      commentCol = `[View](#issuecomment-${r.commentId})`;
    } else {
      commentCol = `skipped: ${r.error ?? "unknown error"}`;
    }

    lines.push(
      `| ${num} | ${r.pageTitle} | ${wikiLink} | ${r.suggestionsCount} | ${r.prsCount} | ${commentCol} |`,
    );
  }

  return lines.join("\n");
}

/**
 * Post a comment with retry on 403 (GitHub secondary rate limit).
 * Returns the comment ID on success, null on failure.
 */
export async function postCommentWithRetry(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  maxRetries = 3,
): Promise<{ commentId: number } | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      return { commentId: response.data.id };
    } catch (error: unknown) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status: number }).status
          : 0;

      if (status === 403 && attempt < maxRetries) {
        // Check Retry-After header
        const retryAfter =
          typeof error === "object" &&
          error !== null &&
          "response" in error &&
          typeof (error as Record<string, unknown>).response === "object" &&
          (error as Record<string, Record<string, unknown>>).response !== null
            ? (
                (error as { response: { headers?: Record<string, string> } })
                  .response.headers?.["retry-after"] ?? null
              )
            : null;

        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : 60_000 * Math.pow(2, attempt); // 60s, 120s, 240s

        await delay(waitMs);
        continue;
      }

      // Non-403 or exhausted retries
      return null;
    }
  }
  return null;
}

/**
 * Scan an issue's comments for an existing wiki-modification marker and update it,
 * or create a new comment if no match is found.
 *
 * Returns `{ commentId, action }` on success, `null` on failure.
 */
export async function upsertWikiPageComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  pageId: number,
  body: string,
  logger: Logger,
): Promise<{ commentId: number; action: 'updated' | 'created' } | null> {
  const marker = `<!-- kodiai:wiki-modification:${pageId} -->`;
  let existingCommentId: number | null = null;

  try {
    for (let page = 1; page <= 10; page++) {
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
        page,
        sort: "created",
        direction: "desc",
      });

      if (comments.length === 0) break;

      for (const comment of comments) {
        if (comment.body?.includes(marker)) {
          existingCommentId = comment.id;
          break;
        }
      }

      if (existingCommentId !== null) break;
      if (comments.length < 100) break;
    }
  } catch {
    logger.debug(
      { pageId, issueNumber },
      "Failed to scan for existing wiki comment, will create new",
    );
  }

  try {
    if (existingCommentId !== null) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingCommentId,
        body,
      });
      logger.debug(
        { pageId, commentId: existingCommentId, action: 'updated' },
        "Updated existing wiki comment",
      );
      return { commentId: existingCommentId, action: 'updated' };
    } else {
      const response = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      logger.debug(
        { pageId, commentId: response.data.id, action: 'created' },
        "Created new wiki comment",
      );
      return { commentId: response.data.id, action: 'created' };
    }
  } catch {
    logger.debug(
      { pageId, issueNumber },
      "Failed to post wiki comment (upsert API error)",
    );
    return null;
  }
}

// ── Main factory ────────────────────────────────────────────────────────

export function createWikiPublisher(options: WikiPublisherOptions) {
  const {
    sql,
    githubApp,
    logger,
    owner = "xbmc",
    repo = "wiki",
    prOwner = "xbmc",
    prRepo = "xbmc",
    commentDelayMs = 3000,
  } = options;

  return {
    async publish(runOptions: PublishRunOptions = {}): Promise<PublishResult> {
      const { dryRun = false, pageIds, groundedOnly = false } = runOptions;

      const emptyResult: PublishResult = {
        issueNumber: null,
        issueUrl: null,
        pagesPosted: 0,
        pagesSkipped: 0,
        suggestionsPublished: 0,
        skippedPages: [],
      };

      // ── 1. Pre-flight check (PUB-04) ──────────────────────────────
      let octokit: Octokit | null = null;

      if (!dryRun) {
        const installCtx = await githubApp.getRepoInstallationContext(
          owner,
          repo,
        );
        if (!installCtx) {
          const slug = githubApp.getAppSlug();
          logger.error(
            { owner, repo },
            `GitHub App not installed on ${owner}/${repo}. Install the app at https://github.com/apps/${slug}/installations`,
          );
          return emptyResult;
        }
        octokit = await githubApp.getInstallationOctokit(
          installCtx.installationId,
        );
      }

      // ── 2. Fetch unpublished suggestions ──────────────────────────
      const conditions = [
        sql`published_at IS NULL`,
        sql`grounding_status IN ('grounded', 'partially-grounded')`,
      ];
      if (pageIds && pageIds.length > 0) {
        conditions.push(sql`page_id = ANY(${pageIds})`);
      }
      if (groundedOnly) {
        conditions.push(sql`voice_mismatch_warning = false`);
      }

      const where = conditions.reduce((a, b) => sql`${a} AND ${b}`);

      const rows = await sql`
        SELECT id, page_id, page_title, section_heading, suggestion, why_summary,
               citing_prs, voice_mismatch_warning
        FROM wiki_update_suggestions
        WHERE ${where}
        ORDER BY page_id, section_heading NULLS FIRST
      `;

      if (rows.length === 0) {
        logger.info("No unpublished grounded suggestions found");
        return emptyResult;
      }

      // ── 3. Group by page ──────────────────────────────────────────
      const groupMap = new Map<number, PageSuggestionGroup>();
      for (const row of rows) {
        const pageId = row.page_id as number;
        if (!groupMap.has(pageId)) {
          groupMap.set(pageId, {
            pageId,
            pageTitle: row.page_title as string,
            suggestions: [],
          });
        }
        const citingPrs = typeof row.citing_prs === "string"
          ? JSON.parse(row.citing_prs)
          : (row.citing_prs ?? []);

        groupMap.get(pageId)!.suggestions.push({
          sectionHeading: row.section_heading as string | null,
          suggestion: row.suggestion as string,
          whySummary: row.why_summary as string,
          citingPrs: citingPrs as Array<{
            prNumber: number;
            prTitle: string;
          }>,
          voiceMismatchWarning: row.voice_mismatch_warning as boolean,
        });
      }
      const groups = Array.from(groupMap.values());

      // ── 4a. Retrofit-preview branch (scan-only, no mutation) ──────
      if (runOptions.retrofitPreview === true) {
        if (!runOptions.issueNumber) {
          throw new Error("retrofitPreview requires issueNumber in runOptions");
        }
        if (dryRun) {
          logger.warn(
            "retrofitPreview ignores dryRun — it needs a live GitHub connection to scan comments",
          );
        }

        // retrofitPreview needs a live Octokit (reads GitHub)
        if (!octokit) {
          const installCtx = await githubApp.getRepoInstallationContext(owner, repo);
          if (!installCtx) {
            const slug = githubApp.getAppSlug();
            logger.error(
              { owner, repo },
              `GitHub App not installed on ${owner}/${repo}. Install the app at https://github.com/apps/${slug}/installations`,
            );
            return emptyResult;
          }
          octokit = await githubApp.getInstallationOctokit(installCtx.installationId);
        }

        const previewIssueNumber = runOptions.issueNumber;
        const actions: RetrofitPageAction[] = [];

        for (const group of groups) {
          const marker = `<!-- kodiai:wiki-modification:${group.pageId} -->`;
          let existingCommentId: number | null = null;

          try {
            for (let page = 1; page <= 10; page++) {
              const { data: comments } = await octokit.rest.issues.listComments({
                owner,
                repo,
                issue_number: previewIssueNumber,
                per_page: 100,
                page,
                sort: "created",
                direction: "desc",
              });

              if (comments.length === 0) break;

              for (const comment of comments) {
                if (comment.body?.includes(marker)) {
                  existingCommentId = comment.id;
                  break;
                }
              }

              if (existingCommentId !== null) break;
              if (comments.length < 100) break;
            }
          } catch {
            logger.debug(
              { pageId: group.pageId, issueNumber: previewIssueNumber },
              "Failed to scan for existing wiki comment in retrofit-preview",
            );
          }

          const action: RetrofitPageAction = {
            pageId: group.pageId,
            pageTitle: group.pageTitle,
            action: existingCommentId !== null ? 'update' : 'create',
            existingCommentId,
          };

          actions.push(action);
          logger.info(
            { pageId: group.pageId, pageTitle: group.pageTitle, action: action.action, existingCommentId },
            `Retrofit preview: ${group.pageTitle} → ${action.action}`,
          );
        }

        const retrofitPreviewResult: RetrofitPreviewResult = {
          actions,
          issueNumber: previewIssueNumber,
        };

        return {
          ...emptyResult,
          retrofitPreviewResult,
        };
      }

      // ── 4b. Dry-run branch ────────────────────────────────────────
      if (dryRun) {
        const parts: string[] = [];
        for (const group of groups) {
          parts.push(formatPageComment(group, prOwner, prRepo));
        }
        const dryRunOutput = parts.join("\n\n");
        logger.info(
          { pages: groups.length, suggestions: rows.length },
          "Dry-run: formatted suggestions for all pages",
        );
        logger.info({ dryRunOutput }, "Dry-run output");
        return {
          ...emptyResult,
          pagesPosted: groups.length,
          suggestionsPublished: rows.length,
          dryRunOutput,
        };
      }

      // ── 5. Get or create tracking issue ──────────────────────────
      const today = new Date().toISOString().slice(0, 10);
      let issueNumber: number;
      let issueUrl: string;

      if (runOptions.issueNumber) {
        // Supplied issue — skip create, fetch URL via issues.get
        const issueData = await octokit!.rest.issues.get({
          owner,
          repo,
          issue_number: runOptions.issueNumber,
        });
        issueNumber = runOptions.issueNumber;
        issueUrl = issueData.data.html_url;
        logger.info(
          { issueNumber, issueUrl },
          `Using supplied tracking issue #${issueNumber}`,
        );
      } else {
        // Create new tracking issue (PUB-01)
        const issue = await octokit!.rest.issues.create({
          owner,
          repo,
          title: `Wiki Modification Artifacts — ${today}`,
          body: "Posting modification artifacts... (will be updated with summary table)",
          labels: ["wiki-update", "bot-generated"],
        });
        issueNumber = issue.data.number;
        issueUrl = issue.data.html_url;
        logger.info(
          { issueNumber, issueUrl },
          `Created tracking issue #${issueNumber}`,
        );
      }

      // ── 6. Post per-page comments (PUB-02 + PUB-03) ──────────────
      const pageResults: PagePostResult[] = [];
      let totalPublished = 0;

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i]!;
        const commentBody = formatPageComment(group, prOwner, prRepo);
        const uniquePrs = new Set<number>();
        let hasVoiceWarnings = false;

        for (const s of group.suggestions) {
          for (const pr of s.citingPrs) uniquePrs.add(pr.prNumber);
          if (s.voiceMismatchWarning) hasVoiceWarnings = true;
        }

        const result = await upsertWikiPageComment(
          octokit!,
          owner,
          repo,
          issueNumber,
          group.pageId,
          commentBody,
          logger,
        );

        if (result) {
          pageResults.push({
            pageId: group.pageId,
            pageTitle: group.pageTitle,
            commentId: result.commentId,
            success: true,
            suggestionsCount: group.suggestions.length,
            prsCount: uniquePrs.size,
            hasVoiceWarnings,
            commentAction: result.action,
          });

          // ── 7. Mark published in DB ───────────────────────────────
          await sql`
            UPDATE wiki_update_suggestions
            SET published_at = NOW(),
                published_issue_number = ${issueNumber},
                published_comment_id = ${result.commentId}
            WHERE page_id = ${group.pageId}
              AND published_at IS NULL
              AND grounding_status IN ('grounded', 'partially-grounded')
          `;

          totalPublished += group.suggestions.length;
          logger.info(
            {
              pageTitle: group.pageTitle,
              sections: group.suggestions.length,
              prs: uniquePrs.size,
            },
            `Posted: ${group.pageTitle} (${group.suggestions.length} sections, ${uniquePrs.size} PRs cited)`,
          );
        } else {
          const errorMsg = "Comment post failed after retries";
          pageResults.push({
            pageId: group.pageId,
            pageTitle: group.pageTitle,
            commentId: null,
            success: false,
            error: errorMsg,
            suggestionsCount: group.suggestions.length,
            prsCount: uniquePrs.size,
            hasVoiceWarnings,
          });
          logger.warn(
            { pageTitle: group.pageTitle },
            `Skipped: ${group.pageTitle} — ${errorMsg}`,
          );
        }

        // Rate-limit delay between comments (except after last)
        if (i < groups.length - 1) {
          await delay(commentDelayMs);
        }
      }

      // ── 8. Update issue body with summary table ───────────────────
      const summaryBody = formatSummaryTable(
        today,
        pageResults,
        totalPublished,
      );
      await octokit!.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: summaryBody,
      });

      logger.info(
        { issueNumber, pagesPosted: pageResults.filter((r) => r.success).length },
        "Updated issue body with summary table",
      );

      const skippedPages = pageResults
        .filter((r) => !r.success)
        .map((r) => ({ pageTitle: r.pageTitle, reason: r.error ?? "unknown" }));

      return {
        issueNumber,
        issueUrl,
        pagesPosted: pageResults.filter((r) => r.success).length,
        pagesSkipped: skippedPages.length,
        suggestionsPublished: totalPublished,
        skippedPages,
      };
    },
  };
}
