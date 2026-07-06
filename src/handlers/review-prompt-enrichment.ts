import type { Logger } from "pino";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";
import type { LinkResult } from "../knowledge/issue-linker.ts";
import type { IssueStore } from "../knowledge/issue-types.ts";
import type { EmbeddingProvider } from "../knowledge/types.ts";
import { linkPRToIssues as linkPRToIssuesDefault } from "../knowledge/issue-linker.ts";

export type ReviewPromptEnrichmentResult = {
  clusterPatterns: ClusterPatternMatch[];
  linkedIssues?: LinkResult;
};

export async function buildReviewPromptEnrichment(params: {
  repo: string;
  prTitle: string;
  prBody: string | null;
  commitMessages: string[];
  promptFiles: string[];
  filesByCategory?: Record<string, string[]>;
  clusterMatcher?: (opts: {
    prEmbedding: Float32Array | null;
    prFilePaths: string[];
    repo: string;
  }) => Promise<ClusterPatternMatch[]>;
  issueStore?: IssueStore;
  embeddingProvider?: EmbeddingProvider;
  linkPRToIssues?: typeof linkPRToIssuesDefault;
  logger: Pick<Logger, "info" | "warn">;
  baseLog: Record<string, unknown>;
}): Promise<ReviewPromptEnrichmentResult> {
  let clusterPatterns: ClusterPatternMatch[] = [];
  let linkedIssues: LinkResult | undefined;

  if (params.clusterMatcher && params.embeddingProvider) {
    try {
      const prText = [params.prTitle, params.prBody ?? "", ...params.promptFiles.slice(0, 20)].join("\n");
      const embedResult = await params.embeddingProvider.generate(prText, "query");
      const prEmbedding = embedResult?.embedding ?? null;
      clusterPatterns = await params.clusterMatcher({
        prEmbedding,
        prFilePaths: params.promptFiles,
        repo: params.repo,
      });
      if (clusterPatterns.length > 0) {
        params.logger.info(
          { ...params.baseLog, clusterMatches: clusterPatterns.length },
          "Cluster patterns matched for PR review",
        );
      }
    } catch (err) {
      params.logger.warn({ ...params.baseLog, err }, "Cluster pattern matching failed (fail-open)");
    }
  }

  if (params.issueStore && params.embeddingProvider) {
    try {
      const diffSummaryParts: string[] = [];
      if (params.filesByCategory) {
        const allFiles = Object.values(params.filesByCategory).flat();
        if (allFiles.length > 0) {
          diffSummaryParts.push(allFiles.join(", "));
        }
      }

      const linkPRToIssues = params.linkPRToIssues ?? linkPRToIssuesDefault;
      linkedIssues = await linkPRToIssues({
        prBody: params.prBody ?? "",
        prTitle: params.prTitle,
        commitMessages: params.commitMessages,
        diffSummary: diffSummaryParts.join("\n"),
        repo: params.repo,
        issueStore: params.issueStore,
        embeddingProvider: params.embeddingProvider,
        logger: params.logger as Logger,
      });

      if (
        linkedIssues.referencedIssues.length > 0 ||
        linkedIssues.semanticMatches.length > 0
      ) {
        params.logger.info(
          {
            ...params.baseLog,
            referencedCount: linkedIssues.referencedIssues.length,
            semanticCount: linkedIssues.semanticMatches.length,
          },
          "PR-issue linking completed",
        );
      }
    } catch (err) {
      params.logger.warn({ ...params.baseLog, err }, "PR-issue linking failed (fail-open)");
    }
  }

  return {
    clusterPatterns,
    linkedIssues,
  };
}
