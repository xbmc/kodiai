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
  const { keywordProfileOverride, manualProfile, linesChanged } = _params;

  if (keywordProfileOverride) {
    return {
      selectedProfile: keywordProfileOverride,
      source: "keyword",
      autoBand: null,
      linesChanged,
    };
  }

  if (manualProfile) {
    return {
      selectedProfile: manualProfile,
      source: "manual",
      autoBand: null,
      linesChanged,
    };
  }

  if (linesChanged <= AUTO_PROFILE_THRESHOLDS.strictMax) {
    return {
      selectedProfile: "strict",
      source: "auto",
      autoBand: "small",
      linesChanged,
    };
  }

  if (linesChanged <= AUTO_PROFILE_THRESHOLDS.balancedMax) {
    return {
      selectedProfile: "balanced",
      source: "auto",
      autoBand: "medium",
      linesChanged,
    };
  }

  return {
    selectedProfile: "minimal",
    source: "auto",
    autoBand: "large",
    linesChanged,
  };
}
