import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { MentionEvent } from "./mention-types.ts";
import {
  buildExistingPrReply,
  buildWriteInProgressReply,
  buildWriteRateLimitedReply,
} from "./mention-write-replies.ts";
import type { MentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";

export type MentionWritePreflightResult =
  | { action: "continue"; acquiredWriteKey?: string }
  | { action: "stop"; acquiredWriteKey?: string };

export async function evaluateMentionWritePreflight(params: {
  writeEnabled: boolean;
  writeOutputKey: string | undefined;
  writeBranchName: string | undefined;
  octokit: Octokit;
  mention: MentionEvent;
  deliveryId: string;
  installationId: number;
  triggerCommentUrl: string | undefined;
  inFlightWriteKeys: Set<string>;
  writeRateLimit: MentionWriteRateLimitRuntime;
  postMentionReply: (replyBody: string) => Promise<void>;
  logger: Pick<Logger, "info" | "warn">;
}): Promise<MentionWritePreflightResult> {
  let acquiredWriteKey: string | undefined;

  if (params.writeEnabled && params.writeOutputKey && params.writeBranchName) {
    try {
      const { data: prs } = await params.octokit.rest.pulls.list({
        owner: params.mention.owner,
        repo: params.mention.repo,
        state: "all",
        head: `${params.mention.owner}:${params.writeBranchName}`,
        per_page: 5,
      });

      const existing = prs[0];
      if (existing?.html_url) {
        params.logger.info(
          {
            evidenceType: "write-mode",
            outcome: "reused-pr",
            deliveryId: params.deliveryId,
            installationId: params.installationId,
            owner: params.mention.owner,
            repoName: params.mention.repo,
            repo: `${params.mention.owner}/${params.mention.repo}`,
            sourcePrNumber: params.mention.prNumber,
            triggerCommentId: params.mention.commentId,
            triggerCommentUrl: params.triggerCommentUrl,
            writeOutputKey: params.writeOutputKey,
            branchName: params.writeBranchName,
            prUrl: existing.html_url,
          },
          "Evidence bundle",
        );

        await params.postMentionReply(buildExistingPrReply({ prUrl: existing.html_url }));
        return { action: "stop" };
      }
    } catch (err) {
      params.logger.warn(
        {
          err,
          writeBranchName: params.writeBranchName,
          writeOutputKey: params.writeOutputKey,
          prNumber: params.mention.prNumber,
        },
        "Failed to look up existing PR for write idempotency; continuing",
      );
    }

    if (params.inFlightWriteKeys.has(params.writeOutputKey)) {
      await params.postMentionReply(buildWriteInProgressReply());
      return { action: "stop" };
    }
    params.inFlightWriteKeys.add(params.writeOutputKey);
    acquiredWriteKey = params.writeOutputKey;
  }

  if (params.writeEnabled) {
    const writeRateLimitCheck = params.writeRateLimit.check(params.mention.owner, params.mention.repo);
    if (!writeRateLimitCheck.allowed) {
      await params.postMentionReply(buildWriteRateLimitedReply({
        retryInSeconds: writeRateLimitCheck.retryInSeconds,
      }));
      return { action: "stop", acquiredWriteKey };
    }
  }

  return { action: "continue", acquiredWriteKey };
}
