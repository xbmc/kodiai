import type { Logger } from "pino";
import {
  buildIssueCodeContext,
  type BuildIssueCodeContextParams,
  type IssueCodeContextResult,
} from "../execution/issue-code-context.ts";
import type { PromptSectionMetric } from "../telemetry/types.ts";

type BuildIssueCodeContextFn = (
  params: Pick<BuildIssueCodeContextParams, "workspaceDir" | "question">,
) => Promise<IssueCodeContextResult>;

export type MentionIssueCodePointerResult = {
  mentionContext: string;
  mentionContextSectionMetrics: PromptSectionMetric[];
};

export async function appendMentionIssueCodePointers(params: {
  enabled: boolean;
  mentionContext: string;
  mentionContextSectionMetrics: PromptSectionMetric[];
  workspaceDir: string;
  question: string;
  logger: Pick<Logger, "warn">;
  logContext: Record<string, unknown>;
  buildIssueCodeContext?: BuildIssueCodeContextFn;
}): Promise<MentionIssueCodePointerResult> {
  if (!params.enabled) {
    return {
      mentionContext: params.mentionContext,
      mentionContextSectionMetrics: params.mentionContextSectionMetrics,
    };
  }

  try {
    const issueCodeContext = await (params.buildIssueCodeContext ?? buildIssueCodeContext)({
      workspaceDir: params.workspaceDir,
      question: params.question,
    });

    if (issueCodeContext.contextBlock.trim().length === 0) {
      return {
        mentionContext: params.mentionContext,
        mentionContextSectionMetrics: params.mentionContextSectionMetrics,
      };
    }

    const codePointerSection = [
      "## Candidate Code Pointers",
      "",
      issueCodeContext.contextBlock.trim(),
    ].join("\n");
    const contextParts = [
      params.mentionContext.trim(),
      codePointerSection,
    ].filter((part) => part.length > 0);

    return {
      mentionContext: contextParts.join("\n"),
      mentionContextSectionMetrics: [
        ...params.mentionContextSectionMetrics,
        {
          sectionName: "candidate-code-pointers",
          sectionPosition: params.mentionContextSectionMetrics.length,
          charCount: codePointerSection.length,
          estimatedTokens: Math.ceil(codePointerSection.length / 4),
        },
      ],
    };
  } catch (err) {
    params.logger.warn(
      { err, ...params.logContext },
      "Failed to build issue code context; proceeding without code pointers",
    );
    return {
      mentionContext: params.mentionContext,
      mentionContextSectionMetrics: params.mentionContextSectionMetrics,
    };
  }
}
