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
    db.close();

    expect(journalMode.journal_mode).toBe("wal");
    expect(findingsFk.length).toBeGreaterThan(0);
    expect(suppressionFk.length).toBeGreaterThan(0);
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
