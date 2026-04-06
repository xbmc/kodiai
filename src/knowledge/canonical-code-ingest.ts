import type { Logger } from "pino";
import { chunkCanonicalCodeFile, type CanonicalChunkerObservability } from "./canonical-code-chunker.ts";
import type { CanonicalCodeStore } from "./canonical-code-types.ts";
import type { EmbeddingProvider } from "./types.ts";

export type CanonicalCodeIngestFile = {
  filePath: string;
  fileContent: string;
};

export type CanonicalCodeIngestRequest = {
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  files: CanonicalCodeIngestFile[];
};

export type CanonicalCodeIngestFileResult = {
  filePath: string;
  excluded: boolean;
  exclusionReason: CanonicalChunkerObservability["exclusionReason"];
  boundaryDecisions: CanonicalChunkerObservability["boundaryDecisions"];
  chunkCount: number;
  deletedCount: number;
  inserted: number;
  replaced: number;
  dedup: number;
  failed: number;
};

export type CanonicalCodeIngestResult = {
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  filesTotal: number;
  filesProcessed: number;
  filesExcluded: number;
  chunksAttempted: number;
  inserted: number;
  replaced: number;
  dedup: number;
  failed: number;
  deleted: number;
  fileResults: CanonicalCodeIngestFileResult[];
};

export async function ingestCanonicalCodeSnapshot(params: {
  store: Pick<CanonicalCodeStore, "upsertChunk" | "deleteChunksForFile">;
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  request: CanonicalCodeIngestRequest;
  logger: Logger;
}): Promise<CanonicalCodeIngestResult> {
  const { store, embeddingProvider, request, logger } = params;

  const fileResults: CanonicalCodeIngestFileResult[] = [];
  let filesProcessed = 0;
  let filesExcluded = 0;
  let chunksAttempted = 0;
  let inserted = 0;
  let replaced = 0;
  let dedup = 0;
  let failed = 0;
  let deleted = 0;

  for (const file of request.files) {
    const chunkResult = chunkCanonicalCodeFile({
      filePath: file.filePath,
      fileContent: file.fileContent,
    });

    const fileResult: CanonicalCodeIngestFileResult = {
      filePath: file.filePath,
      excluded: chunkResult.observability.excluded,
      exclusionReason: chunkResult.observability.exclusionReason,
      boundaryDecisions: chunkResult.observability.boundaryDecisions,
      chunkCount: chunkResult.chunks.length,
      deletedCount: 0,
      inserted: 0,
      replaced: 0,
      dedup: 0,
      failed: 0,
    };

    if (chunkResult.observability.excluded) {
      filesExcluded += 1;
      fileResults.push(fileResult);
      logger.info(
        {
          repo: request.repo,
          owner: request.owner,
          canonicalRef: request.canonicalRef,
          commitSha: request.commitSha,
          filePath: file.filePath,
          excluded: true,
          exclusionReason: chunkResult.observability.exclusionReason,
        },
        "Canonical code ingest skipped excluded file",
      );
      continue;
    }

    filesProcessed += 1;

    const deletedCount = await store.deleteChunksForFile({
      repo: request.repo,
      owner: request.owner,
      canonicalRef: request.canonicalRef,
      filePath: file.filePath,
    });
    fileResult.deletedCount = deletedCount;
    deleted += deletedCount;

    for (const chunk of chunkResult.chunks) {
      let embeddingResult;
      try {
        embeddingResult = await embeddingProvider.generate(chunk.chunkText, "document");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed += 1;
        fileResult.failed += 1;
        logger.warn(
          {
            repo: request.repo,
            owner: request.owner,
            canonicalRef: request.canonicalRef,
            commitSha: request.commitSha,
            filePath: file.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            err: message,
          },
          "Canonical code ingest embedding failed (fail-open)",
        );
        continue;
      }

      if (!embeddingResult) {
        failed += 1;
        fileResult.failed += 1;
        logger.warn(
          {
            repo: request.repo,
            owner: request.owner,
            canonicalRef: request.canonicalRef,
            commitSha: request.commitSha,
            filePath: file.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
          },
          "Canonical code ingest embedding unavailable (fail-open)",
        );
        continue;
      }

      const outcome = await store.upsertChunk(
        {
          repo: request.repo,
          owner: request.owner,
          canonicalRef: request.canonicalRef,
          commitSha: request.commitSha,
          filePath: chunk.filePath,
          language: chunk.language,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          chunkType: chunk.chunkType,
          symbolName: chunk.symbolName,
          chunkText: chunk.chunkText,
          contentHash: chunk.contentHash,
          embeddingModel: embeddingResult.model,
        },
        embeddingResult.embedding,
      );

      chunksAttempted += 1;
      if (outcome === "inserted") {
        inserted += 1;
        fileResult.inserted += 1;
      } else if (outcome === "replaced") {
        replaced += 1;
        fileResult.replaced += 1;
      } else {
        dedup += 1;
        fileResult.dedup += 1;
      }
    }

    fileResults.push(fileResult);
    logger.info(
      {
        repo: request.repo,
        owner: request.owner,
        canonicalRef: request.canonicalRef,
        commitSha: request.commitSha,
        filePath: file.filePath,
        chunkCount: fileResult.chunkCount,
        deletedCount: fileResult.deletedCount,
        inserted: fileResult.inserted,
        replaced: fileResult.replaced,
        dedup: fileResult.dedup,
        failed: fileResult.failed,
        excluded: false,
        boundaryDecisions: fileResult.boundaryDecisions,
      },
      "Canonical code ingest completed file",
    );
  }

  const summary: CanonicalCodeIngestResult = {
    repo: request.repo,
    owner: request.owner,
    canonicalRef: request.canonicalRef,
    commitSha: request.commitSha,
    filesTotal: request.files.length,
    filesProcessed,
    filesExcluded,
    chunksAttempted,
    inserted,
    replaced,
    dedup,
    failed,
    deleted,
    fileResults,
  };

  logger.info(
    {
      repo: request.repo,
      owner: request.owner,
      canonicalRef: request.canonicalRef,
      commitSha: request.commitSha,
      filesTotal: summary.filesTotal,
      filesProcessed: summary.filesProcessed,
      filesExcluded: summary.filesExcluded,
      chunksAttempted: summary.chunksAttempted,
      inserted: summary.inserted,
      replaced: summary.replaced,
      dedup: summary.dedup,
      failed: summary.failed,
      deleted: summary.deleted,
    },
    "Canonical code ingest snapshot complete",
  );

  return summary;
}
