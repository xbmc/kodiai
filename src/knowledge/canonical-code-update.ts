import type { Logger } from "pino";
import { chunkCanonicalCodeFile, type CanonicalChunk, type CanonicalChunkerObservability } from "./canonical-code-chunker.ts";
import type { CanonicalCodeStore } from "./canonical-code-types.ts";
import type { EmbeddingProvider } from "./types.ts";

export type CanonicalCodeUpdateFile = {
  filePath: string;
  fileContent: string;
};

export type CanonicalCodeUpdateRequest = {
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  files: CanonicalCodeUpdateFile[];
};

export type CanonicalCodeUpdateFileResult = {
  filePath: string;
  excluded: boolean;
  exclusionReason: CanonicalChunkerObservability["exclusionReason"];
  boundaryDecisions: CanonicalChunkerObservability["boundaryDecisions"];
  chunkCount: number;
  removed: number;
  updated: number;
  unchanged: number;
  failed: number;
};

export type CanonicalCodeUpdateResult = {
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  filesTotal: number;
  filesProcessed: number;
  filesExcluded: number;
  chunksSeen: number;
  removed: number;
  updated: number;
  unchanged: number;
  failed: number;
  fileResults: CanonicalCodeUpdateFileResult[];
};

type LiveChunkIdentity = Awaited<ReturnType<CanonicalCodeStore["listChunksForFile"]>>[number];

function chunkIdentityKey(chunk: Pick<CanonicalChunk, "filePath" | "chunkType" | "symbolName">): string {
  return [chunk.filePath, chunk.chunkType, chunk.symbolName ?? ""].join("|");
}

function liveIdentityKey(chunk: Pick<LiveChunkIdentity, "filePath" | "chunkType" | "symbolName">): string {
  return [chunk.filePath, chunk.chunkType, chunk.symbolName ?? ""].join("|");
}

export async function updateCanonicalCodeSnapshot(params: {
  store: Pick<CanonicalCodeStore, "listChunksForFile" | "deleteChunksForFile" | "upsertChunk">;
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  request: CanonicalCodeUpdateRequest;
  logger: Logger;
}): Promise<CanonicalCodeUpdateResult> {
  const { store, embeddingProvider, request, logger } = params;

  const fileResults: CanonicalCodeUpdateFileResult[] = [];
  let filesProcessed = 0;
  let filesExcluded = 0;
  let chunksSeen = 0;
  let removed = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const file of request.files) {
    const chunkResult = chunkCanonicalCodeFile({
      filePath: file.filePath,
      fileContent: file.fileContent,
    });

    const fileResult: CanonicalCodeUpdateFileResult = {
      filePath: file.filePath,
      excluded: chunkResult.observability.excluded,
      exclusionReason: chunkResult.observability.exclusionReason,
      boundaryDecisions: chunkResult.observability.boundaryDecisions,
      chunkCount: chunkResult.chunks.length,
      removed: 0,
      updated: 0,
      unchanged: 0,
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
        "Canonical code update skipped excluded file",
      );
      continue;
    }

    filesProcessed += 1;
    chunksSeen += chunkResult.chunks.length;

    const existingChunks = await store.listChunksForFile({
      repo: request.repo,
      owner: request.owner,
      canonicalRef: request.canonicalRef,
      filePath: file.filePath,
    });

    const existingByIdentity = new Map(existingChunks.map((chunk) => [liveIdentityKey(chunk), chunk]));
    const nextIdentityKeys = new Set(chunkResult.chunks.map((chunk) => chunkIdentityKey(chunk)));

    const removedIdentities = existingChunks.filter((chunk) => !nextIdentityKeys.has(liveIdentityKey(chunk)));
    if (removedIdentities.length > 0) {
      const deletedCount = await store.deleteChunksForFile({
        repo: request.repo,
        owner: request.owner,
        canonicalRef: request.canonicalRef,
        filePath: file.filePath,
      });
      fileResult.removed += removedIdentities.length;
      removed += removedIdentities.length;
      logger.info(
        {
          repo: request.repo,
          owner: request.owner,
          canonicalRef: request.canonicalRef,
          commitSha: request.commitSha,
          filePath: file.filePath,
          removedIdentities: removedIdentities.length,
          deletedCount,
        },
        "Canonical code update removed stale chunk identities for file",
      );
    }

    for (const chunk of chunkResult.chunks) {
      const identity = chunkIdentityKey(chunk);
      const existing = existingByIdentity.get(identity);

      if (existing && existing.contentHash === chunk.contentHash) {
        unchanged += 1;
        fileResult.unchanged += 1;
        continue;
      }

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
          "Canonical code update embedding failed (fail-open)",
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
          "Canonical code update embedding unavailable (fail-open)",
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

      if (outcome === "dedup") {
        unchanged += 1;
        fileResult.unchanged += 1;
      } else {
        updated += 1;
        fileResult.updated += 1;
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
        removed: fileResult.removed,
        updated: fileResult.updated,
        unchanged: fileResult.unchanged,
        failed: fileResult.failed,
        excluded: false,
        boundaryDecisions: fileResult.boundaryDecisions,
      },
      "Canonical code update completed file",
    );
  }

  const summary: CanonicalCodeUpdateResult = {
    repo: request.repo,
    owner: request.owner,
    canonicalRef: request.canonicalRef,
    commitSha: request.commitSha,
    filesTotal: request.files.length,
    filesProcessed,
    filesExcluded,
    chunksSeen,
    removed,
    updated,
    unchanged,
    failed,
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
      chunksSeen: summary.chunksSeen,
      removed: summary.removed,
      updated: summary.updated,
      unchanged: summary.unchanged,
      failed: summary.failed,
    },
    "Canonical code selective update complete",
  );

  return summary;
}
