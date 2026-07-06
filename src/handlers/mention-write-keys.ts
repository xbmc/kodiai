import { createHash } from "node:crypto";

export function buildWriteOutputKey(input: {
  installationId: number;
  owner: string;
  repo: string;
  sourceType: "pr" | "issue";
  sourceNumber: number;
  commentId: number;
  keyword: string;
}): string {
  const normalizedOwner = input.owner.trim().toLowerCase();
  const normalizedRepo = input.repo.trim().toLowerCase();
  const normalizedKeyword = input.keyword.trim().toLowerCase();

  return [
    "kodiai-write-output",
    "v1",
    `inst-${input.installationId}`,
    `${normalizedOwner}/${normalizedRepo}`,
    `${input.sourceType}-${input.sourceNumber}`,
    `comment-${input.commentId}`,
    `keyword-${normalizedKeyword}`,
  ].join(":");
}

export function buildWriteBranchName(params: {
  sourceType: "pr" | "issue";
  sourceNumber: number;
  commentId: number;
  writeOutputKey: string;
}): string {
  const hash = createHash("sha256").update(params.writeOutputKey).digest("hex").slice(0, 12);
  return `kodiai/apply/${params.sourceType}-${params.sourceNumber}-comment-${params.commentId}-${hash}`;
}

export function buildMentionTriggerCommentUrl(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | undefined;
  commentId: number;
}): string {
  return params.prNumber !== undefined
    ? `https://github.com/${params.owner}/${params.repo}/pull/${params.prNumber}#issuecomment-${params.commentId}`
    : `https://github.com/${params.owner}/${params.repo}/issues/${params.issueNumber}#issuecomment-${params.commentId}`;
}

export function buildMentionWriteContext(params: {
  writeEnabled: boolean;
  writeKeyword: string;
  writeRequest: string;
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  prNumber: number | undefined;
  commentId: number;
  appSlug: string;
}): {
  writeSource: { type: "pr" | "issue"; number: number };
  retryCommand: string;
  triggerCommentUrl: string;
  writeOutputKey?: string;
  writeBranchName?: string;
} {
  const writeSource =
    params.prNumber !== undefined
      ? { type: "pr" as const, number: params.prNumber }
      : { type: "issue" as const, number: params.issueNumber };
  const retryCommand =
    params.writeRequest.trim().length > 0
      ? `@${params.appSlug} ${params.writeKeyword}: ${params.writeRequest}`
      : `@${params.appSlug} ${params.writeKeyword}: <same request>`;
  const writeOutputKey = params.writeEnabled
    ? buildWriteOutputKey({
        installationId: params.installationId,
        owner: params.owner,
        repo: params.repo,
        sourceType: writeSource.type,
        sourceNumber: writeSource.number,
        commentId: params.commentId,
        keyword: params.writeKeyword,
      })
    : undefined;

  return {
    writeSource,
    retryCommand,
    triggerCommentUrl: buildMentionTriggerCommentUrl(params),
    ...(writeOutputKey
      ? {
          writeOutputKey,
          writeBranchName: buildWriteBranchName({
            sourceType: writeSource.type,
            sourceNumber: writeSource.number,
            commentId: params.commentId,
            writeOutputKey,
          }),
        }
      : {}),
  };
}
