import { createRequire } from "node:module";
import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { McpServerConfig, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { CommentPublicationState } from "./comment-server.ts";
import type { KnowledgeStore } from "../../knowledge/types.ts";
import type { ExecutionPublishEvent } from "../types.ts";
import type { PrDiffCommentabilityIndex } from "../formatter-suggestions.ts";
import { createReviewOutputPublicationGate, type CandidateVerificationContext } from "./review-output-publication-gate.ts";
import type { ReviewCandidateFindingRecorder } from "../../review-orchestration/review-candidate-finding.ts";
import type { CandidateVerificationPublicationEvidenceSink } from "../../specialists/candidate-verification-publication-evidence.ts";

export type {
  InlineCommentLocation,
  InlineReviewPublicationReason,
  InlineReviewPublicationResult,
  InlineReviewPublicationStatus,
  InlineReviewPublisherOptions,
  PublishInlineReviewCommentInput,
  PublishInlineReviewCommentOptions,
} from "./inline-review-publisher.ts";

type CommentServerModule = typeof import("./comment-server.ts");
type InlineReviewServerModule = typeof import("./inline-review-server.ts");
type CiStatusServerModule = typeof import("./ci-status-server.ts");
type ReviewCommentThreadServerModule = typeof import("./review-comment-thread-server.ts");
type CheckpointServerModule = typeof import("./checkpoint-server.ts");
type IssueLabelServerModule = typeof import("./issue-label-server.ts");
type IssueCommentServerModule = typeof import("./issue-comment-server.ts");
type CandidateFindingServerModule = typeof import("./candidate-finding-server.ts");

type McpServerModuleLoaders = {
  comment: () => Pick<CommentServerModule, "createCommentServer">;
  inlineReview: () => Pick<InlineReviewServerModule, "createInlineReviewServer">;
  ciStatus: () => Pick<CiStatusServerModule, "createCIStatusServer">;
  reviewCommentThread: () => Pick<ReviewCommentThreadServerModule, "createReviewCommentThreadServer">;
  checkpoint: () => Pick<CheckpointServerModule, "createCheckpointServer">;
  issueLabel: () => Pick<IssueLabelServerModule, "createIssueLabelServer">;
  issueComment: () => Pick<IssueCommentServerModule, "createIssueCommentServer">;
  candidateFinding: () => Pick<CandidateFindingServerModule, "createCandidateFindingServer">;
};

const requireModule = createRequire(import.meta.url);

const defaultMcpServerModuleLoaders: McpServerModuleLoaders = {
  comment: () => requireModule("./comment-server.ts") as CommentServerModule,
  inlineReview: () => requireModule("./inline-review-server.ts") as InlineReviewServerModule,
  ciStatus: () => requireModule("./ci-status-server.ts") as CiStatusServerModule,
  reviewCommentThread: () => requireModule("./review-comment-thread-server.ts") as ReviewCommentThreadServerModule,
  checkpoint: () => requireModule("./checkpoint-server.ts") as CheckpointServerModule,
  issueLabel: () => requireModule("./issue-label-server.ts") as IssueLabelServerModule,
  issueComment: () => requireModule("./issue-comment-server.ts") as IssueCommentServerModule,
  candidateFinding: () => requireModule("./candidate-finding-server.ts") as CandidateFindingServerModule,
};

export interface TriageConfig {
  enabled: boolean;
  label: { enabled: boolean };
  comment: { enabled: boolean };
}

export type IssueToolsConfig = {
  issueNumber: number;
  triageConfig: TriageConfig;
};

type McpBuilderDeps = {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber?: number;
  issueNumber?: number;
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
  prDiffCommentabilityIndex?: PrDiffCommentabilityIndex;
  issueTools?: IssueToolsConfig;
  /**
   * Compatibility guard for older call sites. New code should pass issueTools
   * so the issue number and policy travel as a single invariant.
   */
  enableIssueTools?: boolean;
  triageConfig?: TriageConfig;
  enableCandidateFindingTool?: boolean;
  candidateFindingRecorder?: ReviewCandidateFindingRecorder;
  candidateVerificationContext?: CandidateVerificationContext;
  candidateVerificationPublicationEvidenceSink?: CandidateVerificationPublicationEvidenceSink;
};

function resolveIssueTools(deps: McpBuilderDeps): IssueToolsConfig | undefined {
  if (deps.issueTools) {
    return deps.issueTools;
  }
  if (deps.enableIssueTools !== true) {
    return undefined;
  }
  if (deps.issueNumber === undefined) {
    throw new Error("Issue MCP tools require issueNumber");
  }
  if (!deps.triageConfig) {
    throw new Error("Issue MCP tools require triageConfig");
  }
  return {
    issueNumber: deps.issueNumber,
    triageConfig: deps.triageConfig,
  };
}

function buildIssueToolServerCreators(deps: {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  issueNumber: number;
  botHandles?: string[];
  getTriageConfig: () => TriageConfig;
  loaders: McpServerModuleLoaders;
}) {
  return {
    github_issue_label: () =>
      deps.loaders.issueLabel().createIssueLabelServer({
        getOctokit: deps.getOctokit,
        owner: deps.owner,
        repo: deps.repo,
        getTriageConfig: () => ({
          enabled: deps.getTriageConfig().enabled,
          label: deps.getTriageConfig().label,
        }),
        issueNumber: deps.issueNumber,
      }),
    github_issue_comment: () =>
      deps.loaders.issueComment().createIssueCommentServer({
        getOctokit: deps.getOctokit,
        owner: deps.owner,
        repo: deps.repo,
        getTriageConfig: () => ({
          enabled: deps.getTriageConfig().enabled,
          comment: deps.getTriageConfig().comment,
        }),
        botHandles: deps.botHandles ?? [],
        issueNumber: deps.issueNumber,
      }),
  };
}

export function buildMcpServers(deps: McpBuilderDeps): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(buildMcpServerFactoriesWithLoaders(deps, defaultMcpServerModuleLoaders))
      .map(([name, createServer]) => [name, createServer()]),
  );
}

export const MCP_TOOL_NAMES_BY_SERVER: Record<string, string[]> = {
  github_comment: [
    "create_comment",
    "update_comment",
  ],
  reviewCommentThread: [
    "reply_to_pr_review_comment",
  ],
  github_inline_comment: [
    "create_inline_comment",
  ],
  github_ci: [
    "get_ci_status",
    "get_workflow_run_details",
  ],
  review_checkpoint: [
    "save_review_checkpoint",
  ],
  github_issue_label: [
    "add_labels",
  ],
  github_issue_comment: [
    "create_comment",
  ],
  review_candidate_finding: [
    "record_candidate_finding",
  ],
};

export function buildAllowedMcpTools(serverNames: string[]): string[] {
  return serverNames.flatMap((serverName) => {
    const toolNames = MCP_TOOL_NAMES_BY_SERVER[serverName];
    if (!toolNames) {
      return [`mcp__${serverName}__*`];
    }
    return toolNames.map((toolName) => `mcp__${serverName}__${toolName}`);
  });
}

/**
 * Like buildMcpServers, but returns factory functions instead of instances.
 *
 * Each factory re-calls the server creator on every invocation, producing a
 * fresh McpSdkServerConfigWithInstance with a new McpServer instance.
 *
 * Required for the MCP HTTP registry: WebStandardStreamableHTTPServerTransport
 * is stateless and creates a new transport per HTTP request, but McpServer
 * instances can only be connected to one transport at a time. Calling
 * server.connect(transport) on an already-connected server throws:
 *   "Already connected to a transport. Call close() before connecting..."
 *
 * By calling the creator inside the factory, each HTTP request gets a fresh
 * McpServer that has never been connected.
 */
export function buildMcpServerFactories(deps: McpBuilderDeps): Record<string, () => McpSdkServerConfigWithInstance> {
  return buildMcpServerFactoriesWithLoaders(deps, defaultMcpServerModuleLoaders);
}

export function buildMcpServerFactoriesWithLoaders(
  deps: McpBuilderDeps,
  loaders: McpServerModuleLoaders,
): Record<string, () => McpSdkServerConfigWithInstance> {
  const enableCommentTools = deps.enableCommentTools ?? true;
  const enableInlineTools = deps.enableInlineTools ?? true;
  const enableCheckpointTool = deps.enableCheckpointTool ?? false;
  const issueTools = resolveIssueTools(deps);
  const enableCandidateFindingTool = deps.enableCandidateFindingTool ?? false;
  const reviewOutputPublicationGate =
    deps.reviewOutputKey && deps.prNumber !== undefined
      ? createReviewOutputPublicationGate({
          owner: deps.owner,
          repo: deps.repo,
          prNumber: deps.prNumber,
          reviewOutputKey: deps.reviewOutputKey,
          candidateVerificationContext: deps.candidateVerificationContext,
          candidateVerificationPublicationEvidenceSink: deps.candidateVerificationPublicationEvidenceSink,
        })
      : undefined;

  const factories: Record<string, () => McpSdkServerConfigWithInstance> = {};
  const commentPublicationState: CommentPublicationState = { createCommentPublished: false };
  const candidateVerificationRequired = deps.candidateVerificationContext !== undefined;

  if (enableCommentTools) {
    factories.github_comment = () =>
      loaders.comment().createCommentServer(
        deps.getOctokit,
        deps.owner,
        deps.repo,
        deps.botHandles ?? [],
        deps.reviewOutputKey,
        deps.onPublish,
        deps.prNumber,
        deps.onPublishEvent,
        deps.logger,
        reviewOutputPublicationGate,
        commentPublicationState,
        candidateVerificationRequired,
      ) as McpSdkServerConfigWithInstance;
  }

  if (deps.prNumber !== undefined && deps.commentId !== undefined) {
    factories.reviewCommentThread = () =>
      loaders.reviewCommentThread().createReviewCommentThreadServer(
        deps.getOctokit,
        deps.owner,
        deps.repo,
        deps.botHandles ?? [],
        deps.onPublish,
      ) as McpSdkServerConfigWithInstance;
  }

  if (enableInlineTools && deps.prNumber !== undefined) {
    factories.github_inline_comment = () =>
      loaders.inlineReview().createInlineReviewServer({
        getOctokit: deps.getOctokit,
        owner: deps.owner,
        repo: deps.repo,
        prNumber: deps.prNumber!,
        botHandles: deps.botHandles ?? [],
        reviewOutputKey: deps.reviewOutputKey,
        deliveryId: deps.deliveryId,
        logger: deps.logger,
        onPublish: deps.onPublish,
        publicationGate: reviewOutputPublicationGate,
        prDiffCommentabilityIndex: deps.prDiffCommentabilityIndex,
      }) as McpSdkServerConfigWithInstance;

    factories.github_ci = () =>
      loaders.ciStatus().createCIStatusServer(
        deps.getOctokit,
        deps.owner,
        deps.repo,
        deps.prNumber!,
      ) as McpSdkServerConfigWithInstance;
  }

  if (
    enableCheckpointTool &&
    deps.knowledgeStore &&
    deps.prNumber !== undefined &&
    deps.reviewOutputKey
  ) {
    factories.review_checkpoint = () =>
      loaders.checkpoint().createCheckpointServer(
        deps.knowledgeStore!,
        deps.reviewOutputKey!,
        `${deps.owner}/${deps.repo}`,
        deps.prNumber!,
        deps.totalFiles ?? 0,
        deps.logger,
      ) as McpSdkServerConfigWithInstance;
  }

  if (issueTools) {
    const issueToolCreators = buildIssueToolServerCreators({
      getOctokit: deps.getOctokit,
      owner: deps.owner,
      repo: deps.repo,
      issueNumber: issueTools.issueNumber,
      botHandles: deps.botHandles,
      getTriageConfig: () => issueTools.triageConfig,
      loaders,
    });

    factories.github_issue_label = () =>
      issueToolCreators.github_issue_label() as McpSdkServerConfigWithInstance;

    factories.github_issue_comment = () =>
      issueToolCreators.github_issue_comment() as McpSdkServerConfigWithInstance;
  }

  if (
    enableCandidateFindingTool &&
    deps.prNumber !== undefined &&
    deps.reviewOutputKey
  ) {
    factories.review_candidate_finding = () =>
      loaders.candidateFinding().createCandidateFindingServer({
        recorder: deps.candidateFindingRecorder,
        repo: `${deps.owner}/${deps.repo}`,
        pullNumber: deps.prNumber!,
        reviewOutputKey: deps.reviewOutputKey!,
        deliveryId: deps.deliveryId,
        logger: deps.logger,
      }) as McpSdkServerConfigWithInstance;
  }

  return factories;
}
