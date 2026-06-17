export type ReactionEntry = {
  id: number;
  content: string;
  user?: {
    login?: string;
    type?: string;
  } | null;
  created_at?: string | null;
};

export function normalizeGitHubLogin(login: string | undefined): string {
  return (login ?? "").trim().toLowerCase().replace(/\[bot\]$/i, "");
}

export function isHumanThumbReaction(reaction: ReactionEntry, appSlug: string): boolean {
  if (reaction.content !== "+1" && reaction.content !== "-1") return false;

  const userType = (reaction.user?.type ?? "").toLowerCase();
  if (userType === "bot") return false;

  const reactorLogin = normalizeGitHubLogin(reaction.user?.login);
  if (reactorLogin.length === 0) return false;
  if (reactorLogin === normalizeGitHubLogin(appSlug)) return false;

  return true;
}
