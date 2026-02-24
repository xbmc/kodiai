import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { FeedbackPattern } from "../feedback/types.ts";
import type {
  AuthorCacheEntry,
  CheckpointRecord,
  DepBumpMergeHistoryRecord,
  FeedbackReaction,
  FindingByCommentId,
  FindingCommentCandidate,
  FindingRecord,
  FindingCategory,
  FindingSeverity,
  GlobalPatternRecord,
  KnowledgeStore,
  PriorFinding,
  RepoStats,
  ReviewRecord,
  RunStateCheck,
  SuppressionLogEntry,
  TrendData,
} from "./types.ts";

type CheckpointData = {
  filesReviewed: string[];
  findingCount: number;
  summaryDraft: string;
  totalFiles: number;
};

/** FNV-1a fingerprint for title deduplication (duplicated from review.ts to avoid circular imports). */
function _fingerprintTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** FNV-1a fingerprint matching review.ts fingerprintFindingTitle (includes fp- prefix). */
function _feedbackFingerprint(title: string): string {
  return `fp-${_fingerprintTitle(title)}`;
}

export function createKnowledgeStore(opts: {
  sql: Sql;
  logger: Logger;
}): KnowledgeStore {
  const { sql, logger } = opts;

  const store: KnowledgeStore = {
    async recordReview(entry: ReviewRecord): Promise<number> {
      const [inserted] = await sql`
        INSERT INTO reviews (
          repo, pr_number, head_sha, delivery_id,
          files_analyzed, lines_changed,
          findings_critical, findings_major, findings_medium, findings_minor, findings_total,
          suppressions_applied, config_snapshot,
          duration_ms, model, conclusion
        ) VALUES (
          ${entry.repo}, ${entry.prNumber}, ${entry.headSha ?? null}, ${entry.deliveryId ?? null},
          ${entry.filesAnalyzed}, ${entry.linesChanged},
          ${entry.findingsCritical}, ${entry.findingsMajor}, ${entry.findingsMedium}, ${entry.findingsMinor}, ${entry.findingsTotal},
          ${entry.suppressionsApplied}, ${entry.configSnapshot ?? null},
          ${entry.durationMs ?? null}, ${entry.model ?? null}, ${entry.conclusion}
        )
        RETURNING id
      `;
      return inserted.id;
    },

    async recordFindings(findings: FindingRecord[]): Promise<void> {
      if (findings.length === 0) return;
      await sql.begin(async (tx) => {
        for (const finding of findings) {
          await tx`
            INSERT INTO findings (
              review_id, file_path, start_line, end_line,
              severity, category, confidence, title, suppressed, suppression_pattern,
              comment_id, comment_surface, review_output_key
            ) VALUES (
              ${finding.reviewId}, ${finding.filePath}, ${finding.startLine ?? null}, ${finding.endLine ?? null},
              ${finding.severity}, ${finding.category}, ${finding.confidence}, ${finding.title},
              ${finding.suppressed}, ${finding.suppressionPattern ?? null},
              ${finding.commentId ?? null}, ${finding.commentSurface ?? null}, ${finding.reviewOutputKey ?? null}
            )
          `;
        }
      });
    },

    async recordFeedbackReactions(reactions: FeedbackReaction[]): Promise<void> {
      if (reactions.length === 0) return;
      await sql.begin(async (tx) => {
        for (const reaction of reactions) {
          await tx`
            INSERT INTO feedback_reactions (
              repo, review_id, finding_id, comment_id, comment_surface,
              reaction_id, reaction_content, reactor_login, reacted_at,
              severity, category, file_path, title
            ) VALUES (
              ${reaction.repo}, ${reaction.reviewId}, ${reaction.findingId},
              ${reaction.commentId}, ${reaction.commentSurface},
              ${reaction.reactionId}, ${reaction.reactionContent}, ${reaction.reactorLogin},
              ${reaction.reactedAt ?? null},
              ${reaction.severity}, ${reaction.category}, ${reaction.filePath}, ${reaction.title}
            )
            ON CONFLICT (repo, comment_id, reaction_id) DO NOTHING
          `;
        }
      });
    },

    async listRecentFindingCommentCandidates(repo: string, limit = 100): Promise<FindingCommentCandidate[]> {
      const effectiveLimit = Math.max(1, limit);
      const rows = await sql`
        SELECT
          f.id AS finding_id,
          f.review_id AS review_id,
          r.repo AS repo,
          f.comment_id AS comment_id,
          f.comment_surface AS comment_surface,
          f.review_output_key AS review_output_key,
          f.severity AS severity,
          f.category AS category,
          f.file_path AS file_path,
          f.title AS title,
          f.created_at AS created_at
        FROM findings f
        INNER JOIN reviews r ON r.id = f.review_id
        WHERE r.repo = ${repo}
          AND f.comment_id IS NOT NULL
          AND f.comment_surface IS NOT NULL
          AND f.review_output_key IS NOT NULL
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT ${effectiveLimit}
      `;

      return rows.map((row) => ({
        findingId: row.finding_id,
        reviewId: row.review_id,
        repo: row.repo,
        commentId: row.comment_id,
        commentSurface: row.comment_surface,
        reviewOutputKey: row.review_output_key,
        severity: row.severity,
        category: row.category,
        filePath: row.file_path,
        title: row.title,
        createdAt: typeof row.created_at === "string" ? row.created_at : (row.created_at as Date).toISOString(),
      }));
    },

    async recordSuppressionLog(entries: SuppressionLogEntry[]): Promise<void> {
      if (entries.length === 0) return;
      await sql.begin(async (tx) => {
        for (const entry of entries) {
          await tx`
            INSERT INTO suppression_log (review_id, pattern, matched_count, finding_ids)
            VALUES (${entry.reviewId}, ${entry.pattern}, ${entry.matchedCount}, ${entry.findingIds ? JSON.stringify(entry.findingIds) : null})
          `;
        }
      });
    },

    async recordGlobalPattern(entry: GlobalPatternRecord): Promise<void> {
      if (entry.count <= 0) return;
      await sql`
        INSERT INTO global_patterns (
          severity, category, confidence_band, pattern_fingerprint, count
        ) VALUES (
          ${entry.severity}, ${entry.category}, ${entry.confidenceBand},
          ${entry.patternFingerprint}, ${entry.count}
        )
        ON CONFLICT (severity, category, confidence_band, pattern_fingerprint)
        DO UPDATE SET count = global_patterns.count + EXCLUDED.count
      `;
    },

    async recordDepBumpMergeHistory(entry: DepBumpMergeHistoryRecord): Promise<void> {
      const isSecurityBump =
        entry.isSecurityBump === undefined || entry.isSecurityBump === null
          ? null
          : entry.isSecurityBump;
      await sql`
        INSERT INTO dep_bump_merge_history (
          repo, pr_number, merged_at, delivery_id, source, signals_json,
          package_name, old_version, new_version, semver_bump_type,
          merge_confidence_level, merge_confidence_rationale_json,
          advisory_status, advisory_max_severity, is_security_bump
        ) VALUES (
          ${entry.repo}, ${entry.prNumber}, ${entry.mergedAt ?? null}, ${entry.deliveryId ?? null},
          ${entry.source}, ${entry.signalsJson ?? null},
          ${entry.packageName ?? null}, ${entry.oldVersion ?? null}, ${entry.newVersion ?? null},
          ${entry.semverBumpType ?? null},
          ${entry.mergeConfidenceLevel ?? null}, ${entry.mergeConfidenceRationaleJson ?? null},
          ${entry.advisoryStatus ?? null}, ${entry.advisoryMaxSeverity ?? null}, ${isSecurityBump}
        )
        ON CONFLICT (repo, pr_number) DO NOTHING
      `;
    },

    async getRepoStats(repo: string, sinceDays?: number): Promise<RepoStats> {
      const sinceClause = sinceDays !== undefined;
      const days = sinceDays ?? 0;

      const [summary] = sinceClause
        ? await sql`
            SELECT
              COUNT(*) AS total_reviews,
              COALESCE(SUM(findings_total), 0) AS total_findings,
              COALESCE(SUM(suppressions_applied), 0) AS total_suppressed
            FROM reviews
            WHERE repo = ${repo} AND created_at >= now() - ${`${days} days`}::interval
          `
        : await sql`
            SELECT
              COUNT(*) AS total_reviews,
              COALESCE(SUM(findings_total), 0) AS total_findings,
              COALESCE(SUM(suppressions_applied), 0) AS total_suppressed
            FROM reviews
            WHERE repo = ${repo}
          `;

      const severityRows = sinceClause
        ? await sql`
            SELECT f.severity AS severity, COUNT(*) AS count
            FROM findings f
            INNER JOIN reviews r ON r.id = f.review_id
            WHERE r.repo = ${repo} AND r.created_at >= now() - ${`${days} days`}::interval
            GROUP BY f.severity
          `
        : await sql`
            SELECT f.severity AS severity, COUNT(*) AS count
            FROM findings f
            INNER JOIN reviews r ON r.id = f.review_id
            WHERE r.repo = ${repo}
            GROUP BY f.severity
          `;

      const [confidenceRow] = sinceClause
        ? await sql`
            SELECT COALESCE(AVG(f.confidence), 0) AS avg_confidence
            FROM findings f
            INNER JOIN reviews r ON r.id = f.review_id
            WHERE r.repo = ${repo} AND r.created_at >= now() - ${`${days} days`}::interval
          `
        : await sql`
            SELECT COALESCE(AVG(f.confidence), 0) AS avg_confidence
            FROM findings f
            INNER JOIN reviews r ON r.id = f.review_id
            WHERE r.repo = ${repo}
          `;

      const topFilesRows = sinceClause
        ? await sql`
            SELECT f.file_path AS path, COUNT(*) AS finding_count
            FROM findings f
            INNER JOIN reviews r ON r.id = f.review_id
            WHERE r.repo = ${repo} AND r.created_at >= now() - ${`${days} days`}::interval
            GROUP BY f.file_path
            ORDER BY finding_count DESC, f.file_path ASC
            LIMIT 10
          `
        : await sql`
            SELECT f.file_path AS path, COUNT(*) AS finding_count
            FROM findings f
            INNER JOIN reviews r ON r.id = f.review_id
            WHERE r.repo = ${repo}
            GROUP BY f.file_path
            ORDER BY finding_count DESC, f.file_path ASC
            LIMIT 10
          `;

      const findingsBySeverity: Record<string, number> = {
        critical: 0,
        major: 0,
        medium: 0,
        minor: 0,
      };
      for (const row of severityRows) {
        findingsBySeverity[row.severity] = Number(row.count);
      }

      const totalReviews = Number(summary.total_reviews);
      const totalFindings = Number(summary.total_findings);

      return {
        totalReviews,
        totalFindings,
        findingsBySeverity,
        totalSuppressed: Number(summary.total_suppressed),
        avgFindingsPerReview: totalReviews > 0 ? totalFindings / totalReviews : 0,
        avgConfidence: Number(confidenceRow.avg_confidence ?? 0),
        topFiles: topFilesRows.map((row) => ({ path: row.path, findingCount: Number(row.finding_count) })),
      };
    },

    async getRepoTrends(repo: string, days: number): Promise<TrendData[]> {
      const interval = `${days} days`;
      const rows = await sql`
        SELECT
          day_rollup.date AS date,
          day_rollup.review_count AS review_count,
          COALESCE(finding_rollup.findings_count, 0) AS findings_count,
          day_rollup.suppressions_count AS suppressions_count,
          COALESCE(finding_rollup.avg_confidence, 0) AS avg_confidence
        FROM (
          SELECT
            to_char(created_at, 'YYYY-MM-DD') AS date,
            COUNT(*) AS review_count,
            COALESCE(SUM(suppressions_applied), 0) AS suppressions_count
          FROM reviews
          WHERE repo = ${repo}
            AND created_at >= now() - ${interval}::interval
          GROUP BY to_char(created_at, 'YYYY-MM-DD')
        ) AS day_rollup
        LEFT JOIN (
          SELECT
            to_char(r.created_at, 'YYYY-MM-DD') AS date,
            COUNT(f.id) AS findings_count,
            AVG(f.confidence) AS avg_confidence
          FROM reviews r
          LEFT JOIN findings f ON f.review_id = r.id
          WHERE r.repo = ${repo}
            AND r.created_at >= now() - ${interval}::interval
          GROUP BY to_char(r.created_at, 'YYYY-MM-DD')
        ) AS finding_rollup ON finding_rollup.date = day_rollup.date
        ORDER BY day_rollup.date ASC
      `;

      return rows.map((row) => ({
        date: row.date,
        reviewCount: Number(row.review_count),
        findingsCount: Number(row.findings_count),
        suppressionsCount: Number(row.suppressions_count),
        avgConfidence: Number(row.avg_confidence ?? 0),
      }));
    },

    async checkAndClaimRun(params: {
      repo: string;
      prNumber: number;
      baseSha: string;
      headSha: string;
      deliveryId: string;
      action: string;
    }): Promise<RunStateCheck> {
      const runKey = `${params.repo}:pr-${params.prNumber}:base-${params.baseSha}:head-${params.headSha}`;

      return await sql.begin(async (tx) => {
        // Check for existing run with this key
        const existing = await tx`
          SELECT run_key, status FROM run_state WHERE run_key = ${runKey}
        `;
        if (existing.length > 0) {
          return {
            shouldProcess: false,
            runKey,
            reason: 'duplicate' as const,
            supersededRunKeys: [],
          };
        }

        // Find prior runs for the same PR
        const priorRuns = await tx`
          SELECT run_key FROM run_state
          WHERE repo = ${params.repo} AND pr_number = ${params.prNumber}
            AND status NOT IN ('superseded')
        `;

        const supersededRunKeys: string[] = [];
        for (const prior of priorRuns) {
          await tx`
            UPDATE run_state SET status = 'superseded', superseded_by = ${runKey}
            WHERE run_key = ${prior.run_key}
          `;
          supersededRunKeys.push(prior.run_key);
        }

        // Insert the new run
        await tx`
          INSERT INTO run_state (run_key, repo, pr_number, base_sha, head_sha, delivery_id, action, status)
          VALUES (${runKey}, ${params.repo}, ${params.prNumber}, ${params.baseSha}, ${params.headSha}, ${params.deliveryId}, ${params.action}, 'pending')
        `;

        return {
          shouldProcess: true,
          runKey,
          reason: (supersededRunKeys.length > 0 ? 'superseded-prior' : 'new') as 'superseded-prior' | 'new',
          supersededRunKeys,
        };
      });
    },

    async completeRun(runKey: string): Promise<void> {
      await sql`
        UPDATE run_state SET status = 'completed', completed_at = now()
        WHERE run_key = ${runKey}
      `;
    },

    async purgeOldRuns(retentionDays = 30): Promise<number> {
      const completedInterval = `${retentionDays} days`;
      const supersededRetention = Math.min(retentionDays, 7);
      const supersededInterval = `${supersededRetention} days`;

      const completedResult = await sql`
        DELETE FROM run_state
        WHERE status = 'completed' AND created_at < now() - ${completedInterval}::interval
      `;
      const supersededResult = await sql`
        DELETE FROM run_state
        WHERE status = 'superseded' AND created_at < now() - ${supersededInterval}::interval
      `;
      const authorCachePurged = await store.purgeStaleAuthorCache?.() ?? 0;
      return completedResult.count + supersededResult.count + authorCachePurged;
    },

    async getAuthorCache(params: { repo: string; authorLogin: string }): Promise<AuthorCacheEntry | null> {
      const rows = await sql`
        SELECT tier, author_association, pr_count, cached_at
        FROM author_cache
        WHERE repo = ${params.repo}
          AND author_login = ${params.authorLogin}
          AND cached_at >= now() - interval '24 hours'
      `;

      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        tier: row.tier,
        authorAssociation: row.author_association,
        prCount: row.pr_count,
        cachedAt: typeof row.cached_at === "string" ? row.cached_at : (row.cached_at as Date).toISOString(),
      };
    },

    async getFindingByCommentId(params: { repo: string; commentId: number }): Promise<FindingByCommentId | null> {
      const rows = await sql`
        SELECT f.severity, f.category, f.file_path, f.start_line, f.title
        FROM findings f
        INNER JOIN reviews r ON r.id = f.review_id
        WHERE r.repo = ${params.repo} AND f.comment_id = ${params.commentId}
        ORDER BY f.created_at DESC
        LIMIT 1
      `;

      if (rows.length === 0) return null;
      const row = rows[0];

      return {
        severity: row.severity as FindingSeverity,
        category: row.category as FindingCategory,
        filePath: row.file_path,
        startLine: row.start_line,
        title: row.title,
      };
    },

    async upsertAuthorCache(params: {
      repo: string;
      authorLogin: string;
      tier: string;
      authorAssociation: string;
      prCount: number | null;
    }): Promise<void> {
      const repo = params.repo.trim();
      const authorLogin = params.authorLogin.trim();
      if (!repo || !authorLogin) {
        logger.warn(
          {
            repo: params.repo,
            authorLogin: params.authorLogin,
          },
          "Skipping author cache upsert due to missing identity fields",
        );
        return;
      }

      await sql`
        INSERT INTO author_cache (
          repo, author_login, tier, author_association, pr_count, cached_at
        ) VALUES (
          ${repo}, ${authorLogin}, ${params.tier}, ${params.authorAssociation},
          ${params.prCount}, now()
        )
        ON CONFLICT (repo, author_login)
        DO UPDATE SET
          tier = EXCLUDED.tier,
          author_association = EXCLUDED.author_association,
          pr_count = EXCLUDED.pr_count,
          cached_at = now()
      `;
    },

    async purgeStaleAuthorCache(retentionDays = 7): Promise<number> {
      const interval = `${retentionDays} days`;
      const result = await sql`
        DELETE FROM author_cache WHERE cached_at < now() - ${interval}::interval
      `;
      return result.count;
    },

    async getLastReviewedHeadSha(params: { repo: string; prNumber: number }): Promise<string | null> {
      const rows = await sql`
        SELECT head_sha
        FROM run_state
        WHERE repo = ${params.repo}
          AND pr_number = ${params.prNumber}
          AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 1
      `;
      return rows.length > 0 ? rows[0].head_sha : null;
    },

    async getPriorReviewFindings(params: { repo: string; prNumber: number; limit?: number }): Promise<PriorFinding[]> {
      const effectiveLimit = params.limit ?? 100;
      const rows = await sql`
        SELECT
          f.file_path, f.title, f.severity, f.category,
          f.start_line, f.end_line, f.comment_id
        FROM findings f
        INNER JOIN reviews r ON r.id = f.review_id
        WHERE r.repo = ${params.repo}
          AND r.pr_number = ${params.prNumber}
          AND r.head_sha = (
            SELECT rs.head_sha FROM run_state rs
            WHERE rs.repo = ${params.repo} AND rs.pr_number = ${params.prNumber} AND rs.status = 'completed'
            ORDER BY rs.created_at DESC LIMIT 1
          )
          AND f.suppressed = false
        ORDER BY f.id ASC
        LIMIT ${effectiveLimit}
      `;

      return rows.map((row) => ({
        filePath: row.file_path,
        title: row.title,
        titleFingerprint: _fingerprintTitle(row.title),
        severity: row.severity as FindingSeverity,
        category: row.category as FindingCategory,
        startLine: row.start_line,
        endLine: row.end_line,
        commentId: row.comment_id,
      }));
    },

    async aggregateFeedbackPatterns(repo: string): Promise<FeedbackPattern[]> {
      const rows = await sql`
        SELECT
          fr.title,
          SUM(CASE WHEN fr.reaction_content = '-1' THEN 1 ELSE 0 END) AS thumbs_down_count,
          SUM(CASE WHEN fr.reaction_content = '+1' THEN 1 ELSE 0 END) AS thumbs_up_count,
          COUNT(DISTINCT CASE WHEN fr.reaction_content = '-1' THEN fr.reactor_login END) AS distinct_reactors,
          COUNT(DISTINCT CASE WHEN fr.reaction_content = '-1' THEN r.pr_number END) AS distinct_prs,
          (SELECT fr2.severity FROM feedback_reactions fr2 WHERE fr2.repo = ${repo} AND fr2.title = fr.title ORDER BY fr2.id DESC LIMIT 1) AS latest_severity,
          (SELECT fr2.category FROM feedback_reactions fr2 WHERE fr2.repo = ${repo} AND fr2.title = fr.title ORDER BY fr2.id DESC LIMIT 1) AS latest_category
        FROM feedback_reactions fr
        INNER JOIN reviews r ON r.id = fr.review_id
        WHERE fr.repo = ${repo}
        GROUP BY fr.title
        HAVING SUM(CASE WHEN fr.reaction_content = '-1' THEN 1 ELSE 0 END) > 0
      `;
      return rows.map((row) => ({
        fingerprint: _feedbackFingerprint(row.title),
        thumbsDownCount: Number(row.thumbs_down_count),
        thumbsUpCount: Number(row.thumbs_up_count),
        distinctReactors: Number(row.distinct_reactors),
        distinctPRs: Number(row.distinct_prs),
        severity: row.latest_severity as FindingSeverity,
        category: row.latest_category as FindingCategory,
        sampleTitle: row.title,
      }));
    },

    async clearFeedbackSuppressions(repo: string): Promise<number> {
      const result = await sql`
        DELETE FROM feedback_reactions WHERE repo = ${repo}
      `;
      return result.count;
    },

    async listFeedbackSuppressions(repo: string): Promise<FeedbackPattern[]> {
      return store.aggregateFeedbackPatterns(repo);
    },

    async saveCheckpoint(data: CheckpointRecord): Promise<void> {
      const checkpointData: CheckpointData = {
        filesReviewed: data.filesReviewed,
        findingCount: data.findingCount,
        summaryDraft: data.summaryDraft,
        totalFiles: data.totalFiles,
      };

      await sql`
        INSERT INTO review_checkpoints (
          review_output_key, repo, pr_number, checkpoint_data, partial_comment_id
        ) VALUES (
          ${data.reviewOutputKey}, ${data.repo}, ${data.prNumber},
          ${JSON.stringify(checkpointData)}, ${data.partialCommentId ?? null}
        )
        ON CONFLICT (review_output_key)
        DO UPDATE SET
          checkpoint_data = EXCLUDED.checkpoint_data,
          partial_comment_id = COALESCE(EXCLUDED.partial_comment_id, review_checkpoints.partial_comment_id)
      `;
    },

    async getCheckpoint(reviewOutputKey: string): Promise<CheckpointRecord | null> {
      const rows = await sql`
        SELECT
          created_at, review_output_key, repo, pr_number,
          checkpoint_data, partial_comment_id
        FROM review_checkpoints
        WHERE review_output_key = ${reviewOutputKey}
        LIMIT 1
      `;

      if (rows.length === 0) return null;
      const row = rows[0];

      let parsed: CheckpointData | null = null;
      try {
        parsed = JSON.parse(row.checkpoint_data) as CheckpointData;
      } catch (err) {
        logger.warn(
          { err, reviewOutputKey },
          "Failed to parse review checkpoint JSON; returning null",
        );
        return null;
      }

      return {
        reviewOutputKey: row.review_output_key,
        repo: row.repo,
        prNumber: row.pr_number,
        filesReviewed: Array.isArray(parsed.filesReviewed) ? parsed.filesReviewed : [],
        findingCount: typeof parsed.findingCount === "number" ? parsed.findingCount : 0,
        summaryDraft: typeof parsed.summaryDraft === "string" ? parsed.summaryDraft : "",
        totalFiles: typeof parsed.totalFiles === "number" ? parsed.totalFiles : 0,
        partialCommentId: row.partial_comment_id,
        createdAt: typeof row.created_at === "string" ? row.created_at : (row.created_at as Date).toISOString(),
      };
    },

    async deleteCheckpoint(reviewOutputKey: string): Promise<void> {
      await sql`
        DELETE FROM review_checkpoints WHERE review_output_key = ${reviewOutputKey}
      `;
    },

    async updateCheckpointCommentId(reviewOutputKey: string, commentId: number): Promise<void> {
      await sql`
        UPDATE review_checkpoints SET partial_comment_id = ${commentId}
        WHERE review_output_key = ${reviewOutputKey}
      `;
    },

    checkpoint(): void {
      // No-op: PostgreSQL has no WAL checkpoint equivalent needed
    },

    close(): void {
      // No-op: connection lifecycle managed by client.ts
    },
  };

  logger.debug("KnowledgeStore initialized (PostgreSQL)");
  return store;
}
