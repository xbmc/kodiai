import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { createCommentServer } from "./comment-server.ts";
import { createInlineReviewServer } from "./inline-review-server.ts";
import { createCIStatusServer } from "./ci-status-server.ts";
import { createReviewCommentThreadServer } from "./review-comment-thread-server.ts";

export { createCommentServer } from "./comment-server.ts";
export { createInlineReviewServer } from "./inline-review-server.ts";
export { createCIStatusServer } from "./ci-status-server.ts";
export { createReviewCommentThreadServer } from "./review-comment-thread-server.ts";

export function buildMcpServers(deps: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber?: number;
  commentId?: number;
  reviewOutputKey?: string;
  deliveryId?: string;
  logger?: Logger;
  onPublish?: () => void;
  enableInlineTools?: boolean;
  enableCommentTools?: boolean;
}) {
  const servers: Record<string, ReturnType<typeof createCommentServer>> = {};

  const enableCommentTools = deps.enableCommentTools ?? true;
  if (enableCommentTools) {
    servers.github_comment = createCommentServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      deps.reviewOutputKey,
      deps.onPublish,
      deps.prNumber,
    );
  }

  if (deps.prNumber !== undefined && deps.commentId !== undefined) {
    servers.reviewCommentThread = createReviewCommentThreadServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      deps.onPublish,
    );
  }

  const enableInlineTools = deps.enableInlineTools ?? true;

  if (enableInlineTools && deps.prNumber !== undefined) {
    servers.github_inline_comment = createInlineReviewServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      deps.prNumber,
      deps.reviewOutputKey,
      deps.deliveryId,
      deps.logger,
      deps.onPublish,
    );
    servers.github_ci = createCIStatusServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      deps.prNumber,
    );
  }

  return servers;
}

export function buildAllowedMcpTools(serverNames: string[]): string[] {
  return serverNames.map((name) => `mcp__${name}__*`);
}
