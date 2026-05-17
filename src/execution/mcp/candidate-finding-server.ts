import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Logger } from "pino";
import {
  createReviewCandidateFindingExecutionResult,
  MAX_REVIEW_CANDIDATE_BODY_LENGTH,
  MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH,
  MAX_REVIEW_CANDIDATE_FILE_PATH_LENGTH,
  MAX_REVIEW_CANDIDATE_TITLE_LENGTH,
  type ReviewCandidateFindingRecorder,
} from "../../review-orchestration/review-candidate-finding.ts";

const candidateFindingInputSchema = z.object({
  filePath: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REVIEW_CANDIDATE_FILE_PATH_LENGTH)
    .describe("Repository-relative path for the candidate finding. Do not use absolute paths or parent-directory traversal."),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional 1-based starting line for the candidate finding."),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional 1-based ending line. Must be greater than or equal to startLine when provided."),
  severity: z
    .enum(["critical", "major", "medium", "minor"])
    .optional()
    .describe("Candidate severity. Use critical only for severe correctness/security issues; default is medium."),
  category: z
    .enum(["security", "correctness", "performance", "style", "documentation"])
    .optional()
    .describe("Candidate category. Use correctness for behavior bugs and validation failures."),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REVIEW_CANDIDATE_TITLE_LENGTH)
    .describe("Short candidate title for reducer/coordinator approval before publication. This does not publish to GitHub."),
  body: z
    .string()
    .trim()
    .min(1)
    .max(MAX_REVIEW_CANDIDATE_BODY_LENGTH)
    .describe("Candidate explanation for reducer/coordinator approval before publication. This does not publish to GitHub and must not include secrets, prompts, or raw diffs."),
  evidence: z
    .string()
    .trim()
    .max(MAX_REVIEW_CANDIDATE_EVIDENCE_LENGTH)
    .optional()
    .describe("Optional concise evidence for the candidate. Do not include raw diffs, prompts, credentials, or large code blocks."),
});

type CandidateFindingInput = z.infer<typeof candidateFindingInputSchema>;

export function createCandidateFindingServer(deps: {
  recorder?: ReviewCandidateFindingRecorder;
  repo: string;
  pullNumber: number;
  reviewOutputKey?: string;
  deliveryId?: string;
  logger?: Logger;
}) {
  return createSdkMcpServer({
    name: "review_candidate_finding",
    version: "0.1.0",
    tools: [
      tool(
        "record_candidate_finding",
        [
          "Record one review candidate finding for the preferred pre-publication path in this review run.",
          "Candidate findings feed reducer/coordinator approval before publication, but this MCP tool does not publish to GitHub itself.",
          "Use direct GitHub publication only as audited fallback when candidate capture, approval, or publication is unavailable, rejected, or degraded; if fallback is needed, continue safely and explain the fallback reason in final review text.",
        ].join(" "),
        candidateFindingInputSchema.shape,
        async (input: CandidateFindingInput) => {
          const parsed = candidateFindingInputSchema.safeParse(input);
          if (!parsed.success) {
            deps.logger?.warn(
              logContext(deps, { input: 1, recorded: 0, rejected: 1, errors: 0, reason: "schema-validation-failed" }),
              "Rejected candidate finding MCP input",
            );
            return textResponse({
              recorded: false,
              mode: "shadow",
              reason: "candidate-finding-rejected",
            });
          }

          const normalized = createReviewCandidateFindingExecutionResult({
            repo: deps.repo,
            pullNumber: deps.pullNumber,
            reviewOutputKey: deps.reviewOutputKey ?? "",
            deliveryId: deps.deliveryId,
            logger: deps.logger,
            candidates: [parsed.data],
          });

          if (normalized.status === "unavailable") {
            deps.logger?.warn(
              logContext(deps, { ...normalized.counts, reason: normalized.reason ?? "missing-correlation" }),
              "Candidate finding MCP capture unavailable",
            );
            return textResponse({
              recorded: false,
              mode: "unavailable",
              reason: "missing-correlation",
            });
          }

          if (normalized.status === "degraded" || normalized.findings.length !== 1) {
            const rejection = normalized.rejections[0];
            if (rejection && deps.recorder?.recordCandidateFindingRejection) {
              try {
                await deps.recorder.recordCandidateFindingRejection(rejection, {
                  repo: normalized.repo,
                  pullNumber: normalized.pullNumber,
                  reviewOutputKey: normalized.reviewOutputKey,
                  ...(normalized.deliveryId ? { deliveryId: normalized.deliveryId } : {}),
                });
              } catch (err) {
                deps.logger?.warn(
                  { ...logContext(deps, { input: 1, recorded: 0, rejected: 1, errors: 1, reason: "rejection-record-failed" }), err },
                  "Candidate finding rejection recorder failed",
                );
              }
            }
            deps.logger?.warn(
              logContext(deps, { ...normalized.counts, reason: normalized.reason ?? normalized.rejections[0]?.reason ?? "candidate-rejected" }),
              "Rejected candidate finding after contract normalization",
            );
            return textResponse({
              recorded: false,
              mode: "shadow",
              reason: "candidate-finding-rejected",
            });
          }

          if (!deps.recorder) {
            deps.logger?.warn(
              logContext(deps, { ...normalized.counts, recorded: 0, errors: 1, reason: "recorder-unavailable" }),
              "Candidate finding recorder unavailable",
            );
            return textResponse({
              recorded: false,
              mode: "degraded",
              reason: "candidate-finding-recorder-unavailable",
            });
          }

          try {
            await deps.recorder.recordCandidateFinding(normalized.findings[0]!, {
              repo: normalized.repo,
              pullNumber: normalized.pullNumber,
              reviewOutputKey: normalized.reviewOutputKey,
              ...(normalized.deliveryId ? { deliveryId: normalized.deliveryId } : {}),
            });

            deps.logger?.debug?.(
              logContext(deps, { input: 1, recorded: 1, rejected: 0, errors: 0 }),
              "Recorded candidate finding",
            );

            return textResponse({ recorded: true, mode: "shadow" });
          } catch (err) {
            try {
              await deps.recorder.recordCandidateFindingError?.("record-failed", {
                repo: normalized.repo,
                pullNumber: normalized.pullNumber,
                reviewOutputKey: normalized.reviewOutputKey,
                ...(normalized.deliveryId ? { deliveryId: normalized.deliveryId } : {}),
              });
            } catch (errorRecordErr) {
              deps.logger?.warn(
                { ...logContext(deps, { input: 1, recorded: 0, rejected: 0, errors: 1, reason: "error-record-failed" }), err: errorRecordErr },
                "Candidate finding error recorder failed",
              );
            }
            deps.logger?.warn(
              { ...logContext(deps, { input: 1, recorded: 0, rejected: 0, errors: 1, reason: "record-failed" }), err },
              "Candidate finding recorder failed",
            );
            return textResponse({
              recorded: false,
              mode: "degraded",
              reason: "candidate-finding-record-failed",
            });
          }
        },
      ),
    ],
  });
}

function textResponse(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
  };
}

function logContext(
  deps: {
    repo: string;
    pullNumber: number;
    reviewOutputKey?: string;
    deliveryId?: string;
  },
  counts: {
    input: number;
    recorded: number;
    rejected: number;
    errors: number;
    reason?: string;
  },
) {
  return {
    event: "review-candidate-finding-mcp",
    repo: deps.repo,
    prNumber: deps.pullNumber,
    reviewOutputKey: deps.reviewOutputKey,
    deliveryId: deps.deliveryId,
    counts: {
      input: counts.input,
      recorded: counts.recorded,
      rejected: counts.rejected,
      errors: counts.errors,
    },
    ...(counts.reason ? { reason: counts.reason } : {}),
  };
}
