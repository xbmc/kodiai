import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import { buildMentionPromptDetails } from "../execution/mention-prompt.ts";
import {
  buildPromptSectionRecord,
  type PromptBuildResult,
} from "../execution/prompt-section-metrics.ts";
import type { PrDiffCommentabilityIndex } from "../execution/formatter-suggestions.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import type { ReviewTaskRouting } from "../lib/review-routing.ts";
import type { ReviewCommentMatch } from "../knowledge/review-comment-retrieval.ts";
import type { UnifiedRetrievalChunk } from "../knowledge/cross-corpus-rrf.ts";
import type { WikiKnowledgeMatch } from "../knowledge/wiki-retrieval.ts";
import type { PromptSectionRecord } from "../telemetry/types.ts";
import {
  buildMentionExplicitReviewPrompt,
  type MentionExplicitReviewPromptResult,
} from "./mention-explicit-review-prompt.ts";
import type { MentionRetrievalContext } from "./mention-retrieval-context.ts";
import type { MentionPrDiffContext } from "./mention-pr-diff-context.ts";
import type { MentionEvent } from "./mention-types.ts";

type BuildExplicitReviewPrompt = (params: Parameters<typeof buildMentionExplicitReviewPrompt>[0]) => Promise<MentionExplicitReviewPromptResult>;
type BuildMentionPrompt = typeof buildMentionPromptDetails;
type ExplicitReviewPromptParams = Parameters<typeof buildMentionExplicitReviewPrompt>[0];
type MentionPromptParams = Parameters<typeof buildMentionPromptDetails>[0];

export type MentionPromptRuntimeContext = {
  prompt: string;
  promptSections: PromptSectionRecord[];
  explicitReviewPromptFileCount: number | undefined;
  explicitReviewDynamicTimeoutSeconds: number | undefined;
  explicitReviewMaxTurnsOverride: number | undefined;
  explicitReviewPrDiffCommentabilityIndex: PrDiffCommentabilityIndex | undefined;
  explicitReviewHeadSha: string | undefined;
  explicitReviewBaseSha: string | undefined;
  explicitReviewRouting: ReviewTaskRouting;
};

export async function resolveMentionPromptRuntimeContext(params: {
  explicitReviewRequest: boolean;
  mention: MentionEvent;
  config: Pick<RepoConfig, "maxTurns" | "timeoutSeconds" | "timeout" | "largePR" | "review" | "mention">;
  deliveryId: string;
  workspaceDir: string;
  workspaceToken: string | undefined;
  retrievalContext: MentionRetrievalContext | undefined;
  reviewPrecedents: ReviewCommentMatch[];
  wikiKnowledge: WikiKnowledgeMatch[];
  unifiedResults: UnifiedRetrievalChunk[];
  contextWindow: string | undefined;
  logger: Logger;
  getPullRequest: ExplicitReviewPromptParams["getPullRequest"];
  fetchPullRequestFiles: NonNullable<ExplicitReviewPromptParams["fetchPullRequestFiles"]>;
  mentionContext: string;
  mentionContextSectionMetrics: PromptBuildResult["sections"];
  userQuestion: string;
  findingContext: MentionPromptParams["findingContext"];
  planOnlyInstructions: string | undefined;
  writeInstructions: string | undefined;
  outputLanguage: string | undefined;
  triageContext: string;
  prDiffContext: MentionPrDiffContext | undefined;
  buildExplicitReviewPrompt?: BuildExplicitReviewPrompt;
  buildMentionPrompt?: BuildMentionPrompt;
}): Promise<MentionPromptRuntimeContext> {
  const {
    explicitReviewRequest,
    mention,
    config,
    deliveryId,
    workspaceDir,
    workspaceToken,
    retrievalContext,
    reviewPrecedents,
    wikiKnowledge,
    unifiedResults,
    contextWindow,
    logger,
    getPullRequest,
    fetchPullRequestFiles,
    mentionContext,
    mentionContextSectionMetrics,
    userQuestion,
    findingContext,
    planOnlyInstructions,
    writeInstructions,
    outputLanguage,
    triageContext,
    prDiffContext,
    buildExplicitReviewPrompt = buildMentionExplicitReviewPrompt,
    buildMentionPrompt = buildMentionPromptDetails,
  } = params;

  if (explicitReviewRequest && mention.prNumber !== undefined) {
    const explicitReviewPrompt = await buildExplicitReviewPrompt({
      mention: mention as MentionEvent & { prNumber: number },
      config,
      deliveryId,
      workspaceDir,
      workspaceToken,
      retrievalContext,
      reviewPrecedents,
      wikiKnowledge,
      unifiedResults,
      contextWindow,
      logger,
      getPullRequest,
      fetchPullRequestFiles,
    });

    return {
      prompt: explicitReviewPrompt.prompt,
      promptSections: explicitReviewPrompt.promptSections,
      explicitReviewPromptFileCount: explicitReviewPrompt.promptFileCount,
      explicitReviewDynamicTimeoutSeconds: explicitReviewPrompt.dynamicTimeoutSeconds,
      explicitReviewMaxTurnsOverride: explicitReviewPrompt.maxTurnsOverride,
      explicitReviewPrDiffCommentabilityIndex: explicitReviewPrompt.prDiffCommentabilityIndex,
      explicitReviewHeadSha: explicitReviewPrompt.headSha,
      explicitReviewBaseSha: explicitReviewPrompt.baseSha,
      explicitReviewRouting: explicitReviewPrompt.routing,
    };
  }

  const mentionPromptResult = buildMentionPrompt({
    mention,
    mentionContext,
    retrievalContext,
    userQuestion,
    findingContext,
    customInstructions: [config.mention.prompt, planOnlyInstructions, writeInstructions]
      .filter((s) => (s ?? "").trim().length > 0)
      .join("\n\n"),
    outputLanguage,
    unifiedResults: unifiedResults.length > 0 ? unifiedResults : undefined,
    contextWindow,
    triageContext: triageContext.trim().length > 0 ? triageContext : undefined,
    prDiffContext,
  });

  return {
    prompt: mentionPromptResult.text,
    promptSections: [
      buildPromptSectionRecord({
        deliveryId,
        repo: `${mention.owner}/${mention.repo}`,
        taskType: "mention.response",
        promptKind: "mention.context",
        sections: mentionContextSectionMetrics,
      }),
      buildPromptSectionRecord({
        deliveryId,
        repo: `${mention.owner}/${mention.repo}`,
        taskType: "mention.response",
        promptKind: "mention.user-prompt",
        sections: mentionPromptResult.sections,
      }),
    ].filter((record) => record.sections.length > 0),
    explicitReviewPromptFileCount: undefined,
    explicitReviewDynamicTimeoutSeconds: undefined,
    explicitReviewMaxTurnsOverride: undefined,
    explicitReviewPrDiffCommentabilityIndex: undefined,
    explicitReviewHeadSha: undefined,
    explicitReviewBaseSha: undefined,
    explicitReviewRouting: {
      taskType: TASK_TYPES.REVIEW_FULL,
      routingReason: "standard",
    },
  };
}
