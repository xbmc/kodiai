import type { Logger } from "pino";
import { collectCappedPrDiff } from "./mention-workspace.ts";
import type { MentionEvent } from "./mention-types.ts";

export type MentionPrDiffContext = {
  stat: string;
  diff: string;
  truncated: boolean;
  fileCount: number;
};

export async function resolveMentionPrDiffContext(params: {
  allowPrDiffContext: boolean;
  writeEnabled: boolean;
  mention: Pick<MentionEvent, "surface" | "prNumber" | "baseRef">;
  workspaceDir: string;
  logger: Logger;
  collectDiff?: typeof collectCappedPrDiff;
}): Promise<MentionPrDiffContext | undefined> {
  if (
    !params.allowPrDiffContext
    || params.mention.prNumber === undefined
    || !params.mention.baseRef
    || params.writeEnabled
  ) {
    return undefined;
  }

  try {
    const prDiffContext = await (params.collectDiff ?? collectCappedPrDiff)({
      workspaceDir: params.workspaceDir,
      baseRef: params.mention.baseRef,
      logger: params.logger,
      logContext: {
        surface: params.mention.surface,
        prNumber: params.mention.prNumber,
        baseRef: params.mention.baseRef,
      },
    });
    if (prDiffContext) {
      params.logger.debug(
        {
          surface: params.mention.surface,
          prNumber: params.mention.prNumber,
          fileCount: prDiffContext.fileCount,
          truncated: prDiffContext.truncated,
        },
        "Pre-fetched PR diff for mention context",
      );
    }
    return prDiffContext;
  } catch {
    return undefined;
  }
}
