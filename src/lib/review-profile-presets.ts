import type { FindingSeverity, ReviewArea } from "./review-finding-metadata.ts";

export const PROFILE_PRESETS: Record<string, {
  severityMinLevel: FindingSeverity;
  maxComments: number;
  ignoredAreas: ReviewArea[];
  focusAreas: ReviewArea[];
}> = {
  strict: {
    severityMinLevel: "minor",
    maxComments: 15,
    ignoredAreas: [],
    focusAreas: [],
  },
  balanced: {
    severityMinLevel: "medium",
    maxComments: 7,
    ignoredAreas: ["style"],
    focusAreas: [],
  },
  minimal: {
    severityMinLevel: "major",
    // 3 was too stingy for >500-line PRs — a large diff with 5 real majors
    // silently dropped 2 of them.
    maxComments: 5,
    ignoredAreas: ["style", "documentation"],
    focusAreas: ["security", "correctness"],
  },
};
