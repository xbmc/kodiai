import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { handleKodiaiCommand } from "./slash-command-handler.ts";
import type { ContributorProfileStore } from "../contributor/types.ts";

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

  test("profile with linked profile returns contract-first card", async () => {
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
    expect(result.text).toBe([
      "*Contributor Profile*",
      "GitHub: `octocat`",
      "Status: Linked contributor guidance is active.",
      "Kodiai can adapt review guidance using your linked contributor profile.",
      "",
      "*Top Expertise:*",
      "  language/typescript: 0.90",
    ].join("\n"));
    expect(result.text).not.toContain("Tier:");
    expect(result.text).not.toContain("Score:");
  });

  test("profile with opted-out profile stays generic and hides expertise", async () => {
    const store = createMockProfileStore({
      getBySlackUserId: async () => ({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Octo",
        overallTier: "senior" as const,
        overallScore: 0.98,
        optedOut: true,
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

    expect(result.text).toBe([
      "*Contributor Profile*",
      "GitHub: `octocat`",
      "Status: Generic contributor guidance is active.",
      "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
    ].join("\n"));
    expect(result.text).not.toContain("Tier:");
    expect(result.text).not.toContain("Score:");
    expect(result.text).not.toContain("Top Expertise");
  });

  test("profile with malformed stored tier data falls back to neutral contract copy", async () => {
    const store = createMockProfileStore({
      getBySlackUserId: async () => ({
        id: 1,
        githubUsername: "octocat",
        slackUserId: "U001",
        displayName: "Octo",
        overallTier: "mystery-tier" as never,
        overallScore: 0.42,
        optedOut: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScoredAt: new Date(),
      }),
      getExpertise: async () => [],
    });

    const result = await handleKodiaiCommand({
      text: "profile",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });

    expect(result.text).toBe([
      "*Contributor Profile*",
      "GitHub: `octocat`",
      "Status: Generic contributor guidance is active.",
      "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
    ].join("\n"));
    expect(result.text).not.toContain("Tier:");
    expect(result.text).not.toContain("Score:");
  });

  test("profile opt-out sets opted_out to true and advertises opt-in", async () => {
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
    expect(result.text).toBe(
      "Contributor-specific guidance is now off. Kodiai will keep your reviews generic until you run `/kodiai profile opt-in`. Check `/kodiai profile` any time to review your current status.",
    );
  });

  test("unknown subcommand returns help text with both opt controls", async () => {
    const store = createMockProfileStore();
    const result = await handleKodiaiCommand({
      text: "foobar",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });
    expect(result.text).toBe(
      "Unknown command. Available: `link <github-username>`, `unlink`, `profile`, `profile opt-in`, `profile opt-out`",
    );
  });

  test("profile opt-in re-enables profiling and advertises opt-out", async () => {
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
    expect(result.text).toBe(
      "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
    );
  });
});
