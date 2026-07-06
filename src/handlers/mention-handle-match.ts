export function buildAcceptedMentionHandles(params: {
  appSlug: string;
  acceptClaudeAlias: boolean;
}): string[] {
  const handles = params.acceptClaudeAlias
    ? [params.appSlug, "kodai", "claude"]
    : [params.appSlug, "kodai"];

  return handles.map(normalizeMentionHandle);
}

export function mentionBodyMatchesAcceptedHandles(
  commentBody: string,
  acceptedHandles: readonly string[],
): boolean {
  const body = commentBody.toLowerCase();
  return acceptedHandles.some((handle) => body.includes(handle));
}

function normalizeMentionHandle(handle: string): string {
  const prefixed = handle.startsWith("@") ? handle : `@${handle}`;
  return prefixed.toLowerCase();
}
