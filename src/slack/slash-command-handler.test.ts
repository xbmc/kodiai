import { describe, expect, test } from "bun:test";
import type { Logger } from "pino";
import { handleKodiaiCommand } from "./slash-command-handler.ts";
import {
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
} from "../contributor/profile-trust.ts";
import type {
  ContributorExpertise,
  ContributorProfile,
  ContributorProfileStore,
} from "../contributor/types.ts";

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

function makeProfile(
  overrides: Partial<ContributorProfile> = {},
): ContributorProfile {
  return {
    id: 1,
    githubUsername: "octocat",
    slackUserId: "U001",
    displayName: "Octo",
    overallTier: "newcomer",
    overallScore: 0,
    optedOut: false,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    lastScoredAt: null,
    trustMarker: null,
    ...overrides,
  };
}

function makeExpertise(
  overrides: Partial<ContributorExpertise> = {},
): ContributorExpertise {
  return {
    id: 1,
    profileId: 1,
    dimension: "language",
    topic: "typescript",
    score: 0.9,
    rawSignals: 50,
    lastActive: new Date("2026-04-09T00:00:00.000Z"),
    createdAt: new Date("2026-04-09T00:00:00.000Z"),
    updatedAt: new Date("2026-04-09T00:00:00.000Z"),
    ...overrides,
  };
}

function createMockProfileStore(
  overrides: Partial<ContributorProfileStore> = {},
): ContributorProfileStore {
  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async (p) =>
      makeProfile({
        githubUsername: p.githubUsername,
        slackUserId: p.slackUserId,
        displayName: p.displayName,
      }),
    unlinkSlack: async () => {},
    setOptedOut: async () => {},
    getExpertise: async () => [],
    upsertExpertise: async () => {},
    updateTier: async () => {},
    getOrCreateByGithubUsername: async () =>
      makeProfile({
        slackUserId: null,
        displayName: null,
      }),
    getAllScores: async () => [],
    ...overrides,
  };
}

describe("handleKodiaiCommand", () => {
  test("link octocat keeps continuity generic for a newly linked unscored profile", async () => {
    let linkCalled = false;
    const store = createMockProfileStore({
      linkIdentity: async (p) => {
        linkCalled = true;
        expect(p.githubUsername).toBe("octocat");
        expect(p.slackUserId).toBe("U001");
        return makeProfile({
          githubUsername: p.githubUsername,
          slackUserId: p.slackUserId,
          displayName: p.displayName,
          overallTier: "newcomer",
          overallScore: 0,
          lastScoredAt: null,
          trustMarker: null,
        });
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
    expect(result.text).toBe(
      "Linked your Slack account to GitHub user `octocat`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use `/kodiai profile` to review your status.",
    );
  });

  test("link advertises active linked guidance only when the stored profile is trusted", async () => {
    const store = createMockProfileStore({
      linkIdentity: async (p) =>
        makeProfile({
          githubUsername: p.githubUsername,
          slackUserId: p.slackUserId,
          displayName: p.displayName,
          overallTier: "established",
          overallScore: 0.82,
          lastScoredAt: new Date(),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
    });

    const result = await handleKodiaiCommand({
      text: "link octocat",
      slackUserId: "U001",
      slackUserName: "Test User",
      profileStore: store,
      logger: mockLogger,
    });

    expect(result.text).toBe(
      "Linked your Slack account to GitHub user `octocat`. Linked contributor guidance is active for your profile. Use `/kodiai profile` to review your status.",
    );
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
      getBySlackUserId: async () => makeProfile(),
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

  test("profile with linked trusted profile returns contract-first card", async () => {
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "established",
          overallScore: 0.75,
          lastScoredAt: new Date(),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
      getExpertise: async () => [makeExpertise()],
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

  test("profile with opted-out profile stays generic, hides expertise, and skips lookup", async () => {
    let expertiseCalls = 0;
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "senior",
          overallScore: 0.98,
          optedOut: true,
          lastScoredAt: new Date(),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
      getExpertise: async () => {
        expertiseCalls += 1;
        return [makeExpertise()];
      },
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
    expect(expertiseCalls).toBe(0);
  });

  test("profile with a legacy scored row stays generic and skips expertise lookup", async () => {
    let expertiseCalls = 0;
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "established",
          overallScore: 0.75,
          lastScoredAt: new Date("2026-04-02T00:00:00.000Z"),
          trustMarker: null,
        }),
      getExpertise: async () => {
        expertiseCalls += 1;
        return [makeExpertise()];
      },
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
    expect(result.text).not.toContain("Top Expertise");
    expect(expertiseCalls).toBe(0);
  });

  test("profile with a stale calibrated row stays generic and skips expertise lookup", async () => {
    let expertiseCalls = 0;
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "established",
          overallScore: 0.75,
          lastScoredAt: new Date("2025-01-01T00:00:00.000Z"),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
      getExpertise: async () => {
        expertiseCalls += 1;
        return [makeExpertise()];
      },
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
    expect(result.text).not.toContain("Top Expertise");
    expect(expertiseCalls).toBe(0);
  });

  test("profile with malformed stored tier data falls back to neutral contract copy", async () => {
    let expertiseCalls = 0;
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "mystery-tier" as never,
          overallScore: 0.42,
          lastScoredAt: new Date(),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
      getExpertise: async () => {
        expertiseCalls += 1;
        return [];
      },
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
    expect(expertiseCalls).toBe(0);
  });

  test("profile fails open to generic copy when expertise lookup throws", async () => {
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "established",
          overallScore: 0.75,
          lastScoredAt: new Date(),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
        }),
      getExpertise: async () => {
        throw new Error("database unavailable");
      },
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
    expect(result.text).not.toContain("Top Expertise");
  });

  test("profile opt-out sets opted_out to true and advertises opt-in", async () => {
    let optedOutGithub = "";
    const store = createMockProfileStore({
      getBySlackUserId: async () => makeProfile(),
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

  test("profile opt-in re-enables active linked guidance only for trusted rows", async () => {
    let optedIn = false;
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "established",
          overallScore: 0.75,
          optedOut: true,
          lastScoredAt: new Date(),
          trustMarker: CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
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

  test("profile opt-in keeps continuity generic for linked-unscored rows", async () => {
    const store = createMockProfileStore({
      getBySlackUserId: async () =>
        makeProfile({
          overallTier: "newcomer",
          overallScore: 0,
          optedOut: true,
          lastScoredAt: null,
          trustMarker: null,
        }),
      setOptedOut: async (_gh, val) => {
        expect(val).toBe(false);
      },
    });

    const result = await handleKodiaiCommand({
      text: "profile opt-in",
      slackUserId: "U001",
      slackUserName: "Test",
      profileStore: store,
      logger: mockLogger,
    });

    expect(result.text).toBe(
      "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.",
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
});
