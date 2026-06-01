import type { Logger } from "pino";
import type { CodeSnippetStore, EmbeddingProvider } from "../knowledge/types.ts";
import {
  applyHunkCap,
  buildEmbeddingText,
  computeContentHash,
  isExcludedPath,
  parseDiffHunks,
} from "../knowledge/code-snippet-chunker.ts";
import { toProductionLogHunkEmbeddingCounts } from "../review-audit/production-log-projection.ts";

export async function embedReviewDiffHunks(params: {
  diffFiles: Array<{ filename: string; patch?: string }>;
  repo: string;
  owner: string;
  prNumber: number;
  prTitle: string;
  codeSnippetStore: CodeSnippetStore;
  embeddingProvider: EmbeddingProvider;
  config: { enabled: boolean; maxHunksPerPr: number; minChangedLines: number; excludePatterns: string[] };
  logger: Logger;
}): Promise<void> {
  const {
    diffFiles,
    repo,
    owner,
    prNumber,
    prTitle,
    codeSnippetStore,
    embeddingProvider,
    config: hunkConfig,
    logger,
  } = params;

  if (!hunkConfig.enabled) return;

  try {
    const allHunks: import("../knowledge/code-snippet-chunker.ts").ParsedHunk[] = [];

    for (const file of diffFiles) {
      if (!file.patch) continue;
      if (isExcludedPath(file.filename, hunkConfig.excludePatterns)) continue;

      const hunks = parseDiffHunks({
        diffText: file.patch,
        filePath: file.filename,
        minChangedLines: hunkConfig.minChangedLines,
      });
      allHunks.push(...hunks);
    }

    if (allHunks.length === 0) return;

    const cappedHunks = applyHunkCap(allHunks, hunkConfig.maxHunksPerPr);

    let embeddedCount = 0;
    let failedCount = 0;

    for (const hunk of cappedHunks) {
      try {
        const embeddedText = buildEmbeddingText({ hunk, prTitle });
        const contentHash = computeContentHash(embeddedText);

        const embeddingResult = await embeddingProvider.generate(embeddedText, "document");
        if (!embeddingResult) {
          failedCount++;
          continue;
        }

        await codeSnippetStore.writeSnippet(
          {
            contentHash,
            embeddedText,
            language: hunk.language,
            embeddingModel: embeddingResult.model,
          },
          embeddingResult.embedding,
        );

        await codeSnippetStore.writeOccurrence({
          contentHash,
          repo,
          owner,
          prNumber,
          prTitle,
          filePath: hunk.filePath,
          startLine: hunk.startLine,
          endLine: hunk.startLine + hunk.addedLines.length - 1,
          functionContext: hunk.functionContext || null,
        });

        embeddedCount++;
      } catch (err) {
        failedCount++;
        logger.warn(
          { err, filePath: hunk.filePath, startLine: hunk.startLine },
          "Hunk embedding failed for individual hunk (fail-open)",
        );
      }
    }

    if (embeddedCount > 0 || failedCount > 0) {
      logger.info(
        {
          repo,
          prNumber,
          ...toProductionLogHunkEmbeddingCounts({
            hunkCount: cappedHunks.length,
            embeddedCount,
            failedCount,
          }),
        },
        "Hunk embedding complete",
      );
    }
  } catch (err) {
    logger.warn({ err, repo, prNumber }, "Hunk embedding pipeline failed (fail-open)");
  }
}
