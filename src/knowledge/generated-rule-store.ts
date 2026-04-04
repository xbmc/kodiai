import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";

export type GeneratedRuleStatus = "pending" | "active" | "retired";
export type GeneratedRuleOrigin = "generated";

export type GeneratedRuleRecord = {
  id: number;
  repo: string;
  title: string;
  ruleText: string;
  status: GeneratedRuleStatus;
  origin: GeneratedRuleOrigin;
  signalScore: number;
  memberCount: number;
  clusterCentroid: Float32Array;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
};

export type GeneratedRuleProposal = {
  repo: string;
  title: string;
  ruleText: string;
  signalScore: number;
  memberCount: number;
  clusterCentroid?: Float32Array;
};

export type GeneratedRuleLifecycleCounts = {
  pending: number;
  active: number;
  retired: number;
  total: number;
};

export type GeneratedRuleStore = {
  savePendingRule(rule: GeneratedRuleProposal): Promise<GeneratedRuleRecord>;
  getRule(ruleId: number): Promise<GeneratedRuleRecord | null>;
  listRulesForRepo(repo: string, opts?: { status?: GeneratedRuleStatus; limit?: number }): Promise<GeneratedRuleRecord[]>;
  getActiveRulesForRepo(repo: string, limit?: number): Promise<GeneratedRuleRecord[]>;
  activateRule(ruleId: number): Promise<GeneratedRuleRecord | null>;
  retireRule(ruleId: number): Promise<GeneratedRuleRecord | null>;
  getLifecycleCounts(repo: string): Promise<GeneratedRuleLifecycleCounts>;
};

function float32ArrayToVectorString(arr: Float32Array): string {
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    parts[i] = String(arr[i]);
  }
  return `[${parts.join(",")}]`;
}

function parseVectorToFloat32Array(vec: unknown): Float32Array {
  if (vec instanceof Float32Array) return vec;
  if (typeof vec === "string") {
    const normalized = vec.trim();
    if (normalized === "[]") return new Float32Array(0);
    return new Float32Array(
      normalized
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .filter(Boolean)
        .map(Number),
    );
  }
  return new Float32Array(0);
}

type GeneratedRuleRow = {
  id: number;
  repo: string;
  title: string;
  rule_text: string;
  status: string;
  origin: string;
  signal_score: number;
  member_count: number;
  cluster_centroid: unknown;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
};

function rowToRecord(row: GeneratedRuleRow): GeneratedRuleRecord {
  return {
    id: Number(row.id),
    repo: row.repo,
    title: row.title,
    ruleText: row.rule_text,
    status: row.status as GeneratedRuleStatus,
    origin: row.origin as GeneratedRuleOrigin,
    signalScore: Number(row.signal_score),
    memberCount: Number(row.member_count),
    clusterCentroid: parseVectorToFloat32Array(row.cluster_centroid),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at,
    retiredAt: row.retired_at,
  };
}

export function createGeneratedRuleStore(opts: {
  sql: Sql;
  logger: Logger;
}): GeneratedRuleStore {
  const { sql, logger } = opts;

  const store: GeneratedRuleStore = {
    async savePendingRule(rule: GeneratedRuleProposal): Promise<GeneratedRuleRecord> {
      const centroidValue = rule.clusterCentroid && rule.clusterCentroid.length > 0
        ? float32ArrayToVectorString(rule.clusterCentroid)
        : null;

      try {
        const rows = await sql`
          INSERT INTO generated_rules (
            repo, title, rule_text, status, origin,
            signal_score, member_count, cluster_centroid
          ) VALUES (
            ${rule.repo}, ${rule.title}, ${rule.ruleText}, 'pending', 'generated',
            ${rule.signalScore}, ${rule.memberCount}, ${centroidValue}::vector
          )
          ON CONFLICT (repo, title) DO UPDATE SET
            rule_text = EXCLUDED.rule_text,
            signal_score = EXCLUDED.signal_score,
            member_count = EXCLUDED.member_count,
            cluster_centroid = EXCLUDED.cluster_centroid,
            updated_at = now(),
            status = CASE
              WHEN generated_rules.status = 'pending' THEN EXCLUDED.status
              ELSE generated_rules.status
            END
          RETURNING *
        `;

        return rowToRecord(rows[0] as unknown as GeneratedRuleRow);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message, repo: rule.repo, title: rule.title }, "Failed to save pending generated rule");
        throw err;
      }
    },

    async getRule(ruleId: number): Promise<GeneratedRuleRecord | null> {
      const rows = await sql`
        SELECT * FROM generated_rules WHERE id = ${ruleId}
      `;
      if (rows.length === 0) return null;
      return rowToRecord(rows[0] as unknown as GeneratedRuleRow);
    },

    async listRulesForRepo(repo: string, opts?: {
      status?: GeneratedRuleStatus;
      limit?: number;
    }): Promise<GeneratedRuleRecord[]> {
      const limit = opts?.limit ?? 50;
      const rows = opts?.status
        ? await sql`
            SELECT * FROM generated_rules
            WHERE repo = ${repo} AND status = ${opts.status}
            ORDER BY signal_score DESC, member_count DESC, created_at DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT * FROM generated_rules
            WHERE repo = ${repo}
            ORDER BY
              CASE status
                WHEN 'active' THEN 0
                WHEN 'pending' THEN 1
                ELSE 2
              END,
              signal_score DESC,
              member_count DESC,
              created_at DESC
            LIMIT ${limit}
          `;

      return rows.map((row) => rowToRecord(row as unknown as GeneratedRuleRow));
    },

    async getActiveRulesForRepo(repo: string, limit = 10): Promise<GeneratedRuleRecord[]> {
      const rows = await sql`
        SELECT * FROM generated_rules
        WHERE repo = ${repo} AND status = 'active'
        ORDER BY signal_score DESC, member_count DESC, activated_at DESC, created_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => rowToRecord(row as unknown as GeneratedRuleRow));
    },

    async activateRule(ruleId: number): Promise<GeneratedRuleRecord | null> {
      const rows = await sql`
        UPDATE generated_rules
        SET status = 'active', activated_at = now(), retired_at = NULL, updated_at = now()
        WHERE id = ${ruleId}
        RETURNING *
      `;
      if (rows.length === 0) return null;
      return rowToRecord(rows[0] as unknown as GeneratedRuleRow);
    },

    async retireRule(ruleId: number): Promise<GeneratedRuleRecord | null> {
      const rows = await sql`
        UPDATE generated_rules
        SET status = 'retired', retired_at = now(), updated_at = now()
        WHERE id = ${ruleId}
        RETURNING *
      `;
      if (rows.length === 0) return null;
      return rowToRecord(rows[0] as unknown as GeneratedRuleRow);
    },

    async getLifecycleCounts(repo: string): Promise<GeneratedRuleLifecycleCounts> {
      const rows = await sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'retired')::int AS retired,
          COUNT(*)::int AS total
        FROM generated_rules
        WHERE repo = ${repo}
      `;

      const row = rows[0] as Record<string, unknown> | undefined;
      return {
        pending: Number(row?.pending ?? 0),
        active: Number(row?.active ?? 0),
        retired: Number(row?.retired ?? 0),
        total: Number(row?.total ?? 0),
      };
    },
  };

  logger.debug("GeneratedRuleStore initialized");
  return store;
}
