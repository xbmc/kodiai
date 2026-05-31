import { $ } from "bun";
import type { Logger } from "pino";
import { collectDiffContext } from "../review-orchestration/review-diff-collection.ts";
import { scanLinesForFabricatedContent } from "../lib/mention-utils.ts";
import type { MentionEvent } from "./mention-types.ts";

export async function scanDiffForFabricatedContent(dir: string): Promise<string[]> {
  let diffText: string;
  try {
    diffText = (await $`git -C ${dir} diff HEAD~1 HEAD`.quiet()).text();
  } catch {
    return [];
  }

  const addedLines = diffText
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

  return scanLinesForFabricatedContent(addedLines);
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
