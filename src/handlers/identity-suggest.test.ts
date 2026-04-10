import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";
import * as identitySuggest from "./identity-suggest.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";

const originalFetch = globalThis.fetch;

type MockLogger = Logger & {
  info: ReturnType<typeof mock>;
  warn: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
  debug: ReturnType<typeof mock>;
  trace: ReturnType<typeof mock>;
  fatal: ReturnType<typeof mock>;
};

function createMockLogger(): MockLogger {
  const info = mock(() => undefined);
  const warn = mock(() => undefined);
  const error = mock(() => undefined);
  const debug = mock(() => undefined);
  const trace = mock(() => undefined);
  const fatal = mock(() => undefined);

  return {
    info,
    warn,
    error,
    debug,
    trace,
    fatal,
    child: () => createMockLogger(),
    level: "silent",
  } as unknown as MockLogger;
}

function createMockProfileStore(
  overrides: Partial<ContributorProfileStore> = {},
): ContributorProfileStore {
  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async (p) => ({
      id: 1,
      githubUsername: p.githubUsername,
      slackUserId: p.slackUserId,
      displayName: p.displayName,
      overallTier: "newcomer" as const,
      overallScore: 0,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScoredAt: null,
    }),
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => [],
    upsertExpertise: async () => {},
    updateTier: async () => {},
    getOrCreateByGithubUsername: async () => ({
      id: 1,
      githubUsername: "",
      slackUserId: null,
      displayName: null,
      overallTier: "newcomer" as const,
      overallScore: 0,
      optedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastScoredAt: null,
    }),
    getAllScores: async () => [],
    ...overrides,
  };
}

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

describe("suggestIdentityLink", () => {
  beforeEach(() => {
    (identitySuggest as { resetIdentitySuggestionStateForTests?: () => void })
      .resetIdentitySuggestionStateForTests?.();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (identitySuggest as { resetIdentitySuggestionStateForTests?: () => void })
      .resetIdentitySuggestionStateForTests?.();
  });

  test("existing linked profile suppresses Slack lookup and DM delivery", async () => {
    const fetchMock = mock(async () => jsonResponse({ ok: true, members: [] }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await identitySuggest.suggestIdentityLink({
      githubUsername: "linked-user",
      githubDisplayName: "Linked User",
      slackBotToken: "xoxb-test-token",
      profileStore: createMockProfileStore({
        getByGithubUsername: async () => ({
          id: 1,
          githubUsername: "linked-user",
          slackUserId: "U-LINKED",
          displayName: "Linked User",
          overallTier: "established",
          overallScore: 0.8,
          optedOut: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastScoredAt: new Date(),
        }),
      }),
      logger: createMockLogger(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("no high-confidence match stays fail-open without opening a DM", async () => {
    const requests: string[] = [];
    const fetchMock = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push(url);

      if (url === "https://slack.com/api/users.list") {
        return jsonResponse({
          ok: true,
          members: [
            {
              id: "U001",
              profile: { display_name: "octocat", real_name: "Octo Cat" },
            },
          ],
        });
      }

      return new Response("Not Found", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await identitySuggest.suggestIdentityLink({
      githubUsername: "octocaat",
      githubDisplayName: null,
      slackBotToken: "xoxb-test-token",
      profileStore: createMockProfileStore(),
      logger: createMockLogger(),
    });

    expect(requests).toEqual(["https://slack.com/api/users.list"]);
  });

  test("high-confidence match sends one truthful DM body", async () => {
    const requests: Array<{ url: string; body: string | null }> = [];
    const logger = createMockLogger();

    const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push({
        url,
        body: typeof init?.body === "string" ? init.body : null,
      });

      if (url === "https://slack.com/api/users.list") {
        return jsonResponse({
          ok: true,
          members: [
            {
              id: "U777",
              profile: { display_name: "octocat", real_name: "Octo Cat" },
            },
          ],
        });
      }

      if (url === "https://slack.com/api/conversations.open") {
        return jsonResponse({ ok: true, channel: { id: "D777" } });
      }

      if (url === "https://slack.com/api/chat.postMessage") {
        return jsonResponse({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await identitySuggest.suggestIdentityLink({
      githubUsername: "octocat",
      githubDisplayName: "Octo Cat",
      slackBotToken: "xoxb-test-token",
      profileStore: createMockProfileStore(),
      logger,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://slack.com/api/users.list",
      "https://slack.com/api/conversations.open",
      "https://slack.com/api/chat.postMessage",
    ]);

    expect(requests[1]?.body).toBe(JSON.stringify({ users: "U777" }));

    const postBody = JSON.parse(requests[2]?.body ?? "{}") as {
      channel?: string;
      text?: string;
    };
    expect(postBody.channel).toBe("D777");
    expect(postBody.text).toBe(
      "I noticed GitHub user `octocat` submitted a PR, and their profile may match your Slack account. If that's you, link your accounts with `/kodiai link octocat` so Kodiai can use your linked contributor profile when available. If you'd rather keep reviews generic, you can opt out any time with `/kodiai profile opt-out`.",
    );
    expect(postBody.text).not.toContain("personalized code reviews");
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  test("Slack API failures stay non-blocking and log a warning", async () => {
    const logger = createMockLogger();
    const requests: string[] = [];

    const fetchMock = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push(url);

      if (url === "https://slack.com/api/users.list") {
        return jsonResponse({
          ok: true,
          members: [
            {
              id: "U778",
              profile: { display_name: "warning-user", real_name: "Warning User" },
            },
          ],
        });
      }

      if (url === "https://slack.com/api/conversations.open") {
        return jsonResponse({ ok: false, error: "channel_not_found" });
      }

      if (url === "https://slack.com/api/chat.postMessage") {
        return jsonResponse({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(
      identitySuggest.suggestIdentityLink({
        githubUsername: "warning-user",
        githubDisplayName: "Warning User",
        slackBotToken: "xoxb-test-token",
        profileStore: createMockProfileStore(),
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(requests).toEqual([
      "https://slack.com/api/users.list",
      "https://slack.com/api/conversations.open",
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
