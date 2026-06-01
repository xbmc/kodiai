import type { PromptSectionRecord } from "../telemetry/types.ts";
import type { PromptBudgetOutcome } from "../execution/prompt-budget.ts";
import type { ReviewCacheTelemetryObservation } from "../review-cache-telemetry/cache-telemetry.ts";
import type { ContinuationCompactionObservation } from "../review-continuation/continuation-compaction.ts";
import {
  buildReviewDetailsBudgetLines,
  buildVisibleBudgetProjection,
  type PromptBudgetEvidenceObservation,
  type VisibleBudgetProjection,
  type VisibleBudgetScenario,
} from "../review-visible-budget/visible-budget-behavior.ts";

export function buildPromptBudgetEvidenceObservations(
  records: readonly PromptSectionRecord[],
): PromptBudgetEvidenceObservation[] {
  return records
    .map((record) => {
      const sections = record.sections
        .filter((section) =>
          typeof section.budgetChars === "number"
          && typeof section.budgetTokens === "number"
          && typeof section.includedChars === "number"
          && typeof section.includedTokens === "number"
          && typeof section.trimmedChars === "number"
          && typeof section.trimmedTokens === "number"
          && (section.budgetStatus === "included" || section.budgetStatus === "trimmed" || section.budgetStatus === "bypassed")
          && (section.budgetReason === "within-budget" || section.budgetReason === "section-over-budget" || section.budgetReason === "zero-budget")
        )
        .map((section) => ({
          sectionName: section.sectionName,
          sectionPosition: section.sectionPosition,
          budgetChars: section.budgetChars!,
          budgetTokens: section.budgetTokens!,
          includedChars: section.includedChars!,
          includedTokens: section.includedTokens!,
          trimmedChars: section.trimmedChars!,
          trimmedTokens: section.trimmedTokens!,
          budgetStatus: section.budgetStatus!,
          budgetReason: section.budgetReason!,
        }));

      if (sections.length === 0) {
        return null;
      }

      return {
        caseId: `${record.promptKind}:budget`,
        deliveryId: record.deliveryId ?? "unknown-delivery",
        repo: record.repo,
        taskType: record.taskType,
        promptKind: record.promptKind,
        sections,
      };
    })
    .filter((entry): entry is PromptBudgetEvidenceObservation => entry !== null);
}

export function buildPromptBudgetOutcomes(records: readonly PromptSectionRecord[]): PromptBudgetOutcome[] {
  return buildPromptBudgetEvidenceObservations(records).flatMap((observation) =>
    observation.sections.map((section) => ({
      sectionName: section.sectionName,
      sectionPosition: section.sectionPosition,
      budgetChars: section.budgetChars,
      budgetTokens: section.budgetTokens,
      includedChars: section.includedChars,
      includedTokens: section.includedTokens,
      trimmedChars: section.trimmedChars,
      trimmedTokens: section.trimmedTokens,
      status: section.budgetStatus,
      reason: section.budgetReason,
    }))
  );
}

export function chooseVisibleBudgetScenario(params: {
  promptBudgetEvidence: readonly PromptBudgetEvidenceObservation[];
  cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
  continuationCompactionObservations: readonly ContinuationCompactionObservation[];
}): VisibleBudgetScenario {
  if (params.continuationCompactionObservations.some((observation) => observation.status === "fallback")) {
    return "fallback-review";
  }

  const promptScoped = params.promptBudgetEvidence.some((observation) =>
    observation.sections.some((section) => section.budgetStatus === "trimmed" || section.budgetStatus === "bypassed")
  );
  const cacheScoped = params.cacheTelemetryObservations.some((observation) =>
    observation.status === "degraded" || observation.status === "bypass"
  );
  const continuationScoped = params.continuationCompactionObservations.some((observation) =>
    observation.status === "compacted" || observation.status === "degraded"
  );

  return promptScoped || cacheScoped || continuationScoped ? "scoped-review" : "happy-path";
}

export function buildVisibleBudgetProjectionFromEvidence(params: {
  promptSectionRecords: readonly PromptSectionRecord[];
  cacheTelemetryObservations: readonly ReviewCacheTelemetryObservation[];
  continuationCompactionObservations: readonly ContinuationCompactionObservation[];
}): VisibleBudgetProjection | null {
  const promptBudgetEvidence = buildPromptBudgetEvidenceObservations(params.promptSectionRecords);
  if (
    promptBudgetEvidence.length === 0
    && params.cacheTelemetryObservations.length === 0
    && params.continuationCompactionObservations.length === 0
  ) {
    return null;
  }

  return buildVisibleBudgetProjection({
    scenario: chooseVisibleBudgetScenario({
      promptBudgetEvidence,
      cacheTelemetryObservations: params.cacheTelemetryObservations,
      continuationCompactionObservations: params.continuationCompactionObservations,
    }),
    promptBudgetEvidence,
    cacheTelemetryObservations: params.cacheTelemetryObservations,
    continuationCompactionObservations: params.continuationCompactionObservations,
  });
}

export function appendReviewDetailsBudgetLines(body: string, projection: VisibleBudgetProjection | null): string {
  if (!projection) return body;
  const lines = buildReviewDetailsBudgetLines(projection).map((line) => `- ${line}`);
  const closeMarker = "\n\n</details>";
  const closeIndex = body.lastIndexOf(closeMarker);
  if (closeIndex === -1) {
    return `${body}\n${lines.join("\n")}`;
  }
  return `${body.slice(0, closeIndex)}\n${lines.join("\n")}${body.slice(closeIndex)}`;
}

export function buildVisibleBudgetDisclosureEvidence(projection: VisibleBudgetProjection | null): string | null {
  if (!projection || projection.visibleStatus === "complete") return null;
  if (projection.visibleStatus === "fallback") {
    return "Review scope note: fallback review behavior was used; Review Details include bounded budget/cache/continuation counts only.";
  }
  if (projection.visibleReason === "prompt-budget-limited") {
    return "Review scope note: output was scoped by prompt budget limits; Review Details include bounded counts only.";
  }
  if (projection.visibleReason === "cache-degraded") {
    return "Review scope note: cache reuse was degraded or bypassed; Review Details include bounded cache status counts only.";
  }
  return "Review scope note: continuation or compaction behavior scoped the review; Review Details include bounded counts only.";
}
