/**
 * Heuristic identity matcher for suggesting GitHub <-> Slack links.
 * Uses Levenshtein distance to find similar usernames/display names.
 */

type MatchConfidence = "high" | "medium";

export type PotentialMatch = {
  slackUserId: string;
  displayName: string;
  confidence: MatchConfidence;
};

/**
 * Compute Levenshtein distance between two strings.
 * Standard dynamic programming approach — O(m*n) time and space.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0) as number[],
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .trim();
}

function getMaxDistance(name: string): number {
  return name.length <= 8 ? 2 : 3;
}

/**
 * Find potential Slack matches for a GitHub user based on username/display name similarity.
 * Returns up to 3 matches sorted by confidence (high first).
 */
export function findPotentialMatches(params: {
  githubUsername: string;
  githubDisplayName: string | null;
  slackMembers: Array<{
    userId: string;
    displayName: string;
    realName: string;
  }>;
}): PotentialMatch[] {
  const { githubUsername, githubDisplayName, slackMembers } = params;
  const normalizedGithub = normalize(githubUsername);
  const normalizedGithubDisplay = githubDisplayName
    ? normalize(githubDisplayName)
    : null;

  const matches: PotentialMatch[] = [];

  for (const member of slackMembers) {
    const normalizedDisplay = normalize(member.displayName);
    const normalizedReal = normalize(member.realName);

    // Skip empty names
    if (!normalizedDisplay && !normalizedReal) continue;

    let confidence: MatchConfidence | null = null;

    // Check exact matches
    if (
      normalizedGithub === normalizedDisplay ||
      normalizedGithub === normalizedReal
    ) {
      confidence = "high";
    } else if (
      normalizedGithubDisplay &&
      (normalizedGithubDisplay === normalizedDisplay ||
        normalizedGithubDisplay === normalizedReal)
    ) {
      confidence = "high";
    }

    // Check Levenshtein distance for close matches
    if (!confidence) {
      const namesToCheck = [normalizedDisplay, normalizedReal].filter(Boolean);
      const githubNames = [normalizedGithub];
      if (normalizedGithubDisplay) githubNames.push(normalizedGithubDisplay);

      for (const gName of githubNames) {
        for (const sName of namesToCheck) {
          const maxDist = getMaxDistance(gName);
          const dist = levenshteinDistance(gName, sName);
          if (dist > 0 && dist <= maxDist) {
            confidence = "medium";
            break;
          }
        }
        if (confidence) break;
      }
    }

    if (confidence) {
      matches.push({
        slackUserId: member.userId,
        displayName: member.displayName || member.realName,
        confidence,
      });
    }
  }

  // Sort by confidence (high first), then limit to 3
  matches.sort((a, b) => {
    if (a.confidence === b.confidence) return 0;
    return a.confidence === "high" ? -1 : 1;
  });

  return matches.slice(0, 3);
}
