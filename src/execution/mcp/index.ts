import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { createCommentServer } from "./comment-server.ts";
import { createInlineReviewServer } from "./inline-review-server.ts";
import { createCIStatusServer } from "./ci-status-server.ts";
import { createReviewCommentThreadServer } from "./review-comment-thread-server.ts";
import { createCheckpointServer } from "./checkpoint-server.ts";
import { createIssueLabelServer } from "./issue-label-server.ts";
import { createIssueCommentServer } from "./issue-comment-server.ts";
import type { KnowledgeStore } from "../../knowledge/types.ts";
import type { ExecutionPublishEvent } from "../types.ts";

export { createCommentServer } from "./comment-server.ts";
export { createInlineReviewServer } from "./inline-review-server.ts";
export { createCIStatusServer } from "./ci-status-server.ts";
export { createReviewCommentThreadServer } from "./review-comment-thread-server.ts";
export { createCheckpointServer } from "./checkpoint-server.ts";
export { createIssueLabelServer } from "./issue-label-server.ts";
export { createIssueCommentServer } from "./issue-comment-server.ts";

export interface TriageConfig {
  enabled: boolean;
  label: { enabled: boolean };
  comment: { enabled: boolean };
}

export function buildMcpServers(deps: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber?: number;
  commentId?: number;
  botHandles?: string[];
  reviewOutputKey?: string;
  deliveryId?: string;
  logger?: Logger;
  onPublish?: () => void;
  onPublishEvent?: (event: ExecutionPublishEvent) => void;
  enableInlineTools?: boolean;
  enableCommentTools?: boolean;
  knowledgeStore?: KnowledgeStore;
  totalFiles?: number;
  enableCheckpointTool?: boolean;
  enableIssueTools?: boolean;
  triageConfig?: TriageConfig;
}): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  const enableCommentTools = deps.enableCommentTools ?? true;
  if (enableCommentTools) {
    servers.github_comment = createCommentServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      deps.botHandles ?? [],
      deps.reviewOutputKey,
      deps.onPublish,
      deps.prNumber,
      deps.onPublishEvent,
    );
  }

  if (deps.prNumber !== undefined && deps.commentId !== undefined) {
    servers.reviewCommentThread = createReviewCommentThreadServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      deps.botHandles ?? [],
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
      deps.botHandles ?? [],
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

  const enableCheckpointTool = deps.enableCheckpointTool ?? false;
  if (
    enableCheckpointTool &&
    deps.knowledgeStore &&
    deps.prNumber !== undefined &&
    deps.reviewOutputKey
  ) {
    servers.review_checkpoint = createCheckpointServer(
      deps.knowledgeStore,
      deps.reviewOutputKey,
      `${deps.owner}/${deps.repo}`,
      deps.prNumber,
      deps.totalFiles ?? 0,
      deps.logger,
    );
  }

  // Issue triage tools -- opt-in via enableIssueTools + triageConfig
  const enableIssueTools = deps.enableIssueTools ?? false;
  if (enableIssueTools && deps.triageConfig) {
    const getTriageConfig = () => deps.triageConfig!;

    servers.github_issue_label = createIssueLabelServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      () => ({ enabled: getTriageConfig().enabled, label: getTriageConfig().label }),
    );

    servers.github_issue_comment = createIssueCommentServer(
      deps.getOctokit,
      deps.owner,
      deps.repo,
      () => ({ enabled: getTriageConfig().enabled, comment: getTriageConfig().comment }),
    );
  }

  return servers;
}

export function buildAllowedMcpTools(serverNames: string[]): string[] {
  return serverNames.map((name) => `mcp__${name}__*`);
}
