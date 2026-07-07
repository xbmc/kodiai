import type { Logger } from "pino";
import { loadRepoConfig, type RepoConfig } from "../execution/config.ts";
import type { ReviewPhaseTiming } from "../execution/types.ts";
import type { Workspace, WorkspaceManager } from "../jobs/types.ts";
import {
  fetchAndCheckoutPullRequestHeadRef,
  fetchRemoteTrackingBranch,
} from "../jobs/workspace.ts";
import { createReviewPhaseTiming } from "../review-orchestration/review-phase-timing.ts";

type RepoConfigLoadResult = Awaited<ReturnType<typeof loadRepoConfig>>;

export type PrepareReviewWorkspaceInput = {
  workspaceManager: Pick<WorkspaceManager, "create">;
  installationId: number;
  owner: string;
  repo: string;
  ref: string;
  depth: number;
  usesPrRef: boolean;
  prNumber: number;
  baseRef: string;
  fallbackHeadRepoFullName?: string | null;
  fallbackHeadRef: string;
  loadRepoConfigFn?: typeof loadRepoConfig;
  fetchAndCheckoutPullRequestHeadRefFn?: typeof fetchAndCheckoutPullRequestHeadRef;
  fetchRemoteTrackingBranchFn?: typeof fetchRemoteTrackingBranch;
  onBeforeFinalizeConfig?: () => void;
  logger: Pick<Logger, "warn">;
  now?: () => number;
};

export type PrepareReviewWorkspaceResult = {
  workspace: Workspace;
  config: RepoConfig;
  workspacePreparationPhase: ReviewPhaseTiming;
};

export type PrepareReviewRetryWorkspaceInput = Omit<
  PrepareReviewWorkspaceInput,
  "loadRepoConfigFn" | "logger" | "now"
> & {
  localBranch: string;
};

export async function prepareReviewWorkspace(
  input: PrepareReviewWorkspaceInput,
): Promise<PrepareReviewWorkspaceResult> {
  const {
    workspaceManager,
    installationId,
    owner,
    repo,
    ref,
    depth,
    usesPrRef,
    prNumber,
    baseRef,
    fallbackHeadRepoFullName,
    fallbackHeadRef,
    logger,
  } = input;
  const now = input.now ?? Date.now;
  const phaseStartedAt = now();
  const loadConfig = input.loadRepoConfigFn ?? loadRepoConfig;
  const checkoutPullRequestHead = input.fetchAndCheckoutPullRequestHeadRefFn ?? fetchAndCheckoutPullRequestHeadRef;
  const fetchBaseBranch = input.fetchRemoteTrackingBranchFn ?? fetchRemoteTrackingBranch;

  const workspace = await createWorkspaceAndFetchReviewRefs({
    workspaceManager,
    installationId,
    owner,
    repo,
    ref,
    depth,
    usesPrRef,
    prNumber,
    baseRef,
    fallbackHeadRepoFullName,
    fallbackHeadRef,
    localBranch: "pr-review",
    fetchAndCheckoutPullRequestHeadRefFn: checkoutPullRequestHead,
    fetchRemoteTrackingBranchFn: fetchBaseBranch,
    beforeCheckoutPullRequestHead: async (createdWorkspace) => {
      if (usesPrRef) {
        return await loadConfig(createdWorkspace.dir);
      }
      return null;
    },
  });

  input.onBeforeFinalizeConfig?.();
  const trustedBaseRepoConfig = workspace.beforeCheckoutResult;
  const configResult: RepoConfigLoadResult = trustedBaseRepoConfig ?? (await loadConfig(workspace.workspace.dir));
  for (const warning of configResult.warnings) {
    logger.warn(
      { section: warning.section, issues: warning.issues },
      "Config warning detected",
    );
  }

  return {
    workspace: workspace.workspace,
    config: configResult.config,
    workspacePreparationPhase: createReviewPhaseTiming({
      name: "workspace preparation",
      status: "completed",
      durationMs: Math.max(0, now() - phaseStartedAt),
    }),
  };
}

export async function prepareReviewRetryWorkspace(
  input: PrepareReviewRetryWorkspaceInput,
): Promise<Workspace> {
  const prepared = await createWorkspaceAndFetchReviewRefs({
    ...input,
    fetchAndCheckoutPullRequestHeadRefFn: input.fetchAndCheckoutPullRequestHeadRefFn ?? fetchAndCheckoutPullRequestHeadRef,
    fetchRemoteTrackingBranchFn: input.fetchRemoteTrackingBranchFn ?? fetchRemoteTrackingBranch,
    beforeCheckoutPullRequestHead: async () => null,
  });
  return prepared.workspace;
}

async function createWorkspaceAndFetchReviewRefs<T>(input: {
  workspaceManager: Pick<WorkspaceManager, "create">;
  installationId: number;
  owner: string;
  repo: string;
  ref: string;
  depth: number;
  usesPrRef: boolean;
  prNumber: number;
  baseRef: string;
  fallbackHeadRepoFullName?: string | null;
  fallbackHeadRef: string;
  localBranch: string;
  fetchAndCheckoutPullRequestHeadRefFn: typeof fetchAndCheckoutPullRequestHeadRef;
  fetchRemoteTrackingBranchFn: typeof fetchRemoteTrackingBranch;
  beforeCheckoutPullRequestHead: (workspace: Workspace) => Promise<T>;
}): Promise<{ workspace: Workspace; beforeCheckoutResult: T }> {
  const workspace = await input.workspaceManager.create(input.installationId, {
    owner: input.owner,
    repo: input.repo,
    ref: input.ref,
    depth: input.depth,
  });

  try {
    const beforeCheckoutResult = await input.beforeCheckoutPullRequestHead(workspace);

    if (input.usesPrRef) {
      await input.fetchAndCheckoutPullRequestHeadRefFn({
        dir: workspace.dir,
        prNumber: input.prNumber,
        localBranch: input.localBranch,
        token: workspace.token,
        fallbackRemoteUrl: input.fallbackHeadRepoFullName ? `https://github.com/${input.fallbackHeadRepoFullName}.git` : undefined,
        fallbackRef: input.fallbackHeadRef,
        depth: input.depth,
      });
    }

    await input.fetchRemoteTrackingBranchFn({
      dir: workspace.dir,
      branch: input.baseRef,
      token: workspace.token,
      depth: input.depth,
    });

    return { workspace, beforeCheckoutResult };
  } catch (err) {
    await workspace.cleanup().catch(() => undefined);
    throw err;
  }
}
