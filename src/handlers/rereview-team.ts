import type { Logger } from "pino";

function normalizeConfiguredTeam(team: string): string {
  const trimmed = team.trim().toLowerCase();
  if (trimmed.length === 0) return "";
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

export function buildRereviewTeamCandidates(team: string): string[] {
  const primary = normalizeConfiguredTeam(team);
  if (primary.length === 0) return [];

  const candidates = new Set<string>([primary]);
  if (primary === "ai-review") candidates.add("aireview");
  if (primary === "aireview") candidates.add("ai-review");
  return Array.from(candidates);
}

function getStatusCode(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as { status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

export async function requestRereviewTeamBestEffort(options: {
  octokit: {
    rest: {
      pulls: {
        listRequestedReviewers: (params: {
          owner: string;
          repo: string;
          pull_number: number;
        }) => Promise<{ data: { teams?: Array<{ slug?: string | null; name?: string | null }> } }>;
        requestReviewers: (params: {
          owner: string;
          repo: string;
          pull_number: number;
          team_reviewers: string[];
        }) => Promise<unknown>;
      };
    };
  };
  owner: string;
  repo: string;
  prNumber: number;
  configuredTeam: string;
  logger: Logger;
}): Promise<{ requestedTeam?: string; alreadyRequested: boolean }> {
  const { octokit, owner, repo, prNumber, configuredTeam, logger } = options;
  const candidates = buildRereviewTeamCandidates(configuredTeam);
  if (candidates.length === 0) return { alreadyRequested: false };

  try {
    const requested = await octokit.rest.pulls.listRequestedReviewers({
      owner,
      repo,
      pull_number: prNumber,
    });

    const already = (requested.data.teams ?? []).some((team) => {
      const slug = (team.slug ?? "").trim().toLowerCase();
      const name = (team.name ?? "").trim().toLowerCase();
      return candidates.includes(slug) || candidates.includes(name);
    });
    if (already) return { alreadyRequested: true };
  } catch (err) {
    logger.warn(
      { err, owner, repo, prNumber, configuredTeam },
      "Failed to list requested reviewers; attempting rereview request anyway",
    );
  }

  for (const candidate of candidates) {
    try {
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: prNumber,
        team_reviewers: [candidate],
      });
      return { requestedTeam: candidate, alreadyRequested: false };
    } catch (err) {
      const status = getStatusCode(err);
      const canFallback = status === 422 && candidate !== candidates[candidates.length - 1];
      logger.warn(
        {
          err,
          owner,
          repo,
          prNumber,
          configuredTeam,
          candidate,
          status,
          fallbackRemaining: canFallback,
        },
        "Failed to request rereview team candidate",
      );
      if (!canFallback) break;
    }
  }

  return { alreadyRequested: false };
}
