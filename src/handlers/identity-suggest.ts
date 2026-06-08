/**
 * Fire-and-forget identity suggestion DMs for unlinked GitHub users.
 *
 * When a contributor has no linked profile, this module checks for
 * potential Slack matches using heuristic name matching and sends
 * a one-time DM suggesting they link their accounts.
 *
 * Completely fail-open: any error is logged and silently ignored.
 */

import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { findPotentialMatches } from "../contributor/identity-matcher.ts";
import { createInMemoryCache } from "../lib/in-memory-cache.ts";

type SlackMember = {
  userId: string;
  displayName: string;
  realName: string;
};

const MEMBER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SLACK_MEMBER_CACHE_ENTRIES = 20;
const MAX_DISABLED_SLACK_MEMBER_LOOKUP_TOKENS = 100;
const SUGGESTED_USERNAME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_SUGGESTED_USERNAMES = 10_000;

const slackMemberCache = createInMemoryCache<string, SlackMember[]>({
  maxSize: MAX_SLACK_MEMBER_CACHE_ENTRIES,
  ttlMs: MEMBER_CACHE_TTL_MS,
  now: () => Date.now(),
});

const slackMemberLookupDisabledReasonsByToken = createInMemoryCache<string, string>({
  maxSize: MAX_DISABLED_SLACK_MEMBER_LOOKUP_TOKENS,
  ttlMs: 24 * 60 * 60 * 1000,
  now: () => Date.now(),
});

/** Track recent GitHub usernames we've already suggested to avoid repeat DMs. */
const suggestedUsernames = createInMemoryCache<string, true>({
  maxSize: MAX_SUGGESTED_USERNAMES,
  ttlMs: SUGGESTED_USERNAME_TTL_MS,
  now: () => Date.now(),
});

export function resetIdentitySuggestionStateForTests(): void {
  slackMemberCache.clear();
  slackMemberLookupDisabledReasonsByToken.clear();
  suggestedUsernames.clear();
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeSlackErrorCode(error: unknown): string {
  return typeof error === "string" && error.length > 0 ? error : "unknown";
}

function isSlackMissingScopeError(error: unknown): boolean {
  return /(?:^|\b)missing_scope(?:\b|$)/.test(normalizeSlackErrorCode(error));
}

async function fetchSlackMembers(
  botToken: string,
  logger: Logger,
): Promise<SlackMember[]> {
  const tokenCacheKey = tokenFingerprint(botToken);
  const disabledReason = slackMemberLookupDisabledReasonsByToken.get(tokenCacheKey);
  if (disabledReason) {
    logger.debug(
      { reason: disabledReason },
      "Slack member lookup disabled for token; skipping identity suggestion",
    );
    return [];
  }

  const cachedMembers = slackMemberCache.get(tokenCacheKey);
  if (cachedMembers) {
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

  let data: {
    ok?: boolean;
    error?: string;
    members?: Array<{
      id?: string;
      deleted?: boolean;
      is_bot?: boolean;
      profile?: { display_name?: string; real_name?: string };
    }>;
  } | null = null;

  try {
    data = (await response.json()) as typeof data;
  } catch {
    if (!response.ok) {
      throw new Error(`Slack users.list HTTP ${response.status}`);
    }
    throw new Error("Slack users.list returned malformed JSON");
  }

  if (!response.ok && !isSlackMissingScopeError(data?.error)) {
    throw new Error(`Slack users.list HTTP ${response.status}`);
  }

  if (!data?.ok) {
    const errorCode = normalizeSlackErrorCode(data?.error);
    if (isSlackMissingScopeError(errorCode)) {
      const disabledReason = "missing_scope";
      slackMemberLookupDisabledReasonsByToken.set(tokenCacheKey, disabledReason);
      logger.info(
        { reason: disabledReason, slackError: errorCode, httpStatus: response.status },
        "Slack member lookup disabled; missing users.list scope",
      );
      return [];
    }

    throw new Error(`Slack users.list failed: ${errorCode}`);
  }

  const members: SlackMember[] = (data.members ?? [])
    .filter((member) => !member.deleted && !member.is_bot)
    .filter((member): member is NonNullable<typeof member> & { id: string } =>
      typeof member.id === "string" && member.id.length > 0,
    )
    .map((member) => ({
      userId: member.id,
      displayName: member.profile?.display_name ?? "",
      realName: member.profile?.real_name ?? "",
    }));

  slackMemberCache.set(tokenCacheKey, members);
  logger.debug({ memberCount: members.length }, "Slack member list cached");
  return members;
}

async function sendSuggestionDM(
  botToken: string,
  slackUserId: string,
  githubUsername: string,
  logger: Logger,
): Promise<void> {
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: slackUserId }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!openRes.ok) {
    throw new Error(`Slack conversations.open HTTP ${openRes.status}`);
  }

  const openData = (await openRes.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { id?: string };
  };

  if (!openData.ok || !openData.channel?.id) {
    throw new Error(
      `Slack conversations.open failed: ${openData.error ?? "no channel"}`,
    );
  }

  const channelId = openData.channel.id;
  const message =
    `I noticed GitHub user \`${githubUsername}\` submitted a PR, and their profile may match your Slack account. ` +
    `If that's you, link your accounts with \`/kodiai link ${githubUsername}\` so Kodiai can use your linked contributor profile when available. ` +
    "If you'd rather keep reviews generic, you can opt out any time with `/kodiai profile opt-out`.";

  const msgRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text: message }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!msgRes.ok) {
    throw new Error(`Slack chat.postMessage HTTP ${msgRes.status}`);
  }

  const msgData = (await msgRes.json()) as {
    ok?: boolean;
    error?: string;
  };

  if (!msgData.ok) {
    throw new Error(
      `Slack chat.postMessage failed: ${msgData.error ?? "unknown"}`,
    );
  }

  logger.info({ githubUsername, slackUserId }, "Identity suggestion DM sent");
}

/**
 * Check for potential Slack matches for an unlinked GitHub user and
 * send a one-time DM suggesting they link their accounts.
 *
 * Only suggests for high-confidence matches to avoid spam.
 * Tracks recently suggested usernames in bounded memory (resets on restart).
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

  try {
    const normalizedGithubUsername = githubUsername.toLowerCase();
    if (suggestedUsernames.has(normalizedGithubUsername)) {
      return;
    }

    const existing = await profileStore.getByGithubUsername(githubUsername, {
      includeOptedOut: true,
    });
    if (existing?.slackUserId) {
      return;
    }

    const members = await fetchSlackMembers(slackBotToken, logger);
    const matches = findPotentialMatches({
      githubUsername,
      githubDisplayName,
      slackMembers: members,
    });

    const highMatches = matches.filter((match) => match.confidence === "high");
    if (highMatches.length === 0) {
      suggestedUsernames.set(normalizedGithubUsername, true);
      return;
    }

    const match = highMatches[0]!;
    await sendSuggestionDM(slackBotToken, match.slackUserId, githubUsername, logger);
    suggestedUsernames.set(normalizedGithubUsername, true);
  } catch (err) {
    logger.warn({ githubUsername, err }, "Identity suggestion check failed (non-blocking)");
  }
}
