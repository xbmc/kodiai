// ---------------------------------------------------------------------------
// Unified Guardrail Pipeline
// ---------------------------------------------------------------------------
// classify -> filter -> audit for any surface via SurfaceAdapter.
// ---------------------------------------------------------------------------

import { classifyClaimAgainstContext } from "./context-classifier.ts";
import type {
  SurfaceAdapter,
  GuardrailConfig,
  GuardrailResult,
  AuditRecord,
  ClaimClassification,
  StrictnessLevel,
} from "./types.ts";
import type { GuardrailAuditStore } from "./audit-store.ts";
import type { LlmClassifier, LlmClassifierClaim } from "./llm-classifier.ts";

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export type RunGuardrailPipelineOpts<TInput, TOutput> = {
  adapter: SurfaceAdapter<TInput, TOutput>;
  input: TInput;
  output: TOutput;
  config: GuardrailConfig;
  repo: string;
  auditStore?: GuardrailAuditStore;
  /** Optional LLM classifier for ambiguous claims (batched Haiku call) */
  llmClassifier?: LlmClassifier;
};

// ---------------------------------------------------------------------------
// Ambiguity threshold
// ---------------------------------------------------------------------------

const AMBIGUITY_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runGuardrailPipeline<TInput, TOutput>(
  opts: RunGuardrailPipelineOpts<TInput, TOutput>,
): Promise<GuardrailResult<TOutput>> {
  const { adapter, input, output, config, repo, auditStore, llmClassifier } =
    opts;

  const startMs = Date.now();

  // Determine effective strictness (surface override > global)
  const effectiveStrictness: StrictnessLevel =
    config.overrides?.[adapter.surface]?.strictness ?? config.strictness;

  // ---------------------------------------------------------------------------
  // Fail-open on any error during classification
  // ---------------------------------------------------------------------------
  try {
    // 1. Extract claims
    const claims = adapter.extractClaims(output);
    const claimsTotal = claims.length;

    if (claimsTotal === 0) {
      // No claims to classify — pass through
      const auditRecord = buildAuditRecord({
        surface: adapter.surface,
        repo,
        strictness: effectiveStrictness,
        claimsTotal: 0,
        claimsGrounded: 0,
        claimsRemoved: 0,
        claimsAmbiguous: 0,
        llmFallbackUsed: false,
        responseSuppressed: false,
        classifierError: false,
        removedClaims: [],
        durationMs: Date.now() - startMs,
      });
      auditStore?.logRun(auditRecord);
      return {
        output,
        claimsTotal: 0,
        claimsRemoved: 0,
        auditRecords: [auditRecord],
        suppressed: false,
        classifierError: false,
      };
    }

    // 2. Build grounding context
    const context = adapter.buildGroundingContext(input);

    // 3. Classify each claim
    const classifications: ClaimClassification[] = [];
    for (const claim of claims) {
      const classification = classifyClaimAgainstContext(
        claim,
        context,
        effectiveStrictness,
      );
      classifications.push(classification);
    }

    // 4. Handle ambiguous claims via batched LLM fallback
    let claimsAmbiguous = 0;
    let llmFallbackUsed = false;

    // Collect ambiguous claim indices for batched LLM call
    const ambiguousIndices: number[] = [];
    for (let i = 0; i < classifications.length; i++) {
      if (classifications[i]!.confidence < AMBIGUITY_THRESHOLD) {
        claimsAmbiguous++;
        ambiguousIndices.push(i);
      }
    }

    if (llmClassifier && ambiguousIndices.length > 0) {
      // Batch all ambiguous claims into a single LLM call
      try {
        const ambiguousClaims: LlmClassifierClaim[] = ambiguousIndices.map((idx) => ({
          text: claims[idx]!,
          context,
        }));
        const llmResults = await llmClassifier(ambiguousClaims);

        // Replace ambiguous classifications with LLM results
        for (let j = 0; j < ambiguousIndices.length; j++) {
          if (llmResults[j]) {
            classifications[ambiguousIndices[j]!] = llmResults[j]!;
          }
        }
        llmFallbackUsed = true;
      } catch {
        // LLM failed — keep original classifications (fail-open)
      }
    }
    // If no llmClassifier, ambiguous claims treated as grounded (fail-open)

    // 5. Filter: keep grounded and inferential, remove external-knowledge
    const keptClaims: string[] = [];
    const removedClaims: AuditRecord["removedClaims"] = [];

    for (let i = 0; i < classifications.length; i++) {
      const c = classifications[i]!;
      if (c.label === "external-knowledge") {
        removedClaims.push({
          text: c.text,
          label: c.label,
          evidence: c.evidence,
        });
      } else {
        keptClaims.push(claims[i]!);
      }
    }

    const claimsRemoved = removedClaims.length;
    const claimsGrounded = claimsTotal - claimsRemoved;

    // 6. Check minimum content threshold
    const keptWordsCount = keptClaims.join(" ").split(/\s+/).filter(Boolean).length;
    const suppressed = keptWordsCount < adapter.minContentThreshold;

    // 7. Reconstruct output or suppress
    let finalOutput: TOutput | null;
    if (suppressed || keptClaims.length === 0) {
      finalOutput = null;
    } else {
      finalOutput = adapter.reconstructOutput(output, keptClaims);
    }

    // 8. Build audit record
    const auditRecord = buildAuditRecord({
      surface: adapter.surface,
      repo,
      strictness: effectiveStrictness,
      claimsTotal,
      claimsGrounded,
      claimsRemoved,
      claimsAmbiguous,
      llmFallbackUsed,
      responseSuppressed: suppressed,
      classifierError: false,
      removedClaims,
      durationMs: Date.now() - startMs,
    });

    // 9. Fire-and-forget audit logging
    auditStore?.logRun(auditRecord);

    return {
      output: finalOutput,
      claimsTotal,
      claimsRemoved,
      auditRecords: [auditRecord],
      suppressed,
      classifierError: false,
    };
  } catch (err) {
    // Fail-open: on any error, return output unchanged
    const auditRecord = buildAuditRecord({
      surface: adapter.surface,
      repo,
      strictness: effectiveStrictness,
      claimsTotal: 0,
      claimsGrounded: 0,
      claimsRemoved: 0,
      claimsAmbiguous: 0,
      llmFallbackUsed: false,
      responseSuppressed: false,
      classifierError: true,
      removedClaims: [],
      durationMs: Date.now() - startMs,
    });
    auditStore?.logRun(auditRecord);

    return {
      output,
      claimsTotal: 0,
      claimsRemoved: 0,
      auditRecords: [auditRecord],
      suppressed: false,
      classifierError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAuditRecord(fields: AuditRecord): AuditRecord {
  return { ...fields };
}
