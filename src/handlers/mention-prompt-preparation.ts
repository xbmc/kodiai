import type { Logger } from "pino";
import type { RepoConfig } from "../execution/config.ts";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import type { TriageCooldownStore } from "../lib/mention-state-stores.ts";
import type { TelemetryStore } from "../telemetry/types.ts";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { MentionEvent } from "./mention-types.ts";
import type { MentionFindingLookup } from "./mention-finding-context.ts";
import { hydrateMentionFindingContext } from "./mention-finding-context.ts";
import { buildMentionTriageContext } from "./mention-triage-context.ts";
import { buildMentionAgentInstructions } from "./mention-agent-instructions.ts";
import { appendMentionIssueCodePointers } from "./mention-code-pointers.ts";
import {
  buildMentionDerivedContext,
  type MentionDerivedContextCacheStatus,
} from "./mention-derived-context.ts";
import {
  buildMentionRetrievalContextForPrompt,
  type MentionRetrievalPromptContext,
} from "./mention-retrieval-context.ts";
import {
  resolveMentionPrDiffContext,
  type MentionPrDiffContext,
} from "./mention-pr-diff-context.ts";
import { resolveMentionPromptContextRouting } from "./mention-prompt-context-routing.ts";

type MentionPromptPreparationConfig = Pick<
  RepoConfig,
  "knowledge" | "mention" | "telemetry" | "triage"
>;

type MentionPromptPreparationResult = MentionRetrievalPromptContext & {
  mentionContext: string;
  mentionContextSectionMetrics: PromptBuildResult["sections"];
  mentionDerivedContextCacheStatus: MentionDerivedContextCacheStatus;
  mentionDerivedContextCacheReason: string | null;
  findingContext: Awaited<ReturnType<typeof hydrateMentionFindingContext>>;
  planOnlyInstructions?: string;
  writeInstructions?: string;
  triageContext: string;
  prDiffContext?: MentionPrDiffContext;
};

export async function prepareMentionPromptInputs(params: {
  octokit: Parameters<typeof buildMentionDerivedContext>[0]["octokit"];
  mention: MentionEvent;
  explicitReviewRequest: boolean;
  config: MentionPromptPreparationConfig;
  findingLookup: MentionFindingLookup | undefined;
  mentionDerivedContextCache: SearchCache<PromptBuildResult>;
  getMentionDerivedContextCacheErrorCount: () => number;
  retriever?: ReturnType<typeof createRetriever>;
  telemetryStore: TelemetryStore;
  deliveryId: string;
  workspaceDir: string;
  writeRequest: string;
  isIssueThreadComment: boolean;
  isPlanOnly: boolean;
  isWriteRequest: boolean;
  writeEnabled: boolean;
  triageCooldownStore: TriageCooldownStore;
  logger: Logger;
}): Promise<MentionPromptPreparationResult> {
  const {
    allowIssueCodePointers,
    allowPrDiffContext,
    includeIssueCorpus,
  } = resolveMentionPromptContextRouting({
    isIssueThreadComment: params.isIssueThreadComment,
    prNumber: params.mention.prNumber,
    writeRequest: params.writeRequest,
  });

  let {
    mentionContext,
    mentionContextSectionMetrics,
    mentionDerivedContextCacheStatus,
    mentionDerivedContextCacheReason,
  } = await buildMentionDerivedContext({
    octokit: params.octokit,
    mention: params.mention,
    explicitReviewRequest: params.explicitReviewRequest,
    mentionAdmission: params.config.mention.admission,
    maxThreadChars: params.config.mention.conversation.contextBudgetChars,
    findingLookup: params.findingLookup,
    cache: params.mentionDerivedContextCache,
    getCacheErrorCount: params.getMentionDerivedContextCacheErrorCount,
    logger: params.logger,
  });

  ({
    mentionContext,
    mentionContextSectionMetrics,
  } = await appendMentionIssueCodePointers({
    enabled: allowIssueCodePointers,
    mentionContext,
    mentionContextSectionMetrics,
    workspaceDir: params.workspaceDir,
    question: params.writeRequest,
    logger: params.logger,
    logContext: { surface: params.mention.surface, issueNumber: params.mention.issueNumber },
  }));

  const triageContext = await buildMentionTriageContext({
    enabled: params.config.triage.enabled,
    isIssueThreadComment: params.isIssueThreadComment,
    owner: params.mention.owner,
    repo: params.mention.repo,
    issueNumber: params.mention.issueNumber,
    issueBody: params.mention.issueBody,
    workspaceDir: params.workspaceDir,
    cooldownMinutes: params.config.triage.cooldownMinutes,
    labelAllowlist: params.config.triage.labelAllowlist,
    cooldownStore: params.triageCooldownStore,
    logger: params.logger,
  });

  const findingContext = await hydrateMentionFindingContext({
    owner: params.mention.owner,
    repo: params.mention.repo,
    inReplyToId: params.mention.inReplyToId,
    findingLookup: params.findingLookup,
    logger: params.logger,
  });

  const retrievalPromptContext = await buildMentionRetrievalContextForPrompt({
    retriever: params.retriever,
    retrievalEnabled: params.config.knowledge?.retrieval?.enabled === true,
    topK: params.config.knowledge?.retrieval?.topK,
    telemetryEnabled: params.config.telemetry.enabled,
    telemetryStore: params.telemetryStore,
    deliveryId: params.deliveryId,
    owner: params.mention.owner,
    repo: params.mention.repo,
    surface: params.mention.surface,
    issueNumber: params.mention.issueNumber,
    prNumber: params.mention.prNumber,
    baseRef: params.mention.baseRef,
    workspaceDir: params.workspaceDir,
    writeRequest: params.writeRequest,
    mentionContext,
    allowHeavyContext: allowIssueCodePointers,
    allowDiffContext: allowPrDiffContext,
    explicitReviewRequest: params.explicitReviewRequest,
    inReplyToId: params.mention.inReplyToId,
    includeIssueCorpus,
    logger: params.logger,
  });

  const { planOnlyInstructions, writeInstructions } = buildMentionAgentInstructions({
    isPlanOnly: params.isPlanOnly,
    isWriteRequest: params.isWriteRequest,
    writeEnabled: params.writeEnabled,
  });

  const prDiffContext = await resolveMentionPrDiffContext({
    allowPrDiffContext,
    writeEnabled: params.writeEnabled,
    mention: params.mention,
    workspaceDir: params.workspaceDir,
    logger: params.logger,
  });

  return {
    mentionContext,
    mentionContextSectionMetrics,
    mentionDerivedContextCacheStatus,
    mentionDerivedContextCacheReason,
    findingContext,
    ...retrievalPromptContext,
    planOnlyInstructions,
    writeInstructions,
    triageContext,
    prDiffContext,
  };
}
