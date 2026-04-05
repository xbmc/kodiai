import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { $ } from "bun";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { WorkspaceManager } from "../jobs/types.ts";
import { chunkCanonicalCodeFile } from "./canonical-code-chunker.ts";
import type { CanonicalCodeStore, CanonicalCorpusBackfillState } from "./canonical-code-types.ts";
import type { EmbeddingProvider } from "./types.ts";

export type CanonicalCodeBackfillDeps = {
  githubApp: Pick<GitHubApp, "getRepoInstallationContext">;
  workspaceManager: Pick<WorkspaceManager, "create">;
  store: Pick<CanonicalCodeStore, "getBackfillState" | "saveBackfillState" | "deleteChunksForFile" | "upsertChunk">;
  embeddingProvider: Pick<EmbeddingProvider, "generate">;
  logger: Logger;
};

export type CanonicalCodeBackfillRequest = {
  owner: string;
  repo: string;
  maxFiles?: number;
  /** Optional explicit backfill state run id; normally auto-generated. */
  runId?: string;
};

export type CanonicalCodeBackfillWarning = {
  class: "workspace" | "read" | "parse" | "embedding" | "store";
  filePath?: string;
  message: string;
};

export type CanonicalCodeBackfillResult = {
  repo: string;
  owner: string;
  canonicalRef: string;
  commitSha: string;
  runId: string;
  status: "completed" | "partial" | "failed";
  resumed: boolean;
  filesTotal: number;
  filesDone: number;
  filesSkipped: number;
  chunksDone: number;
  chunksSkipped: number;
  chunksFailed: number;
  warnings: CanonicalCodeBackfillWarning[];
};

async function listFilesRecursive(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      paths.push(...await listFilesRecursive(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    paths.push(relative(rootDir, absolutePath));
  }

  return paths.sort((a, b) => a.localeCompare(b));
}

function shouldResumeFromPath(filePath: string, lastFilePath: string | null): boolean {
  if (!lastFilePath) return true;
  return filePath > lastFilePath;
}

function createInitialState(params: {
  repo: string;
  owner: string;
  canonicalRef: string;
  runId: string;
  filesTotal: number;
  commitSha: string;
  resumed: boolean;
  checkpoint?: CanonicalCorpusBackfillState | null;
}): CanonicalCorpusBackfillState {
  const checkpoint = params.checkpoint;
  return {
    repo: params.repo,
    owner: params.owner,
    canonicalRef: params.canonicalRef,
    runId: params.runId,
    status: "running",
    filesTotal: params.filesTotal,
    filesDone: checkpoint?.filesDone ?? 0,
    chunksTotal: null,
    chunksDone: checkpoint?.chunksDone ?? 0,
    chunksSkipped: checkpoint?.chunksSkipped ?? 0,
    chunksFailed: checkpoint?.chunksFailed ?? 0,
    lastFilePath: checkpoint?.lastFilePath ?? null,
    commitSha: params.commitSha,
    errorMessage: null,
    createdAt: checkpoint?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function backfillCanonicalCodeSnapshot(
  deps: CanonicalCodeBackfillDeps,
  request: CanonicalCodeBackfillRequest,
): Promise<CanonicalCodeBackfillResult> {
  const installationContext = await deps.githubApp.getRepoInstallationContext(request.owner, request.repo);
  if (!installationContext) {
    throw new Error(`Repository ${request.owner}/${request.repo} is not installed for this GitHub App`);
  }

  const canonicalRef = installationContext.defaultBranch;
  const workspace = await deps.workspaceManager.create(installationContext.installationId, {
    owner: request.owner,
    repo: request.repo,
    ref: canonicalRef,
    depth: 1,
  });

  try {
    const commitSha = (await $`git -C ${workspace.dir} rev-parse HEAD`.quiet()).text().trim();
    const discoveredFiles = await listFilesRecursive(workspace.dir);
    const files = request.maxFiles && request.maxFiles > 0
      ? discoveredFiles.slice(0, request.maxFiles)
      : discoveredFiles;

    const checkpoint = await deps.store.getBackfillState({
      repo: request.repo,
      owner: request.owner,
      canonicalRef,
    });
    const resumableCheckpoint = checkpoint && checkpoint.status !== "completed" && checkpoint.commitSha === commitSha
      ? checkpoint
      : null;
    const resumed = Boolean(resumableCheckpoint?.lastFilePath);
    const runId = request.runId ?? resumableCheckpoint?.runId ?? `canonical-backfill-${request.owner}-${request.repo}-${Date.now()}`;

    const state = createInitialState({
      repo: request.repo,
      owner: request.owner,
      canonicalRef,
      runId,
      filesTotal: files.length,
      commitSha,
      resumed,
      checkpoint: resumableCheckpoint,
    });
    await deps.store.saveBackfillState(state);

    const warnings: CanonicalCodeBackfillWarning[] = [];
    let filesSkipped = 0;

    for (const filePath of files) {
      if (resumableCheckpoint && !shouldResumeFromPath(filePath, checkpoint?.lastFilePath ?? null)) {
        continue;
      }

      let fileContent: string;
      try {
        fileContent = await readFile(join(workspace.dir, filePath), "utf8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push({ class: "read", filePath, message });
        filesSkipped += 1;
        state.filesDone += 1;
        state.lastFilePath = filePath;
        state.status = "partial";
        state.errorMessage = message;
        await deps.store.saveBackfillState(state);
        deps.logger.warn({ repo: request.repo, canonicalRef, filePath, err: message }, "Canonical code backfill failed to read file (fail-open)");
        continue;
      }

      const chunkResult = chunkCanonicalCodeFile({ filePath, fileContent });
      if (chunkResult.observability.excluded) {
        filesSkipped += 1;
        state.filesDone += 1;
        state.lastFilePath = filePath;
        await deps.store.saveBackfillState(state);
        deps.logger.info({ repo: request.repo, canonicalRef, filePath, reason: chunkResult.observability.exclusionReason }, "Canonical code backfill skipped excluded file");
        continue;
      }

      if (chunkResult.chunks.length === 0) {
        filesSkipped += 1;
        state.filesDone += 1;
        state.lastFilePath = filePath;
        await deps.store.saveBackfillState(state);
        deps.logger.info({ repo: request.repo, canonicalRef, filePath }, "Canonical code backfill skipped empty parse result");
        continue;
      }

      let deletedForFile = false;
      for (const chunk of chunkResult.chunks) {
        let embeddingResult;
        try {
          embeddingResult = await deps.embeddingProvider.generate(chunk.chunkText, "document");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push({ class: "embedding", filePath, message });
          state.chunksFailed += 1;
          state.status = "partial";
          state.errorMessage = message;
          deps.logger.warn({ repo: request.repo, canonicalRef, filePath, err: message }, "Canonical code backfill embedding failed (fail-open)");
          continue;
        }

        if (!embeddingResult) {
          const message = `Embedding unavailable for canonical chunk ${filePath}:${chunk.startLine}-${chunk.endLine}`;
          warnings.push({ class: "embedding", filePath, message });
          state.chunksFailed += 1;
          state.status = "partial";
          state.errorMessage = message;
          deps.logger.warn({ repo: request.repo, canonicalRef, filePath, startLine: chunk.startLine, endLine: chunk.endLine }, "Canonical code backfill embedding unavailable (fail-open)");
          continue;
        }

        try {
          if (!deletedForFile) {
            await deps.store.deleteChunksForFile({
              repo: request.repo,
              owner: request.owner,
              canonicalRef,
              filePath,
            });
            deletedForFile = true;
          }

          const outcome = await deps.store.upsertChunk(
            {
              repo: request.repo,
              owner: request.owner,
              canonicalRef,
              commitSha,
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
            state.chunksSkipped += 1;
          } else {
            state.chunksDone += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push({ class: "store", filePath, message });
          state.chunksFailed += 1;
          state.status = "partial";
          state.errorMessage = message;
          deps.logger.warn({ repo: request.repo, canonicalRef, filePath, err: message }, "Canonical code backfill store write failed (fail-open)");
        }
      }

      state.filesDone += 1;
      state.lastFilePath = filePath;
      await deps.store.saveBackfillState(state);
    }

    state.status = state.chunksFailed > 0 || warnings.length > 0 ? "partial" : "completed";
    if (state.status === "completed") {
      state.errorMessage = null;
    }
    await deps.store.saveBackfillState(state);

    return {
      repo: request.repo,
      owner: request.owner,
      canonicalRef,
      commitSha,
      runId,
      status: state.status,
      resumed,
      filesTotal: files.length,
      filesDone: state.filesDone,
      filesSkipped,
      chunksDone: state.chunksDone,
      chunksSkipped: state.chunksSkipped,
      chunksFailed: state.chunksFailed,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.error({ repo: request.repo, owner: request.owner, err: message }, "Canonical code backfill failed before per-file processing");
    throw err;
  } finally {
    await workspace.cleanup();
  }
}
