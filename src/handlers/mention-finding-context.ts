import type { Logger } from "pino";
import type { FindingByCommentId, KnowledgeStore } from "../knowledge/types.ts";

export type MentionFindingLookup = (
  repo: string,
  commentId: number,
) => Promise<FindingByCommentId | null> | FindingByCommentId | null;

export function createMentionFindingLookup(
  knowledgeStore: Pick<KnowledgeStore, "getFindingByCommentId"> | undefined,
): MentionFindingLookup | undefined {
  if (!knowledgeStore?.getFindingByCommentId) {
    return undefined;
  }

  return (repo, commentId) => knowledgeStore.getFindingByCommentId!({ repo, commentId });
}

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
