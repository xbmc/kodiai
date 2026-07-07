import type { Logger } from "pino";
import {
  evaluateFeedbackSuppressions,
  type FeedbackSuppressionConfig,
  type FeedbackSuppressionResult,
} from "../feedback/index.ts";
import type { KnowledgeStore } from "../knowledge/types.ts";

const EMPTY_FEEDBACK_SUPPRESSION: FeedbackSuppressionResult = {
  suppressedFingerprints: new Set<string>(),
  suppressedPatternCount: 0,
  patterns: [],
};

type EvaluateFeedbackSuppressions = (params: {
  store: KnowledgeStore;
  repo: string;
  config: FeedbackSuppressionConfig;
  logger: Logger;
}) => Promise<FeedbackSuppressionResult>;

export async function resolveReviewFeedbackSuppression(params: {
  knowledgeStore: KnowledgeStore | undefined;
  repo: string;
  config: FeedbackSuppressionConfig;
  logger: Logger;
  evaluate?: EvaluateFeedbackSuppressions;
}): Promise<FeedbackSuppressionResult> {
  if (!params.knowledgeStore) {
    return EMPTY_FEEDBACK_SUPPRESSION;
  }

  const evaluate = params.evaluate ?? evaluateFeedbackSuppressions;
  return await evaluate({
    store: params.knowledgeStore,
    repo: params.repo,
    config: params.config,
    logger: params.logger,
  });
}
