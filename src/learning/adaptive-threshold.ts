export type ThresholdMethod = "adaptive" | "percentile" | "configured";

export type AdaptiveThresholdResult = {
  threshold: number;
  method: ThresholdMethod;
  candidateCount: number;
  gapSize?: number;
  gapIndex?: number;
};

export type AdaptiveThresholdConfig = {
  minCandidatesForGap: number;
  fallbackPercentile: number;
  minGapSize: number;
  floor: number;
  ceiling: number;
};

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveThresholdConfig = {
  minCandidatesForGap: 8,
  fallbackPercentile: 0.75,
  minGapSize: 0.05,
  floor: 0.15,
  ceiling: 0.65,
};

export function computeAdaptiveThreshold(params: {
  distances: number[];
  configuredThreshold: number;
  config?: AdaptiveThresholdConfig;
}): AdaptiveThresholdResult {
  const { distances, configuredThreshold, config = DEFAULT_ADAPTIVE_CONFIG } = params;

  if (distances.length === 0) {
    return {
      threshold: clamp(configuredThreshold, config.floor, config.ceiling),
      method: "configured",
      candidateCount: 0,
    };
  }

  const sorted = [...distances].sort((a, b) => a - b);

  if (sorted.length < config.minCandidatesForGap) {
    const idx = Math.min(
      Math.floor(sorted.length * config.fallbackPercentile),
      sorted.length - 1,
    );

    return {
      threshold: clamp(sorted[idx]!, config.floor, config.ceiling),
      method: "percentile",
      candidateCount: sorted.length,
    };
  }

  let maxGap = 0;
  let maxGapIndex = 0;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIndex = i;
    }
  }

  if (maxGap < config.minGapSize) {
    return {
      threshold: clamp(configuredThreshold, config.floor, config.ceiling),
      method: "configured",
      candidateCount: sorted.length,
      gapSize: maxGap,
    };
  }

  const threshold = sorted[maxGapIndex - 1]!;
  return {
    threshold: clamp(threshold, config.floor, config.ceiling),
    method: "adaptive",
    candidateCount: sorted.length,
    gapSize: maxGap,
    gapIndex: maxGapIndex,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
