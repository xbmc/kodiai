export const AUTO_PROFILE_THRESHOLDS = {
  strictMax: 100,
  balancedMax: 500,
} as const;

export type ReviewProfile = "strict" | "balanced" | "minimal";
export type ProfileSelectionSource = "keyword" | "manual" | "auto";
export type AutoProfileBand = "small" | "medium" | "large";

export type ResolvedReviewProfile = {
  selectedProfile: ReviewProfile;
  source: ProfileSelectionSource;
  autoBand: AutoProfileBand | null;
  linesChanged: number;
};

export function resolveReviewProfile(_params: {
  keywordProfileOverride: ReviewProfile | null;
  manualProfile: ReviewProfile | null;
  linesChanged: number;
}): ResolvedReviewProfile {
  throw new Error("not implemented");
}
