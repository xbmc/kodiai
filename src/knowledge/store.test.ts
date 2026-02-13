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

  describe("run state", () => {
    test("checkAndClaimRun returns new for first run", () => {
      const result = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 10,
        baseSha: "base-aaa",
        headSha: "head-bbb",
        deliveryId: "delivery-1",
        action: "opened",
      });

      expect(result.shouldProcess).toBe(true);
      expect(result.reason).toBe("new");
      expect(result.runKey).toBe("owner/repo:pr-10:base-base-aaa:head-head-bbb");
      expect(result.supersededRunKeys).toEqual([]);
    });

    test("checkAndClaimRun returns duplicate for same SHA pair", () => {
      const params = {
        repo: "owner/repo",
        prNumber: 11,
        baseSha: "base-111",
        headSha: "head-222",
        deliveryId: "delivery-first",
        action: "opened",
      };

      const first = fixture.store.checkAndClaimRun(params);
      expect(first.shouldProcess).toBe(true);
      expect(first.reason).toBe("new");

      const second = fixture.store.checkAndClaimRun({
        ...params,
        deliveryId: "delivery-second",
      });
      expect(second.shouldProcess).toBe(false);
      expect(second.reason).toBe("duplicate");
    });

    test("force push supersedes prior runs", () => {
      const firstRun = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 12,
        baseSha: "base-aaa",
        headSha: "head-old",
        deliveryId: "delivery-a",
        action: "opened",
      });
      expect(firstRun.shouldProcess).toBe(true);
      expect(firstRun.reason).toBe("new");

      const secondRun = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 12,
        baseSha: "base-aaa",
        headSha: "head-new",
        deliveryId: "delivery-b",
        action: "opened",
      });
      expect(secondRun.shouldProcess).toBe(true);
      expect(secondRun.reason).toBe("superseded-prior");
      expect(secondRun.supersededRunKeys).toContain(firstRun.runKey);

      // Verify the old run is now superseded in the database
      const db = new Database(fixture.dbPath, { readonly: true });
      const row = db.query("SELECT status, superseded_by FROM run_state WHERE run_key = ?").get(firstRun.runKey) as Record<string, unknown>;
      db.close();

      expect(row.status).toBe("superseded");
      expect(row.superseded_by).toBe(secondRun.runKey);
    });

    test("completeRun marks run as completed", () => {
      const result = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 13,
        baseSha: "base-ccc",
        headSha: "head-ddd",
        deliveryId: "delivery-c",
        action: "opened",
      });
      expect(result.shouldProcess).toBe(true);

      fixture.store.completeRun(result.runKey);

      const db = new Database(fixture.dbPath, { readonly: true });
      const row = db.query("SELECT status, completed_at FROM run_state WHERE run_key = ?").get(result.runKey) as Record<string, unknown>;
      db.close();

      expect(row.status).toBe("completed");
      expect(row.completed_at).toBeTruthy();
    });

    test("purgeOldRuns removes old completed runs", () => {
      // Create and complete a run
      const result = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 14,
        baseSha: "base-eee",
        headSha: "head-fff",
        deliveryId: "delivery-d",
        action: "opened",
      });
      fixture.store.completeRun(result.runKey);

      // Manually backdate the run for purge testing
      const db = new Database(fixture.dbPath);
      db.run(
        "UPDATE run_state SET created_at = datetime('now', '-60 days') WHERE run_key = ?",
        [result.runKey],
      );
      db.close();

      const purged = fixture.store.purgeOldRuns(30);
      expect(purged).toBeGreaterThanOrEqual(1);

      const verifyDb = new Database(fixture.dbPath, { readonly: true });
      const row = verifyDb.query("SELECT * FROM run_state WHERE run_key = ?").get(result.runKey);
      verifyDb.close();

      expect(row).toBeNull();
    });

    test("different delivery IDs for same SHA pair are still duplicates", () => {
      const first = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 15,
        baseSha: "base-ggg",
        headSha: "head-hhh",
        deliveryId: "delivery-x",
        action: "opened",
      });
      expect(first.shouldProcess).toBe(true);

      const second = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 15,
        baseSha: "base-ggg",
        headSha: "head-hhh",
        deliveryId: "delivery-y",
        action: "opened",
      });
      expect(second.shouldProcess).toBe(false);
      expect(second.reason).toBe("duplicate");

      // Verify both share the same run_key
      expect(second.runKey).toBe(first.runKey);
    });
  });

  describe("incremental re-review queries", () => {
    test("getLastReviewedHeadSha returns null when no completed review exists", () => {
      // No runs at all
      expect(fixture.store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 99 })).toBeNull();

      // Pending run (not completed)
      fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 99,
        baseSha: "base-aaa",
        headSha: "head-pending",
        deliveryId: "delivery-pending",
        action: "opened",
      });
      expect(fixture.store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 99 })).toBeNull();
    });

    test("getLastReviewedHeadSha returns head_sha of most recent completed review", () => {
      // Create and complete first run
      const first = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 100,
        baseSha: "base-aaa",
        headSha: "head-first",
        deliveryId: "delivery-first",
        action: "opened",
      });
      fixture.store.completeRun(first.runKey);

      expect(fixture.store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 100 })).toBe("head-first");

      // Create and complete second run (new push)
      const second = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 100,
        baseSha: "base-aaa",
        headSha: "head-second",
        deliveryId: "delivery-second",
        action: "synchronize",
      });
      fixture.store.completeRun(second.runKey);

      expect(fixture.store.getLastReviewedHeadSha({ repo: "owner/repo", prNumber: 100 })).toBe("head-second");
    });

    test("getPriorReviewFindings returns unsuppressed findings from latest completed review", () => {
      // Set up a completed run + review with findings
      const run = fixture.store.checkAndClaimRun({
        repo: "owner/repo",
        prNumber: 200,
        baseSha: "base-aaa",
        headSha: "head-review-1",
        deliveryId: "delivery-review-1",
        action: "opened",
      });
      fixture.store.completeRun(run.runKey);

      const reviewId = fixture.store.recordReview({
        repo: "owner/repo",
        prNumber: 200,
        headSha: "head-review-1",
        deliveryId: "delivery-review-1",
        filesAnalyzed: 3,
        linesChanged: 50,
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
          filePath: "src/api/routes.ts",
          startLine: 10,
          endLine: 15,
          severity: "major",
          category: "security",
          confidence: 90,
          title: "Missing auth check",
          suppressed: false,
          commentId: 555,
        },
        {
          reviewId,
          filePath: "src/api/utils.ts",
          startLine: 20,
          severity: "medium",
          category: "correctness",
          confidence: 70,
          title: "Potential null dereference",
          suppressed: false,
        },
        {
          reviewId,
          filePath: "src/api/routes.ts",
          startLine: 30,
          severity: "minor",
          category: "style",
          confidence: 50,
          title: "Use const instead of let",
          suppressed: true,
          suppressionPattern: "style:let-vs-const",
        },
      ]);

      const findings = fixture.store.getPriorReviewFindings({ repo: "owner/repo", prNumber: 200 });
      expect(findings).toHaveLength(2);

      expect(findings[0]?.filePath).toBe("src/api/routes.ts");
      expect(findings[0]?.title).toBe("Missing auth check");
      expect(findings[0]?.severity).toBe("major");
      expect(findings[0]?.category).toBe("security");
      expect(findings[0]?.startLine).toBe(10);
      expect(findings[0]?.endLine).toBe(15);
      expect(findings[0]?.commentId).toBe(555);
      expect(findings[0]?.titleFingerprint).toBeTruthy();
      expect(typeof findings[0]?.titleFingerprint).toBe("string");

      expect(findings[1]?.filePath).toBe("src/api/utils.ts");
      expect(findings[1]?.title).toBe("Potential null dereference");
      expect(findings[1]?.startLine).toBe(20);
      expect(findings[1]?.endLine).toBeNull();
      expect(findings[1]?.commentId).toBeNull();
    });

    test("getPriorReviewFindings returns empty array when no completed review exists", () => {
      const findings = fixture.store.getPriorReviewFindings({ repo: "owner/repo", prNumber: 999 });
      expect(findings).toEqual([]);
    });
  });
});
