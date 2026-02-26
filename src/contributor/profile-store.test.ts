import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import postgres from "postgres";
import { createContributorProfileStore } from "./profile-store.ts";
import type { ContributorProfileStore } from "./types.ts";
import type { Sql } from "../db/client.ts";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://kodiai:kodiai@localhost:5432/kodiai";

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
  level: "silent",
} as unknown as import("pino").Logger;

let sql: Sql;
let store: ContributorProfileStore;

async function truncateAll(): Promise<void> {
  await sql`TRUNCATE contributor_expertise, contributor_profiles CASCADE`;
}

beforeAll(async () => {
  sql = postgres(DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  store = createContributorProfileStore({ sql, logger: mockLogger });
});

afterAll(async () => {
  await sql.end();
});

describe("ContributorProfileStore", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("linkIdentity creates profile and retrieves by github username", async () => {
    const profile = await store.linkIdentity({
      slackUserId: "U001",
      githubUsername: "octocat",
      displayName: "Octo Cat",
    });
    expect(profile.githubUsername).toBe("octocat");
    expect(profile.slackUserId).toBe("U001");
    expect(profile.displayName).toBe("Octo Cat");
    expect(profile.overallTier).toBe("newcomer");
    expect(profile.optedOut).toBe(false);

    const fetched = await store.getByGithubUsername("octocat");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(profile.id);
  });

  test("getBySlackUserId retrieves linked profile", async () => {
    await store.linkIdentity({
      slackUserId: "U002",
      githubUsername: "dev1",
      displayName: "Dev One",
    });
    const profile = await store.getBySlackUserId("U002");
    expect(profile).not.toBeNull();
    expect(profile!.githubUsername).toBe("dev1");
  });

  test("unlinkSlack nulls slack_user_id but profile persists", async () => {
    await store.linkIdentity({
      slackUserId: "U003",
      githubUsername: "dev2",
      displayName: "Dev Two",
    });
    await store.unlinkSlack("dev2");

    const bySlack = await store.getBySlackUserId("U003");
    expect(bySlack).toBeNull();

    const byGithub = await store.getByGithubUsername("dev2");
    expect(byGithub).not.toBeNull();
    expect(byGithub!.slackUserId).toBeNull();
  });

  test("re-link same github username updates slack_user_id", async () => {
    await store.linkIdentity({
      slackUserId: "U004",
      githubUsername: "dev3",
      displayName: "Dev Three",
    });
    const updated = await store.linkIdentity({
      slackUserId: "U005",
      githubUsername: "dev3",
      displayName: "Dev Three Updated",
    });
    expect(updated.slackUserId).toBe("U005");
    expect(updated.displayName).toBe("Dev Three Updated");
  });

  test("opt-out hides from getByGithubUsername but not getBySlackUserId", async () => {
    await store.linkIdentity({
      slackUserId: "U006",
      githubUsername: "dev4",
      displayName: "Dev Four",
    });
    await store.setOptedOut("dev4", true);

    const byGithub = await store.getByGithubUsername("dev4");
    expect(byGithub).toBeNull();

    const bySlack = await store.getBySlackUserId("U006");
    expect(bySlack).not.toBeNull();
    expect(bySlack!.optedOut).toBe(true);
  });

  test("upsertExpertise creates and updates entries", async () => {
    const profile = await store.linkIdentity({
      slackUserId: "U007",
      githubUsername: "dev5",
      displayName: "Dev Five",
    });

    await store.upsertExpertise({
      profileId: profile.id,
      dimension: "language",
      topic: "typescript",
      score: 0.5,
      rawSignals: 10,
      lastActive: new Date(),
    });

    let expertise = await store.getExpertise(profile.id);
    expect(expertise).toHaveLength(1);
    expect(expertise[0]!.topic).toBe("typescript");
    expect(expertise[0]!.score).toBeCloseTo(0.5, 1);

    // Update same entry
    await store.upsertExpertise({
      profileId: profile.id,
      dimension: "language",
      topic: "typescript",
      score: 0.8,
      rawSignals: 20,
      lastActive: new Date(),
    });

    expertise = await store.getExpertise(profile.id);
    expect(expertise).toHaveLength(1);
    expect(expertise[0]!.score).toBeCloseTo(0.8, 1);
    expect(expertise[0]!.rawSignals).toBe(20);
  });

  test("getOrCreateByGithubUsername creates new and returns existing", async () => {
    const created = await store.getOrCreateByGithubUsername("newuser");
    expect(created.githubUsername).toBe("newuser");
    expect(created.overallTier).toBe("newcomer");

    const existing = await store.getOrCreateByGithubUsername("newuser");
    expect(existing.id).toBe(created.id);
  });

  test("getAllScores returns non-opted-out profiles", async () => {
    await store.linkIdentity({
      slackUserId: "U008",
      githubUsername: "dev6",
      displayName: "Dev Six",
    });
    await store.linkIdentity({
      slackUserId: "U009",
      githubUsername: "dev7",
      displayName: "Dev Seven",
    });
    await store.setOptedOut("dev7", true);

    const scores = await store.getAllScores();
    expect(scores.length).toBe(1);
    expect(scores[0]!.overallScore).toBe(0);
  });

  test("updateTier changes tier and overall score", async () => {
    const profile = await store.linkIdentity({
      slackUserId: "U010",
      githubUsername: "dev8",
      displayName: "Dev Eight",
    });

    await store.updateTier(profile.id, "senior", 0.95);

    const updated = await store.getByGithubUsername("dev8");
    expect(updated).not.toBeNull();
    expect(updated!.overallTier).toBe("senior");
    expect(updated!.overallScore).toBeCloseTo(0.95, 2);
    expect(updated!.lastScoredAt).not.toBeNull();
  });

  test("getExpertise returns entries sorted by score descending", async () => {
    const profile = await store.getOrCreateByGithubUsername("dev9");

    await store.upsertExpertise({
      profileId: profile.id,
      dimension: "language",
      topic: "python",
      score: 0.3,
      rawSignals: 5,
      lastActive: new Date(),
    });
    await store.upsertExpertise({
      profileId: profile.id,
      dimension: "language",
      topic: "typescript",
      score: 0.9,
      rawSignals: 30,
      lastActive: new Date(),
    });
    await store.upsertExpertise({
      profileId: profile.id,
      dimension: "file_area",
      topic: "src/handlers/",
      score: 0.6,
      rawSignals: 15,
      lastActive: new Date(),
    });

    const expertise = await store.getExpertise(profile.id);
    expect(expertise).toHaveLength(3);
    expect(expertise[0]!.topic).toBe("typescript");
    expect(expertise[1]!.topic).toBe("src/handlers/");
    expect(expertise[2]!.topic).toBe("python");
  });
});
