import type { Logger } from "pino";
import { $ } from "bun";
import { buildAuthFetchUrl } from "../jobs/workspace.ts";
import type { PullRequestFileMetadata } from "../lib/github-pr-files.ts";
import { splitGitLines } from "../lib/review-utils.ts";
import { toProductionLogRuntimeBudgetFields } from "../review-audit/production-log-projection.ts";

type DiffCollectionStrategy =
  | "triple-dot"
  | "deepened-triple-dot"
  | "fallback-two-dot"
  | "github-file-list-fallback"
  | "github-pr-files-fallback";

export type DiffCollectionResult = {
  changedFiles: string[];
  numstatLines: string[];
  diffContent?: string;
  strategy: DiffCollectionStrategy;
  mergeBaseRecovered: boolean;
  deepenAttempts: number;
  unshallowAttempted: boolean;
  diffRange: string;
};

type DiffCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type DiffCommandRunner = (args: string[], timeoutMs: number) => Promise<DiffCommandResult>;

type DiffFallbackFile = PullRequestFileMetadata;

export const REVIEW_WORKSPACE_FETCH_DEPTH = 50;
const DIFF_DEEPEN_STEPS = [50, 150, 300];
const DIFF_COMMAND_TIMEOUT_MS = 30_000;

async function hasMergeBase(workspaceDir: string, baseRef: string): Promise<boolean> {
  const mergeBaseResult = await $`git -C ${workspaceDir} merge-base origin/${baseRef} HEAD`.quiet().nothrow();
  return mergeBaseResult.exitCode === 0;
}

async function runDiffCommandWithTimeout(params: {
  workspaceDir: string;
  args: string[];
  timeoutMs: number;
}): Promise<DiffCommandResult> {
  const { workspaceDir, args, timeoutMs } = params;
  const proc = Bun.spawn(["git", "-C", workspaceDir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  try {
    const exitCode = timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? await Promise.race([
          proc.exited,
          new Promise<number>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              try {
                proc.kill();
              } catch {
                // Ignore kill races; the process may have already exited.
              }
              resolve(124);
            }, timeoutMs);
          }),
        ])
      : await proc.exited;

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function buildFallbackPatchDiff(files: DiffFallbackFile[]): string | undefined {
  const chunks = files
    .filter((file) => typeof file.patch === "string" && file.patch.trim().length > 0)
    .map((file) => {
      const oldPath = file.status === "added" ? "/dev/null" : `a/${file.previousFilename ?? file.filename}`;
      const newPath = file.status === "removed" ? "/dev/null" : `b/${file.filename}`;
      return [
        `diff --git a/${file.previousFilename ?? file.filename} b/${file.filename}`,
        `--- ${oldPath}`,
        `+++ ${newPath}`,
        file.patch!.trimEnd(),
      ].join("\n");
    });

  return chunks.length > 0 ? chunks.join("\n") + "\n" : undefined;
}

function buildFallbackNumstatLines(files: DiffFallbackFile[]): string[] {
  return files.map((file) => {
    const additions = typeof file.additions === "number" && Number.isFinite(file.additions) ? String(file.additions) : "-";
    const deletions = typeof file.deletions === "number" && Number.isFinite(file.deletions) ? String(file.deletions) : "-";
    return `${additions}\t${deletions}\t${file.filename}`;
  });
}

async function buildDiffCollectionFallback(params: {
  fallbackFileProvider?: () => Promise<string[]>;
  fallbackDiffProvider?: () => Promise<DiffFallbackFile[]>;
  logger: Logger;
  baseLog: Record<string, unknown>;
  stage: string;
  reason: string;
  deepenAttempts: number;
  unshallowAttempted: boolean;
  mergeBaseRecovered: boolean;
  diffRange: string;
}): Promise<DiffCollectionResult> {
  const {
    fallbackFileProvider,
    fallbackDiffProvider,
    logger,
    baseLog,
    stage,
    reason,
    deepenAttempts,
    unshallowAttempted,
    mergeBaseRecovered,
    diffRange,
  } = params;

  if (fallbackDiffProvider) {
    const fallbackFiles = await fallbackDiffProvider();
    const uniqueFiles = Array.from(new Map(fallbackFiles.map((file) => [file.filename, file])).values());
    const changedFiles = uniqueFiles.map((file) => file.filename);
    const numstatLines = buildFallbackNumstatLines(uniqueFiles);
    const diffContent = buildFallbackPatchDiff(uniqueFiles);
    const patchFilesCount = uniqueFiles.filter((file) => typeof file.patch === "string" && file.patch.trim().length > 0).length;
    const hasCompletePatchFallback = uniqueFiles.length > 0 && patchFilesCount === uniqueFiles.length && diffContent !== undefined;
    const logFallback = hasCompletePatchFallback ? logger.info.bind(logger) : logger.warn.bind(logger);

    logFallback(
      {
        ...baseLog,
        gate: "diff-collection",
        stage,
        reason,
        strategy: "github-pr-files-fallback",
        fallbackEvidenceQuality: hasCompletePatchFallback ? "patch-complete" : "patch-partial",
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
        changedFilesCount: changedFiles.length,
        patchFilesCount,
        diffContentAvailable: diffContent !== undefined,
      },
      hasCompletePatchFallback
        ? "Diff collection used GitHub PR files fallback with patch evidence"
        : "Diff collection degraded to GitHub PR files fallback",
    );

    return {
      changedFiles,
      numstatLines,
      diffContent,
      strategy: "github-pr-files-fallback",
      mergeBaseRecovered,
      deepenAttempts,
      unshallowAttempted,
      diffRange: "github-api:pr-files",
    };
  }

  if (!fallbackFileProvider) {
    throw new Error(`Diff collection timed out during ${stage} (${reason}) and no fallback provider was configured`);
  }

  const changedFiles = Array.from(new Set(await fallbackFileProvider()));
  const boundedFilenameOnlyFallback = changedFiles.length <= 10;
  const logFallback = boundedFilenameOnlyFallback ? logger.info.bind(logger) : logger.warn.bind(logger);

  logFallback(
    {
      ...baseLog,
      gate: "diff-collection",
      stage,
      reason,
      strategy: "github-file-list-fallback",
      fallbackEvidenceQuality: boundedFilenameOnlyFallback ? "filename-only-small" : "filename-only",
      deepenAttempts,
      unshallowAttempted,
      mergeBaseRecovered,
      diffRange,
      changedFilesCount: changedFiles.length,
    },
    "Diff collection degraded to GitHub file-list fallback",
  );

  return {
    changedFiles,
    numstatLines: [],
    diffContent: undefined,
    strategy: "github-file-list-fallback",
    mergeBaseRecovered,
    deepenAttempts,
    unshallowAttempted,
    diffRange: "github-api:file-list",
  };
}

export async function collectDiffContext(params: {
  workspaceDir: string;
  baseRef: string;
  maxFilesForFullDiff: number;
  logger: Logger;
  baseLog: Record<string, unknown>;
  token?: string;
  runGitCommand?: DiffCommandRunner;
  fallbackFileProvider?: () => Promise<string[]>;
  fallbackDiffProvider?: () => Promise<DiffFallbackFile[]>;
  commandTimeoutMs?: number;
}): Promise<DiffCollectionResult> {
  const {
    workspaceDir,
    baseRef,
    maxFilesForFullDiff,
    logger,
    baseLog,
    token,
    runGitCommand,
    fallbackFileProvider,
    fallbackDiffProvider,
    commandTimeoutMs = DIFF_COMMAND_TIMEOUT_MS,
  } = params;

  const diffCommandRunner = runGitCommand
    ?? ((args: string[], timeoutMs: number) =>
      runDiffCommandWithTimeout({ workspaceDir, args, timeoutMs }));

  let strategy: DiffCollectionStrategy = "triple-dot";
  let mergeBaseRecovered = false;
  let deepenAttempts = 0;
  let unshallowAttempted = false;

  // Build auth-injected remote URL once for all fetch calls in this function.
  const fetchRemote = await buildAuthFetchUrl(workspaceDir, token);

  let mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
  if (!mergeBaseAvailable) {
    logger.info(
      {
        ...baseLog,
        gate: "diff-collection",
        stage: "merge-base-recovery",
        baseRef,
        ...toProductionLogRuntimeBudgetFields(commandTimeoutMs),
      },
      "Merge base missing before diff collection; attempting history recovery",
    );

    for (const step of DIFF_DEEPEN_STEPS) {
      deepenAttempts += 1;
      logger.info(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "merge-base-recovery",
          attempt: deepenAttempts,
          deepenBy: step,
          ...toProductionLogRuntimeBudgetFields(commandTimeoutMs),
        },
        "Attempting diff collection merge-base recovery",
      );

      const deepenResult = await diffCommandRunner(
        ["fetch", fetchRemote, `+${baseRef}:refs/remotes/origin/${baseRef}`, `--deepen=${step}`],
        commandTimeoutMs,
      );
      if (deepenResult.timedOut) {
        return await buildDiffCollectionFallback({
          fallbackFileProvider,
          fallbackDiffProvider,
          logger,
          baseLog,
          stage: "merge-base-recovery",
          reason: `fetch-timeout-deepen-${step}`,
          deepenAttempts,
          unshallowAttempted,
          mergeBaseRecovered,
          diffRange: `origin/${baseRef}...HEAD`,
        });
      }

      mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
      if (mergeBaseAvailable) {
        mergeBaseRecovered = true;
        strategy = "deepened-triple-dot";
        break;
      }
    }

    if (!mergeBaseAvailable) {
      unshallowAttempted = true;
      logger.info(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "merge-base-recovery",
          attempt: deepenAttempts + 1,
          mode: "unshallow",
          ...toProductionLogRuntimeBudgetFields(commandTimeoutMs),
        },
        "Attempting diff collection full-history recovery",
      );

      const unshallowResult = await diffCommandRunner(
        ["fetch", fetchRemote, `+${baseRef}:refs/remotes/origin/${baseRef}`, "--unshallow"],
        commandTimeoutMs,
      );
      if (unshallowResult.timedOut) {
        return await buildDiffCollectionFallback({
          fallbackFileProvider,
          fallbackDiffProvider,
          logger,
          baseLog,
          stage: "merge-base-recovery",
          reason: "fetch-timeout-unshallow",
          deepenAttempts,
          unshallowAttempted,
          mergeBaseRecovered,
          diffRange: `origin/${baseRef}...HEAD`,
        });
      }

      mergeBaseAvailable = await hasMergeBase(workspaceDir, baseRef);
      if (mergeBaseAvailable) {
        mergeBaseRecovered = true;
        strategy = "deepened-triple-dot";
      }
    }
  }

  let diffRange = mergeBaseAvailable ? `origin/${baseRef}...HEAD` : `origin/${baseRef}..HEAD`;
  if (!mergeBaseAvailable) {
    strategy = "fallback-two-dot";
  }

  let nameOnlyResult = await diffCommandRunner(["diff", diffRange, "--name-only"], commandTimeoutMs);
  if (nameOnlyResult.timedOut) {
    return await buildDiffCollectionFallback({
      fallbackFileProvider,
      fallbackDiffProvider,
      logger,
      baseLog,
      stage: "name-only",
      reason: `diff-timeout-${diffRange}-name-only`,
      deepenAttempts,
      unshallowAttempted,
      mergeBaseRecovered,
      diffRange,
    });
  }

  if (nameOnlyResult.exitCode !== 0 && diffRange.includes("...")) {
    strategy = "fallback-two-dot";
    diffRange = `origin/${baseRef}..HEAD`;
    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        strategy,
        reason: "triple-dot-diff-failed",
      },
      "Triple-dot diff failed; retrying with deterministic fallback range",
    );
    nameOnlyResult = await diffCommandRunner(["diff", diffRange, "--name-only"], commandTimeoutMs);
    if (nameOnlyResult.timedOut) {
      return await buildDiffCollectionFallback({
        fallbackFileProvider,
        fallbackDiffProvider,
        logger,
        baseLog,
        stage: "name-only",
        reason: `diff-timeout-${diffRange}-name-only`,
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
      });
    }
    if (nameOnlyResult.exitCode !== 0) {
      return await buildDiffCollectionFallback({
        fallbackFileProvider,
        fallbackDiffProvider,
        logger,
        baseLog,
        stage: "name-only",
        reason: `diff-failed-${diffRange}-name-only`,
        deepenAttempts,
        unshallowAttempted,
        mergeBaseRecovered,
        diffRange,
      });
    }
  } else if (nameOnlyResult.exitCode !== 0) {
    throw new Error(`git diff ${diffRange} --name-only failed with exit code ${nameOnlyResult.exitCode}`);
  }

  const changedFiles = splitGitLines(nameOnlyResult.stdout);

  const numstatOutput = await diffCommandRunner(["diff", diffRange, "--numstat"], commandTimeoutMs);
  let numstatLines: string[] = [];
  if (numstatOutput.timedOut) {
    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        stage: "numstat",
        diffRange,
        ...toProductionLogRuntimeBudgetFields(commandTimeoutMs),
      },
      "Diff numstat collection timed out; continuing without numstat",
    );
  } else if (numstatOutput.exitCode !== 0) {
    logger.warn(
      {
        ...baseLog,
        gate: "diff-collection",
        stage: "numstat",
        diffRange,
        exitCode: numstatOutput.exitCode,
      },
      "Diff numstat collection failed; continuing without numstat",
    );
  } else {
    numstatLines = splitGitLines(numstatOutput.stdout);
  }

  let diffContent: string | undefined;
  if (changedFiles.length <= maxFilesForFullDiff) {
    const fullDiff = await diffCommandRunner(["diff", diffRange], commandTimeoutMs);
    if (fullDiff.timedOut) {
      logger.warn(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "full-diff",
          diffRange,
          changedFilesCount: changedFiles.length,
          ...toProductionLogRuntimeBudgetFields(commandTimeoutMs),
        },
        "Full diff collection timed out; continuing without full diff",
      );
    } else if (fullDiff.exitCode !== 0) {
      logger.warn(
        {
          ...baseLog,
          gate: "diff-collection",
          stage: "full-diff",
          diffRange,
          changedFilesCount: changedFiles.length,
          exitCode: fullDiff.exitCode,
        },
        "Full diff collection failed; continuing without full diff",
      );
    } else {
      diffContent = fullDiff.stdout;
    }
  }

  logger.info(
    {
      ...baseLog,
      gate: "diff-collection",
      strategy,
      deepenAttempts,
      unshallowAttempted,
      mergeBaseRecovered,
      diffRange,
      changedFilesCount: changedFiles.length,
    },
    "Collected diff context for review",
  );

  return {
    changedFiles,
    numstatLines,
    diffContent,
    strategy,
    mergeBaseRecovered,
    deepenAttempts,
    unshallowAttempted,
    diffRange,
  };
}