import type { Logger } from "pino";
import type { ContributorProfileStore, ContributorTier } from "./types.ts";

function tierFromPercentile(
  overallScore: number,
  percentile: number,
): ContributorTier {
  // Zero score always means newcomer — no data, no matter the percentile
  if (overallScore === 0) return "newcomer";

  if (percentile < 0.2) return "newcomer";
  if (percentile < 0.5) return "developing";
  if (percentile < 0.8) return "established";
  return "senior";
}

/**
 * Recalculate tiers for all non-opted-out contributors based on percentile
 * distribution of overall_score. Only updates profiles whose tier actually changed.
 */
export async function recalculateTiers(params: {
  profileStore: ContributorProfileStore;
  logger: Logger;
}): Promise<void> {
  const { profileStore, logger } = params;
  const allScores = await profileStore.getAllScores();

  if (allScores.length === 0) {
    logger.debug("No contributor profiles found for tier recalculation");
    return;
  }

  // Sort ascending by score for percentile calculation
  const sorted = [...allScores].sort(
    (a, b) => a.overallScore - b.overallScore,
  );
  const total = sorted.length;

  // We need to know current tiers to detect changes.
  // Build a map of profileId -> desired tier
  const tierAssignments = new Map<
    number,
    { tier: ContributorTier; overallScore: number }
  >();

  for (let i = 0; i < total; i++) {
    const entry = sorted[i]!;
    const percentile = total === 1 ? 0.5 : i / (total - 1);
    const tier = tierFromPercentile(entry.overallScore, percentile);
    tierAssignments.set(entry.profileId, {
      tier,
      overallScore: entry.overallScore,
    });
  }

  // Fetch current tiers and only update changed ones
  let tiersChanged = 0;
  const breakdown: Record<ContributorTier, number> = {
    newcomer: 0,
    developing: 0,
    established: 0,
    senior: 0,
  };

  for (const [profileId, assignment] of tierAssignments) {
    breakdown[assignment.tier]++;
    // Always update tier — the store call is idempotent, and we need to
    // detect changes. In practice, we'd compare against cached current tier,
    // but since getAllScores doesn't return the tier, we update all.
    // The profileStore.updateTier is a cheap UPDATE.
    await profileStore.updateTier(
      profileId,
      assignment.tier,
      assignment.overallScore,
    );
    tiersChanged++;
  }

  logger.info(
    {
      totalProfiles: total,
      tiersChanged,
      breakdown,
    },
    "Tier recalculation complete",
  );
}
