// ---------------------------------------------------------------------------
// Guardrail Audit Store
// ---------------------------------------------------------------------------
// Fire-and-forget Postgres logging for guardrail pipeline runs.
// Follows the void + .catch() pattern from citation logging (121-01).
// ---------------------------------------------------------------------------

import type { Logger } from "pino";
import type { AuditRecord } from "./types.ts";

export type GuardrailAuditStore = {
  /** Log a guardrail pipeline run. Fire-and-forget — does not block. */
  logRun(record: AuditRecord): void;
};

/**
 * Create a guardrail audit store backed by Postgres.
 * Uses tagged template literal sql for parameterized queries.
 */
export function createGuardrailAuditStore(
  sql: (strings: TemplateStringsArray, ...values: any[]) => Promise<any>,
  logger?: Logger,
): GuardrailAuditStore {
  return {
    logRun(record: AuditRecord): void {
      const removedClaimsJson = JSON.stringify(record.removedClaims);

      void sql`
        INSERT INTO guardrail_audit (
          surface, repo, strictness,
          claims_total, claims_grounded, claims_removed, claims_ambiguous,
          llm_fallback_used, response_suppressed, classifier_error,
          removed_claims, duration_ms
        ) VALUES (
          ${record.surface}, ${record.repo}, ${record.strictness},
          ${record.claimsTotal}, ${record.claimsGrounded}, ${record.claimsRemoved}, ${record.claimsAmbiguous},
          ${record.llmFallbackUsed}, ${record.responseSuppressed}, ${record.classifierError},
          ${removedClaimsJson}::jsonb, ${record.durationMs}
        )
      `.catch((err) => {
        logger?.error({ err }, "Failed to log guardrail audit record");
      });
    },
  };
}
