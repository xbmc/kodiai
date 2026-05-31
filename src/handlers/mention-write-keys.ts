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
