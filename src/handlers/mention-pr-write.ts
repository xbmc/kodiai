import { $ } from "bun";
import { fetchRemoteTrackingBranch } from "../jobs/workspace.ts";

type SameRepoPrHeadInput = {
  owner: string;
  repo: string;
  headRepoOwner?: string;
  headRepoName?: string;
  headRef?: string;
};

type RemoteMarkerLookupInput = {
  dir: string;
  branch: string;
  token?: string;
  marker: string;
  depth?: number;
};

function normalizeRepoName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isSameRepoPrHead(input: SameRepoPrHeadInput): boolean {
  return normalizeRepoName(input.headRepoOwner) === normalizeRepoName(input.owner)
    && normalizeRepoName(input.headRepoName) === normalizeRepoName(input.repo)
    && typeof input.headRef === "string"
    && input.headRef.length > 0;
}

export function buildWriteOutputIdempotencyMarker(writeOutputKey: string): string {
  return `kodiai-write-output-key: ${writeOutputKey}`;
}

export async function remoteHeadContainsMarker(input: RemoteMarkerLookupInput): Promise<boolean> {
  await fetchRemoteTrackingBranch({
    dir: input.dir,
    branch: input.branch,
    token: input.token,
    depth: input.depth ?? 50,
  });
  const recentMessages = (
    await $`git -C ${input.dir} log -n 50 --pretty=%B refs/remotes/origin/${input.branch}`.quiet()
  ).text();
  return recentMessages.includes(input.marker);
}
