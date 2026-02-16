import type { RerankedResult } from "./retrieval-rerank.ts";

export type RecencyConfig = {
  halfLifeDays: number;
  floorMultiplier: number;
  floorSeverities: string[];
};

export const DEFAULT_RECENCY_CONFIG: RecencyConfig = {
  halfLifeDays: 90,
  floorMultiplier: 0.3,
  floorSeverities: ["critical", "major"],
};

export function applyRecencyWeighting(params: {
  results: RerankedResult[];
  now?: Date;
  config?: RecencyConfig;
}): RerankedResult[] {
  const { results, now = new Date(), config = DEFAULT_RECENCY_CONFIG } = params;

  const lambda = Math.LN2 / config.halfLifeDays;
  const msPerDay = 86_400_000;
  const floorSet = new Set(config.floorSeverities);

  const weighted: RerankedResult[] = results.map((r) => {
    const createdAt = r.record.createdAt;
    let ageDays = 0;

    if (createdAt) {
      const created = new Date(createdAt);
      ageDays = Math.max(0, (now.getTime() - created.getTime()) / msPerDay);
    }

    let multiplier = Math.exp(-lambda * ageDays);

    // Severity-aware floor
    const severity = r.record.severity?.toLowerCase() ?? "";
    const floor = floorSet.has(severity)
      ? config.floorMultiplier
      : config.floorMultiplier * 0.5;

    multiplier = Math.max(multiplier, floor);

    // Invert multiplier for distance space:
    // multiplier=1.0 -> factor=1.0 (no change)
    // multiplier=0.3 -> factor=1.7 (70% penalty)
    const factor = 2 - multiplier;
    const adjustedDistance = r.adjustedDistance * factor;

    return {
      ...r,
      adjustedDistance,
    };
  });

  // Re-sort by adjustedDistance ascending (lower = better)
  weighted.sort((a, b) => a.adjustedDistance - b.adjustedDistance);

  return weighted;
}
