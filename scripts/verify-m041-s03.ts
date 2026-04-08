/**
 * M041 S03 proof harness: selective update, drift detection, and repair.
 *
 * All checks run in-memory — no live database, no git repo, no embedding API
 * are required. The harness wires stubs that exercise the real module code paths
 * (updateCanonicalCodeSnapshot, buildEmbeddingAuditReport, buildEmbeddingRepairPlan,
 * runEmbeddingRepair) with controlled state, then verifies observable outcomes.
 *
 * Checks:
 *   M041-S03-UNCHANGED-FILE-PRESERVATION
 *     Unchanged chunks are not re-written; only changed chunks are updated.
 *   M041-S03-DRIFT-DETECTED-BY-AUDIT
 *     The audit report surfaces stale / missing / model-mismatch canonical rows as fail.
 *   M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS
 *     The repair plan touches only the stale rows; fresh rows are not re-embedded.
 *   M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT
 *     When all rows are fresh, the repair reports not_needed rather than
 *     attempting any embedding calls.
 */

import {
  updateCanonicalCodeSnapshot,
  type CanonicalCodeUpdateResult,
} from "../src/knowledge/canonical-code-update.ts";
import {
  buildEmbeddingAuditReport,
  finalizeEmbeddingAuditReport,
  type EmbeddingAuditEnvelope,
} from "../src/knowledge/embedding-audit.ts";
import {
  buildEmbeddingRepairPlan,
  runEmbeddingRepair,
  type EmbeddingRepairReport,
  type RepairCandidateRow,
} from "../src/knowledge/embedding-repair.ts";
import type { CanonicalCodeStore } from "../src/knowledge/canonical-code-types.ts";
import type { EmbeddingProvider } from "../src/knowledge/types.ts";
import pino from "pino";

// ── Public check IDs ──────────────────────────────────────────────────────────

export const M041_S03_CHECK_IDS = [
  "M041-S03-UNCHANGED-FILE-PRESERVATION",
  "M041-S03-DRIFT-DETECTED-BY-AUDIT",
  "M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS",
  "M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT",
] as const;

export type M041S03CheckId = (typeof M041_S03_CHECK_IDS)[number];

export type M041S03Check = {
  id: M041S03CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type M041S03EvaluationReport = {
  check_ids: readonly string[];
  overallPassed: boolean;
  checks: M041S03Check[];
};

// ── Proof fixture result type (machine-checkable output) ─────────────────────

export type M041S03SelectiveUpdateResult = {
  update: {
    unchanged: number;
    updated: number;
    removed: number;
    failed: number;
    upsertCallCount: number;
    deleteCallCount: number;
  };
};

export type M041S03AuditResult = {
  audit: {
    status_code: "audit_ok" | "audit_warn" | "audit_failed";
    success: boolean;
    canonicalCodeStatus: string;
    canonicalCodeMissingOrNull: number;
    canonicalCodeStale: number;
    canonicalCodeModelMismatch: number;
  };
};

export type M041S03RepairResult = {
  repair: {
    status_code: "repair_completed" | "repair_not_needed" | "repair_failed";
    success: boolean;
    processed: number;
    repaired: number;
    skipped: number;
    failed: number;
    embedCallCount: number;
    writeCallCount: number;
  };
};

export type M041S03NoRepairNeededResult = {
  noRepair: {
    status_code: "repair_completed" | "repair_not_needed" | "repair_failed";
    success: boolean;
    processed: number;
    repaired: number;
    embedCallCount: number;
  };
};

// ── Shared hashes for deterministic test data ─────────────────────────────────

/** SHA-256 of "export const config = { enabled: true };" produced by canonical-code-chunker */
const UNCHANGED_HASH = "2cf70c8516307f5fefd094fb9f66300c9be2900212b9a56d28cd4f34d3e21465";
/** A different hash representing "old" content that will be seen as changed */
const STALE_HASH = "aaaa0000bbbb1111cccc2222dddd3333eeee4444ffff555500001111222233334";

// ── In-memory store harness ───────────────────────────────────────────────────

type RowState = {
  filePath: string;
  chunkType: string;
  symbolName: string | null;
  contentHash: string;
  deleted: boolean;
};

type WriteHarness = {
  upsertCalls: number;
  deleteCalls: number;
  store: Pick<CanonicalCodeStore, "listChunksForFile" | "deleteChunksForFile" | "upsertChunk">;
};

function createWriteHarness(initialRows: RowState[]): WriteHarness {
  const rows: RowState[] = initialRows.map((row) => ({ ...row }));
  const harness = { upsertCalls: 0, deleteCalls: 0 } as WriteHarness;

  harness.store = {
    async listChunksForFile(params) {
      let id = 1n;
      return rows
        .filter((row) => !row.deleted && row.filePath === params.filePath)
        .map((row) => ({
          id: id++,
          filePath: row.filePath,
          chunkType: row.chunkType as CanonicalCodeStore["listChunksForFile"] extends (...args: infer _) => Promise<Array<infer T>> ? (T extends { chunkType: infer CT } ? CT : never) : never,
          symbolName: row.symbolName,
          contentHash: row.contentHash,
        }));
    },
    async deleteChunksForFile(params) {
      harness.deleteCalls += 1;
      let n = 0;
      for (const row of rows) {
        if (row.filePath === params.filePath && !row.deleted) {
          row.deleted = true;
          n += 1;
        }
      }
      return n;
    },
    async upsertChunk(input, _embedding) {
      harness.upsertCalls += 1;
      const existing = rows.find(
        (row) =>
          !row.deleted &&
          row.filePath === input.filePath &&
          row.chunkType === input.chunkType &&
          row.symbolName === input.symbolName,
      );
      if (existing) {
        if (existing.contentHash === input.contentHash) {
          return "dedup";
        }
        existing.contentHash = input.contentHash;
        return "replaced";
      }
      rows.push({
        filePath: input.filePath,
        chunkType: input.chunkType,
        symbolName: input.symbolName,
        contentHash: input.contentHash,
        deleted: false,
      });
      return "inserted";
    },
  };

  return harness;
}

// ── Embedding provider stub ───────────────────────────────────────────────────

function createStubEmbeddingProvider(): EmbeddingProvider & { callCount: number } {
  let callCount = 0;
  return {
    get callCount() {
      return callCount;
    },
    get model() {
      return "voyage-4";
    },
    get dimensions() {
      return 2;
    },
    async generate(text: string) {
      callCount += 1;
      return {
        embedding: new Float32Array([text.length, text.length % 7]),
        model: "voyage-4",
        dimensions: 2,
      };
    },
  };
}

function createSilentLogger() {
  return pino({ level: "silent" });
}

// ── Fixture runners ───────────────────────────────────────────────────────────

/**
 * Fixture for unchanged-file preservation check.
 *
 * Scenario: a file has two chunks already stored with current hashes.
 * The update request sends the same file content → both chunks should be
 * recognised as unchanged; no upserts should fire.
 */
export async function runUnchangedFileFixture(): Promise<M041S03SelectiveUpdateResult> {
  const initialRows: RowState[] = [
    {
      filePath: "src/player.ts",
      chunkType: "module",
      symbolName: null,
      contentHash: UNCHANGED_HASH,
      deleted: false,
    },
    // The function chunk content hash is derived from the content; we use a
    // stable hash that the chunker will produce for this exact text so we can
    // assert unchanged detection without actually hashing here.
    {
      filePath: "src/player.ts",
      chunkType: "function",
      symbolName: "boot",
      contentHash: "5493b6cb5745787ae27cf11456fdfa17e597d683c59544f0ddd9247cd9b0a213",
      deleted: false,
    },
  ];

  const harness = createWriteHarness(initialRows);
  const embeddingProvider = createStubEmbeddingProvider();
  const logger = createSilentLogger();

  const result: CanonicalCodeUpdateResult = await updateCanonicalCodeSnapshot({
    store: harness.store,
    embeddingProvider,
    logger,
    request: {
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      commitSha: "def456",
      files: [
        {
          filePath: "src/player.ts",
          fileContent: [
            "export const config = { enabled: true };",
            "",
            "export function boot() {",
            "  return config.enabled;",
            "}",
          ].join("\n"),
        },
      ],
    },
  });

  return {
    update: {
      unchanged: result.unchanged,
      updated: result.updated,
      removed: result.removed,
      failed: result.failed,
      upsertCallCount: harness.upsertCalls,
      deleteCallCount: harness.deleteCalls,
    },
  };
}

/**
 * Fixture for partial update check.
 *
 * Scenario: one chunk matches the stored hash (unchanged), another has a
 * different hash (changed). Only the changed chunk should be re-embedded
 * and upserted.
 */
export async function runPartialUpdateFixture(): Promise<M041S03SelectiveUpdateResult> {
  const initialRows: RowState[] = [
    {
      filePath: "src/player.ts",
      chunkType: "module",
      symbolName: null,
      contentHash: UNCHANGED_HASH,
      deleted: false,
    },
    {
      filePath: "src/player.ts",
      chunkType: "function",
      symbolName: "boot",
      // Intentionally wrong hash — triggers a changed-chunk update
      contentHash: STALE_HASH,
      deleted: false,
    },
  ];

  const harness = createWriteHarness(initialRows);
  const embeddingProvider = createStubEmbeddingProvider();
  const logger = createSilentLogger();

  const result: CanonicalCodeUpdateResult = await updateCanonicalCodeSnapshot({
    store: harness.store,
    embeddingProvider,
    logger,
    request: {
      repo: "kodi",
      owner: "xbmc",
      canonicalRef: "main",
      commitSha: "def456",
      files: [
        {
          filePath: "src/player.ts",
          fileContent: [
            "export const config = { enabled: true };",
            "",
            "export function boot() {",
            "  return config.enabled;",
            "}",
          ].join("\n"),
        },
      ],
    },
  });

  return {
    update: {
      unchanged: result.unchanged,
      updated: result.updated,
      removed: result.removed,
      failed: result.failed,
      upsertCallCount: harness.upsertCalls,
      deleteCallCount: harness.deleteCalls,
    },
  };
}

/**
 * Fixture for drift detection (audit).
 *
 * Scenario: canonical_code_chunks has stale, missing, and model-mismatch rows.
 * The audit report should surface these as fail / critical for the canonical_code
 * corpus.
 */
export function runDriftAuditFixture(): M041S03AuditResult {
  const report = buildEmbeddingAuditReport({
    generatedAt: new Date().toISOString(),
    corpora: {
      learning_memories: {
        total: 10,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 10 },
      },
      review_comments: {
        total: 5,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 5 },
      },
      wiki_pages: {
        total: 3,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-context-3": 3 },
      },
      code_snippets: {
        total: 20,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 20 },
      },
      issues: {
        total: 7,
        missing_or_null: 0,
        stale: 0,
        stale_support: "not_supported",
        actual_model_counts: { "voyage-4": 7 },
      },
      issue_comments: {
        total: 4,
        missing_or_null: 0,
        stale: 0,
        stale_support: "not_supported",
        actual_model_counts: { "voyage-4": 4 },
      },
      // canonical_code has 2 stale + 1 missing + 3 with old model
      canonical_code: {
        total: 30,
        missing_or_null: 1,
        stale: 2,
        stale_support: "supported",
        actual_model_counts: {
          "voyage-4": 27,
          "voyage-3": 3,  // model mismatch
        },
      },
    },
  });

  const envelope: EmbeddingAuditEnvelope = finalizeEmbeddingAuditReport(report);
  const canonicalReport = report.corpora.find((c) => c.corpus === "canonical_code")!;

  return {
    audit: {
      status_code: envelope.status_code,
      success: envelope.success,
      canonicalCodeStatus: canonicalReport.status,
      canonicalCodeMissingOrNull: canonicalReport.missing_or_null,
      canonicalCodeStale: canonicalReport.stale,
      canonicalCodeModelMismatch: canonicalReport.model_mismatch,
    },
  };
}

/**
 * Fixture for clean-state audit.
 *
 * Scenario: all canonical_code rows are fresh with the expected model.
 * The audit should pass.
 */
export function runCleanAuditFixture(): M041S03AuditResult {
  const report = buildEmbeddingAuditReport({
    generatedAt: new Date().toISOString(),
    corpora: {
      learning_memories: {
        total: 10,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 10 },
      },
      review_comments: {
        total: 5,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 5 },
      },
      wiki_pages: {
        total: 3,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-context-3": 3 },
      },
      code_snippets: {
        total: 20,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 20 },
      },
      issues: {
        total: 7,
        missing_or_null: 0,
        stale: 0,
        stale_support: "not_supported",
        actual_model_counts: { "voyage-4": 7 },
      },
      issue_comments: {
        total: 4,
        missing_or_null: 0,
        stale: 0,
        stale_support: "not_supported",
        actual_model_counts: { "voyage-4": 4 },
      },
      canonical_code: {
        total: 30,
        missing_or_null: 0,
        stale: 0,
        stale_support: "supported",
        actual_model_counts: { "voyage-4": 30 },
      },
    },
  });

  const envelope: EmbeddingAuditEnvelope = finalizeEmbeddingAuditReport(report);
  const canonicalReport = report.corpora.find((c) => c.corpus === "canonical_code")!;

  return {
    audit: {
      status_code: envelope.status_code,
      success: envelope.success,
      canonicalCodeStatus: canonicalReport.status,
      canonicalCodeMissingOrNull: canonicalReport.missing_or_null,
      canonicalCodeStale: canonicalReport.stale,
      canonicalCodeModelMismatch: canonicalReport.model_mismatch,
    },
  };
}

/**
 * Fixture for selective repair check.
 *
 * Scenario: a mix of stale, missing, and fresh rows. Only the drifted rows
 * should end up in the repair plan; the repair should embed exactly those rows.
 */
export async function runSelectiveRepairFixture(): Promise<M041S03RepairResult> {
  const targetModel = "voyage-4";

  // Row 1: stale=true → repair candidate
  // Row 2: model mismatch → repair candidate
  // Row 3: missing embedding → repair candidate
  // Row 4: fresh, correct model, not stale → should NOT be touched
  const rows: RepairCandidateRow[] = [
    {
      id: 1,
      corpus: "canonical_code",
      embedding_model: targetModel,
      embedding: new Float32Array([0.1]),
      stale: true,
      chunk_text: "export function staleFunction() {}",
    },
    {
      id: 2,
      corpus: "canonical_code",
      embedding_model: "voyage-3",  // wrong model
      embedding: new Float32Array([0.2]),
      stale: false,
      chunk_text: "export function modelMismatchFunction() {}",
    },
    {
      id: 3,
      corpus: "canonical_code",
      embedding_model: null,  // missing
      embedding: null,
      stale: false,
      chunk_text: "export function missingEmbeddingFunction() {}",
    },
    {
      id: 4,
      corpus: "canonical_code",
      embedding_model: targetModel,
      embedding: new Float32Array([0.4]),
      stale: false,
      chunk_text: "export function freshFunction() {}",
    },
  ];

  let embedCallCount = 0;
  let writeCallCount = 0;

  const report: EmbeddingRepairReport = await runEmbeddingRepair({
    corpus: "canonical_code",
    store: {
      async listRepairCandidates() {
        return rows;
      },
      async getRepairState() {
        return null;
      },
      async saveRepairState() {},
      async writeRepairEmbeddingsBatch(payload) {
        writeCallCount += payload.embeddings.length;
      },
    },
    embedRows: async (batchRows) => {
      embedCallCount += batchRows.length;
      return {
        status: "ok",
        embeddings: batchRows.map((row) => ({
          row_id: row.id,
          embedding: new Float32Array([row.id, row.id * 0.1]),
        })),
      };
    },
  });

  return {
    repair: {
      status_code: report.status_code,
      success: report.success,
      processed: report.processed,
      repaired: report.repaired,
      skipped: report.skipped,
      failed: report.failed,
      embedCallCount,
      writeCallCount,
    },
  };
}

/**
 * Fixture for "no drift → no repair" check.
 *
 * Scenario: all rows are fresh. The repair should detect nothing to do and
 * return repair_not_needed without calling the embedding provider at all.
 */
export async function runNoRepairNeededFixture(): Promise<M041S03NoRepairNeededResult> {
  const targetModel = "voyage-4";

  const rows: RepairCandidateRow[] = [
    {
      id: 1,
      corpus: "canonical_code",
      embedding_model: targetModel,
      embedding: new Float32Array([0.1]),
      stale: false,
      chunk_text: "export function freshA() {}",
    },
    {
      id: 2,
      corpus: "canonical_code",
      embedding_model: targetModel,
      embedding: new Float32Array([0.2]),
      stale: false,
      chunk_text: "export function freshB() {}",
    },
  ];

  let embedCallCount = 0;

  const report: EmbeddingRepairReport = await runEmbeddingRepair({
    corpus: "canonical_code",
    store: {
      async listRepairCandidates() {
        return rows;
      },
      async getRepairState() {
        return null;
      },
      async saveRepairState() {},
      async writeRepairEmbeddingsBatch() {},
    },
    embedRows: async (batchRows) => {
      embedCallCount += batchRows.length;
      return {
        status: "ok",
        embeddings: batchRows.map((row) => ({
          row_id: row.id,
          embedding: new Float32Array([1, 0]),
        })),
      };
    },
  });

  return {
    noRepair: {
      status_code: report.status_code,
      success: report.success,
      processed: report.processed,
      repaired: report.repaired,
      embedCallCount,
    },
  };
}

// ── Check runners ─────────────────────────────────────────────────────────────

export async function runUnchangedFilePreservationCheck(
  runUnchangedFn: () => Promise<M041S03SelectiveUpdateResult> = runUnchangedFileFixture,
  runPartialFn: () => Promise<M041S03SelectiveUpdateResult> = runPartialUpdateFixture,
): Promise<M041S03Check> {
  const problems: string[] = [];

  // Sub-check A: fully unchanged file → zero upserts
  const unchangedResult = await runUnchangedFn();
  if (unchangedResult.update.upsertCallCount !== 0) {
    problems.push(
      `unchanged file: expected 0 upserts, got ${unchangedResult.update.upsertCallCount}`,
    );
  }
  if (unchangedResult.update.deleteCallCount !== 0) {
    problems.push(
      `unchanged file: expected 0 deletes, got ${unchangedResult.update.deleteCallCount}`,
    );
  }
  if (unchangedResult.update.unchanged < 2) {
    problems.push(
      `unchanged file: expected >= 2 unchanged, got ${unchangedResult.update.unchanged}`,
    );
  }

  // Sub-check B: partial change → exactly 1 upsert, 1 unchanged preserved
  const partialResult = await runPartialFn();
  if (partialResult.update.upsertCallCount !== 1) {
    problems.push(
      `partial update: expected 1 upsert, got ${partialResult.update.upsertCallCount}`,
    );
  }
  if (partialResult.update.unchanged < 1) {
    problems.push(
      `partial update: expected >= 1 unchanged, got ${partialResult.update.unchanged}`,
    );
  }
  if (partialResult.update.updated < 1) {
    problems.push(
      `partial update: expected >= 1 updated, got ${partialResult.update.updated}`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M041-S03-UNCHANGED-FILE-PRESERVATION",
      passed: true,
      skipped: false,
      status_code: "selective_update_preserves_unchanged_rows",
      detail:
        `unchanged_upserts=${unchangedResult.update.upsertCallCount} ` +
        `unchanged_deletes=${unchangedResult.update.deleteCallCount} ` +
        `partial_upserts=${partialResult.update.upsertCallCount} ` +
        `partial_unchanged=${partialResult.update.unchanged}`,
    };
  }

  return {
    id: "M041-S03-UNCHANGED-FILE-PRESERVATION",
    passed: false,
    skipped: false,
    status_code: "selective_update_verification_failed",
    detail: problems.join("; "),
  };
}

export function runDriftDetectedByAuditCheck(
  driftFn: () => M041S03AuditResult = runDriftAuditFixture,
  cleanFn: () => M041S03AuditResult = runCleanAuditFixture,
): M041S03Check {
  const problems: string[] = [];

  // Sub-check A: drifted corpus → audit_failed
  const driftResult = driftFn();
  if (driftResult.audit.status_code !== "audit_failed") {
    problems.push(
      `drift scenario: expected status_code=audit_failed, got ${driftResult.audit.status_code}`,
    );
  }
  if (driftResult.audit.canonicalCodeStatus !== "fail") {
    problems.push(
      `drift scenario: canonical_code status=${driftResult.audit.canonicalCodeStatus} (expected fail)`,
    );
  }
  if (driftResult.audit.canonicalCodeMissingOrNull === 0) {
    problems.push("drift scenario: missing_or_null unexpectedly 0");
  }
  if (driftResult.audit.canonicalCodeModelMismatch === 0) {
    problems.push("drift scenario: model_mismatch unexpectedly 0");
  }

  // Sub-check B: clean corpus → audit_ok
  const cleanResult = cleanFn();
  if (cleanResult.audit.status_code !== "audit_ok") {
    problems.push(
      `clean scenario: expected status_code=audit_ok, got ${cleanResult.audit.status_code}`,
    );
  }
  if (cleanResult.audit.canonicalCodeStatus !== "pass") {
    problems.push(
      `clean scenario: canonical_code status=${cleanResult.audit.canonicalCodeStatus} (expected pass)`,
    );
  }

  if (problems.length === 0) {
    return {
      id: "M041-S03-DRIFT-DETECTED-BY-AUDIT",
      passed: true,
      skipped: false,
      status_code: "audit_surfaces_canonical_code_drift",
      detail:
        `drift_status_code=${driftResult.audit.status_code} ` +
        `drift_canonical_status=${driftResult.audit.canonicalCodeStatus} ` +
        `clean_status_code=${cleanResult.audit.status_code}`,
    };
  }

  return {
    id: "M041-S03-DRIFT-DETECTED-BY-AUDIT",
    passed: false,
    skipped: false,
    status_code: "audit_drift_detection_failed",
    detail: problems.join("; "),
  };
}

export async function runSelectiveRepairFixesOnlyDriftedRowsCheck(
  runFn: () => Promise<M041S03RepairResult> = runSelectiveRepairFixture,
): Promise<M041S03Check> {
  const problems: string[] = [];
  const result = await runFn();

  // 3 rows are repair candidates (stale + model mismatch + missing embedding).
  // 1 row is fresh and must not be touched.
  if (result.repair.status_code !== "repair_completed") {
    problems.push(`status_code=${result.repair.status_code} (expected repair_completed)`);
  }
  if (!result.repair.success) {
    problems.push("success=false (expected true)");
  }
  if (result.repair.repaired !== 3) {
    problems.push(`repaired=${result.repair.repaired} (expected 3)`);
  }
  if (result.repair.embedCallCount !== 3) {
    problems.push(
      `embedCallCount=${result.repair.embedCallCount} (expected 3 — fresh row must not be re-embedded)`,
    );
  }
  if (result.repair.writeCallCount !== 3) {
    problems.push(
      `writeCallCount=${result.repair.writeCallCount} (expected 3)`,
    );
  }
  if (result.repair.failed !== 0) {
    problems.push(`failed=${result.repair.failed} (expected 0)`);
  }

  if (problems.length === 0) {
    return {
      id: "M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS",
      passed: true,
      skipped: false,
      status_code: "repair_targets_only_drifted_canonical_rows",
      detail:
        `repaired=${result.repair.repaired} ` +
        `embedCallCount=${result.repair.embedCallCount} ` +
        `writeCallCount=${result.repair.writeCallCount}`,
    };
  }

  return {
    id: "M041-S03-SELECTIVE-REPAIR-FIXES-ONLY-DRIFTED-ROWS",
    passed: false,
    skipped: false,
    status_code: "selective_repair_verification_failed",
    detail: problems.join("; "),
  };
}

export async function runRepairSkipsWhenNoDriftCheck(
  runFn: () => Promise<M041S03NoRepairNeededResult> = runNoRepairNeededFixture,
): Promise<M041S03Check> {
  const problems: string[] = [];
  const result = await runFn();

  if (result.noRepair.status_code !== "repair_not_needed") {
    problems.push(
      `status_code=${result.noRepair.status_code} (expected repair_not_needed)`,
    );
  }
  if (!result.noRepair.success) {
    problems.push("success=false (expected true)");
  }
  if (result.noRepair.embedCallCount !== 0) {
    problems.push(
      `embedCallCount=${result.noRepair.embedCallCount} (expected 0 — no rows to repair)`,
    );
  }
  if (result.noRepair.repaired !== 0) {
    problems.push(`repaired=${result.noRepair.repaired} (expected 0)`);
  }

  if (problems.length === 0) {
    return {
      id: "M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT",
      passed: true,
      skipped: false,
      status_code: "repair_reports_not_needed_when_corpus_is_fresh",
      detail:
        `status_code=${result.noRepair.status_code} ` +
        `embedCallCount=${result.noRepair.embedCallCount}`,
    };
  }

  return {
    id: "M041-S03-REPAIR-SKIPS-WHEN-NO-DRIFT",
    passed: false,
    skipped: false,
    status_code: "no_drift_repair_check_failed",
    detail: problems.join("; "),
  };
}

// ── Top-level evaluator ───────────────────────────────────────────────────────

export type M041S03FixtureOverrides = {
  _runUnchangedFile?: () => Promise<M041S03SelectiveUpdateResult>;
  _runPartialUpdate?: () => Promise<M041S03SelectiveUpdateResult>;
  _runDriftAudit?: () => M041S03AuditResult;
  _runCleanAudit?: () => M041S03AuditResult;
  _runSelectiveRepair?: () => Promise<M041S03RepairResult>;
  _runNoRepair?: () => Promise<M041S03NoRepairNeededResult>;
};

export async function evaluateM041S03(
  opts?: M041S03FixtureOverrides,
): Promise<M041S03EvaluationReport> {
  const [
    preservationCheck,
    auditCheck,
    repairCheck,
    noRepairCheck,
  ] = await Promise.all([
    runUnchangedFilePreservationCheck(opts?._runUnchangedFile, opts?._runPartialUpdate),
    Promise.resolve(runDriftDetectedByAuditCheck(opts?._runDriftAudit, opts?._runCleanAudit)),
    runSelectiveRepairFixesOnlyDriftedRowsCheck(opts?._runSelectiveRepair),
    runRepairSkipsWhenNoDriftCheck(opts?._runNoRepair),
  ]);

  const checks = [preservationCheck, auditCheck, repairCheck, noRepairCheck];
  const overallPassed = checks.filter((c) => !c.skipped).every((c) => c.passed);

  return {
    check_ids: M041_S03_CHECK_IDS,
    overallPassed,
    checks,
  };
}

// ── Report renderer ───────────────────────────────────────────────────────────

function renderReport(report: M041S03EvaluationReport): string {
  const lines = [
    "M041 S03 proof harness: selective update, drift detection, and repair",
    `Final verdict: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    const detail = check.detail ? ` ${check.detail}` : "";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${detail}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

// ── Harness entry point ───────────────────────────────────────────────────────

export async function buildM041S03ProofHarness(opts?: {
  json?: boolean;
  stdout?: { write: (chunk: string) => void };
  stderr?: { write: (chunk: string) => void };
} & M041S03FixtureOverrides): Promise<{ exitCode: number }> {
  const stdout = opts?.stdout ?? process.stdout;
  const stderr = opts?.stderr ?? process.stderr;
  const useJson = opts?.json ?? false;

  const report = await evaluateM041S03(opts);

  if (useJson) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderReport(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((c) => !c.passed && !c.skipped)
      .map((c) => `${c.id}:${c.status_code}`)
      .join(", ");
    stderr.write(`verify:m041:s03 failed: ${failingCodes}\n`);
  }

  return { exitCode: report.overallPassed ? 0 : 1 };
}

if (import.meta.main) {
  const useJson = process.argv.includes("--json");
  const { exitCode } = await buildM041S03ProofHarness({ json: useJson });
  process.exit(exitCode);
}
