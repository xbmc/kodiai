import type { ReviewArea } from "../lib/review-finding-metadata.ts";

export function applyReviewPrIntentAreas(params: {
  styleOk: boolean;
  focusAreas: readonly string[];
  resolvedFocusAreas: ReviewArea[];
  resolvedIgnoredAreas: ReviewArea[];
}): void {
  if (params.styleOk && !params.resolvedIgnoredAreas.includes("style")) {
    params.resolvedIgnoredAreas.push("style");
  }

  for (const area of params.focusAreas as ReviewArea[]) {
    if (!params.resolvedFocusAreas.includes(area)) {
      params.resolvedFocusAreas.push(area);
    }
  }
}
