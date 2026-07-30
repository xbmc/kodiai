import type { Logger } from "pino";
import { runCommandWithCappedLines } from "../lib/capped-process.ts";
import { collectDiffContext } from "../review-orchestration/review-diff-collection.ts";
import { scanLinesForFabricatedContent } from "../lib/fabricated-content-detector.ts";
import type { MentionEvent } from "./mention-types.ts";

export const FABRICATED_CONTENT_DIFF_MAX_BYTES = 2 * 1024 * 1024;
export const FABRICATED_CONTENT_MAX_WARNINGS = 100;

export type FabricatedContentScanResult = {
  warnings: string[];
  complete: boolean;
  reason?: "command-failed" | "output-truncated";
};

type RunDiffLines = (params: Parameters<typeof runCommandWithCappedLines>[0]) =>
  ReturnType<typeof runCommandWithCappedLines>;

export async function scanDiffForFabricatedContent(
  dir: string,
  runDiffLines: RunDiffLines = runCommandWithCappedLines,
): Promise<FabricatedContentScanResult> {
  const warnings = new Set<string>();
  let insideHunk = false;
  let result: Awaited<ReturnType<RunDiffLines>>;
  try {
    result = await runDiffLines({
      command: "git",
      args: ["-C", dir, "diff", "HEAD~1", "HEAD"],
      maxStdoutBytes: FABRICATED_CONTENT_DIFF_MAX_BYTES,
      onStdoutLine: (line) => {
        if (line.startsWith("diff --git ")) {
          insideHunk = false;
          return;
        }
        if (line.startsWith("@@")) {
          insideHunk = true;
          return;
        }
        if (!insideHunk || !line.startsWith("+") || warnings.size >= FABRICATED_CONTENT_MAX_WARNINGS) {
          return;
        }
        for (const warning of scanLinesForFabricatedContent([line])) {
          warnings.add(warning);
          if (warnings.size >= FABRICATED_CONTENT_MAX_WARNINGS) break;
        }
      },
    });
  } catch {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  if (result.timedOut) {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  if (result.stdoutTruncated) {
    return {
      warnings: [...warnings],
      complete: false,
      reason: "output-truncated",
    };
  }

  if (result.exitCode !== 0) {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  return {
    warnings: [...warnings],
    complete: true,
  };
}

export async function collectPrReviewPromptDiff(input: {
  workspaceDir: string;
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  surface: MentionEvent["surface"];
  logger: Logger;
  token?: string;
  fallbackFileProvider?: () => Promise<string[]>;
  fallbackDiffProvider?: () => Promise<Array<{
    filename: string;
    status?: string;
    previousFilename?: string;
    additions?: number | null;
    deletions?: number | null;
    patch?: string | null;
  }>>;
}): Promise<{
  changedFiles: string[];
  numstatLines: string[];
  diffRange: string;
  diffContent?: string;
}> {
  const diffContext = await collectDiffContext({
    workspaceDir: input.workspaceDir,
    baseRef: input.baseRef,
    maxFilesForFullDiff: 0,
    logger: input.logger,
    baseLog: {
      surface: input.surface,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
    },
    token: input.token,
    fallbackFileProvider: input.fallbackFileProvider,
    fallbackDiffProvider: input.fallbackDiffProvider,
  });

  return {
    changedFiles: diffContext.changedFiles,
    numstatLines: diffContext.numstatLines,
    diffRange: diffContext.diffRange,
    diffContent: diffContext.diffContent,
  };
}
