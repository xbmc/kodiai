import type { ContributorProfile, ContributorTier } from "./types.ts";

export const CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER =
  "m047-calibrated-v1";
export const CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS = 180;

const STALE_AFTER_MS =
  CONTRIBUTOR_PROFILE_TRUST_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

export type ContributorProfileTrustState =
  | "linked-unscored"
  | "legacy"
  | "calibrated"
  | "stale"
  | "malformed";

export type ContributorProfileTrustReason =
  | "never-scored"
  | "missing-trust-marker"
  | "current-trust-marker"
  | "trust-marker-stale"
  | "invalid-overall-tier"
  | "missing-last-scored-at"
  | "invalid-last-scored-at"
  | "unsupported-trust-marker";

export type ContributorProfileTrust = {
  state: ContributorProfileTrustState;
  trusted: boolean;
  reason: ContributorProfileTrustReason;
  calibrationMarker: string | null;
  calibrationVersion: string | null;
};

export type ContributorProfileTrustInput = Pick<
  Partial<ContributorProfile>,
  "overallTier" | "lastScoredAt" | "trustMarker"
>;

export function isContributorTier(value: unknown): value is ContributorTier {
  return ["newcomer", "developing", "established", "senior"].includes(
    value as ContributorTier,
  );
}

function resolveCalibrationVersion(marker: string | null): string | null {
  if (marker === CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER) {
    return "v1";
  }
  return null;
}

function normalizeLastScoredAt(
  value: ContributorProfileTrustInput["lastScoredAt"],
): Date | null | "invalid" {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "invalid" : value;
  }

  return "invalid";
}

export function classifyContributorProfileTrust(
  profile: ContributorProfileTrustInput,
  opts: { referenceTime?: Date } = {},
): ContributorProfileTrust {
  const calibrationMarker = profile.trustMarker ?? null;
  const calibrationVersion = resolveCalibrationVersion(calibrationMarker);

  if (!isContributorTier(profile.overallTier)) {
    return {
      state: "malformed",
      trusted: false,
      reason: "invalid-overall-tier",
      calibrationMarker,
      calibrationVersion,
    };
  }

  const lastScoredAt = normalizeLastScoredAt(profile.lastScoredAt);
  if (lastScoredAt === "invalid") {
    return {
      state: "malformed",
      trusted: false,
      reason: "invalid-last-scored-at",
      calibrationMarker,
      calibrationVersion,
    };
  }

  if (
    calibrationMarker !== null &&
    calibrationMarker !== CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER
  ) {
    return {
      state: "malformed",
      trusted: false,
      reason: "unsupported-trust-marker",
      calibrationMarker,
      calibrationVersion,
    };
  }

  if (calibrationMarker === CURRENT_CONTRIBUTOR_PROFILE_TRUST_MARKER) {
    if (!lastScoredAt) {
      return {
        state: "malformed",
        trusted: false,
        reason: "missing-last-scored-at",
        calibrationMarker,
        calibrationVersion,
      };
    }

    const referenceTime = opts.referenceTime ?? new Date();
    const ageMs = referenceTime.getTime() - lastScoredAt.getTime();

    if (ageMs > STALE_AFTER_MS) {
      return {
        state: "stale",
        trusted: false,
        reason: "trust-marker-stale",
        calibrationMarker,
        calibrationVersion,
      };
    }

    return {
      state: "calibrated",
      trusted: true,
      reason: "current-trust-marker",
      calibrationMarker,
      calibrationVersion,
    };
  }

  if (!lastScoredAt) {
    return {
      state: "linked-unscored",
      trusted: false,
      reason: "never-scored",
      calibrationMarker: null,
      calibrationVersion: null,
    };
  }

  return {
    state: "legacy",
    trusted: false,
    reason: "missing-trust-marker",
    calibrationMarker: null,
    calibrationVersion: null,
  };
}

export function isTrustworthyContributorProfile(
  profile: ContributorProfileTrustInput,
  opts: { referenceTime?: Date } = {},
): boolean {
  return classifyContributorProfileTrust(profile, opts).trusted;
}
