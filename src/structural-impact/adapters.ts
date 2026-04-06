/**
 * Consumer-facing adapters for structural-impact orchestration.
 *
 * These adapters translate M040 (ReviewGraph blast-radius) and M041
 * (CanonicalCode semantic retrieval) outputs into the bounded
 * StructuralImpactPayload shape consumed by M038's review handler.
 *
 * Contracts:
 *   - GraphAdapter and CorpusAdapter are the explicit dependency seams.
 *     M038 code must use these interfaces rather than importing from
 *     review-graph/ or knowledge/ directly. This bounds the API surface
 *     so future substrate changes don't sprawl through review.ts.
 *   - Both adapters are fail-open: errors and timeouts produce empty results
 *     with degradation records rather than thrown exceptions.
 *   - `boundStructuralImpactPayload` is the single assembly point that
 *     merges both adapter results into a StructuralImpactPayload.
 *
 * Implementation note:
 *   These adapters do NOT import substrate modules. The concrete substrate
 *   implementations (createReviewGraphQuery, searchCanonicalCode) are wired
 *   in at orchestration time (orchestrator.ts). This file only defines the
 *   contracts and the assembly/translation logic.
 */

import type {
  CanonicalCodeEvidence,
  StructuralCaller,
  StructuralGraphStats,
  StructuralImpactDegradation,
  StructuralImpactFile,
  StructuralImpactPayload,
  StructuralImpactStatus,
  StructuralLikelyTest,
} from "./types.ts";

// ── GraphAdapter contract ─────────────────────────────────────────────────────

/**
 * Input for a graph blast-radius query.
 */
export type GraphQueryInput = {
  /** Full "owner/name" repo identifier. */
  repo: string;
  /** Workspace key identifying the indexed snapshot. */
  workspaceKey: string;
  /** Changed file paths from the PR diff. */
  changedPaths: string[];
  /** Maximum number of results per ranked list. Defaults to 20. */
  limit?: number;
};

/**
 * The blast-radius result returned by the graph adapter.
 * Fields mirror `ReviewGraphBlastRadiusResult` from M040 but are typed
 * here to avoid a direct import dependency on the substrate module.
 */
export type GraphBlastRadiusResult = {
  changedFiles: string[];
  seedSymbols: Array<{
    stableKey: string;
    symbolName: string | null;
    qualifiedName: string | null;
    filePath: string;
  }>;
  impactedFiles: Array<{
    path: string;
    score: number;
    confidence: number;
    reasons: string[];
    languages: string[];
  }>;
  probableDependents: Array<{
    stableKey: string;
    symbolName: string | null;
    qualifiedName: string | null;
    filePath: string;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  likelyTests: Array<{
    path: string;
    score: number;
    confidence: number;
    reasons: string[];
    testSymbols: string[];
  }>;
  graphStats: {
    files: number;
    nodes: number;
    edges: number;
    changedFilesFound: number;
  };
};

/**
 * Adapter contract for the structural graph substrate (M040).
 *
 * Implementors wire this to `createReviewGraphQuery(…).queryBlastRadius`.
 * Tests stub it directly.
 */
export type GraphAdapter = {
  queryBlastRadius(input: GraphQueryInput): Promise<GraphBlastRadiusResult>;
};

// ── CorpusAdapter contract ────────────────────────────────────────────────────

/**
 * Input for a canonical code semantic-search query.
 */
export type CorpusQueryInput = {
  /** Full "owner/name" repo identifier. */
  repo: string;
  /** Branch/ref of the canonical corpus snapshot (e.g. "main"). */
  canonicalRef: string;
  /** Free-text query derived from diff symbols and changed code. */
  query: string;
  /** Maximum number of results. Defaults to 10. */
  topK?: number;
  /** Optional language filter (e.g. "cpp", "python"). */
  language?: string;
};

/**
 * A single canonical code match returned by the corpus adapter.
 * Fields mirror `CanonicalCodeMatch` from M041 but are typed here
 * to avoid a direct import dependency on the substrate module.
 */
export type CorpusCodeMatch = {
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  chunkType: string;
  symbolName: string | null;
  chunkText: string;
  distance: number;
  commitSha: string;
  canonicalRef: string;
};

/**
 * Adapter contract for the canonical current-code corpus (M041).
 *
 * Implementors wire this to `searchCanonicalCode(…)`.
 * Tests stub it directly.
 */
export type CorpusAdapter = {
  searchCanonicalCode(input: CorpusQueryInput): Promise<CorpusCodeMatch[]>;
};

// ── Translation helpers ───────────────────────────────────────────────────────

function toStructuralImpactFiles(
  items: GraphBlastRadiusResult["impactedFiles"],
): StructuralImpactFile[] {
  return items.map((item) => ({
    path: item.path,
    score: item.score,
    confidence: item.confidence,
    reasons: item.reasons,
    languages: item.languages,
  }));
}

function toStructuralCallers(
  items: GraphBlastRadiusResult["probableDependents"],
): StructuralCaller[] {
  return items.map((item) => ({
    stableKey: item.stableKey,
    symbolName: item.symbolName,
    qualifiedName: item.qualifiedName,
    filePath: item.filePath,
    score: item.score,
    confidence: item.confidence,
    reasons: item.reasons,
  }));
}

function toStructuralLikelyTests(
  items: GraphBlastRadiusResult["likelyTests"],
): StructuralLikelyTest[] {
  return items.map((item) => ({
    path: item.path,
    score: item.score,
    confidence: item.confidence,
    reasons: item.reasons,
    testSymbols: item.testSymbols,
  }));
}

function toCanonicalCodeEvidence(items: CorpusCodeMatch[]): CanonicalCodeEvidence[] {
  return items.map((item) => ({
    filePath: item.filePath,
    language: item.language,
    startLine: item.startLine,
    endLine: item.endLine,
    chunkType: item.chunkType,
    symbolName: item.symbolName,
    chunkText: item.chunkText,
    distance: item.distance,
    commitSha: item.commitSha,
    canonicalRef: item.canonicalRef,
  }));
}

function toGraphStats(
  raw: GraphBlastRadiusResult["graphStats"],
  changedFilesRequested: number,
): StructuralGraphStats {
  return {
    files: raw.files,
    nodes: raw.nodes,
    edges: raw.edges,
    changedFilesFound: raw.changedFilesFound,
    changedFilesRequested,
  };
}

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * Merge a (possibly null) graph result and a (possibly empty) corpus result
 * into a bounded StructuralImpactPayload.
 *
 * This is the single assembly point called by the orchestration layer after
 * both adapter fetches have completed (or timed out / failed).
 *
 * @param graphResult  Null when the graph query failed or timed out.
 * @param corpusMatches  Empty array when corpus query failed or timed out.
 * @param changedPaths  Original changed paths from the PR diff.
 * @param degradations  Degradation records from the orchestration layer.
 */
export function boundStructuralImpactPayload(opts: {
  graphResult: GraphBlastRadiusResult | null;
  corpusMatches: CorpusCodeMatch[];
  changedPaths: string[];
  degradations: StructuralImpactDegradation[];
}): StructuralImpactPayload {
  const { graphResult, corpusMatches, changedPaths, degradations } = opts;

  const hasGraph = graphResult !== null;
  const hasCorpus = corpusMatches.length > 0;

  const status: StructuralImpactStatus = hasGraph && hasCorpus
    ? "ok"
    : hasGraph || hasCorpus
      ? "partial"
      : "unavailable";

  if (!hasGraph) {
    return {
      status,
      changedFiles: changedPaths,
      seedSymbols: [],
      impactedFiles: [],
      probableCallers: [],
      likelyTests: [],
      graphStats: null,
      canonicalEvidence: toCanonicalCodeEvidence(corpusMatches),
      degradations,
    };
  }

  return {
    status,
    changedFiles: graphResult.changedFiles,
    seedSymbols: graphResult.seedSymbols,
    impactedFiles: toStructuralImpactFiles(graphResult.impactedFiles),
    probableCallers: toStructuralCallers(graphResult.probableDependents),
    likelyTests: toStructuralLikelyTests(graphResult.likelyTests),
    graphStats: toGraphStats(graphResult.graphStats, changedPaths.length),
    canonicalEvidence: toCanonicalCodeEvidence(corpusMatches),
    degradations,
  };
}
