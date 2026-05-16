import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { buildReviewOutputMarker } from "../../handlers/review-idempotency.ts";
import { sanitizeOutgoingMentions, scanOutgoingForSecrets } from "../../lib/sanitizer.ts";
import { buildPrDiffCommentabilityIndex, type PrDiffCommentabilityIndex } from "../formatter-suggestions.ts";
import {
  createReviewOutputPublicationGate,
  type ReviewOutputPublicationGate,
} from "./review-output-publication-gate.ts";

export const REVIEW_OUTPUT_MARKER_PREFIX = "kodiai:review-output-key";

export type InlineCommentLocation = {
  path: string;
  line?: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
};

export type InlineReviewPublicationStatus = "published" | "skipped" | "blocked" | "failed";

export type InlineReviewPublicationReason =
  | "already-published"
  | "m070-candidate-verification-denied"
  | "secret-detected"
  | "validation-error"
  | "line-not-commentable-in-pr-diff"
  | "github-error"
  | "publication-gate-malformed"
  | "publication-failed";

export type InlineReviewPublicationToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type InlineReviewPublicationResult = InlineReviewPublicationToolResult & {
  status: InlineReviewPublicationStatus;
  reason?: InlineReviewPublicationReason;
  commentId?: number;
};

export type InlineReviewPublisherOptions = {
  getOctokit: () => Promise<Octokit>;
  owner: string;
  repo: string;
  prNumber: number;
  botHandles: string[];
  reviewOutputKey?: string;
  deliveryId?: string;
  logger?: Logger;
  onPublish?: () => void;
  publicationGate?: ReviewOutputPublicationGate;
  prDiffForCommentValidation?: string;
};

export type PublishInlineReviewCommentInput = {
  location: InlineCommentLocation;
  body: string;
};

export type PublishInlineReviewCommentOptions = InlineReviewPublisherOptions & PublishInlineReviewCommentInput;

type GitHubApiErrorDetails = {
  status?: number;
  requestId?: string;
  responseMessage?: string;
  responseErrors?: unknown;
};

type CandidateAwarePublicationGate = ReviewOutputPublicationGate & {
  evaluateInlineCandidatePublication?: (candidate: Record<string, unknown>) => { allowed: boolean; status?: unknown; candidateRef?: unknown; counts?: unknown; reasonCategories?: readonly unknown[]; hasDeliveryId?: unknown; hasReviewOutputKey?: unknown; hasCorrelationKey?: unknown; redactionFlags?: unknown } | null;
  recordInlinePublicationSkipped?: (reason: string) => void;
  recordInlinePublicationFailed?: (reason: string) => void;
  recordInlinePublicationPublished?: (details?: { commentId?: number; path?: string }) => void;
};

function formatInlineCommentLocation(location: InlineCommentLocation): string {
  const side = location.side ?? "RIGHT";
  if (location.startLine !== undefined) {
    return `path "${location.path}" at ${side} lines ${location.startLine}-${location.line ?? "?"}`;
  }
  return `path "${location.path}" at ${side} line ${location.line ?? "?"}`;
}

function extractGitHubApiErrorDetails(error: unknown): GitHubApiErrorDetails {
  const candidate = error as {
    status?: unknown;
    response?: {
      data?: { message?: unknown; errors?: unknown };
      headers?: Record<string, unknown>;
    };
  };

  const headers = candidate.response?.headers;
  const requestId = typeof headers?.["x-github-request-id"] === "string"
    ? headers["x-github-request-id"]
    : undefined;

  return {
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    requestId,
    responseMessage: typeof candidate.response?.data?.message === "string"
      ? candidate.response.data.message
      : undefined,
    responseErrors: candidate.response?.data?.errors,
  };
}

function formatGitHubValidationDetails(details: GitHubApiErrorDetails): string {
  const parts: string[] = [];
  if (details.status !== undefined) parts.push(`status ${details.status}`);
  if (details.responseMessage) parts.push(details.responseMessage);
  if (details.responseErrors !== undefined) {
    parts.push(`errors: ${JSON.stringify(details.responseErrors)}`);
  }
  return parts.length > 0 ? ` GitHub response: ${parts.join("; ")}.` : "";
}

function validateInlineCommentLocation(location: InlineCommentLocation): void {
  const { line, startLine } = location;
  if (line === undefined && startLine === undefined) {
    throw new Error(
      "Either 'line' for single-line comments or 'startLine' (with 'line') for multi-line comments must be provided",
    );
  }
  if (startLine !== undefined && line === undefined) {
    throw new Error(
      "Multi-line comments require both 'startLine' and 'line' so GitHub can identify the diff range",
    );
  }
  if (line !== undefined && line < 1) {
    throw new Error("Inline comment 'line' must be a 1-based GitHub diff line number");
  }
  if (startLine !== undefined && startLine < 1) {
    throw new Error("Inline comment 'startLine' must be a 1-based GitHub diff line number");
  }
  if (startLine !== undefined && line !== undefined && startLine > line) {
    throw new Error("Inline comment 'startLine' must be less than or equal to 'line'");
  }
}

function assertRightSideCommentability(
  rightCommentableLines: PrDiffCommentabilityIndex | undefined,
  location: InlineCommentLocation,
): void {
  if (!rightCommentableLines || (location.side ?? "RIGHT") !== "RIGHT") {
    return;
  }

  const commentableLinesForPath = rightCommentableLines.get(location.path);
  const targetLines = location.startLine !== undefined && location.line !== undefined
    ? Array.from({ length: location.line - location.startLine + 1 }, (_, index) => location.startLine! + index)
    : [location.line].filter((value): value is number => value !== undefined);
  const missingLine = targetLines.find((targetLine) => !commentableLinesForPath?.has(targetLine));
  if (missingLine !== undefined) {
    throw new Error(`RIGHT line ${missingLine} is not commentable in the PR diff for ${location.path}`);
  }
}

function classifyFailure(errorMessage: string): InlineReviewPublicationReason {
  if (errorMessage.includes("is not commentable in the PR diff")) {
    return "line-not-commentable-in-pr-diff";
  }
  if (
    errorMessage.includes("Either 'line'")
    || errorMessage.includes("Multi-line comments require")
    || errorMessage.includes("must be a 1-based")
    || errorMessage.includes("must be less than or equal")
  ) {
    return "validation-error";
  }
  if (errorMessage.includes("Publication gate returned malformed status")) {
    return "publication-gate-malformed";
  }
  if (errorMessage.includes("Validation Failed") || errorMessage.includes("Not Found")) {
    return "github-error";
  }
  return "publication-failed";
}

function makeErrorResult(params: {
  error: unknown;
  location: InlineCommentLocation;
  owner: string;
  repo: string;
  prNumber: number;
  deliveryId?: string;
  reviewOutputKey?: string;
  logger?: Logger;
}): InlineReviewPublicationResult {
  const errorMessage = params.error instanceof Error ? params.error.message : String(params.error);
  const githubErrorDetails = extractGitHubApiErrorDetails(params.error);
  const reason = classifyFailure(errorMessage);
  const locationText = formatInlineCommentLocation(params.location);

  let helpMessage = "";
  if (errorMessage.includes("Validation Failed")) {
    helpMessage = " This usually means the line number doesn't exist in the diff or the file path is incorrect.";
  } else if (errorMessage.includes("Not Found")) {
    helpMessage = " This usually means the PR number, repository, or file path is incorrect.";
  }

  params.logger?.warn(
    {
      deliveryId: params.deliveryId,
      reviewOutputKey: params.reviewOutputKey,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      tool: "create_inline_comment",
      path: params.location.path,
      line: params.location.line,
      startLine: params.location.startLine,
      side: params.location.side || "RIGHT",
      githubStatus: githubErrorDetails.status,
      githubRequestId: githubErrorDetails.requestId,
      githubResponseMessage: githubErrorDetails.responseMessage,
      githubResponseErrors: githubErrorDetails.responseErrors,
      reason: reason === "line-not-commentable-in-pr-diff" ? reason : undefined,
    },
    "Inline review comment publication failed",
  );

  return {
    status: "failed",
    reason,
    content: [
      {
        type: "text",
        text: `Error creating inline comment for ${locationText}: ${errorMessage}.${formatGitHubValidationDetails(githubErrorDetails)}${helpMessage}`,
      },
    ],
    isError: true,
  };
}

export function createInlineReviewPublisher(options: InlineReviewPublisherOptions) {
  const rightCommentableLines = options.prDiffForCommentValidation
    ? buildPrDiffCommentabilityIndex(options.prDiffForCommentValidation)
    : undefined;
  const reviewOutputPublicationGate = options.publicationGate
    ?? (
      options.reviewOutputKey
        ? createReviewOutputPublicationGate({
          owner: options.owner,
          repo: options.repo,
          prNumber: options.prNumber,
          reviewOutputKey: options.reviewOutputKey,
        })
        : undefined
    );

  async function resolveOutputPublicationState(octokit: Octokit): Promise<"allowed" | "already-published"> {
    if (!options.reviewOutputKey || !reviewOutputPublicationGate) {
      return "allowed";
    }

    const idempotencyCheck = await reviewOutputPublicationGate.resolve(octokit);
    if (typeof idempotencyCheck.shouldPublish !== "boolean") {
      throw new Error("Publication gate returned malformed status: missing shouldPublish");
    }

    if (!idempotencyCheck.shouldPublish) {
      options.logger?.info(
        {
          deliveryId: options.deliveryId,
          reviewOutputKey: options.reviewOutputKey,
          idempotencyOutcome: "already-published-skip",
          existingLocation: idempotencyCheck.existingLocation,
        },
        "Skipping inline review publication because output key already exists",
      );
      return "already-published";
    }

    return "allowed";
  }

  return {
    async publish(input: PublishInlineReviewCommentInput): Promise<InlineReviewPublicationResult> {
      try {
        validateInlineCommentLocation(input.location);
        assertRightSideCommentability(rightCommentableLines, input.location);

        const octokit = await options.getOctokit();
        const candidateGate = reviewOutputPublicationGate as CandidateAwarePublicationGate | undefined;
        const candidatePolicyResult = candidateGate?.evaluateInlineCandidatePublication?.({
          path: input.location.path,
          side: input.location.side || "RIGHT",
          line: input.location.line,
          startLine: input.location.startLine,
          body: input.body,
          reviewOutputKey: options.reviewOutputKey,
          deliveryId: options.deliveryId,
        });
        if (candidatePolicyResult && candidatePolicyResult.allowed !== true) {
          const reason = "m070-candidate-verification-denied";
          candidateGate?.recordInlinePublicationSkipped?.(reason);
          options.logger?.warn(
            {
              deliveryId: options.deliveryId,
              reviewOutputKey: options.reviewOutputKey,
              owner: options.owner,
              repo: options.repo,
              prNumber: options.prNumber,
              tool: "create_inline_comment",
              gate: "m070-candidate-publication-policy",
              path: input.location.path,
              line: input.location.line,
              startLine: input.location.startLine,
              side: input.location.side || "RIGHT",
              reason,
              gateResult: candidatePolicyResult.status,
              candidateRef: candidatePolicyResult.candidateRef,
              counts: candidatePolicyResult.counts,
              reasonCategories: candidatePolicyResult.reasonCategories,
              hasDeliveryId: candidatePolicyResult.hasDeliveryId,
              hasReviewOutputKey: candidatePolicyResult.hasReviewOutputKey,
              hasCorrelationKey: candidatePolicyResult.hasCorrelationKey,
              redactionFlags: candidatePolicyResult.redactionFlags,
            },
            "Inline review comment publication blocked by candidate verification policy",
          );
          return {
            status: "blocked",
            reason,
            content: [{ type: "text", text: JSON.stringify({ success: false, blocked: true, reason }) }],
            isError: true,
          };
        }

        const publicationState = await resolveOutputPublicationState(octokit);
        if (publicationState === "already-published") {
          candidateGate?.recordInlinePublicationSkipped?.("already-published");
          return {
            status: "skipped",
            reason: "already-published",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  skipped: true,
                  reason: "already-published",
                  review_output_key: options.reviewOutputKey,
                  marker_prefix: REVIEW_OUTPUT_MARKER_PREFIX,
                }),
              },
            ],
          };
        }

        const pr = await octokit.rest.pulls.get({
          owner: options.owner,
          repo: options.repo,
          pull_number: options.prNumber,
        });

        const sanitizedBody = sanitizeOutgoingMentions(input.body, options.botHandles);
        const scanResult = scanOutgoingForSecrets(sanitizedBody);
        if (scanResult.blocked) {
          candidateGate?.recordInlinePublicationSkipped?.("secret-detected");
          options.logger?.warn(
            { matchedPattern: scanResult.matchedPattern, tool: "create_inline_comment" },
            "Outgoing secret scan blocked publish",
          );
          return {
            status: "blocked",
            reason: "secret-detected",
            content: [{ type: "text", text: "[SECURITY: response blocked — contained credential pattern]" }],
            isError: true,
          };
        }

        const body = options.reviewOutputKey
          ? `${sanitizedBody}\n\n${buildReviewOutputMarker(options.reviewOutputKey)}`
          : sanitizedBody;
        const params: Record<string, unknown> = {
          owner: options.owner,
          repo: options.repo,
          pull_number: options.prNumber,
          body,
          path: input.location.path,
          side: input.location.side || "RIGHT",
          commit_id: pr.data.head.sha,
        };

        if (input.location.startLine) {
          params.start_line = input.location.startLine;
          params.start_side = input.location.side || "RIGHT";
          params.line = input.location.line;
        } else {
          params.line = input.location.line;
        }

        const result = await octokit.rest.pulls.createReviewComment(
          params as Parameters<typeof octokit.rest.pulls.createReviewComment>[0],
        );

        options.onPublish?.();
        candidateGate?.recordInlinePublicationPublished?.({
          commentId: result.data.id,
          path: result.data.path,
        });

        if (options.reviewOutputKey) {
          options.logger?.info(
            {
              deliveryId: options.deliveryId,
              reviewOutputKey: options.reviewOutputKey,
              idempotencyOutcome: "published",
              reviewCommentId: result.data.id,
              path: result.data.path,
            },
            "Published inline review output with idempotency marker",
          );
        }

        return {
          status: "published",
          commentId: result.data.id,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                comment_id: result.data.id,
                html_url: result.data.html_url,
                path: result.data.path,
                line: result.data.line || result.data.original_line,
              }),
            },
          ],
        };
      } catch (error) {
        const candidateGate = reviewOutputPublicationGate as CandidateAwarePublicationGate | undefined;
        candidateGate?.recordInlinePublicationFailed?.(classifyFailure(error instanceof Error ? error.message : String(error)));
        return makeErrorResult({
          error,
          location: input.location,
          owner: options.owner,
          repo: options.repo,
          prNumber: options.prNumber,
          deliveryId: options.deliveryId,
          reviewOutputKey: options.reviewOutputKey,
          logger: options.logger,
        });
      }
    },
  };
}

export async function publishInlineReviewComment(
  options: PublishInlineReviewCommentOptions,
): Promise<InlineReviewPublicationResult> {
  const publisher = createInlineReviewPublisher(options);
  return publisher.publish({ location: options.location, body: options.body });
}
