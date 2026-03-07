// ---------------------------------------------------------------------------
// Guardrail Pipeline Types
// ---------------------------------------------------------------------------

import type {
  ClaimLabel,
  ClaimClassification,
  DiffContext,
} from "../claim-classifier.ts";

// Re-export for consumers
export type { ClaimLabel, ClaimClassification, DiffContext };

// ---------------------------------------------------------------------------
// Grounding context — generalizes DiffContext for non-diff surfaces
// ---------------------------------------------------------------------------

export type GroundingContext = {
  /** Textual context strings the claim should be grounded against */
  providedContext: string[];
  /** Optional diff context (for PR review surfaces) */
  diffContext?: DiffContext;
  /** Sources of context (e.g., "issue", "code", "wiki", "pr-description") */
  contextSources: string[];
};

// ---------------------------------------------------------------------------
// Surface adapter — pluggable per-surface interface
// ---------------------------------------------------------------------------

export type SurfaceAdapter<TInput, TOutput> = {
  /** Surface identifier (e.g., "pr-review", "issue-triage", "mention") */
  surface: string;
  /** Extract individual claim strings from the surface output */
  extractClaims(output: TOutput): string[];
  /** Build grounding context from the surface input */
  buildGroundingContext(input: TInput): GroundingContext;
  /** Reconstruct the output keeping only the specified claims */
  reconstructOutput(output: TOutput, keptClaims: string[]): TOutput;
  /** Minimum word count for kept claims before suppressing entirely */
  minContentThreshold: number;
};

// ---------------------------------------------------------------------------
// Strictness levels
// ---------------------------------------------------------------------------

export type StrictnessLevel = "strict" | "standard" | "lenient";

// ---------------------------------------------------------------------------
// Guardrail config
// ---------------------------------------------------------------------------

export type GuardrailConfig = {
  strictness: StrictnessLevel;
  overrides?: Partial<Record<string, { strictness?: StrictnessLevel }>>;
};

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

export type AuditRecord = {
  surface: string;
  repo: string;
  strictness: StrictnessLevel;
  claimsTotal: number;
  claimsGrounded: number;
  claimsRemoved: number;
  claimsAmbiguous: number;
  llmFallbackUsed: boolean;
  responseSuppressed: boolean;
  classifierError: boolean;
  removedClaims: Array<{ text: string; label: ClaimLabel; evidence?: string }>;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Guardrail result
// ---------------------------------------------------------------------------

export type GuardrailResult<T> = {
  output: T | null;
  claimsTotal: number;
  claimsRemoved: number;
  auditRecords: AuditRecord[];
  suppressed: boolean;
  classifierError: boolean;
};
