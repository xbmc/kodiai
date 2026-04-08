/**
 * Consumer-facing types for structural-impact analysis.
 *
 * These types represent the BOUNDED payload that M038 produces and passes
 * into review context assembly. They deliberately do NOT expose raw
 * ReviewGraph substrate records or CanonicalCodeChunk internals — callers
 * see only what they need to format Review Details and build prompts.
 *
 * Design decisions:
 *   - `StructuralImpactPayload` is the single top-level hand-off type.
 *   - All list fields are bounded at fetch time; no unbounded blast-radius
 *     dumps reach the review handler or prompt builder.
 *   - Confidence fields are [0, 1] floats from the graph layer; consumers
 *     should label results as "probable" where confidence < 1.0.
 *   - `StructuralImpactStatus` tracks degradation so callers can choose
 *     whether to surface partial results or omit the section entirely.
 *   - Unchanged-code evidence (CanonicalCodeEvidence) is kept separate from
 *     graph-derived fields so the two substrate paths stay independent.
 */

// ── Caller / dependent ────────────────────────────────────────────────────────

/**
 * A single caller or dependent of a changed symbol, resolved from the
 * structural graph substrate (M040).
 *
 * `qualifiedName` is preferred for display; `symbolName` is the fallback.
 * `confidence` reflects graph edge confidence, not LLM certainty.
 */
export type StructuralCaller = {
  /** Graph node stable key (opaque, for dedup only). */
  stableKey: string;
  /** Short symbol name (e.g. "executeController"). */
  symbolName: string | null;
  /** Fully-qualified name (e.g. "MyModule::Controller::executeController"). */
  qualifiedName: string | null;
  /** Repository-relative file path. */
  filePath: string;
  /** Relevance score from graph ranking — higher is more impacted. */
  score: number;
  /** Graph edge confidence in [0, 1]. Values below 1.0 are "probable". */
  confidence: number;
  /** Human-readable reason(s) for inclusion (e.g. "calls changed symbol helper"). */
  reasons: string[];
};

// ── Impacted file ─────────────────────────────────────────────────────────────

/**
 * A file in the structural blast radius, ranked by impact score.
 */
export type StructuralImpactFile = {
  /** Repository-relative file path. */
  path: string;
  /** Relevance score from graph ranking. */
  score: number;
  /** Graph confidence in [0, 1]. */
  confidence: number;
  /** Human-readable reasons for inclusion. */
  reasons: string[];
  /** Detected languages for this file's nodes. */
  languages: string[];
};

// ── Likely test ───────────────────────────────────────────────────────────────

/**
 * A test file that likely exercises a changed symbol, ranked by test signal.
 */
export type StructuralLikelyTest = {
  /** Repository-relative path to the test file. */
  path: string;
  /** Relevance score. */
  score: number;
  /** Graph confidence in [0, 1]. */
  confidence: number;
  /** Human-readable reasons for inclusion. */
  reasons: string[];
  /** Symbol names within the test file that match changed symbols. */
  testSymbols: string[];
};

// ── Canonical code evidence ───────────────────────────────────────────────────

/**
 * A snippet of current unchanged code from the canonical corpus (M041),
 * retrieved by semantic similarity to the changed diff symbols.
 *
 * This is kept intentionally separate from graph-derived fields:
 * the graph answers structural impact; canonical evidence answers
 * semantic relevance of unchanged code.
 */
export type CanonicalCodeEvidence = {
  /** Repository-relative file path. */
  filePath: string;
  /** Language of the chunk. */
  language: string;
  /** 1-indexed start line of the chunk in the source file. */
  startLine: number;
  /** 1-indexed end line of the chunk in the source file. */
  endLine: number;
  /** Chunk type: function, class, method, module, or block. */
  chunkType: string;
  /** Symbol name (null for block chunks). */
  symbolName: string | null;
  /** Current text of the unchanged code chunk. */
  chunkText: string;
  /** Cosine distance from the query — lower is more relevant. */
  distance: number;
  /** Commit SHA the chunk was indexed at. */
  commitSha: string;
  /** Branch/ref from which the chunk was drawn (e.g. "main"). */
  canonicalRef: string;
};

// ── Graph stats ───────────────────────────────────────────────────────────────

/**
 * Summary counters from the graph query, useful for observability logging.
 */
export type StructuralGraphStats = {
  /** Total files in the workspace graph snapshot. */
  files: number;
  /** Total nodes in the workspace graph snapshot. */
  nodes: number;
  /** Total edges in the workspace graph snapshot. */
  edges: number;
  /** How many of the changed files were found in the graph. */
  changedFilesFound: number;
  /** How many changed file paths were requested. */
  changedFilesRequested: number;
};

// ── Status / degradation ──────────────────────────────────────────────────────

/**
 * Status of a structural-impact fetch, including degradation reasons
 * so callers can decide whether to surface partial results or omit
 * the section.
 *
 * - `ok`           — both graph and corpus responded within timeout
 * - `partial`      — at least one source responded; missing data is null/empty
 * - `unavailable`  — both sources failed or timed out; payload has no data
 */
export type StructuralImpactStatus = "ok" | "partial" | "unavailable";

/**
 * Degradation record for one substrate source.
 *
 * Consumers should log these and may include them in telemetry, but
 * should NOT surface raw error details in the review prompt.
 */
export type StructuralImpactDegradation = {
  /** Which substrate experienced degradation. */
  source: "graph" | "corpus";
  /** Short description of the degradation (timeout, error, empty graph, etc.). */
  reason: string;
};

// ── Top-level payload ─────────────────────────────────────────────────────────

/**
 * The bounded structural-impact payload produced by the orchestration layer
 * and consumed by the review handler and prompt builder.
 *
 * All list fields are already bounded — no further truncation is required
 * by callers before prompt injection.
 *
 * When `status` is "unavailable", all list/count fields will be empty/zero
 * and callers should omit the Structural Impact section from the review.
 */
export type StructuralImpactPayload = {
  /** Overall status of the structural-impact fetch. */
  status: StructuralImpactStatus;

  /**
   * Changed file paths that were used as seeds for graph traversal.
   * Derived from the PR diff.
   */
  changedFiles: string[];

  /**
   * Changed symbols that were used as blast-radius seeds.
   * These are the entry points into the graph query.
   */
  seedSymbols: Array<{
    stableKey: string;
    symbolName: string | null;
    qualifiedName: string | null;
    filePath: string;
  }>;

  /**
   * Files in the structural blast radius, bounded and ranked by impact.
   * Empty when graph substrate is unavailable.
   */
  impactedFiles: StructuralImpactFile[];

  /**
   * Probable callers and direct dependents of changed symbols.
   * Bounded subset of the full blast radius.
   */
  probableCallers: StructuralCaller[];

  /**
   * Test files most likely to exercise changed symbols.
   */
  likelyTests: StructuralLikelyTest[];

  /**
   * Summary graph stats for observability / prompt formatting.
   * Null when graph substrate is unavailable.
   */
  graphStats: StructuralGraphStats | null;

  /**
   * Semantically relevant unchanged-code evidence from the canonical corpus.
   * Empty when corpus substrate is unavailable.
   */
  canonicalEvidence: CanonicalCodeEvidence[];

  /**
   * Degradation records. Non-empty when `status` is "partial" or "unavailable".
   * Consumers should log these, not surface them in the prompt.
   */
  degradations: StructuralImpactDegradation[];
};
