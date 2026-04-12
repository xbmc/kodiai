import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import postgres from "postgres";
import { runMigrations } from "../db/migrate.ts";
import {
  classifyContributorProfileTrust,
  CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
  CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS,
} from "./profile-trust.ts";
import { createContributorProfileStore } from "./profile-store.ts";
import type { ContributorProfileStore } from "./types.ts";
import type { Sql } from "../db/client.ts";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
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
  await runMigrations(sql);
  store = createContributorProfileStore({ sql, logger: mockLogger });
});

afterAll(async () => {
  await sql.end();
});

describe("ContributorProfileStore", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test("migrations expose the contributor trust marker column", async () => {
    const rows = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'contributor_profiles'
        AND column_name = 'trust_marker'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.column_name).toBe("trust_marker");
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
    expect(profile.trustMarker).toBeNull();
    expect(classifyContributorProfileTrust(profile)).toMatchObject({
      state: "linked-unscored",
      trusted: false,
      reason: "never-scored",
    });

    const fetched = await store.getByGithubUsername("octocat");
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(profile.id);
    expect(fetched!.trustMarker).toBeNull();
    expect(classifyContributorProfileTrust(fetched!)).toMatchObject({
      state: "linked-unscored",
      trusted: false,
      reason: "never-scored",
    });
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

  test("review-time system lookup can inspect opted-out github profiles without re-enabling them", async () => {
    await store.linkIdentity({
      slackUserId: "U006B",
      githubUsername: "dev4b",
      displayName: "Dev Four B",
    });
    await store.setOptedOut("dev4b", true);

    const defaultLookup = await store.getByGithubUsername("dev4b");
    expect(defaultLookup).toBeNull();

    const systemLookup = await store.getByGithubUsername("dev4b", {
      includeOptedOut: true,
    });
    expect(systemLookup).not.toBeNull();
    expect(systemLookup!.optedOut).toBe(true);
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

  test("updateTier changes tier, overall score, and stamps the current trust marker", async () => {
    const profile = await store.linkIdentity({
      slackUserId: "U010",
      githubUsername: "dev8",
      displayName: "Dev Eight",
    });

    await store.updateTier(profile.id, "newcomer", 0);

    const updated = await store.getByGithubUsername("dev8");
    expect(updated).not.toBeNull();
    expect(updated!.overallTier).toBe("newcomer");
    expect(updated!.overallScore).toBeCloseTo(0, 5);
    expect(updated!.lastScoredAt).not.toBeNull();
    expect(updated!.trustMarker).toBe(CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER);
    expect(classifyContributorProfileTrust(updated!)).toMatchObject({
      state: "calibrated",
      trusted: true,
      reason: "current-trust-marker",
    });

    const persisted = await sql`
      SELECT trust_marker
      FROM contributor_profiles
      WHERE id = ${profile.id}
    `;
    expect(persisted[0]?.trust_marker).toBe(
      CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER,
    );
  });

  test("stored rows distinguish legacy and stale states from a trustworthy calibrated row", async () => {
    const staleMs =
      (CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS + 1) *
      24 *
      60 *
      60 *
      1000;
    const referenceTime = new Date("2026-04-10T12:00:00.000Z");
    const legacyScoredAt = new Date("2026-03-31T00:00:00.000Z");
    const freshScoredAt = new Date("2026-04-09T00:00:00.000Z");
    const staleScoredAt = new Date(referenceTime.getTime() - staleMs);

    await sql`
      INSERT INTO contributor_profiles (
        github_username,
        display_name,
        overall_tier,
        overall_score,
        last_scored_at,
        trust_marker
      ) VALUES
        (
          'legacy-user',
          'Legacy User',
          'established',
          0.7,
          ${legacyScoredAt},
          NULL
        ),
        (
          'fresh-user',
          'Fresh User',
          'newcomer',
          0,
          ${freshScoredAt},
          ${CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER}
        ),
        (
          'stale-user',
          'Stale User',
          'newcomer',
          0,
          ${staleScoredAt},
          ${CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER}
        )
    `;

    const legacy = await store.getByGithubUsername("legacy-user");
    const fresh = await store.getByGithubUsername("fresh-user");
    const stale = await store.getByGithubUsername("stale-user");

    expect(legacy).not.toBeNull();
    expect(fresh).not.toBeNull();
    expect(stale).not.toBeNull();

    expect(
      classifyContributorProfileTrust(legacy!, { referenceTime }),
    ).toMatchObject({
      state: "legacy",
      trusted: false,
      reason: "missing-trust-marker",
    });
    expect(
      classifyContributorProfileTrust(fresh!, { referenceTime }),
    ).toMatchObject({
      state: "calibrated",
      trusted: true,
      reason: "current-trust-marker",
    });
    expect(
      classifyContributorProfileTrust(stale!, { referenceTime }),
    ).toMatchObject({
      state: "stale",
      trusted: false,
      reason: "trust-marker-stale",
    });
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
