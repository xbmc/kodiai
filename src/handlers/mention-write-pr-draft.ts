import { $ } from "bun";
import { summarizeWriteRequest } from "../lib/write-request-formatting.ts";
import { scanDiffForFabricatedContent } from "./mention-pr-review-diff.ts";
import { generatePrBody, generatePrTitle } from "./mention-write-formatters.ts";

export type MentionWritePullRequestDraft = {
  title: string;
  body: string;
  sourceUrl: string;
  diffStat: string;
  warnings: string[];
};

export async function buildMentionWritePullRequestDraft(params: {
  workspaceDir: string;
  issueTitle: string | null;
  writeRequest: string;
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | undefined;
  triggerCommentUrl: string;
  deliveryId: string;
  headSha: string;
  getDiffStat?: (workspaceDir: string) => Promise<string>;
  scanFabricatedContent?: (workspaceDir: string) => Promise<string[]>;
}): Promise<MentionWritePullRequestDraft> {
  let diffStat = "";
  try {
    diffStat = (await (
      params.getDiffStat?.(params.workspaceDir)
      ?? $`git -C ${params.workspaceDir} diff --stat HEAD~1 HEAD`.quiet().text()
    )).trim();
  } catch {
    // diff stat is best-effort and must not block PR creation.
  }

  let warnings: string[] = [];
  try {
    warnings = await (params.scanFabricatedContent?.(params.workspaceDir)
      ?? scanDiffForFabricatedContent(params.workspaceDir));
  } catch {
    // fabrication scanning is best-effort and must not block PR creation.
  }

  const requestSummary = summarizeWriteRequest(params.writeRequest);
  const isFromPr = params.prNumber !== undefined;
  const sourceUrl = isFromPr
    ? `https://github.com/${params.owner}/${params.repo}/pull/${params.prNumber}`
    : `https://github.com/${params.owner}/${params.repo}/issues/${params.issueNumber}`;

  return {
    title: generatePrTitle(params.issueTitle, requestSummary, isFromPr),
    body: generatePrBody({
      summary: requestSummary,
      issueTitle: params.issueTitle,
      sourceUrl,
      triggerCommentUrl: params.triggerCommentUrl,
      deliveryId: params.deliveryId,
      headSha: params.headSha,
      isFromPr,
      issueNumber: params.issueNumber,
      prNumber: params.prNumber,
      diffStat,
      warnings,
    }),
    sourceUrl,
    diffStat,
    warnings,
  };
}
