import type { Logger } from "pino";

type ReviewDraftToneLogger = Pick<Logger, "info">;

export type ReviewDraftToneContext = {
  isDraft: boolean;
};

export function resolveReviewDraftToneContext(params: {
  action: string;
  prDraft: boolean;
  baseLog: Record<string, unknown>;
  logger: ReviewDraftToneLogger;
}): ReviewDraftToneContext {
  const isDraft = params.action === "ready_for_review" ? false : params.prDraft;
  if (isDraft) {
    params.logger.info(
      { ...params.baseLog, isDraft: true },
      "Reviewing draft PR with draft tone",
    );
  }

  return { isDraft };
}
