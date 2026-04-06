import pino from "pino";
import type { Logger } from "pino";
import { createDbClient, type Sql } from "../db/client.ts";

export const AUDITED_CORPORA = [
  "learning_memories",
  "review_comments",
  "wiki_pages",
  "code_snippets",
  "issues",
  "issue_comments",
  "canonical_code",
] as const;

export type AuditedCorpus = typeof AUDITED_CORPORA[number];
export type StaleSupport = "supported" | "not_supported";
export type AuditStatus = "pass" | "warn" | "fail";
export type AuditSeverity = "info" | "warning" | "critical";

export const EXPECTED_CORPUS_MODELS: Record<AuditedCorpus, string> = {
  learning_memories: "voyage-4",
  review_comments: "voyage-4",
  wiki_pages: "voyage-context-3",
  code_snippets: "voyage-4",
  issues: "voyage-4",
  issue_comments: "voyage-4",
  canonical_code: "voyage-4",
};

export type EmbeddingAuditInputRow = {
  total: number;
  missing_or_null: number;
  stale?: number;
  stale_support?: StaleSupport;
  actual_model_counts: Record<string, number>;
  occurrence_diagnostics?: {
    occurrence_rows: number;
    snippets_without_occurrences: number;
  };
};

export type EmbeddingAuditCorpusReport = {
  corpus: AuditedCorpus;
  total: number;
  missing_or_null: number;
  stale: number;
  stale_support: StaleSupport;
  model_mismatch: number;
  expected_model: string;
  actual_models: string[];
  status: AuditStatus;
  severity: AuditSeverity;
  occurrence_diagnostics?: {
    occurrence_rows: number;
    snippets_without_occurrences: number;
  };
};

export type EmbeddingAuditReport = {
  generated_at: string;
  audited_corpora: AuditedCorpus[];
  overall_status: AuditStatus;
  overall_severity: AuditSeverity;
  corpora: EmbeddingAuditCorpusReport[];
};

export type EmbeddingAuditEnvelope = EmbeddingAuditReport & {
  success: boolean;
  status_code: "audit_ok" | "audit_warn" | "audit_failed";
};

function toInteger(value: unknown): number {
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function normalizeActualModels(actualModelCounts: Record<string, number>): string[] {
  return Object.entries(actualModelCounts)
    .filter(([model, count]) => Boolean(model) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model]) => model);
}

function computeModelMismatch(
  actualModelCounts: Record<string, number>,
  expectedModel: string,
): number {
  return Object.entries(actualModelCounts)
    .filter(([model]) => model !== expectedModel)
    .reduce((sum, [, count]) => sum + count, 0);
}

function deriveCorpusStatus(corpus: {
  missing_or_null: number;
  model_mismatch: number;
  stale: number;
  stale_support: StaleSupport;
  occurrence_diagnostics?: {
    snippets_without_occurrences: number;
  };
}): { status: AuditStatus; severity: AuditSeverity } {
  if (corpus.missing_or_null > 0 || corpus.model_mismatch > 0) {
    return { status: "fail", severity: "critical" };
  }

  if (corpus.stale_support === "supported" && corpus.stale > 0) {
    return { status: "warn", severity: "warning" };
  }

  if ((corpus.occurrence_diagnostics?.snippets_without_occurrences ?? 0) > 0) {
    return { status: "warn", severity: "warning" };
  }

  return { status: "pass", severity: "info" };
}

function summarizeOverall(corpora: EmbeddingAuditCorpusReport[]): {
  overall_status: AuditStatus;
  overall_severity: AuditSeverity;
} {
  if (corpora.some((corpus) => corpus.status === "fail")) {
    return { overall_status: "fail", overall_severity: "critical" };
  }

  if (corpora.some((corpus) => corpus.status === "warn")) {
    return { overall_status: "warn", overall_severity: "warning" };
  }

  return { overall_status: "pass", overall_severity: "info" };
}

export function buildEmbeddingAuditReport(input: {
  generatedAt: string;
  corpora: Record<string, EmbeddingAuditInputRow>;
}): EmbeddingAuditReport {
  const corpora = AUDITED_CORPORA.map((corpus): EmbeddingAuditCorpusReport => {
    const raw = input.corpora[corpus] ?? {
      total: 0,
      missing_or_null: 0,
      stale: 0,
      stale_support: corpus === "issues" || corpus === "issue_comments" ? "not_supported" : "supported",
      actual_model_counts: {},
    } satisfies EmbeddingAuditInputRow;

    const expectedModel = EXPECTED_CORPUS_MODELS[corpus];
    const actualModels = normalizeActualModels(raw.actual_model_counts);
    const modelMismatch = computeModelMismatch(raw.actual_model_counts, expectedModel);
    const staleSupport = raw.stale_support ?? "supported";
    const stale = staleSupport === "supported" ? raw.stale ?? 0 : 0;
    const status = deriveCorpusStatus({
      missing_or_null: raw.missing_or_null,
      model_mismatch: modelMismatch,
      stale,
      stale_support: staleSupport,
      occurrence_diagnostics: raw.occurrence_diagnostics,
    });

    return {
      corpus,
      total: raw.total,
      missing_or_null: raw.missing_or_null,
      stale,
      stale_support: staleSupport,
      model_mismatch: modelMismatch,
      expected_model: expectedModel,
      actual_models: actualModels,
      status: status.status,
      severity: status.severity,
      ...(raw.occurrence_diagnostics ? { occurrence_diagnostics: raw.occurrence_diagnostics } : {}),
    };
  });

  const overall = summarizeOverall(corpora);

  return {
    generated_at: input.generatedAt,
    audited_corpora: [...AUDITED_CORPORA],
    overall_status: overall.overall_status,
    overall_severity: overall.overall_severity,
    corpora,
  };
}

export function finalizeEmbeddingAuditReport(report: EmbeddingAuditReport): EmbeddingAuditEnvelope {
  if (report.overall_status === "fail") {
    return { ...report, success: false, status_code: "audit_failed" };
  }

  if (report.overall_status === "warn") {
    return { ...report, success: true, status_code: "audit_warn" };
  }

  return { ...report, success: true, status_code: "audit_ok" };
}

export function renderEmbeddingAuditReport(report: {
  generated_at: string;
  audited_corpora: readonly string[];
  overall_status: string;
  overall_severity: string;
  corpora: Array<{
    corpus: string;
    total: number;
    missing_or_null: number;
    stale: number;
    stale_support: StaleSupport;
    model_mismatch: number;
    expected_model: string;
    actual_models: string[];
    status: string;
    severity: string;
    occurrence_diagnostics?: {
      occurrence_rows: number;
      snippets_without_occurrences: number;
    };
  }>;
  success?: boolean;
  status_code?: string;
}): string {
  const lines = [
    `generated_at: ${report.generated_at}`,
    `overall_status: ${report.overall_status}`,
    `overall_severity: ${report.overall_severity}`,
    `audited_corpora: ${report.audited_corpora.join(", ")}`,
    ...(typeof report.success === "boolean" ? [`success: ${report.success}`] : []),
    ...(report.status_code ? [`status_code: ${report.status_code}`] : []),
    "corpora:",
  ];

  for (const corpus of report.corpora) {
    const staleLabel = corpus.stale_support === "not_supported"
      ? "not_supported"
      : String(corpus.stale);
    const actualModels = corpus.actual_models.length > 0 ? corpus.actual_models.join(",") : "none";
    const base = [
      `- ${corpus.corpus}`,
      `status=${corpus.status}`,
      `severity=${corpus.severity}`,
      `total=${corpus.total}`,
      `missing_or_null=${corpus.missing_or_null}`,
      `stale=${staleLabel}`,
      `model_mismatch=${corpus.model_mismatch}`,
      `expected_model=${corpus.expected_model}`,
      `actual_models=${actualModels}`,
    ];

    if (corpus.occurrence_diagnostics) {
      base.push(
        `occurrence_rows=${corpus.occurrence_diagnostics.occurrence_rows}`,
        `snippets_without_occurrences=${corpus.occurrence_diagnostics.snippets_without_occurrences}`,
      );
    }

    lines.push(`  ${base.join(" ")}`);
  }

  return `${lines.join("\n")}\n`;
}

type BaseCorpusCounts = {
  total: number;
  missing_or_null: number;
  stale?: number;
  stale_support?: StaleSupport;
  actual_model_counts: Record<string, number>;
};

async function loadModelCounts(sql: Sql, query: string): Promise<Record<string, number>> {
  const rows = await sql.unsafe(query);
  return Object.fromEntries(
    rows.map((row) => [String(row.embedding_model), toInteger(row.count)]),
  );
}

async function auditLearningMemories(sql: Sql): Promise<BaseCorpusCounts> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL OR embedding_model IS NULL)::int AS missing_or_null,
      COUNT(*) FILTER (WHERE stale = true)::int AS stale
    FROM learning_memories
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: toInteger(row?.stale),
    stale_support: "supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM learning_memories
      WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
  };
}

async function auditReviewComments(sql: Sql): Promise<BaseCorpusCounts> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL OR embedding_model IS NULL)::int AS missing_or_null,
      COUNT(*) FILTER (WHERE stale = true)::int AS stale
    FROM review_comments
    WHERE deleted = false
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: toInteger(row?.stale),
    stale_support: "supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM review_comments
      WHERE deleted = false AND embedding IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
  };
}

async function auditWikiPages(sql: Sql): Promise<BaseCorpusCounts> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL OR embedding_model IS NULL)::int AS missing_or_null,
      COUNT(*) FILTER (WHERE stale = true)::int AS stale
    FROM wiki_pages
    WHERE deleted = false
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: toInteger(row?.stale),
    stale_support: "supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM wiki_pages
      WHERE deleted = false AND embedding IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
  };
}

async function auditCodeSnippets(sql: Sql): Promise<BaseCorpusCounts & {
  occurrence_diagnostics: {
    occurrence_rows: number;
    snippets_without_occurrences: number;
  };
}> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL OR embedding_model IS NULL)::int AS missing_or_null,
      COUNT(*) FILTER (WHERE stale = true)::int AS stale
    FROM code_snippets
  `);

  const [occurrenceRow] = await sql.unsafe(`
    SELECT
      (SELECT COUNT(*)::int FROM code_snippet_occurrences) AS occurrence_rows,
      COUNT(*) FILTER (WHERE occ.content_hash IS NULL)::int AS snippets_without_occurrences
    FROM code_snippets cs
    LEFT JOIN (
      SELECT DISTINCT content_hash
      FROM code_snippet_occurrences
    ) occ ON occ.content_hash = cs.content_hash
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: toInteger(row?.stale),
    stale_support: "supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM code_snippets
      WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
    occurrence_diagnostics: {
      occurrence_rows: toInteger(occurrenceRow?.occurrence_rows),
      snippets_without_occurrences: toInteger(occurrenceRow?.snippets_without_occurrences),
    },
  };
}

async function auditIssues(sql: Sql): Promise<BaseCorpusCounts> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL OR embedding_model IS NULL)::int AS missing_or_null
    FROM issues
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: 0,
    stale_support: "not_supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM issues
      WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
  };
}

async function auditIssueComments(sql: Sql): Promise<BaseCorpusCounts> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NULL OR embedding_model IS NULL)::int AS missing_or_null
    FROM issue_comments
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: 0,
    stale_support: "not_supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM issue_comments
      WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
  };
}

/**
 * Audit the canonical_code_chunks table across all active repo/ref pairs.
 *
 * stale here includes: stale=true OR embedding IS NULL OR model mismatch
 * aggregated to a single corpus-wide count. Because the canonical corpus spans
 * many repo×ref pairs (unlike the single-tenant tables above), we query at the
 * global level and surface the total counts.
 *
 * stale_support = "supported" because canonical_code_chunks.stale is a
 * first-class column managed by the update/backfill pipelines.
 */
async function auditCanonicalCode(sql: Sql): Promise<BaseCorpusCounts> {
  const [row] = await sql.unsafe(`
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND (embedding IS NULL OR embedding_model IS NULL))::int AS missing_or_null,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND stale = true)::int AS stale
    FROM canonical_code_chunks
  `);

  return {
    total: toInteger(row?.total),
    missing_or_null: toInteger(row?.missing_or_null),
    stale: toInteger(row?.stale),
    stale_support: "supported",
    actual_model_counts: await loadModelCounts(sql, `
      SELECT embedding_model, COUNT(*)::int AS count
      FROM canonical_code_chunks
      WHERE deleted_at IS NULL
        AND embedding IS NOT NULL
        AND embedding_model IS NOT NULL
      GROUP BY embedding_model
    `),
  };
}

export async function collectEmbeddingAuditData(sql: Sql): Promise<Record<AuditedCorpus, EmbeddingAuditInputRow>> {
  return {
    learning_memories: await auditLearningMemories(sql),
    review_comments: await auditReviewComments(sql),
    wiki_pages: await auditWikiPages(sql),
    code_snippets: await auditCodeSnippets(sql),
    issues: await auditIssues(sql),
    issue_comments: await auditIssueComments(sql),
    canonical_code: await auditCanonicalCode(sql),
  };
}

export async function auditEmbeddings(opts?: {
  connectionString?: string;
  logger?: Logger;
}): Promise<EmbeddingAuditEnvelope> {
  const logger = opts?.logger ?? pino({ level: "silent" });
  const db = createDbClient({ connectionString: opts?.connectionString, logger });

  try {
    const report = await db.sql.begin(async (tx) => {
      await (tx as unknown as Sql)`SET TRANSACTION READ ONLY`;
      const corpora = await collectEmbeddingAuditData(tx as unknown as Sql);
      return buildEmbeddingAuditReport({
        generatedAt: new Date().toISOString(),
        corpora,
      });
    });

    return finalizeEmbeddingAuditReport(report);
  } finally {
    await db.close();
  }
}
