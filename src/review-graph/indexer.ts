import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import { extractReviewGraph } from "./extractors.ts";
import type { ReviewGraphBuildRecord, ReviewGraphStore } from "./types.ts";

export type SupportedReviewGraphLanguage = "cpp" | "python";

export type ReviewGraphIndexerMetrics = {
  discovered: number;
  indexed: number;
  updated: number;
  skipped: number;
  failed: number;
  nodesWritten: number;
  edgesWritten: number;
};

export type ReviewGraphIndexResult = {
  build: ReviewGraphBuildRecord;
  metrics: ReviewGraphIndexerMetrics;
  files: {
    indexed: string[];
    updated: string[];
    skipped: string[];
    failed: Array<{ path: string; error: string }>;
  };
};

export type ReviewGraphIndexer = {
  indexWorkspace(input: {
    repo: string;
    workspaceKey: string;
    workspaceDir: string;
    commitSha?: string | null;
    changedPaths?: string[];
  }): Promise<ReviewGraphIndexResult>;
};

type WalkDirFn = (workspaceDir: string) => Promise<string[]>;
type ReadFileFn = (absolutePath: string) => Promise<string>;

type ReviewGraphIndexerOptions = {
  store: ReviewGraphStore;
  logger: Logger;
  walkWorkspace?: WalkDirFn;
  readWorkspaceFile?: ReadFileFn;
};

const SUPPORTED_EXTENSIONS: Array<{ ext: string; language: SupportedReviewGraphLanguage }> = [
  { ext: ".py", language: "python" },
  { ext: ".pyw", language: "python" },
  { ext: ".cpp", language: "cpp" },
  { ext: ".cc", language: "cpp" },
  { ext: ".cxx", language: "cpp" },
  { ext: ".hpp", language: "cpp" },
  { ext: ".hxx", language: "cpp" },
  { ext: ".hh", language: "cpp" },
  { ext: ".h", language: "cpp" },
];
const MAX_REVIEW_GRAPH_FILE_BYTES = 512 * 1024;
const REVIEW_GRAPH_FILE_TOO_LARGE_PREFIX = "review_graph_file_too_large:";

const IGNORED_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".gsd",
]);

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function getLanguageForPath(repoPath: string): SupportedReviewGraphLanguage | null {
  const lower = repoPath.toLowerCase();
  for (const candidate of SUPPORTED_EXTENSIONS) {
    if (lower.endsWith(candidate.ext)) return candidate.language;
  }
  return null;
}

function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function defaultReadWorkspaceFile(absolutePath: string): Promise<string> {
  const fileStats = await stat(absolutePath);
  if (fileStats.size > MAX_REVIEW_GRAPH_FILE_BYTES) {
    throw new Error(`${REVIEW_GRAPH_FILE_TOO_LARGE_PREFIX}${fileStats.size}`);
  }
  return await readFile(absolutePath, "utf8");
}

async function defaultWalkWorkspace(workspaceDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const absolute = path.join(currentDir, entry.name);
      const repoPath = normalizeRepoPath(path.relative(workspaceDir, absolute));
      if (!repoPath || repoPath.startsWith("..")) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(absolute);
        continue;
      }

      if (!entry.isFile()) continue;
      files.push(repoPath);
    }
  }

  await walk(workspaceDir);
  return files;
}

function uniqueSorted(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizeRepoPath))).sort((a, b) => a.localeCompare(b));
}

function createEmptyMetrics(discovered: number): ReviewGraphIndexerMetrics {
  return {
    discovered,
    indexed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    nodesWritten: 0,
    edgesWritten: 0,
  };
}

export function createReviewGraphIndexer(opts: ReviewGraphIndexerOptions): ReviewGraphIndexer {
  const walkWorkspace = opts.walkWorkspace ?? defaultWalkWorkspace;
  const readWorkspaceFile = opts.readWorkspaceFile ?? defaultReadWorkspaceFile;

  return {
    async indexWorkspace(input) {
      const candidatePaths = input.changedPaths?.length
        ? uniqueSorted(input.changedPaths)
        : uniqueSorted(await walkWorkspace(input.workspaceDir));
      const supportedPaths = candidatePaths.filter((repoPath) => getLanguageForPath(repoPath) !== null);

      const startedAt = new Date().toISOString();
      let build = await opts.store.upsertBuild({
        repo: input.repo,
        workspaceKey: input.workspaceKey,
        commitSha: input.commitSha ?? null,
        status: "running",
        startedAt,
        completedAt: null,
        lastError: null,
        filesIndexed: 0,
        filesFailed: 0,
        nodesWritten: 0,
        edgesWritten: 0,
      });

      const metrics = createEmptyMetrics(supportedPaths.length);
      const files: ReviewGraphIndexResult["files"] = {
        indexed: [],
        updated: [],
        skipped: [],
        failed: [],
      };
      const unchangedSkipSamples: Array<{ path: string; contentHash: string }> = [];
      const existingFilesByPath = new Map(
        (await opts.store.listFilesForWorkspace(input.repo, input.workspaceKey))
          .map((file) => [file.path, file]),
      );

      try {
        for (const repoPath of supportedPaths) {
          const language = getLanguageForPath(repoPath);
          if (!language) continue;

          const absolutePath = path.join(input.workspaceDir, repoPath);

          try {
            const content = await readWorkspaceFile(absolutePath);
            const contentHash = computeContentHash(content);
            const existing = existingFilesByPath.get(repoPath) ?? null;

            if (existing?.contentHash === contentHash) {
              metrics.skipped += 1;
              files.skipped.push(repoPath);
              if (unchangedSkipSamples.length < 5) {
                unchangedSkipSamples.push({ path: repoPath, contentHash });
              }
              continue;
            }

            const extraction = extractReviewGraph({
              repo: input.repo,
              workspaceKey: input.workspaceKey,
              path: repoPath,
              content,
              language,
            });

            const writeResult = await opts.store.replaceFileGraph({
              file: {
                repo: input.repo,
                workspaceKey: input.workspaceKey,
                path: repoPath,
                language,
                contentHash,
                buildId: build.id,
              },
              nodes: extraction.nodes,
              edges: extraction.edges,
            });
            existingFilesByPath.set(repoPath, writeResult.file);

            metrics.indexed += 1;
            metrics.nodesWritten += writeResult.nodesWritten;
            metrics.edgesWritten += writeResult.edgesWritten;

            if (existing) {
              metrics.updated += 1;
              files.updated.push(repoPath);
            } else {
              files.indexed.push(repoPath);
            }

            opts.logger.debug(
              {
                repo: input.repo,
                workspaceKey: input.workspaceKey,
                path: repoPath,
                language,
                updated: Boolean(existing),
                nodesWritten: writeResult.nodesWritten,
                edgesWritten: writeResult.edgesWritten,
                extractedMetrics: extraction.metrics,
                graphIndexMetrics: {
                  indexed: metrics.indexed,
                  updated: metrics.updated,
                  skipped: metrics.skipped,
                  failed: metrics.failed,
                },
              },
              "Indexed review graph for file",
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith(REVIEW_GRAPH_FILE_TOO_LARGE_PREFIX)) {
              metrics.skipped += 1;
              files.skipped.push(repoPath);
              opts.logger.debug(
                {
                  repo: input.repo,
                  workspaceKey: input.workspaceKey,
                  path: repoPath,
                  sizeBytes: Number(message.slice(REVIEW_GRAPH_FILE_TOO_LARGE_PREFIX.length)),
                },
                "Skipped review graph index for oversized file",
              );
              continue;
            }
            metrics.failed += 1;
            files.failed.push({ path: repoPath, error: message });
            opts.logger.warn(
              {
                repo: input.repo,
                workspaceKey: input.workspaceKey,
                path: repoPath,
                error: message,
                graphIndexMetrics: {
                  indexed: metrics.indexed,
                  updated: metrics.updated,
                  skipped: metrics.skipped,
                  failed: metrics.failed,
                },
              },
              "Failed to index review graph for file",
            );
          }
        }

        if (unchangedSkipSamples.length > 0) {
          opts.logger.debug(
            {
              repo: input.repo,
              workspaceKey: input.workspaceKey,
              skippedUnchanged: metrics.skipped,
              sample: unchangedSkipSamples,
            },
            "Skipped unchanged review graph files",
          );
        }

        build = await opts.store.upsertBuild({
          repo: input.repo,
          workspaceKey: input.workspaceKey,
          commitSha: input.commitSha ?? null,
          status: metrics.failed > 0 ? "failed" : "completed",
          startedAt: build.startedAt ?? startedAt,
          completedAt: new Date().toISOString(),
          lastError: files.failed[0]?.error ?? null,
          filesIndexed: metrics.indexed,
          filesFailed: metrics.failed,
          nodesWritten: metrics.nodesWritten,
          edgesWritten: metrics.edgesWritten,
        });

        opts.logger.info(
          {
            repo: input.repo,
            workspaceKey: input.workspaceKey,
            commitSha: input.commitSha ?? null,
            discovered: metrics.discovered,
            indexed: metrics.indexed,
            updated: metrics.updated,
            skipped: metrics.skipped,
            failed: metrics.failed,
            nodesWritten: metrics.nodesWritten,
            edgesWritten: metrics.edgesWritten,
          },
          "Completed review graph workspace index",
        );

        return { build, metrics, files };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        build = await opts.store.upsertBuild({
          repo: input.repo,
          workspaceKey: input.workspaceKey,
          commitSha: input.commitSha ?? null,
          status: "failed",
          startedAt: build.startedAt ?? startedAt,
          completedAt: new Date().toISOString(),
          lastError: message,
          filesIndexed: metrics.indexed,
          filesFailed: metrics.failed,
          nodesWritten: metrics.nodesWritten,
          edgesWritten: metrics.edgesWritten,
        });
        throw error;
      }
    },
  };
}

export { computeContentHash, defaultWalkWorkspace, getLanguageForPath };
