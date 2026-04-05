import type { StructuralImpactDegradation, StructuralImpactPayload } from "./types.ts";

export type StructuralImpactAvailability = {
  graphAvailable: boolean;
  corpusAvailable: boolean;
};

export type StructuralImpactTruthfulnessSignal =
  | "graph-unavailable"
  | "corpus-unavailable"
  | "graph-empty"
  | "corpus-empty"
  | "no-structural-evidence";

export type StructuralImpactDegradationSummary = {
  status: StructuralImpactPayload["status"];
  degradations: StructuralImpactDegradation[];
  availability: StructuralImpactAvailability;
  truthfulnessSignals: StructuralImpactTruthfulnessSignal[];
  fallbackUsed: boolean;
  hasRenderableEvidence: boolean;
};

function hasDegradationForSource(
  degradations: StructuralImpactDegradation[],
  source: StructuralImpactDegradation["source"],
): boolean {
  return degradations.some((item) => item.source === source);
}

function sortDegradations(
  degradations: StructuralImpactDegradation[],
): StructuralImpactDegradation[] {
  return [...degradations].sort((a, b) => {
    if (a.source === b.source) {
      return a.reason.localeCompare(b.reason);
    }
    return a.source.localeCompare(b.source);
  });
}

export function summarizeStructuralImpactDegradation(
  payload: StructuralImpactPayload | null | undefined,
): StructuralImpactDegradationSummary {
  const degradations = sortDegradations(payload?.degradations ?? []);
  const graphUnavailable = hasDegradationForSource(degradations, "graph");
  const corpusUnavailable = hasDegradationForSource(degradations, "corpus");
  const graphAvailable = !graphUnavailable;
  const corpusAvailable = !corpusUnavailable;

  const hasGraphEvidence = Boolean(
    payload?.graphStats
      || (payload?.probableCallers.length ?? 0) > 0
      || (payload?.impactedFiles.length ?? 0) > 0
      || (payload?.likelyTests.length ?? 0) > 0
      || (payload?.seedSymbols.length ?? 0) > 0,
  );
  const hasCorpusEvidence = (payload?.canonicalEvidence.length ?? 0) > 0;
  const hasRenderableEvidence = hasGraphEvidence || hasCorpusEvidence;

  const truthfulnessSignals: StructuralImpactTruthfulnessSignal[] = [];
  if (!graphAvailable) truthfulnessSignals.push("graph-unavailable");
  if (!corpusAvailable) truthfulnessSignals.push("corpus-unavailable");
  if (graphAvailable && !hasGraphEvidence) truthfulnessSignals.push("graph-empty");
  if (corpusAvailable && !hasCorpusEvidence) truthfulnessSignals.push("corpus-empty");
  if (!hasRenderableEvidence) truthfulnessSignals.push("no-structural-evidence");

  const status: StructuralImpactPayload["status"] = !graphAvailable && !corpusAvailable
    ? "unavailable"
    : !graphAvailable || !corpusAvailable
      ? "partial"
      : payload?.status ?? "unavailable";

  return {
    status,
    degradations,
    availability: {
      graphAvailable,
      corpusAvailable,
    },
    truthfulnessSignals,
    fallbackUsed: status !== "ok",
    hasRenderableEvidence,
  };
}
