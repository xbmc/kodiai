import {
  resolveContributorExperienceSlackProfileProjection,
  type ContributorExperienceSlackProfileProjection,
} from "./experience-contract.ts";
import {
  classifyContributorProfileTrust,
  isContributorTier,
  type ContributorProfileTrust,
  type ContributorProfileTrustInput,
} from "./profile-trust.ts";
import type { ContributorProfile } from "./types.ts";

export type ContributorProfileSurfaceInput = Pick<
  ContributorProfile,
  "overallTier" | "optedOut" | "lastScoredAt" | "trustMarker"
>;

export type ContributorProfileSurfaceResolution = {
  trust: ContributorProfileTrust | null;
  projection: ContributorExperienceSlackProfileProjection;
  shouldLookupExpertise: boolean;
};

export function createGenericContributorProfileSurfaceResolution(
  trust: ContributorProfileTrust | null = null,
): ContributorProfileSurfaceResolution {
  return {
    trust,
    projection: resolveContributorExperienceSlackProfileProjection({
      source: "none",
    }),
    shouldLookupExpertise: false,
  };
}

export function resolveContributorProfileSurface(
  profile: ContributorProfileSurfaceInput,
  opts: {
    referenceTime?: Date;
    classifyTrust?: (
      profile: ContributorProfileTrustInput,
      opts?: { referenceTime?: Date },
    ) => ContributorProfileTrust;
  } = {},
): ContributorProfileSurfaceResolution {
  const classifyTrust = opts.classifyTrust ?? classifyContributorProfileTrust;

  let trust: ContributorProfileTrust | null = null;
  try {
    trust = classifyTrust(profile, {
      referenceTime: opts.referenceTime,
    });
  } catch {
    return createGenericContributorProfileSurfaceResolution();
  }

  const normalizedTier = isContributorTier(profile.overallTier)
    ? profile.overallTier
    : undefined;

  if (profile.optedOut) {
    return {
      trust,
      projection: resolveContributorExperienceSlackProfileProjection({
        source: "contributor-profile",
        tier: normalizedTier,
        optedOut: true,
      }),
      shouldLookupExpertise: false,
    };
  }

  if (trust?.trusted && normalizedTier) {
    return {
      trust,
      projection: resolveContributorExperienceSlackProfileProjection({
        source: "contributor-profile",
        tier: normalizedTier,
      }),
      shouldLookupExpertise: true,
    };
  }

  return createGenericContributorProfileSurfaceResolution(trust);
}

export function renderLinkedProfileContinuityMessage(params: {
  githubUsername: string;
  surface: Pick<ContributorProfileSurfaceResolution, "projection">;
}): string {
  const { githubUsername, surface } = params;

  if (surface.projection.state === "profile-backed") {
    return `Linked your Slack account to GitHub user \`${githubUsername}\`. Linked contributor guidance is active for your profile. Use \`/kodiai profile\` to review your status.`;
  }

  return `Linked your Slack account to GitHub user \`${githubUsername}\`. Kodiai will keep your reviews generic until your linked profile has current contributor signals. Use \`/kodiai profile\` to review your status.`;
}

export function renderProfileOptInContinuityMessage(params: {
  surface: Pick<ContributorProfileSurfaceResolution, "projection">;
}): string {
  if (params.surface.projection.state === "profile-backed") {
    return "Contributor-specific guidance is now on for your linked profile. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.";
  }

  return "Contributor-specific guidance is now on for your linked profile, but Kodiai will keep reviews generic until current contributor signals are available. Use `/kodiai profile` to review your status, or `/kodiai profile opt-out` to return to generic guidance.";
}
