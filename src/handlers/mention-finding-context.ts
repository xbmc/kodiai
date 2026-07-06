import type { Logger } from "pino";
import type { FindingByCommentId } from "../knowledge/types.ts";

export type MentionFindingLookup = (
  repo: string,
  commentId: number,
) => Promise<FindingByCommentId | null> | FindingByCommentId | null;

export async function hydrateMentionFindingContext(params: {
  owner: string;
  repo: string;
  inReplyToId: number | undefined;
  findingLookup: MentionFindingLookup | undefined;
  logger: Pick<Logger, "warn">;
}): Promise<FindingByCommentId | undefined> {
  if (params.inReplyToId === undefined || !params.findingLookup) {
    return undefined;
  }

  try {
    return (await params.findingLookup(
      `${params.owner}/${params.repo}`,
      params.inReplyToId,
    )) ?? undefined;
  } catch (err) {
    params.logger.warn(
      {
        err,
        owner: params.owner,
        repo: params.repo,
        inReplyToId: params.inReplyToId,
      },
      "Failed to hydrate finding context; proceeding without finding metadata",
    );
    return undefined;
  }
}
