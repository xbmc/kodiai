import type { Logger } from "pino";
import { runCommandWithCappedLines } from "../lib/capped-process.ts";
import { collectDiffContext } from "../review-orchestration/review-diff-collection.ts";
import { scanLinesForFabricatedContent } from "../lib/fabricated-content-detector.ts";
import type { MentionEvent } from "./mention-types.ts";

export const FABRICATED_CONTENT_DIFF_MAX_BYTES = 2 * 1024 * 1024;
export const FABRICATED_CONTENT_DIFF_TIMEOUT_MS = 30_000;
export const FABRICATED_CONTENT_MAX_WARNINGS = 100;
const FABRICATED_CONTENT_WARNING_OVERFLOW =
  "Additional fabricated-content warnings omitted after reaching the limit.";

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
  let warningOverflow = false;
  let hunkPrefixWidth = 0;
  let result: Awaited<ReturnType<RunDiffLines>>;
  try {
    result = await runDiffLines({
      command: "git",
      args: [
        "-C",
        dir,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--text",
        "--no-color",
        "HEAD~1",
        "HEAD",
      ],
      env: { GIT_NO_REPLACE_OBJECTS: "1" },
      timeoutMs: FABRICATED_CONTENT_DIFF_TIMEOUT_MS,
      maxStdoutBytes: FABRICATED_CONTENT_DIFF_MAX_BYTES,
      onStdoutLine: (line) => {
        if (
          line.startsWith("diff --git ")
          || line.startsWith("diff --cc ")
          || line.startsWith("diff --combined ")
        ) {
          hunkPrefixWidth = 0;
          return;
        }

        const hunkHeader = /^(@{2,}) /.exec(line);
        const hunkMarkerWidth = hunkHeader?.[1]?.length;
        if (hunkMarkerWidth !== undefined) {
          hunkPrefixWidth = hunkMarkerWidth - 1;
          return;
        }

        if (hunkPrefixWidth === 0) {
          return;
        }

        const hunkPrefix = line.slice(0, hunkPrefixWidth);
        if (!hunkPrefix.includes("+")) {
          return;
        }

        const addedContent = `+${line.slice(hunkPrefixWidth)}`;
        for (const warning of scanLinesForFabricatedContent([addedContent])) {
          if (warnings.has(warning)) continue;
          if (warnings.size < FABRICATED_CONTENT_MAX_WARNINGS - 1) {
            warnings.add(warning);
          } else {
            warningOverflow = true;
          }
        }
      },
    });
  } catch {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  if (result.timedOut) {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  if (result.stderrTruncated) {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  if (result.stdoutTruncated) {
    return {
      warnings: warningOverflow
        ? [...warnings, FABRICATED_CONTENT_WARNING_OVERFLOW]
        : [...warnings],
      complete: false,
      reason: "output-truncated",
    };
  }

  if (result.exitCode !== 0) {
    return { warnings: [], complete: false, reason: "command-failed" };
  }

  return {
    warnings: warningOverflow
      ? [...warnings, FABRICATED_CONTENT_WARNING_OVERFLOW]
      : [...warnings],
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
