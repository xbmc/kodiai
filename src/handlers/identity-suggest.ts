/**
 * Fire-and-forget identity suggestion DMs for unlinked GitHub users.
 *
 * When a contributor has no linked profile, this module checks for
 * potential Slack matches using heuristic name matching and sends
 * a one-time DM suggesting they link their accounts.
 *
 * Completely fail-open: any error is logged and silently ignored.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { ContributorProfileStore } from "../contributor/types.ts";
import { findPotentialMatches } from "../contributor/identity-matcher.ts";
import { createInMemoryCache } from "../lib/in-memory-cache.ts";
import { dedupeInflight } from "../lib/inflight-dedupe.ts";
import { parseRetryAfterDelayMs } from "../lib/retry-after.ts";
import { retryTransient } from "../lib/transient-retry.ts";

type SlackMember = {
  userId: string;
  displayName: string;
  realName: string;
};

type SlackUsersListResponse = {
  ok?: boolean;
  error?: string;
  members?: Array<{
    id?: string;
    deleted?: boolean;
    is_bot?: boolean;
    profile?: { display_name?: string; real_name?: string };
  }>;
};

type SlackJsonResponse = {
  ok?: boolean;
  error?: string;
  channel?: { id?: string };
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
const slackMemberInflightLoads = new Map<string, Promise<SlackMember[]>>();

/** Track recent GitHub usernames we've already suggested to avoid repeat DMs. */
const suggestedUsernames = createInMemoryCache<string, true>({
  maxSize: MAX_SUGGESTED_USERNAMES,
  ttlMs: SUGGESTED_USERNAME_TTL_MS,
  now: () => Date.now(),
});

export function resetIdentitySuggestionStateForTests(): void {
  slackMemberCache.clear();
  slackMemberInflightLoads.clear();
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

class SlackRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Headers,
    readonly slackError?: string,
  ) {
    super(message);
    this.name = "SlackRequestError";
  }
}

function isRetryableSlackError(error: unknown): boolean {
  if (error instanceof SlackRequestError) {
    if (isSlackMissingScopeError(error.slackError)) return false;
    return error.status === 429 || error.status >= 500 || error.slackError === "ratelimited";
  }
  // Fetch rejects aborted/network-failed requests as TypeError/DOMException before Slack can return JSON.
  return error instanceof TypeError || error instanceof DOMException;
}

function slackRetryAfterDelayMs(error: unknown): number | null {
  if (!(error instanceof SlackRequestError)) return null;
  return parseRetryAfterDelayMs(error.headers.get("retry-after"));
}

async function fetchSlackJson<T extends SlackJsonResponse>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    if (!response.ok) {
      throw new SlackRequestError(
        `${label} HTTP ${response.status}`,
        response.status,
        response.headers,
      );
    }
    throw new Error(`${label} returned malformed JSON`);
  }

  if (!response.ok) {
    if (isSlackMissingScopeError(data.error)) {
      return { response, data };
    }
    throw new SlackRequestError(
      `${label} HTTP ${response.status}`,
      response.status,
      response.headers,
      data.error,
    );
  }
  if (!data.ok && data.error === "ratelimited") {
    throw new SlackRequestError(`${label} failed: ratelimited`, 429, response.headers, data.error);
  }
  return { response, data };
}

async function fetchSlackJsonReadWithRetry<T extends SlackJsonResponse>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<{ response: Response; data: T }> {
  return retryTransient(
    () => fetchSlackJson<T>(url, init, label),
    {
      shouldRetry: isRetryableSlackError,
      retryDelayMs: slackRetryAfterDelayMs,
    },
  );
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

  return dedupeInflight(slackMemberInflightLoads, tokenCacheKey, () =>
    fetchSlackMembersUncached(botToken, tokenCacheKey, logger)
  );
}

async function fetchSlackMembersUncached(
  botToken: string,
  tokenCacheKey: string,
  logger: Logger,
): Promise<SlackMember[]> {
  const { response, data } = await fetchSlackJsonReadWithRetry<SlackUsersListResponse>("https://slack.com/api/users.list", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
  }, "Slack users.list");

  if (!data?.ok) {
    const errorCode = normalizeSlackErrorCode(data.error);
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
  const { data: openData } = await fetchSlackJsonReadWithRetry("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: slackUserId }),
  }, "Slack conversations.open");

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

  const { data: msgData } = await fetchSlackJsonReadWithRetry("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text: message, client_msg_id: randomUUID() }),
  }, "Slack chat.postMessage");

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
