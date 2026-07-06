import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import {
  DEFAULT_EMPTY_INTENT,
  parsePRIntent,
  type ParsedPRIntent,
} from "../lib/pr-intent-parser.ts";
import { fetchReviewCommitMessages } from "../review-orchestration/review-commit-messages.ts";

type ReviewOctokit = Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
type ReviewCommitMessage = { sha: string; message: string };

type FetchReviewCommitMessages = (
  octokit: ReviewOctokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitCount: number,
) => Promise<ReviewCommitMessage[]>;

type ParsePrIntent = (
  title: string,
  body: string | null,
  commits?: ReviewCommitMessage[],
) => ParsedPRIntent;

export type ResolveReviewPrIntentResult = {
  parsedIntent: ParsedPRIntent;
  commitMessagesForLinking: string[];
};

export async function resolveReviewPrIntent(params: {
  octokit: ReviewOctokit;
  owner: string;
  repo: string;
  prNumber: number;
  commitCount: number;
  prTitle: string;
  prBody: string | null;
  baseLog: Record<string, unknown>;
  logger: Pick<Logger, "info" | "warn">;
  fetchCommitMessages?: FetchReviewCommitMessages;
  parseIntent?: ParsePrIntent;
}): Promise<ResolveReviewPrIntentResult> {
  const fetchCommitMessages = params.fetchCommitMessages ?? fetchReviewCommitMessages;
  const parseIntent = params.parseIntent ?? parsePRIntent;

  try {
    const commitMessages = await fetchCommitMessages(
      params.octokit,
      params.owner,
      params.repo,
      params.prNumber,
      params.commitCount,
    );
    const parsedIntent = parseIntent(params.prTitle, params.prBody, commitMessages);
    params.logger.info(
      {
        ...params.baseLog,
        gate: "keyword-parse",
        recognized: parsedIntent.recognized,
        unrecognized: parsedIntent.unrecognized,
        noReview: parsedIntent.noReview,
        isWIP: parsedIntent.isWIP,
        profileOverride: parsedIntent.profileOverride,
        breakingChange: parsedIntent.breakingChangeDetected,
        conventionalType: parsedIntent.conventionalType?.type ?? null,
      },
      "PR intent keywords parsed",
    );

    return {
      parsedIntent,
      commitMessagesForLinking: commitMessages.map((commit) => commit.message),
    };
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, err },
      "PR intent parsing failed (fail-open, proceeding without keywords)",
    );
    return {
      parsedIntent: DEFAULT_EMPTY_INTENT,
      commitMessagesForLinking: [],
    };
  }
}
