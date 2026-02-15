import type { Octokit } from "@octokit/rest";
import type { MentionEvent } from "../handlers/mention-types.ts";
import {
  filterCommentsToTriggerTime,
  sanitizeContent,
} from "../lib/sanitizer.ts";

export type BuildMentionContextOptions = {
  /** Max number of conversation comments to include (after filtering). */
  maxComments?: number;
  /** Max characters to include per comment body (after sanitization). */
  maxCommentChars?: number;
  /** Max total characters to include across all included conversation comments. */
  maxConversationChars?: number;
  /** Max total characters to include across review-thread comments. */
  maxThreadChars?: number;
  /** Max pages to scan when paginating GitHub list APIs for context. */
  maxApiPages?: number;
  /** Max characters to include from PR description (after sanitization). */
  maxPrBodyChars?: number;
  /** Optional callback to hydrate finding metadata for review-thread parent comments. */
  findingLookup?: (repo: string, commentId: number) => {
    severity: string;
    category: string;
    filePath: string;
    startLine: number | null;
    title: string;
  } | null;
};

const DEFAULT_MAX_COMMENTS = 20;
const DEFAULT_MAX_COMMENT_CHARS = 800;
const DEFAULT_MAX_CONVERSATION_CHARS = 16_000;
const DEFAULT_MAX_API_PAGES = 10;
const DEFAULT_MAX_PR_BODY_CHARS = 1200;

type IssueComment = {
  id?: number;
  body?: string | null;
  created_at: string;
  updated_at?: string;
  user?: { login?: string | null } | null;
};

type ReviewComment = {
  id: number;
  body?: string | null;
  created_at: string;
  in_reply_to_id?: number;
  user?: { login?: string | null } | null;
};

function truncateDeterministic(
  input: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (maxChars <= 0) return { text: "", truncated: input.length > 0 };
  if (input.length <= maxChars) return { text: input, truncated: false };
  const clipped = input.slice(0, maxChars).trimEnd();
  return { text: `${clipped}\n...[truncated]`, truncated: true };
}

function isLegacyBotTrackingComment(body: string | null | undefined): boolean {
  // Phase 9 used a tracking comment pattern. Keep skipping it so mention
  // context stays focused on the human conversation.
  return !!body && body.startsWith("> **Kodiai**");
}

/**
 * Build a bounded, sanitized context string for mention replies.
 *
 * Includes:
 * - Recent issue/PR comments filtered to the mention trigger timestamp (TOCTOU)
 * - PR metadata for PR surfaces
 * - Inline review metadata + diff hunk for pr_review_comment
 */
export async function buildMentionContext(
  octokit: Octokit,
  mention: MentionEvent,
  options: BuildMentionContextOptions = {},
): Promise<string> {
  const maxComments = options.maxComments ?? DEFAULT_MAX_COMMENTS;
  const maxCommentChars = options.maxCommentChars ?? DEFAULT_MAX_COMMENT_CHARS;
  const maxConversationChars =
    options.maxConversationChars ?? DEFAULT_MAX_CONVERSATION_CHARS;
  const maxThreadChars = options.maxThreadChars ?? maxConversationChars;
  const maxApiPages = options.maxApiPages ?? DEFAULT_MAX_API_PAGES;
  const maxPrBodyChars = options.maxPrBodyChars ?? DEFAULT_MAX_PR_BODY_CHARS;

  const lines: string[] = [];
  const scaleNotes: string[] = [];

  async function listIssueCommentsBounded(): Promise<{
    comments: IssueComment[];
    scannedPages: number;
    hitPageCap: boolean;
    hitTriggerTimeCap: boolean;
  }> {
    const perPage = 100;
    const all: IssueComment[] = [];

    const triggerTs = mention.commentCreatedAt
      ? new Date(mention.commentCreatedAt).getTime()
      : undefined;
    let hitTriggerTimeCap = false;

    for (let page = 1; page <= maxApiPages; page++) {
      const { data } = await octokit.rest.issues.listComments({
        owner: mention.owner,
        repo: mention.repo,
        issue_number: mention.issueNumber,
        per_page: perPage,
        page,
        sort: "created",
        direction: "desc",
      });

      all.push(...(data as IssueComment[]));

      // Early exit: if there's no trigger time, we only need the most recent
      // `maxComments` comments, and we're already paging newest-first.
      if (!mention.commentCreatedAt && maxComments > 0 && all.length >= maxComments) {
        return {
          comments: all,
          scannedPages: page,
          hitPageCap: false,
          hitTriggerTimeCap: false,
        };
      }

      // If we have a trigger time, try to avoid scanning forever through newer
      // comments after the trigger. Once we've fetched some comments older than
      // the trigger and have enough eligible comments, we'll stop.
      if (typeof triggerTs === "number" && data.length > 0) {
        const oldestFetched = data[data.length - 1] as IssueComment | undefined;
        const oldestFetchedTs = oldestFetched
          ? new Date(oldestFetched.created_at).getTime()
          : NaN;

        // Early exit: once we've reached comments older than the trigger and have
        // enough eligible comments to fill the cap, older pages won't change the
        // bounded output.
        if (maxComments > 0 && oldestFetchedTs < triggerTs) {
          const eligible = filterCommentsToTriggerTime(
            all,
            mention.commentCreatedAt,
          ).filter((c) => !isLegacyBotTrackingComment(c.body));
          if (eligible.length >= maxComments) {
            return {
              comments: all,
              scannedPages: page,
              hitPageCap: false,
              hitTriggerTimeCap: false,
            };
          }
        }

        if (oldestFetchedTs >= triggerTs && page === maxApiPages) {
          hitTriggerTimeCap = true;
        }
      }

      if (data.length < perPage) {
        return {
          comments: all,
          scannedPages: page,
          hitPageCap: false,
          hitTriggerTimeCap,
        };
      }
    }

    // We hit the page cap. We can't know if more pages exist, but the last
    // page was full-sized, which strongly suggests there is more.
    if (typeof triggerTs === "number" && all.length > 0) {
      const oldestOverall = all[all.length - 1] as IssueComment | undefined;
      const oldestOverallTs = oldestOverall
        ? new Date(oldestOverall.created_at).getTime()
        : NaN;
      if (oldestOverallTs >= triggerTs) {
        hitTriggerTimeCap = true;
      }
    }

    return {
      comments: all,
      scannedPages: maxApiPages,
      hitPageCap: true,
      hitTriggerTimeCap,
    };
  }

  // --- Conversation context (issue/PR comments) ---
  const {
    comments: comments,
    scannedPages,
    hitPageCap,
    hitTriggerTimeCap,
  } = await listIssueCommentsBounded();

  if (hitPageCap) {
    scaleNotes.push(
      `Conversation history scan capped at ${scannedPages} page(s) of issue comments (pagination guardrail).`,
    );
  }
  if (hitTriggerTimeCap && mention.commentCreatedAt) {
    scaleNotes.push(
      `Conversation history may include comments after trigger time because scan did not reach older pages before ${mention.commentCreatedAt}.`,
    );
  }

  const safeComments = filterCommentsToTriggerTime(
    comments,
    mention.commentCreatedAt,
  ).filter((c) => !isLegacyBotTrackingComment(c.body));

  // Ensure determinism regardless of API ordering.
  const sortedComments = [...safeComments].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  if (maxComments > 0 && sortedComments.length > maxComments) {
    scaleNotes.push(
      `Only the last ${maxComments} comment(s) were included (comment count cap).`,
    );
  }

  const boundedComments =
    maxComments > 0 ? sortedComments.slice(-maxComments) : [];

  lines.push("## Conversation History");
  lines.push(
    `Included: ${boundedComments.length} comment(s) (filtered to trigger time: ${mention.commentCreatedAt})`,
  );
  lines.push("");

  let remainingConversationChars = Math.max(0, maxConversationChars);
  let didHitConversationCharCap = false;
  let didTruncateAnyComment = false;

  for (const comment of boundedComments) {
    const author = comment.user?.login ?? "unknown";
    const bodyRaw = comment.body ?? "(empty)";
    const bodySanitized = sanitizeContent(bodyRaw);

    if (remainingConversationChars <= 0) {
      if (!didHitConversationCharCap) {
        didHitConversationCharCap = true;
        scaleNotes.push(
          `Conversation history truncated due to ${maxConversationChars} character cap across included comments.`,
        );
      }
      break;
    }

    const truncatedBody = truncateDeterministic(bodySanitized, maxCommentChars);
    if (truncatedBody.truncated) {
      didTruncateAnyComment = true;
    }

    // Apply the global conversation character budget after per-comment truncation.
    const finalBody =
      truncatedBody.text.length <= remainingConversationChars
        ? truncatedBody.text
        : truncateDeterministic(truncatedBody.text, remainingConversationChars).text;

    if (finalBody.length < truncatedBody.text.length && !didHitConversationCharCap) {
      didHitConversationCharCap = true;
      scaleNotes.push(
        `Conversation history truncated due to ${maxConversationChars} character cap across included comments.`,
      );
    }

    remainingConversationChars = Math.max(0, remainingConversationChars - finalBody.length);
    lines.push(`### @${author} (${comment.created_at})`);
    lines.push(finalBody);
    lines.push("");
  }

  if (didTruncateAnyComment) {
    scaleNotes.push(
      `One or more individual comments were truncated to ${maxCommentChars} characters.`,
    );
  }

  // --- PR metadata ---
  if (mention.prNumber !== undefined) {
    const { data: pr } = await octokit.rest.pulls.get({
      owner: mention.owner,
      repo: mention.repo,
      pull_number: mention.prNumber,
    });

    lines.push("## Pull Request Context");
    lines.push(`Title: ${sanitizeContent(pr.title)}`);
    lines.push(`Author: ${pr.user?.login ?? "unknown"}`);
    lines.push(`Branches: ${pr.head.ref} -> ${pr.base.ref}`);

    if (pr.body) {
      const bodySanitized = sanitizeContent(pr.body);
      const bodyTruncated = truncateDeterministic(bodySanitized, maxPrBodyChars);
      if (bodyTruncated.truncated) {
        scaleNotes.push(
          `PR description truncated to ${maxPrBodyChars} characters.`,
        );
      }
      lines.push("");
      lines.push("Description:");
      lines.push(bodyTruncated.text);
    }

    lines.push("");
  }

  // --- Inline review comment context (diff + file/line) ---
  if (mention.surface === "pr_review_comment") {
    lines.push("## Inline Review Comment Context");
    if (mention.filePath) lines.push(`File: ${mention.filePath}`);
    if (mention.fileLine !== undefined) lines.push(`Line: ${mention.fileLine}`);
    lines.push("");

    if (mention.diffHunk) {
      lines.push("Diff hunk:");
      lines.push("```diff");
      lines.push(sanitizeContent(mention.diffHunk));
      lines.push("```");
      lines.push("");
    }
  }

  if (
    mention.surface === "pr_review_comment" &&
    mention.inReplyToId !== undefined &&
    mention.prNumber !== undefined
  ) {
    let parent: ReviewComment | null = null;
    try {
      const parentResponse = await octokit.rest.pulls.getReviewComment({
        owner: mention.owner,
        repo: mention.repo,
        comment_id: mention.inReplyToId,
      });
      parent = parentResponse.data as ReviewComment;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        console.warn(
          {
            owner: mention.owner,
            repo: mention.repo,
            parentCommentId: mention.inReplyToId,
          },
          "Skipping review comment thread context because parent comment was not found",
        );
      } else {
        throw error;
      }
    }

    if (parent) {
      lines.push("## Review Comment Thread Context");

      const reviewOutputMarkerRe = /<!-- kodiai:review-output-key:[^>]+ -->/;
      const isKodiaiFinding = reviewOutputMarkerRe.test(parent.body ?? "");
      if (isKodiaiFinding && options.findingLookup) {
        let finding: ReturnType<NonNullable<BuildMentionContextOptions["findingLookup"]>>;
        try {
          finding = options.findingLookup(
            `${mention.owner}/${mention.repo}`,
            mention.inReplyToId,
          );
        } catch (error) {
          console.warn(
            {
              owner: mention.owner,
              repo: mention.repo,
              parentCommentId: mention.inReplyToId,
              error,
            },
            "Skipping finding metadata in mention context because lookup failed",
          );
          finding = null;
        }
        if (finding) {
          lines.push(
            `Original finding: [${finding.severity.toUpperCase()}] ${finding.category}`,
          );
          lines.push(`File: ${finding.filePath}`);
          if (finding.startLine !== null) {
            lines.push(`Line: ${finding.startLine}`);
          }
          lines.push(`Title: ${finding.title}`);
          lines.push("");
        }
      }

      const threadResponse = await octokit.rest.pulls.listReviewComments({
        owner: mention.owner,
        repo: mention.repo,
        pull_number: mention.prNumber,
        per_page: 100,
        sort: "created",
        direction: "asc",
      });

      let threadRoot = mention.inReplyToId;
      if (parent.in_reply_to_id !== undefined) {
        threadRoot = parent.in_reply_to_id;
      }

      const allReviewComments = threadResponse.data as ReviewComment[];
      const threadComments = allReviewComments
        .filter(
          (comment) =>
            comment.id === threadRoot || comment.in_reply_to_id === threadRoot,
        )
        .filter((comment) => comment.id !== mention.commentId)
        .sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          if (aTime !== bTime) return aTime - bTime;
          return a.id - b.id;
        });

      if (threadComments.length === 0) {
        lines.push("No earlier comments found in this thread.");
        lines.push("");
      } else {
        const olderThreadCount = Math.max(0, threadComments.length - 3);
        let remainingThreadChars = Math.max(0, maxThreadChars);
        let didHitThreadCharCap = false;
        let didTruncateOldThreadTurn = false;

        for (const [index, comment] of threadComments.entries()) {
          if (remainingThreadChars <= 0) {
            if (!didHitThreadCharCap) {
              didHitThreadCharCap = true;
              scaleNotes.push(
                `Review thread context truncated due to ${maxThreadChars} character cap.`,
              );
            }
            break;
          }

          const author = comment.user?.login ?? "unknown";
          const bodyRaw = comment.body ?? "(empty)";
          const bodySanitized = sanitizeContent(bodyRaw);
          const isOlderThreadTurn = index < olderThreadCount;
          const perCommentCap = isOlderThreadTurn ? Math.min(200, maxCommentChars) : maxCommentChars;
          const truncatedBody = truncateDeterministic(bodySanitized, perCommentCap);

          if (isOlderThreadTurn && truncatedBody.truncated) {
            didTruncateOldThreadTurn = true;
          }

          const finalBody =
            truncatedBody.text.length <= remainingThreadChars
              ? truncatedBody.text
              : truncateDeterministic(truncatedBody.text, remainingThreadChars).text;

          if (finalBody.length < truncatedBody.text.length && !didHitThreadCharCap) {
            didHitThreadCharCap = true;
            scaleNotes.push(
              `Review thread context truncated due to ${maxThreadChars} character cap.`,
            );
          }

          remainingThreadChars = Math.max(0, remainingThreadChars - finalBody.length);

          lines.push(`### @${author} (${comment.created_at})`);
          lines.push(finalBody);
          lines.push("");
        }

        if (didTruncateOldThreadTurn) {
          scaleNotes.push(
            "Older review thread turns were truncated to 200 characters to preserve recent context.",
          );
        }
      }
    }
  }

  const header: string[] = [];
  if (scaleNotes.length > 0) {
    header.push(
      "## Scale Notes",
      "Some context was omitted due to scale guardrails:",
      ...scaleNotes.map((n) => `- ${n}`),
      "",
    );
  }

  return header.concat(lines).join("\n").trim() + "\n";
}
