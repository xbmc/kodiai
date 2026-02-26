import { describe, test, expect } from "bun:test";
import type { Logger } from "pino";
import { handleKodiaiCommand, type SlashCommandResult } from "./slash-command-handler.ts";
import type { ContributorProfileStore, ContributorExpertise } from "../contributor/types.ts";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as Logger;

function createMockProfileStore(overrides: Partial<ContributorProfileStore> = {}): ContributorProfileStore {
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

describe("handleKodiaiCommand", () => {
  test("link octocat calls linkIdentity and returns success", async () => {
    let linkCalled = false;
    const store = createMockProfileStore({
      linkIdentity: async (p) => {
        linkCalled = true;
        expect(p.githubUsername).toBe("octocat");
        expect(p.slackUserId).toBe("U001");
        return {
          id: 1,
          githubUsername: "octocat",
          slackUserId: "U001",
          displayName: "Test User",
          overallTier: "newcomer" as const,
          overallScore: 0,
          optedOut: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastScoredAt: null,
        };
      },
    });

    const result = await handleKodiaiCommand({
      text: "link octocat",
      slackUserId: "U001",
      slackUserName: "Test User",
      profileStore: store,
      logger: mockLogger,
    });

    expect(linkCalled).toBe(true);
    expect(result.responseType).toBe("ephemeral");
    expect(result.text).toContain("Linked your Slack account");
    expect(result.text).toContain("octocat");
  });

  test("link with no username returns validation error", async () => {
    const store = createMockProfileStore();
    const result = await handleKodiaiCommand({
      text: "link",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });
    expect(result.responseType).toBe("ephemeral");
    expect(result.text).toContain("Usage:");
  });

  test("link with special chars returns validation error", async () => {
    const store = createMockProfileStore();
    const result = await handleKodiaiCommand({
      text: "link invalid!username",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });
    expect(result.responseType).toBe("ephemeral");
    expect(result.text).toContain("alphanumeric");
  });

  test("unlink with linked profile unlinks and returns success", async () => {
    let unlinkCalled = false;
    const store = createMockProfileStore({
      getBySlackUserId: async () => ({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Test",
        overallTier: "newcomer" as const,
        overallScore: 0,
        optedOut: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: null,
      }),
      unlinkSlack: async () => {
        unlinkCalled = true;
      },
    });

    const result = await handleKodiaiCommand({
      text: "unlink",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });

    expect(unlinkCalled).toBe(true);
    expect(result.responseType).toBe("ephemeral");
    expect(result.text).toContain("Unlinked");
    expect(result.text).toContain("octocat");
  });

  test("unlink with no profile returns no linked account", async () => {
    const store = createMockProfileStore();
    const result = await handleKodiaiCommand({
      text: "unlink",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });
    expect(result.text).toContain("No linked GitHub account");
  });

  test("profile with linked profile returns formatted card", async () => {
    const store = createMockProfileStore({
      getBySlackUserId: async () => ({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Octo",
        overallTier: "established" as const,
        overallScore: 0.75,
        optedOut: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: new Date(),
      }),
      getExpertise: async () => [
        {
          id: 1,
          profileId: 1,
          dimension: "language" as const,
          topic: "typescript",
          score: 0.9,
          rawSignals: 50,
          lastActive: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const result = await handleKodiaiCommand({
      text: "profile",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });

    expect(result.responseType).toBe("ephemeral");
    expect(result.text).toContain("octocat");
    expect(result.text).toContain("established");
    expect(result.text).toContain("typescript");
  });

  test("profile opt-out sets opted_out to true", async () => {
    let optedOutGithub = "";
    const store = createMockProfileStore({
      getBySlackUserId: async () => ({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Octo",
        overallTier: "newcomer" as const,
        overallScore: 0,
        optedOut: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: null,
      }),
      setOptedOut: async (gh, val) => {
        optedOutGithub = gh;
        expect(val).toBe(true);
      },
    });

    const result = await handleKodiaiCommand({
      text: "profile opt-out",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });

    expect(optedOutGithub).toBe("octocat");
    expect(result.text).toContain("Opted out");
  });

  test("unknown subcommand returns help text", async () => {
    const store = createMockProfileStore();
    const result = await handleKodiaiCommand({
      text: "foobar",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });
    expect(result.text).toContain("Unknown command");
    expect(result.text).toContain("link");
    expect(result.text).toContain("unlink");
    expect(result.text).toContain("profile");
  });

  test("profile opt-in re-enables profiling", async () => {
    let optedIn = false;
    const store = createMockProfileStore({
      getBySlackUserId: async () => ({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Octo",
        overallTier: "newcomer" as const,
        overallScore: 0,
        optedOut: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: null,
      }),
      setOptedOut: async (_gh, val) => {
        optedIn = !val;
      },
    });

    const result = await handleKodiaiCommand({
      text: "profile opt-in",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });

    expect(optedIn).toBe(true);
    expect(result.text).toContain("Opted back in");
  });
});
