import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type {
  ContributorExpertise,
  ContributorProfile,
  ContributorProfileStore,
  ContributorTier,
  ExpertiseDimension,
} from "./types.ts";

function mapRow(row: Record<string, unknown>): ContributorProfile {
  return {
    id: Number(row.id),
    githubUsername: row.github_username as string,
    slackUserId: (row.slack_user_id as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    overallTier: (row.overall_tier as ContributorTier) ?? "newcomer",
    overallScore: Number(row.overall_score ?? 0),
    optedOut: Boolean(row.opted_out),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    lastScoredAt: row.last_scored_at
      ? new Date(row.last_scored_at as string)
      : null,
  };
}

function mapExpertiseRow(row: Record<string, unknown>): ContributorExpertise {
  return {
    id: Number(row.id),
    profileId: Number(row.profile_id),
    dimension: row.dimension as ExpertiseDimension,
    topic: row.topic as string,
    score: Number(row.score ?? 0),
    rawSignals: Number(row.raw_signals ?? 0),
    lastActive: row.last_active ? new Date(row.last_active as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export function createContributorProfileStore(opts: {
  sql: Sql;
  logger: Logger;
}): ContributorProfileStore {
  const { sql, logger } = opts;

  const store: ContributorProfileStore = {
    async getByGithubUsername(
      username: string,
    ): Promise<ContributorProfile | null> {
      const rows = await sql`
        SELECT * FROM contributor_profiles
        WHERE github_username = ${username} AND opted_out = false
      `;
      if (rows.length === 0) return null;
      return mapRow(rows[0] as Record<string, unknown>);
    },

    async getBySlackUserId(
      slackUserId: string,
    ): Promise<ContributorProfile | null> {
      const rows = await sql`
        SELECT * FROM contributor_profiles
        WHERE slack_user_id = ${slackUserId}
      `;
      if (rows.length === 0) return null;
      return mapRow(rows[0] as Record<string, unknown>);
    },

    async linkIdentity(params: {
      slackUserId: string;
      githubUsername: string;
      displayName: string;
    }): Promise<ContributorProfile> {
      const { slackUserId, githubUsername, displayName } = params;
      const rows = await sql`
        INSERT INTO contributor_profiles (github_username, slack_user_id, display_name)
        VALUES (${githubUsername}, ${slackUserId}, ${displayName})
        ON CONFLICT (github_username) DO UPDATE SET
          slack_user_id = EXCLUDED.slack_user_id,
          display_name = EXCLUDED.display_name,
          updated_at = now()
        RETURNING *
      `;
      logger.debug(
        { githubUsername, slackUserId },
        "Linked contributor identity",
      );
      return mapRow(rows[0] as Record<string, unknown>);
    },

    async unlinkSlack(githubUsername: string): Promise<void> {
      await sql`
        UPDATE contributor_profiles
        SET slack_user_id = NULL, updated_at = now()
        WHERE github_username = ${githubUsername}
      `;
      logger.debug({ githubUsername }, "Unlinked Slack from contributor");
    },

    async setOptedOut(githubUsername: string, optedOut: boolean): Promise<void> {
      await sql`
        UPDATE contributor_profiles
        SET opted_out = ${optedOut}, updated_at = now()
        WHERE github_username = ${githubUsername}
      `;
      logger.debug({ githubUsername, optedOut }, "Updated contributor opt-out");
    },

    async getExpertise(profileId: number): Promise<ContributorExpertise[]> {
      const rows = await sql`
        SELECT * FROM contributor_expertise
        WHERE profile_id = ${profileId}
        ORDER BY score DESC
      `;
      return rows.map((r) => mapExpertiseRow(r as Record<string, unknown>));
    },

    async upsertExpertise(params: {
      profileId: number;
      dimension: ExpertiseDimension;
      topic: string;
      score: number;
      rawSignals: number;
      lastActive: Date;
    }): Promise<void> {
      const { profileId, dimension, topic, score, rawSignals, lastActive } =
        params;
      await sql`
        INSERT INTO contributor_expertise (profile_id, dimension, topic, score, raw_signals, last_active)
        VALUES (${profileId}, ${dimension}, ${topic}, ${score}, ${rawSignals}, ${lastActive})
        ON CONFLICT (profile_id, dimension, topic) DO UPDATE SET
          score = EXCLUDED.score,
          raw_signals = EXCLUDED.raw_signals,
          last_active = EXCLUDED.last_active,
          updated_at = now()
      `;
    },

    async updateTier(
      profileId: number,
      tier: ContributorTier,
      overallScore: number,
    ): Promise<void> {
      await sql`
        UPDATE contributor_profiles
        SET overall_tier = ${tier}, overall_score = ${overallScore},
            last_scored_at = now(), updated_at = now()
        WHERE id = ${profileId}
      `;
    },

    async getOrCreateByGithubUsername(
      username: string,
    ): Promise<ContributorProfile> {
      // Try to find existing (including opted-out — this is a system-level lookup)
      const existing = await sql`
        SELECT * FROM contributor_profiles
        WHERE github_username = ${username}
      `;
      if (existing.length > 0) {
        return mapRow(existing[0] as Record<string, unknown>);
      }

      const inserted = await sql`
        INSERT INTO contributor_profiles (github_username)
        VALUES (${username})
        ON CONFLICT (github_username) DO UPDATE SET updated_at = now()
        RETURNING *
      `;
      logger.debug({ username }, "Created contributor profile");
      return mapRow(inserted[0] as Record<string, unknown>);
    },

    async getAllScores(): Promise<
      { profileId: number; overallScore: number }[]
    > {
      const rows = await sql`
        SELECT id, overall_score FROM contributor_profiles
        WHERE opted_out = false
      `;
      return rows.map((r) => ({
        profileId: Number(r.id),
        overallScore: Number(r.overall_score),
      }));
    },
  };

  return store;
}
