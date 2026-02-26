/**
 * Fire-and-forget identity suggestion DMs for unlinked GitHub users.
 *
 * When a contributor has no linked profile, this module checks for
 * potential Slack matches using heuristic name matching and sends
 * a one-time DM suggesting they link their accounts.
 *
 * Completely fail-open: any error is logged and silently ignored.
 */

import type { Logger } from "pino";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { findPotentialMatches } from "../contributor/identity-matcher.ts";

type SlackMember = {
  userId: string;
  displayName: string;
  realName: string;
};

/** Cache Slack member list for 1 hour to avoid hammering the API. */
let cachedMembers: SlackMember[] | null = null;
let cachedMembersAt = 0;
const MEMBER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Track which GitHub usernames we've already suggested to avoid repeats. */
const suggestedUsernames = new Set<string>();

async function fetchSlackMembers(
  botToken: string,
  logger: Logger,
): Promise<SlackMember[]> {
  const now = Date.now();
  if (cachedMembers && now - cachedMembersAt < MEMBER_CACHE_TTL_MS) {
    return cachedMembers;
  }

  const response = await fetch("https://slack.com/api/users.list", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Slack users.list HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    members?: Array<{
      id: string;
      deleted?: boolean;
      is_bot?: boolean;
      profile?: { display_name?: string; real_name?: string };
    }>;
  };

  if (!data.ok) {
    throw new Error(`Slack users.list failed: ${data.error ?? "unknown"}`);
  }

  const members: SlackMember[] = (data.members ?? [])
    .filter((m) => !m.deleted && !m.is_bot)
    .map((m) => ({
      userId: m.id,
      displayName: m.profile?.display_name ?? "",
      realName: m.profile?.real_name ?? "",
    }));

  cachedMembers = members;
  cachedMembersAt = now;
  logger.debug({ memberCount: members.length }, "Slack member list cached");
  return members;
}

async function sendSuggestionDM(
  botToken: string,
  slackUserId: string,
  githubUsername: string,
  logger: Logger,
): Promise<void> {
  // Open a DM channel
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: slackUserId }),
    signal: AbortSignal.timeout(10_000),
  });

  const openData = (await openRes.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { id: string };
  };

  if (!openData.ok || !openData.channel?.id) {
    throw new Error(
      `Slack conversations.open failed: ${openData.error ?? "no channel"}`,
    );
  }

  const channelId = openData.channel.id;
  const message =
    `I noticed GitHub user \`${githubUsername}\` submitted a PR. ` +
    `Their profile looks similar to yours. You can link your accounts with ` +
    `\`/kodiai link ${githubUsername}\` to get personalized code reviews.`;

  const msgRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text: message }),
    signal: AbortSignal.timeout(10_000),
  });

  const msgData = (await msgRes.json()) as {
    ok?: boolean;
    error?: string;
  };

  if (!msgData.ok) {
    throw new Error(
      `Slack chat.postMessage failed: ${msgData.error ?? "unknown"}`,
    );
  }

  logger.info(
    { githubUsername, slackUserId },
    "Identity suggestion DM sent",
  );
}

/**
 * Check for potential Slack matches for an unlinked GitHub user and
 * send a one-time DM suggesting they link their accounts.
 *
 * Only suggests for high-confidence matches to avoid spam.
 * Tracks previously suggested usernames in memory (resets on restart).
 */
export async function suggestIdentityLink(params: {
  githubUsername: string;
  githubDisplayName: string | null;
  slackBotToken: string;
  profileStore: ContributorProfileStore;
  logger: Logger;
}): Promise<void> {
  const { githubUsername, githubDisplayName, slackBotToken, profileStore, logger } =
    params;

  // Skip if we've already suggested for this username
  if (suggestedUsernames.has(githubUsername)) return;

  // Check if they already have a linked profile
  const existing = await profileStore.getByGithubUsername(githubUsername);
  if (existing?.slackUserId) return;

  const members = await fetchSlackMembers(slackBotToken, logger);
  const matches = findPotentialMatches({
    githubUsername,
    githubDisplayName,
    slackMembers: members,
  });

  // Only send DMs for high-confidence matches
  const highMatches = matches.filter((m) => m.confidence === "high");
  if (highMatches.length === 0) {
    suggestedUsernames.add(githubUsername);
    return;
  }

  // Send DM to the first high-confidence match
  const match = highMatches[0]!;
  await sendSuggestionDM(slackBotToken, match.slackUserId, githubUsername, logger);
  suggestedUsernames.add(githubUsername);
}
