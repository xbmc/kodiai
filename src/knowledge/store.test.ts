import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKnowledgeStore } from "./store.ts";
import type { KnowledgeStore } from "./types.ts";

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

function createFileStore(): { store: KnowledgeStore; dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kodiai-knowledge-test-"));
  const dbPath = join(dir, "knowledge.db");
  const store = createKnowledgeStore({ dbPath, logger: mockLogger });
  return {
    store,
    dbPath,
    cleanup: () => {
      try {
        store.close();
      } catch {
        // ignore close errors in test cleanup
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    },
  };
}

describe("KnowledgeStore", () => {
  let fixture: { store: KnowledgeStore; dbPath: string; cleanup: () => void };

  beforeEach(() => {
    fixture = createFileStore();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test("recordReview returns integer id and persists review row", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 42,
      headSha: "abc123",
      deliveryId: "delivery-1",
      filesAnalyzed: 12,
      linesChanged: 400,
      findingsCritical: 1,
      findingsMajor: 2,
      findingsMedium: 3,
      findingsMinor: 4,
      findingsTotal: 10,
      suppressionsApplied: 2,
      configSnapshot: '{"mode":"enhanced"}',
      durationMs: 1234,
      model: "claude-sonnet-4-5-20250929",
      conclusion: "success",
    });

    expect(Number.isInteger(reviewId)).toBe(true);
    expect(reviewId).toBeGreaterThan(0);

    const db = new Database(fixture.dbPath, { readonly: true });
    const row = db.query("SELECT * FROM reviews WHERE id = ?").get(reviewId) as Record<string, unknown>;
    db.close();

    expect(row).toBeTruthy();
    expect(row.repo).toBe("owner/repo");
    expect(row.pr_number).toBe(42);
    expect(row.files_analyzed).toBe(12);
    expect(row.findings_total).toBe(10);
    expect(row.suppressions_applied).toBe(2);
  });

  test("recordFindings batch inserts findings linked to review", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 7,
      filesAnalyzed: 2,
      linesChanged: 30,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    fixture.store.recordFindings([
      {
        reviewId,
        filePath: "src/api/auth.ts",
        startLine: 10,
        endLine: 12,
        severity: "major",
        category: "security",
        confidence: 90,
        title: "Missing auth check",
        suppressed: false,
      },
    ]);

    const db = new Database(fixture.dbPath, { readonly: true });
    const finding = db.query("SELECT * FROM findings WHERE review_id = ?").get(reviewId) as Record<
      string,
      unknown
    >;
    db.close();

    expect(finding).toBeTruthy();
    expect(finding.file_path).toBe("src/api/auth.ts");
    expect(finding.severity).toBe("major");
    expect(finding.category).toBe("security");
    expect(finding.suppressed).toBe(0);
  });

  test("recordFindings persists deterministic comment linkage fields", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 77,
      filesAnalyzed: 1,
      linesChanged: 10,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    fixture.store.recordFindings([
      {
        reviewId,
        commentId: 1234,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:test",
        filePath: "src/handler.ts",
        severity: "major",
        category: "correctness",
        confidence: 80,
        title: "Guard undefined access",
        suppressed: false,
      },
    ]);

    const db = new Database(fixture.dbPath, { readonly: true });
    const finding = db
      .query("SELECT comment_id, comment_surface, review_output_key FROM findings WHERE review_id = ?")
      .get(reviewId) as Record<string, unknown>;
    db.close();

    expect(finding.comment_id).toBe(1234);
    expect(finding.comment_surface).toBe("pull_request_review_comment");
    expect(finding.review_output_key).toBe("kodiai-review-output:v1:test");
  });

  test("recordFeedbackReactions is append-only and deduplicates by repo/comment/reaction", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 88,
      filesAnalyzed: 1,
      linesChanged: 10,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    fixture.store.recordFindings([
      {
        reviewId,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:feedback",
        filePath: "src/api/routes.ts",
        severity: "major",
        category: "security",
        confidence: 91,
        title: "Sanitize request body",
        suppressed: false,
      },
    ]);

    const db = new Database(fixture.dbPath, { readonly: true });
    const findingRow = db
      .query("SELECT id FROM findings WHERE review_id = ?")
      .get(reviewId) as { id: number };
    db.close();

    fixture.store.recordFeedbackReactions([
      {
        repo: "owner/repo",
        reviewId,
        findingId: findingRow.id,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reactionId: 9001,
        reactionContent: "+1",
        reactorLogin: "alice",
        reactedAt: "2026-02-12T00:00:00Z",
        severity: "major",
        category: "security",
        filePath: "src/api/routes.ts",
        title: "Sanitize request body",
      },
      {
        repo: "owner/repo",
        reviewId,
        findingId: findingRow.id,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reactionId: 9002,
        reactionContent: "-1",
        reactorLogin: "bob",
        reactedAt: "2026-02-12T00:05:00Z",
        severity: "major",
        category: "security",
        filePath: "src/api/routes.ts",
        title: "Sanitize request body",
      },
      {
        repo: "owner/repo",
        reviewId,
        findingId: findingRow.id,
        commentId: 222,
        commentSurface: "pull_request_review_comment",
        reactionId: 9001,
        reactionContent: "+1",
        reactorLogin: "alice",
        reactedAt: "2026-02-12T00:00:00Z",
        severity: "major",
        category: "security",
        filePath: "src/api/routes.ts",
        title: "Sanitize request body",
      },
    ]);

    const verifyDb = new Database(fixture.dbPath, { readonly: true });
    const rows = verifyDb
      .query(
        "SELECT reaction_content, reactor_login, severity, category, file_path, title FROM feedback_reactions WHERE finding_id = ? ORDER BY reaction_id ASC",
      )
      .all(findingRow.id) as Array<Record<string, unknown>>;
    verifyDb.close();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.reaction_content).toBe("+1");
    expect(rows[1]?.reaction_content).toBe("-1");
    expect(rows[0]?.reactor_login).toBe("alice");
    expect(rows[1]?.reactor_login).toBe("bob");
    expect(rows[0]?.severity).toBe("major");
    expect(rows[0]?.category).toBe("security");
    expect(rows[0]?.file_path).toBe("src/api/routes.ts");
    expect(rows[0]?.title).toBe("Sanitize request body");
  });

  test("listRecentFindingCommentCandidates returns linked findings for repo", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 89,
      filesAnalyzed: 1,
      linesChanged: 5,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 0,
      conclusion: "success",
    });

    fixture.store.recordFindings([
      {
        reviewId,
        commentId: 444,
        commentSurface: "pull_request_review_comment",
        reviewOutputKey: "kodiai-review-output:v1:candidate",
        filePath: "src/candidate.ts",
        severity: "major",
        category: "correctness",
        confidence: 70,
        title: "Candidate finding",
        suppressed: false,
      },
    ]);

    const candidates = fixture.store.listRecentFindingCommentCandidates("owner/repo", 10);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.commentId).toBe(444);
    expect(candidates[0]?.commentSurface).toBe("pull_request_review_comment");
    expect(candidates[0]?.reviewOutputKey).toBe("kodiai-review-output:v1:candidate");
    expect(candidates[0]?.filePath).toBe("src/candidate.ts");
  });

  test("recordSuppressionLog stores suppression entries", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 9,
      filesAnalyzed: 1,
      linesChanged: 10,
      findingsCritical: 0,
      findingsMajor: 0,
      findingsMedium: 1,
      findingsMinor: 0,
      findingsTotal: 1,
      suppressionsApplied: 1,
      conclusion: "success",
    });

    fixture.store.recordSuppressionLog([
      {
        reviewId,
        pattern: "missing JSDoc",
        matchedCount: 2,
        findingIds: [11, 12],
      },
    ]);

    const db = new Database(fixture.dbPath, { readonly: true });
    const row = db.query("SELECT * FROM suppression_log WHERE review_id = ?").get(reviewId) as Record<
      string,
      unknown
    >;
    db.close();

    expect(row).toBeTruthy();
    expect(row.pattern).toBe("missing JSDoc");
    expect(row.matched_count).toBe(2);
    expect(row.finding_ids).toBe("[11,12]");
  });

  test("recordGlobalPattern upserts anonymized aggregate counts", () => {
    fixture.store.recordGlobalPattern({
      severity: "major",
      category: "correctness",
      confidenceBand: "high",
      patternFingerprint: "fp-abc123",
      count: 2,
    });
    fixture.store.recordGlobalPattern({
      severity: "major",
      category: "correctness",
      confidenceBand: "high",
      patternFingerprint: "fp-abc123",
      count: 3,
    });

    const db = new Database(fixture.dbPath, { readonly: true });
    const row = db
      .query(
        "SELECT severity, category, confidence_band, pattern_fingerprint, count FROM global_patterns WHERE pattern_fingerprint = ?",
      )
      .get("fp-abc123") as Record<string, unknown>;
    db.close();

    expect(row.severity).toBe("major");
    expect(row.category).toBe("correctness");
    expect(row.confidence_band).toBe("high");
    expect(row.pattern_fingerprint).toBe("fp-abc123");
    expect(row.count).toBe(5);
  });

  test("getRepoStats returns aggregate totals and top files", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 1,
      filesAnalyzed: 3,
      linesChanged: 50,
      findingsCritical: 1,
      findingsMajor: 1,
      findingsMedium: 0,
      findingsMinor: 0,
      findingsTotal: 2,
      suppressionsApplied: 1,
      conclusion: "success",
    });

    fixture.store.recordFindings([
      {
        reviewId,
        filePath: "src/a.ts",
        severity: "critical",
        category: "security",
        confidence: 99,
        title: "Critical issue",
        suppressed: false,
      },
      {
        reviewId,
        filePath: "src/a.ts",
        severity: "major",
        category: "correctness",
        confidence: 80,
        title: "Major issue",
        suppressed: true,
        suppressionPattern: "false positive",
      },
    ]);

    const stats = fixture.store.getRepoStats("owner/repo");
    expect(stats.totalReviews).toBe(1);
    expect(stats.totalFindings).toBe(2);
    expect(stats.findingsBySeverity.critical).toBe(1);
    expect(stats.findingsBySeverity.major).toBe(1);
    expect(stats.totalSuppressed).toBe(1);
    expect(stats.avgFindingsPerReview).toBe(2);
    expect(stats.avgConfidence).toBe(89.5);
    expect(stats.topFiles[0]).toEqual({ path: "src/a.ts", findingCount: 2 });
  });

  test("getRepoTrends returns daily aggregate rows", () => {
    const reviewId = fixture.store.recordReview({
      repo: "owner/repo",
      prNumber: 3,
      filesAnalyzed: 2,
      linesChanged: 20,
      findingsCritical: 0,
      findingsMajor: 1,
      findingsMedium: 1,
      findingsMinor: 0,
      findingsTotal: 2,
      suppressionsApplied: 1,
      conclusion: "success",
    });

    fixture.store.recordFindings([
      {
        reviewId,
        filePath: "src/trends.ts",
        severity: "major",
        category: "correctness",
        confidence: 70,
        title: "Issue A",
        suppressed: false,
      },
      {
        reviewId,
        filePath: "src/trends.ts",
        severity: "medium",
        category: "performance",
        confidence: 60,
        title: "Issue B",
        suppressed: true,
      },
    ]);

    const trends = fixture.store.getRepoTrends("owner/repo", 30);
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0]?.reviewCount).toBe(1);
    expect(trends[0]?.findingsCount).toBe(2);
    expect(trends[0]?.suppressionsCount).toBe(1);
    expect(trends[0]?.avgConfidence).toBe(65);
  });

  test("empty repo returns zeroed stats and empty trends", () => {
    const stats = fixture.store.getRepoStats("unknown/repo");
    expect(stats.totalReviews).toBe(0);
    expect(stats.totalFindings).toBe(0);
    expect(stats.totalSuppressed).toBe(0);
    expect(stats.avgFindingsPerReview).toBe(0);
    expect(stats.avgConfidence).toBe(0);
    expect(stats.topFiles).toEqual([]);

    const trends = fixture.store.getRepoTrends("unknown/repo", 30);
    expect(trends).toEqual([]);
  });

  test("enforces foreign key constraints", () => {
    expect(() =>
      fixture.store.recordFindings([
        {
          reviewId: 999_999,
          filePath: "src/nope.ts",
          severity: "minor",
          category: "style",
          confidence: 10,
          title: "Orphan finding",
          suppressed: false,
        },
      ])).toThrow();

    expect(() =>
      fixture.store.recordFeedbackReactions([
        {
          repo: "owner/repo",
          reviewId: 999_998,
          findingId: 999_999,
          commentId: 1,
          commentSurface: "pull_request_review_comment",
          reactionId: 1,
          reactionContent: "+1",
          reactorLogin: "eve",
          severity: "minor",
          category: "style",
          filePath: "src/nope.ts",
          title: "Orphan reaction",
        },
      ])).toThrow();
  });

  test("WAL mode and foreign key relationships are present", () => {
    const db = new Database(fixture.dbPath, { readonly: true });
    const journalMode = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    const findingsFk = db.query("PRAGMA foreign_key_list(findings)").all() as Array<
      Record<string, unknown>
    >;
    const suppressionFk = db.query("PRAGMA foreign_key_list(suppression_log)").all() as Array<
      Record<string, unknown>
    >;
    const reactionFk = db.query("PRAGMA foreign_key_list(feedback_reactions)").all() as Array<
      Record<string, unknown>
    >;
    db.close();

    expect(journalMode.journal_mode).toBe("wal");
    expect(findingsFk.length).toBeGreaterThan(0);
    expect(suppressionFk.length).toBeGreaterThan(0);
    expect(reactionFk.length).toBeGreaterThan(0);
  });

  test("close prevents future operations", () => {
    fixture.store.close();
    expect(() =>
      fixture.store.recordReview({
        repo: "owner/repo",
        prNumber: 1,
        filesAnalyzed: 0,
        linesChanged: 0,
        findingsCritical: 0,
        findingsMajor: 0,
        findingsMedium: 0,
        findingsMinor: 0,
        findingsTotal: 0,
        suppressionsApplied: 0,
        conclusion: "success",
      })).toThrow();
  });
});
