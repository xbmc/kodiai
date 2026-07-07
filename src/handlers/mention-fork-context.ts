import type { ForkManager } from "../jobs/fork-manager.ts";
import { stripMention } from "./mention-types.ts";
import { parseWriteIntent } from "./mention-write-formatters.ts";

export type MentionForkContext = {
  forkOwner: string;
  forkRepo: string;
  botPat: string;
};

export type MentionForkContextLogger = {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
};

export async function resolveMentionForkContext(params: {
  forkManager?: ForkManager;
  appSlug: string;
  commentBody: string;
  owner: string;
  repo: string;
  cloneRef: string | undefined;
  usesPrRef: boolean;
  logger: MentionForkContextLogger;
}): Promise<MentionForkContext | undefined> {
  const prelimWriteIntent = parseWriteIntent(
    stripMention(params.commentBody, [params.appSlug, "claude"]),
  );
  const maybeWriteMode = prelimWriteIntent.writeIntent && prelimWriteIntent.keyword !== "plan";

  if (maybeWriteMode && !params.forkManager?.enabled) {
    params.logger.warn(
      { owner: params.owner, repo: params.repo },
      "Write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
    );
  }

  if (!params.forkManager?.enabled || !maybeWriteMode || params.usesPrRef) {
    return undefined;
  }

  try {
    const fork = await params.forkManager.ensureFork(params.owner, params.repo);
    await params.forkManager.syncFork(fork.forkOwner, fork.forkRepo, params.cloneRef!);
    const forkContext = {
      forkOwner: fork.forkOwner,
      forkRepo: fork.forkRepo,
      botPat: params.forkManager.getBotPat(),
    };
    params.logger.info(
      {
        owner: params.owner,
        repo: params.repo,
        forkOwner: fork.forkOwner,
        forkRepo: fork.forkRepo,
      },
      "Fork ensured and synced for write-mode",
    );
    return forkContext;
  } catch (forkErr) {
    params.logger.warn(
      { err: forkErr, owner: params.owner, repo: params.repo },
      "Fork setup failed; will fall back to gist or legacy mode",
    );
    return undefined;
  }
}
