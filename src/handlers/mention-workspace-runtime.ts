import type { Logger } from "pino";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { Workspace, WorkspaceManager } from "../jobs/types.ts";
import type { WriteRateLimitStore } from "../lib/mention-state-stores.ts";
import type { MentionEvent } from "./mention-types.ts";
import { resolveMentionForkContext } from "./mention-fork-context.ts";
import { createMentionWriteRateLimitRuntime, type MentionWriteRateLimitRuntime } from "./mention-write-rate-limit.ts";
import { prepareMentionCheckoutAndLoadConfig } from "./mention-workspace.ts";

export async function createMentionWorkspaceRuntime(params: {
  workspaceManager: WorkspaceManager;
  installationId: number;
  forkManager?: ForkManager;
  appSlug: string;
  mention: MentionEvent;
  cloneOwner: string;
  cloneRepo: string;
  cloneRef: string | undefined;
  cloneDepth: number;
  usesPrRef: boolean;
  workspaceStrategy: string;
  writeRateLimitStore: WriteRateLimitStore;
  beforeLoadConfig?: () => void;
  logger: Pick<Logger, "info" | "warn">;
}): Promise<{
  workspace: Workspace;
  forkContext: Awaited<ReturnType<typeof resolveMentionForkContext>>;
  config: Awaited<ReturnType<typeof prepareMentionCheckoutAndLoadConfig>>["config"];
  writeRateLimit: MentionWriteRateLimitRuntime;
}> {
  const forkContext = await resolveMentionForkContext({
    forkManager: params.forkManager,
    appSlug: params.appSlug,
    commentBody: params.mention.commentBody,
    owner: params.mention.owner,
    repo: params.mention.repo,
    cloneRef: params.cloneRef,
    usesPrRef: params.usesPrRef,
    logger: params.logger,
  });

  params.logger.info(
    {
      surface: params.mention.surface,
      owner: params.mention.owner,
      repo: params.mention.repo,
      issueNumber: params.mention.issueNumber,
      prNumber: params.mention.prNumber,
      cloneOwner: params.cloneOwner,
      cloneRepo: params.cloneRepo,
      cloneRef: params.cloneRef,
      cloneDepth: params.cloneDepth,
      usesPrRef: params.usesPrRef,
      workspaceStrategy: params.workspaceStrategy,
    },
    "Creating workspace for mention execution",
  );

  const workspace = await params.workspaceManager.create(params.installationId, {
    owner: params.cloneOwner,
    repo: params.cloneRepo,
    ref: params.cloneRef!,
    depth: params.cloneDepth,
    forkContext,
  });

  params.beforeLoadConfig?.();
  const { config, warnings } = await prepareMentionCheckoutAndLoadConfig({
    workspace,
    usesPrRef: params.usesPrRef,
    mention: params.mention,
    cloneDepth: params.cloneDepth,
  });
  for (const warning of warnings) {
    params.logger.warn(
      { section: warning.section, issues: warning.issues },
      "Config warning detected",
    );
  }

  const writeRateLimit = createMentionWriteRateLimitRuntime({
    store: params.writeRateLimitStore,
    installationId: params.installationId,
    minIntervalSeconds: config.write.minIntervalSeconds,
  });

  return { workspace, forkContext, config, writeRateLimit };
}
