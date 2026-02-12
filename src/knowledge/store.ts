import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type {
  FeedbackReaction,
  FindingCommentCandidate,
  FindingRecord,
  GlobalPatternRecord,
  KnowledgeStore,
  RepoStats,
  ReviewRecord,
  SuppressionLogEntry,
  TrendData,
} from "./types.ts";

type StatsSummaryRow = {
  total_reviews: number;
  total_findings: number;
  total_suppressed: number;
};

type SeverityRow = {
  severity: string;
  count: number;
};

type TopFileRow = {
  path: string;
  finding_count: number;
};

type TrendRow = {
  date: string;
  review_count: number;
  findings_count: number;
  suppressions_count: number;
  avg_confidence: number;
};

type TableInfoRow = {
  name: string;
};

type FindingCommentCandidateRow = {
  finding_id: number;
  review_id: number;
  repo: string;
  comment_id: number;
  comment_surface: "pull_request_review_comment";
  review_output_key: string;
  severity: "critical" | "major" | "medium" | "minor";
  category: "security" | "correctness" | "performance" | "style" | "documentation";
  file_path: string;
  title: string;
  created_at: string;
};

function hasTableColumn(db: Database, tableName: string, columnName: string): boolean {
  const rows = db.query(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
  return rows.some((row) => row.name === columnName);
}

function ensureTableColumn(db: Database, tableName: string, columnName: string, columnDefinition: string): void {
  if (hasTableColumn(db, tableName, columnName)) {
    return;
  }
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
}

function buildSinceFilter(sinceDays?: number): {
  sql: string;
  params: Record<string, string | number>;
} {
  if (sinceDays === undefined) {
    return { sql: "", params: {} };
  }
  return {
    sql: " AND created_at >= datetime('now', $sinceModifier)",
    params: { $sinceModifier: `-${sinceDays} days` },
  };
}

export function createKnowledgeStore(opts: {
  dbPath: string;
  logger: Logger;
}): KnowledgeStore {
  const { dbPath, logger } = opts;

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      head_sha TEXT,
      delivery_id TEXT,
      files_analyzed INTEGER NOT NULL DEFAULT 0,
      lines_changed INTEGER NOT NULL DEFAULT 0,
      findings_critical INTEGER NOT NULL DEFAULT 0,
      findings_major INTEGER NOT NULL DEFAULT 0,
      findings_medium INTEGER NOT NULL DEFAULT 0,
      findings_minor INTEGER NOT NULL DEFAULT 0,
      findings_total INTEGER NOT NULL DEFAULT 0,
      suppressions_applied INTEGER NOT NULL DEFAULT 0,
      config_snapshot TEXT,
      duration_ms INTEGER,
      model TEXT,
      conclusion TEXT NOT NULL DEFAULT 'unknown'
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repo)");
  db.run("CREATE INDEX IF NOT EXISTS idx_reviews_repo_created ON reviews(repo, created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_reviews_pr ON reviews(repo, pr_number)");

  db.run(`
    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      title TEXT NOT NULL,
      suppressed INTEGER NOT NULL DEFAULT 0,
      suppression_pattern TEXT
    )
  `);

  ensureTableColumn(db, "findings", "comment_id", "comment_id INTEGER");
  ensureTableColumn(db, "findings", "comment_surface", "comment_surface TEXT");
  ensureTableColumn(db, "findings", "review_output_key", "review_output_key TEXT");

  db.run("CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity)");
  db.run("CREATE INDEX IF NOT EXISTS idx_findings_repo_file ON findings(file_path)");

  db.run(`
    CREATE TABLE IF NOT EXISTS suppression_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      pattern TEXT NOT NULL,
      matched_count INTEGER NOT NULL DEFAULT 0,
      finding_ids TEXT
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_suppression_log_review ON suppression_log(review_id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS global_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence_band TEXT NOT NULL,
      pattern_fingerprint TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(severity, category, confidence_band, pattern_fingerprint)
    )
  `);

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_global_patterns_lookup ON global_patterns(severity, category, confidence_band)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS feedback_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      repo TEXT NOT NULL,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      finding_id INTEGER NOT NULL REFERENCES findings(id),
      comment_id INTEGER NOT NULL,
      comment_surface TEXT NOT NULL,
      reaction_id INTEGER NOT NULL,
      reaction_content TEXT NOT NULL,
      reactor_login TEXT NOT NULL,
      reacted_at TEXT,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      file_path TEXT NOT NULL,
      title TEXT NOT NULL,
      UNIQUE(repo, comment_id, reaction_id)
    )
  `);

  db.run(
    "CREATE INDEX IF NOT EXISTS idx_feedback_reactions_repo_created ON feedback_reactions(repo, created_at)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_feedback_reactions_finding ON feedback_reactions(finding_id)",
  );

  const recordReviewStmt = db.query(`
    INSERT INTO reviews (
      repo, pr_number, head_sha, delivery_id,
      files_analyzed, lines_changed,
      findings_critical, findings_major, findings_medium, findings_minor, findings_total,
      suppressions_applied, config_snapshot,
      duration_ms, model, conclusion
    ) VALUES (
      $repo, $prNumber, $headSha, $deliveryId,
      $filesAnalyzed, $linesChanged,
      $findingsCritical, $findingsMajor, $findingsMedium, $findingsMinor, $findingsTotal,
      $suppressionsApplied, $configSnapshot,
      $durationMs, $model, $conclusion
    )
    RETURNING id
  `);

  const recordFindingStmt = db.query(`
    INSERT INTO findings (
      review_id, file_path, start_line, end_line,
      severity, category, confidence, title, suppressed, suppression_pattern,
      comment_id, comment_surface, review_output_key
    ) VALUES (
      $reviewId, $filePath, $startLine, $endLine,
      $severity, $category, $confidence, $title, $suppressed, $suppressionPattern,
      $commentId, $commentSurface, $reviewOutputKey
    )
  `);

  const recordFeedbackReactionStmt = db.query(`
    INSERT OR IGNORE INTO feedback_reactions (
      repo,
      review_id,
      finding_id,
      comment_id,
      comment_surface,
      reaction_id,
      reaction_content,
      reactor_login,
      reacted_at,
      severity,
      category,
      file_path,
      title
    ) VALUES (
      $repo,
      $reviewId,
      $findingId,
      $commentId,
      $commentSurface,
      $reactionId,
      $reactionContent,
      $reactorLogin,
      $reactedAt,
      $severity,
      $category,
      $filePath,
      $title
    )
  `);

  const recordSuppressionStmt = db.query(`
    INSERT INTO suppression_log (review_id, pattern, matched_count, finding_ids)
    VALUES ($reviewId, $pattern, $matchedCount, $findingIds)
  `);

  const recordGlobalPatternStmt = db.query(`
    INSERT INTO global_patterns (
      severity,
      category,
      confidence_band,
      pattern_fingerprint,
      count
    ) VALUES (
      $severity,
      $category,
      $confidenceBand,
      $patternFingerprint,
      $count
    )
    ON CONFLICT(severity, category, confidence_band, pattern_fingerprint)
    DO UPDATE SET count = count + excluded.count
  `);

  const insertFindingsTxn = db.transaction((findings: FindingRecord[]) => {
    for (const finding of findings) {
      recordFindingStmt.run({
        $reviewId: finding.reviewId,
        $filePath: finding.filePath,
        $startLine: finding.startLine ?? null,
        $endLine: finding.endLine ?? null,
        $severity: finding.severity,
        $category: finding.category,
        $confidence: finding.confidence,
        $title: finding.title,
        $suppressed: finding.suppressed ? 1 : 0,
        $suppressionPattern: finding.suppressionPattern ?? null,
        $commentId: finding.commentId ?? null,
        $commentSurface: finding.commentSurface ?? null,
        $reviewOutputKey: finding.reviewOutputKey ?? null,
      });
    }
  });

  const insertSuppressionTxn = db.transaction((entries: SuppressionLogEntry[]) => {
    for (const entry of entries) {
      recordSuppressionStmt.run({
        $reviewId: entry.reviewId,
        $pattern: entry.pattern,
        $matchedCount: entry.matchedCount,
        $findingIds: entry.findingIds ? JSON.stringify(entry.findingIds) : null,
      });
    }
  });

  const insertFeedbackReactionTxn = db.transaction((reactions: FeedbackReaction[]) => {
    for (const reaction of reactions) {
      recordFeedbackReactionStmt.run({
        $repo: reaction.repo,
        $reviewId: reaction.reviewId,
        $findingId: reaction.findingId,
        $commentId: reaction.commentId,
        $commentSurface: reaction.commentSurface,
        $reactionId: reaction.reactionId,
        $reactionContent: reaction.reactionContent,
        $reactorLogin: reaction.reactorLogin,
        $reactedAt: reaction.reactedAt ?? null,
        $severity: reaction.severity,
        $category: reaction.category,
        $filePath: reaction.filePath,
        $title: reaction.title,
      });
    }
  });

  const store: KnowledgeStore = {
    recordReview(entry: ReviewRecord): number {
      const inserted = recordReviewStmt.get({
        $repo: entry.repo,
        $prNumber: entry.prNumber,
        $headSha: entry.headSha ?? null,
        $deliveryId: entry.deliveryId ?? null,
        $filesAnalyzed: entry.filesAnalyzed,
        $linesChanged: entry.linesChanged,
        $findingsCritical: entry.findingsCritical,
        $findingsMajor: entry.findingsMajor,
        $findingsMedium: entry.findingsMedium,
        $findingsMinor: entry.findingsMinor,
        $findingsTotal: entry.findingsTotal,
        $suppressionsApplied: entry.suppressionsApplied,
        $configSnapshot: entry.configSnapshot ?? null,
        $durationMs: entry.durationMs ?? null,
        $model: entry.model ?? null,
        $conclusion: entry.conclusion,
      }) as { id: number };
      return inserted.id;
    },

    recordFindings(findings: FindingRecord[]): void {
      if (findings.length === 0) return;
      insertFindingsTxn(findings);
    },

    recordFeedbackReactions(reactions: FeedbackReaction[]): void {
      if (reactions.length === 0) return;
      insertFeedbackReactionTxn(reactions);
    },

    listRecentFindingCommentCandidates(repo: string, limit = 100): FindingCommentCandidate[] {
      const rows = db
        .query(`
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
          WHERE r.repo = $repo
            AND f.comment_id IS NOT NULL
            AND f.comment_surface IS NOT NULL
            AND f.review_output_key IS NOT NULL
          ORDER BY f.created_at DESC, f.id DESC
          LIMIT $limit
        `)
        .all({ $repo: repo, $limit: Math.max(1, limit) }) as FindingCommentCandidateRow[];

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
        createdAt: row.created_at,
      }));
    },

    recordSuppressionLog(entries: SuppressionLogEntry[]): void {
      if (entries.length === 0) return;
      insertSuppressionTxn(entries);
    },

    recordGlobalPattern(entry: GlobalPatternRecord): void {
      if (entry.count <= 0) return;
      recordGlobalPatternStmt.run({
        $severity: entry.severity,
        $category: entry.category,
        $confidenceBand: entry.confidenceBand,
        $patternFingerprint: entry.patternFingerprint,
        $count: entry.count,
      });
    },

    getRepoStats(repo: string, sinceDays?: number): RepoStats {
      const sinceFilter = buildSinceFilter(sinceDays);
      const summary = db
        .query(`
          SELECT
            COUNT(*) AS total_reviews,
            COALESCE(SUM(findings_total), 0) AS total_findings,
            COALESCE(SUM(suppressions_applied), 0) AS total_suppressed
          FROM reviews
          WHERE repo = $repo${sinceFilter.sql}
        `)
        .get({ $repo: repo, ...sinceFilter.params }) as StatsSummaryRow;

      const severityRows = db
        .query(`
          SELECT f.severity AS severity, COUNT(*) AS count
          FROM findings f
          INNER JOIN reviews r ON r.id = f.review_id
          WHERE r.repo = $repo${sinceFilter.sql.replace("created_at", "r.created_at")}
          GROUP BY f.severity
        `)
        .all({ $repo: repo, ...sinceFilter.params }) as SeverityRow[];

      const confidenceRow = db
        .query(`
          SELECT COALESCE(AVG(f.confidence), 0) AS avg_confidence
          FROM findings f
          INNER JOIN reviews r ON r.id = f.review_id
          WHERE r.repo = $repo${sinceFilter.sql.replace("created_at", "r.created_at")}
        `)
        .get({ $repo: repo, ...sinceFilter.params }) as { avg_confidence: number };

      const topFilesRows = db
        .query(`
          SELECT f.file_path AS path, COUNT(*) AS finding_count
          FROM findings f
          INNER JOIN reviews r ON r.id = f.review_id
          WHERE r.repo = $repo${sinceFilter.sql.replace("created_at", "r.created_at")}
          GROUP BY f.file_path
          ORDER BY finding_count DESC, f.file_path ASC
          LIMIT 10
        `)
        .all({ $repo: repo, ...sinceFilter.params }) as TopFileRow[];

      const findingsBySeverity: Record<string, number> = {
        critical: 0,
        major: 0,
        medium: 0,
        minor: 0,
      };
      for (const row of severityRows) {
        findingsBySeverity[row.severity] = row.count;
      }

      const totalReviews = summary.total_reviews;
      const totalFindings = summary.total_findings;

      return {
        totalReviews,
        totalFindings,
        findingsBySeverity,
        totalSuppressed: summary.total_suppressed,
        avgFindingsPerReview: totalReviews > 0 ? totalFindings / totalReviews : 0,
        avgConfidence: Number(confidenceRow.avg_confidence ?? 0),
        topFiles: topFilesRows.map((row) => ({ path: row.path, findingCount: row.finding_count })),
      };
    },

    getRepoTrends(repo: string, days: number): TrendData[] {
      const rows = db
        .query(`
          SELECT
            day_rollup.date AS date,
            day_rollup.review_count AS review_count,
            COALESCE(finding_rollup.findings_count, 0) AS findings_count,
            day_rollup.suppressions_count AS suppressions_count,
            COALESCE(finding_rollup.avg_confidence, 0) AS avg_confidence
          FROM (
            SELECT
              strftime('%Y-%m-%d', created_at) AS date,
              COUNT(*) AS review_count,
              COALESCE(SUM(suppressions_applied), 0) AS suppressions_count
            FROM reviews
            WHERE repo = $repo
              AND created_at >= datetime('now', $daysModifier)
            GROUP BY strftime('%Y-%m-%d', created_at)
          ) AS day_rollup
          LEFT JOIN (
            SELECT
              strftime('%Y-%m-%d', r.created_at) AS date,
              COUNT(f.id) AS findings_count,
              AVG(f.confidence) AS avg_confidence
            FROM reviews r
            LEFT JOIN findings f ON f.review_id = r.id
            WHERE r.repo = $repo
              AND r.created_at >= datetime('now', $daysModifier)
            GROUP BY strftime('%Y-%m-%d', r.created_at)
          ) AS finding_rollup ON finding_rollup.date = day_rollup.date
          ORDER BY day_rollup.date ASC
        `)
        .all({ $repo: repo, $daysModifier: `-${days} days` }) as TrendRow[];

      return rows.map((row) => ({
        date: row.date,
        reviewCount: row.review_count,
        findingsCount: row.findings_count,
        suppressionsCount: row.suppressions_count,
        avgConfidence: Number(row.avg_confidence ?? 0),
      }));
    },

    checkpoint(): void {
      db.run("PRAGMA wal_checkpoint(PASSIVE)");
    },

    close(): void {
      db.close(false);
    },
  };

  logger.debug({ dbPath }, "KnowledgeStore initialized");
  return store;
}
