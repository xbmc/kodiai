import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { type createRetriever } from "../knowledge/retrieval.ts";
import { detectDependsBump, type DependsBumpInfo } from "../lib/depends-bump-detector.ts";
import {
  buildDependsInlineComments,
  buildDependsReviewComment,
  computeDependsVerdict,
  type DependsReviewData,
  type InlineComment,
} from "../lib/depends-review-builder.ts";
import {
  buildDependsReviewContext,
  type DependsReviewContextSummaryInput,
  type DependsReviewContextResult,
} from "../lib/depends-review-context.ts";
import { fetchAllPullRequestFiles, type PullRequestFileMetadata } from "../lib/github-pr-files.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { createTaskRouter } from "../llm/task-router.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import {
  publishDependsReviewOutput,
  type DependsReviewPublicationResult,
} from "./review-depends-publication.ts";

type FetchPullRequestFiles = typeof fetchAllPullRequestFiles;
type BuildDependsContext = typeof buildDependsReviewContext;
type PublishDependsOutput = typeof publishDependsReviewOutput;
type DependsRetriever = ReturnType<typeof createRetriever>;

export type ReviewDependsFlowResult = {
  action: "continue-standard-review" | "skip-standard-review";
  dependsBumpInfo: DependsBumpInfo | null;
};

async function summarizeDependsContextWithFallback(
  input: DependsReviewContextSummaryInput & {
    logger: Logger;
  },
): Promise<string | null> {
  const taskRouter = createTaskRouter({ models: {} });
  const resolved = taskRouter.resolve(TASK_TYPES.DEPENDS_CONTEXT_SUMMARY);
  const summaryResult = await generateWithFallback({
    taskType: TASK_TYPES.DEPENDS_CONTEXT_SUMMARY,
    resolved,
    system: "You summarize past PR discussion snippets into 1–2 plain sentences explaining why they are relevant context for a dependency bump review. No bullet points. No headers. Output only the summary sentences.",
    prompt: `Dependency being bumped: ${input.packageName}\n\nPast discussion snippets:\n${input.snippets}\n\nSummarize in 1–2 sentences why these past comments are relevant to this bump.`,
    logger: input.logger,
    repo: input.repo,
    deliveryId: input.deliveryId,
  });
  return summaryResult.text;
}

function normalizeDependsPrFiles(
  files: PullRequestFileMetadata[],
): Array<{ filename: string; status?: string; patch?: string }> {
  return files.map((file) => ({
    filename: file.filename,
    ...(file.status ? { status: file.status } : {}),
    ...(file.patch ? { patch: file.patch } : {}),
  }));
}

export async function resolveReviewDependsFlow(params: {
  prTitle: string;
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  workspaceDir: string | null;
  logger: Logger | Pick<Logger, "info" | "warn">;
  baseLog: Record<string, unknown>;
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  retriever?: DependsRetriever | null;
  detectBump?: (title: string) => DependsBumpInfo | null;
  fetchPullRequestFiles?: FetchPullRequestFiles;
  buildContext?: BuildDependsContext;
  buildComment?: (reviewData: DependsReviewData) => string;
  buildInlineComments?: (
    reviewData: DependsReviewData,
    prFiles: Array<{ filename: string; status?: string; patch?: string }>,
  ) => InlineComment[];
  publishOutput?: PublishDependsOutput;
}): Promise<ReviewDependsFlowResult> {
  const logger = params.logger;
  const detectBump = params.detectBump ?? detectDependsBump;
  const fetchPullRequestFiles = params.fetchPullRequestFiles ?? fetchAllPullRequestFiles;
  const buildContext = params.buildContext ?? buildDependsReviewContext;
  const buildComment = params.buildComment ?? buildDependsReviewComment;
  const buildInlineComments = params.buildInlineComments ?? buildDependsInlineComments;
  const publishOutput = params.publishOutput ?? publishDependsReviewOutput;

  let dependsBumpInfo: DependsBumpInfo | null = null;
  try {
    dependsBumpInfo = detectBump(params.prTitle);
    if (dependsBumpInfo) {
      logger.info({
        ...params.baseLog,
        gate: "depends-bump-detect",
        packages: dependsBumpInfo.packages.map((p) => p.name),
        platform: dependsBumpInfo.platform,
        isGroup: dependsBumpInfo.isGroup,
      }, "[depends] bump detected — entering deep-review pipeline");
    }
  } catch (err) {
    logger.warn(
      { ...params.baseLog, err, gate: "depends-bump-detect" },
      "[depends] detection failed (fail-open)",
    );
  }

  if (!dependsBumpInfo) {
    return {
      action: "continue-standard-review",
      dependsBumpInfo: null,
    };
  }

  try {
    const prFilesForDepends = normalizeDependsPrFiles(await fetchPullRequestFiles({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      pullNumber: params.prNumber,
    }));
    const dependsContext: DependsReviewContextResult = await buildContext({
      info: dependsBumpInfo,
      prFiles: prFilesForDepends,
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      workspaceDir: params.workspaceDir,
      logger: params.logger as Logger,
      baseLog: params.baseLog,
      deliveryId: String(params.prNumber),
      retriever: params.retriever,
      summarize: async (input) =>
        summarizeDependsContextWithFallback({
          ...input,
          logger: params.logger as Logger,
        }),
    });

    const verdict = computeDependsVerdict(dependsContext.reviewData);
    const commentBody = buildComment(dependsContext.reviewData);
    const inlineComments = buildInlineComments(dependsContext.reviewData, prFilesForDepends);

    params.setReviewWorkPhase("publish");
    const publicationResult: DependsReviewPublicationResult = await publishOutput({
      octokit: params.octokit,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      summaryBody: commentBody,
      inlineComments,
      botHandles: params.botHandles,
      canPublishVisibleOutput: params.canPublishVisibleOutput,
      setReviewWorkPhase: params.setReviewWorkPhase,
    });
    if (!publicationResult.ok) {
      throw publicationResult.err.error;
    }
    const publication = publicationResult.value;

    if (publication.publishedSummary || publication.publishedInlineComments) {
      logger.info({
        ...params.baseLog,
        gate: "depends-review-complete",
        verdict: verdict.level,
        packagesCount: dependsBumpInfo.packages.length,
        inlineCommentCount: inlineComments.length,
        hasRetrievalContext: Boolean(dependsContext.reviewData.retrievalContext),
      }, "[depends] deep review posted");
    }

    if (!dependsContext.hasSourceChanges) {
      logger.info(
        { ...params.baseLog, gate: "depends-review-skip-standard", verdict: verdict.level },
        "[depends] pure dep bump — skipping standard review",
      );
      return {
        action: "skip-standard-review",
        dependsBumpInfo,
      };
    }

    logger.info(
      {
        ...params.baseLog,
        gate: "depends-review-continue",
        verdict: verdict.level,
        hasSourceChanges: dependsContext.hasSourceChanges,
      },
      "[depends] source changes detected — continuing to standard review",
    );
    return {
      action: "continue-standard-review",
      dependsBumpInfo,
    };
  } catch (err) {
    logger.warn(
      { ...params.baseLog, err, gate: "depends-pipeline" },
      "[depends] pipeline failed (fail-open, falling through to standard review)",
    );
    return {
      action: "continue-standard-review",
      dependsBumpInfo: null,
    };
  }
}
