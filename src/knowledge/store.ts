import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { FeedbackPattern } from "../feedback/types.ts";
import type {
  AuthorCacheEntry,
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

type RunStateRow = {
  run_key: string;
  status: string;
};

type LastReviewedShaRow = {
  head_sha: string;
};

type PriorFindingRow = {
  file_path: string;
  title: string;
  severity: "critical" | "major" | "medium" | "minor";
  category: "security" | "correctness" | "performance" | "style" | "documentation";
  start_line: number | null;
  end_line: number | null;
  comment_id: number | null;
};

type AuthorCacheRow = {
  tier: string;
  author_association: string;
  pr_count: number | null;
  cached_at: string;
};

type FindingByCommentIdRow = {
  severity: FindingSeverity;
  category: FindingCategory;
  file_path: string;
  start_line: number | null;
  title: string;
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

type FeedbackAggregationRow = {
  title: string;
  thumbs_down_count: number;
  thumbs_up_count: number;
  distinct_reactors: number;
  distinct_prs: number;
  latest_severity: string;
  latest_category: string;
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
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_feedback_reactions_repo_title ON feedback_reactions(repo, title)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS run_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key TEXT NOT NULL UNIQUE,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      base_sha TEXT NOT NULL,
      head_sha TEXT NOT NULL,
      delivery_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      superseded_by TEXT
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_run_state_repo_pr ON run_state(repo, pr_number)");
  db.run("CREATE INDEX IF NOT EXISTS idx_run_state_status ON run_state(status)");

  db.run(`
    CREATE TABLE IF NOT EXISTS author_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      author_login TEXT NOT NULL,
      tier TEXT NOT NULL,
      author_association TEXT NOT NULL,
      pr_count INTEGER,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo, author_login)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_author_cache_lookup ON author_cache(repo, author_login)");

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

  const checkRunExistsStmt = db.query(
    "SELECT run_key, status FROM run_state WHERE run_key = $runKey",
  );

  const findPriorRunsStmt = db.query(
    "SELECT run_key FROM run_state WHERE repo = $repo AND pr_number = $prNumber AND status NOT IN ('superseded')",
  );

  const supersedeRunStmt = db.query(
    "UPDATE run_state SET status = 'superseded', superseded_by = $newRunKey WHERE run_key = $oldRunKey",
  );

  const insertRunStmt = db.query(`
    INSERT INTO run_state (run_key, repo, pr_number, base_sha, head_sha, delivery_id, action, status)
    VALUES ($runKey, $repo, $prNumber, $baseSha, $headSha, $deliveryId, $action, 'pending')
  `);

  const completeRunStmt = db.query(
    "UPDATE run_state SET status = 'completed', completed_at = datetime('now') WHERE run_key = $runKey",
  );

  const getAuthorCacheStmt = db.query(`
    SELECT tier, author_association, pr_count, cached_at
    FROM author_cache
    WHERE repo = ?1
      AND author_login = ?2
      AND cached_at >= datetime('now', '-24 hours')
  `);

  const upsertAuthorCacheStmt = db.query(`
    INSERT INTO author_cache (
      repo,
      author_login,
      tier,
      author_association,
      pr_count,
      cached_at
    ) VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      datetime('now')
    )
    ON CONFLICT(repo, author_login)
    DO UPDATE SET
      tier = excluded.tier,
      author_association = excluded.author_association,
      pr_count = excluded.pr_count,
      cached_at = datetime('now')
  `);

  const purgeStaleAuthorCacheStmt = db.query("DELETE FROM author_cache WHERE cached_at < datetime('now', ?1)");

  const getLastReviewedHeadShaStmt = db.query(`
    SELECT head_sha
    FROM run_state
    WHERE repo = $repo
      AND pr_number = $prNumber
      AND status = 'completed'
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const getPriorReviewFindingsStmt = db.query(`
    SELECT
      f.file_path, f.title, f.severity, f.category,
      f.start_line, f.end_line, f.comment_id
    FROM findings f
    INNER JOIN reviews r ON r.id = f.review_id
    WHERE r.repo = $repo
      AND r.pr_number = $prNumber
      AND r.head_sha = (
        SELECT rs.head_sha FROM run_state rs
        WHERE rs.repo = $repo AND rs.pr_number = $prNumber AND rs.status = 'completed'
        ORDER BY rs.created_at DESC LIMIT 1
      )
      AND f.suppressed = 0
    ORDER BY f.id ASC
    LIMIT $limit
  `);

  const getFindingByCommentIdStmt = db.query(`
    SELECT f.severity, f.category, f.file_path, f.start_line, f.title
    FROM findings f
    INNER JOIN reviews r ON r.id = f.review_id
    WHERE r.repo = $repo AND f.comment_id = $commentId
    ORDER BY f.created_at DESC
    LIMIT 1
  `);

  const aggregateFeedbackPatternsStmt = db.query(`
    SELECT
      fr.title,
      SUM(CASE WHEN fr.reaction_content = '-1' THEN 1 ELSE 0 END) AS thumbs_down_count,
      SUM(CASE WHEN fr.reaction_content = '+1' THEN 1 ELSE 0 END) AS thumbs_up_count,
      COUNT(DISTINCT CASE WHEN fr.reaction_content = '-1' THEN fr.reactor_login END) AS distinct_reactors,
      COUNT(DISTINCT CASE WHEN fr.reaction_content = '-1' THEN r.pr_number END) AS distinct_prs,
      (SELECT fr2.severity FROM feedback_reactions fr2 WHERE fr2.repo = $repo AND fr2.title = fr.title ORDER BY fr2.id DESC LIMIT 1) AS latest_severity,
      (SELECT fr2.category FROM feedback_reactions fr2 WHERE fr2.repo = $repo AND fr2.title = fr.title ORDER BY fr2.id DESC LIMIT 1) AS latest_category
    FROM feedback_reactions fr
    INNER JOIN reviews r ON r.id = fr.review_id
    WHERE fr.repo = $repo
    GROUP BY fr.title
    HAVING SUM(CASE WHEN fr.reaction_content = '-1' THEN 1 ELSE 0 END) > 0
  `);

  const checkAndClaimRunTxn = db.transaction((params: {
    runKey: string;
    repo: string;
    prNumber: number;
    baseSha: string;
    headSha: string;
    deliveryId: string;
    action: string;
  }): RunStateCheck => {
    const existing = checkRunExistsStmt.get({ $runKey: params.runKey }) as RunStateRow | null;
    if (existing) {
      return {
        shouldProcess: false,
        runKey: params.runKey,
        reason: 'duplicate',
        supersededRunKeys: [],
      };
    }

    const priorRuns = findPriorRunsStmt.all({
      $repo: params.repo,
      $prNumber: params.prNumber,
    }) as RunStateRow[];

    const supersededRunKeys: string[] = [];
    for (const prior of priorRuns) {
      supersedeRunStmt.run({
        $newRunKey: params.runKey,
        $oldRunKey: prior.run_key,
      });
      supersededRunKeys.push(prior.run_key);
    }

    insertRunStmt.run({
      $runKey: params.runKey,
      $repo: params.repo,
      $prNumber: params.prNumber,
      $baseSha: params.baseSha,
      $headSha: params.headSha,
      $deliveryId: params.deliveryId,
      $action: params.action,
    });

    return {
      shouldProcess: true,
      runKey: params.runKey,
      reason: supersededRunKeys.length > 0 ? 'superseded-prior' : 'new',
      supersededRunKeys,
    };
  });

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

    checkAndClaimRun(params: {
      repo: string;
      prNumber: number;
      baseSha: string;
      headSha: string;
      deliveryId: string;
      action: string;
    }): RunStateCheck {
      const runKey = `${params.repo}:pr-${params.prNumber}:base-${params.baseSha}:head-${params.headSha}`;
      return checkAndClaimRunTxn({
        runKey,
        repo: params.repo,
        prNumber: params.prNumber,
        baseSha: params.baseSha,
        headSha: params.headSha,
        deliveryId: params.deliveryId,
        action: params.action,
      });
    },

    completeRun(runKey: string): void {
      completeRunStmt.run({ $runKey: runKey });
    },

    purgeOldRuns(retentionDays = 30): number {
      const completedResult = db.run(
        "DELETE FROM run_state WHERE status = 'completed' AND created_at < datetime('now', ?1)",
        [`-${retentionDays} days`],
      );
      const supersededRetention = Math.min(retentionDays, 7);
      const supersededResult = db.run(
        "DELETE FROM run_state WHERE status = 'superseded' AND created_at < datetime('now', ?1)",
        [`-${supersededRetention} days`],
      );
      const authorCachePurged = store.purgeStaleAuthorCache?.() ?? 0;
      return completedResult.changes + supersededResult.changes + authorCachePurged;
    },

    getAuthorCache(params: { repo: string; authorLogin: string }): AuthorCacheEntry | null {
      const row = getAuthorCacheStmt.get({
        1: params.repo,
        2: params.authorLogin,
      }) as AuthorCacheRow | null;

      if (!row) return null;

      return {
        tier: row.tier,
        authorAssociation: row.author_association,
        prCount: row.pr_count,
        cachedAt: row.cached_at,
      };
    },

    getFindingByCommentId(params: { repo: string; commentId: number }): FindingByCommentId | null {
      const row = getFindingByCommentIdStmt.get({
        $repo: params.repo,
        $commentId: params.commentId,
      }) as FindingByCommentIdRow | null;

      if (!row) return null;

      return {
        severity: row.severity,
        category: row.category,
        filePath: row.file_path,
        startLine: row.start_line,
        title: row.title,
      };
    },

    upsertAuthorCache(params: {
      repo: string;
      authorLogin: string;
      tier: string;
      authorAssociation: string;
      prCount: number | null;
    }): void {
      upsertAuthorCacheStmt.run({
        1: params.repo,
        2: params.authorLogin,
        3: params.tier,
        4: params.authorAssociation,
        5: params.prCount,
      });
    },

    purgeStaleAuthorCache(retentionDays = 7): number {
      const result = purgeStaleAuthorCacheStmt.run({
        1: `-${retentionDays} days`,
      });
      return result.changes;
    },

    getLastReviewedHeadSha(params: { repo: string; prNumber: number }): string | null {
      const row = getLastReviewedHeadShaStmt.get({
        $repo: params.repo,
        $prNumber: params.prNumber,
      }) as LastReviewedShaRow | null;
      return row?.head_sha ?? null;
    },

    getPriorReviewFindings(params: { repo: string; prNumber: number; limit?: number }): PriorFinding[] {
      const rows = getPriorReviewFindingsStmt.all({
        $repo: params.repo,
        $prNumber: params.prNumber,
        $limit: params.limit ?? 100,
      }) as PriorFindingRow[];

      return rows.map((row) => ({
        filePath: row.file_path,
        title: row.title,
        titleFingerprint: _fingerprintTitle(row.title),
        severity: row.severity,
        category: row.category,
        startLine: row.start_line,
        endLine: row.end_line,
        commentId: row.comment_id,
      }));
    },

    aggregateFeedbackPatterns(repo: string): FeedbackPattern[] {
      const rows = aggregateFeedbackPatternsStmt.all({ $repo: repo }) as FeedbackAggregationRow[];
      return rows.map((row) => ({
        fingerprint: _feedbackFingerprint(row.title),
        thumbsDownCount: row.thumbs_down_count,
        thumbsUpCount: row.thumbs_up_count,
        distinctReactors: row.distinct_reactors,
        distinctPRs: row.distinct_prs,
        severity: row.latest_severity as FindingSeverity,
        category: row.latest_category as FindingCategory,
        sampleTitle: row.title,
      }));
    },

    clearFeedbackSuppressions(repo: string): number {
      const result = db.run(
        "DELETE FROM feedback_reactions WHERE repo = ?1",
        [repo],
      );
      return result.changes;
    },

    listFeedbackSuppressions(repo: string): FeedbackPattern[] {
      return store.aggregateFeedbackPatterns(repo);
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
