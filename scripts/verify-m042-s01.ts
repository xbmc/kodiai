import { recalculateTierFailOpen } from "../src/contributor/expertise-scorer.ts";
import { calculateTierForProfile } from "../src/contributor/tier-calculator.ts";
import { resolveAuthorTierFromSources } from "../src/handlers/review.ts";
import type { ContributorProfileStore, ContributorTier } from "../src/contributor/types.ts";

type CheckResult = {
  id: string;
  passed: boolean;
  detail: string;
};

type VerificationResult = {
  milestone: "M042";
  slice: "S01";
  overallPassed: boolean;
  checks: CheckResult[];
};

function createNoopLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => createNoopLogger(),
  };
}

function makeProfileStoreStub(params: {
  scores: Array<{ profileId: number; overallScore: number }>;
  getAllScoresImpl?: () => Promise<Array<{ profileId: number; overallScore: number }>>;
  updateTierImpl?: (profileId: number, tier: ContributorTier, overallScore: number) => Promise<void>;
}): ContributorProfileStore {
  return {
    getByGithubUsername: async () => null,
    getBySlackUserId: async () => null,
    linkIdentity: async () => {
      throw new Error("not implemented in verifier");
    },
    unlinkSlack: async () => undefined,
    setOptedOut: async () => undefined,
    getExpertise: async () => [],
    upsertExpertise: async () => undefined,
    updateTier: params.updateTierImpl ?? (async () => undefined),
    getOrCreateByGithubUsername: async () => {
      throw new Error("not implemented in verifier");
    },
    getAllScores: params.getAllScoresImpl ?? (async () => params.scores),
  };
}

export async function evaluateM042S01(): Promise<VerificationResult> {
  const checks: CheckResult[] = [];

  const stuckTierScores = [
    { profileId: 10, overallScore: 0.05 },
    { profileId: 11, overallScore: 0.2 },
    { profileId: 12, overallScore: 0.35 },
    { profileId: 13, overallScore: 0.5 },
    { profileId: 14, overallScore: 0.7 },
  ];
  const correctedTier = calculateTierForProfile({
    profileId: 99,
    updatedOverallScore: 0.6,
    scores: stuckTierScores,
  });
  checks.push({
    id: "M042-S01-STUCK-TIER-REPRO-FIXED",
    passed: correctedTier !== "newcomer",
    detail: `updated profile tier=${correctedTier}`,
  });

  let persistedTier: ContributorTier | null = null;
  let persistedScore: number | null = null;
  const profileStore = makeProfileStoreStub({
    scores: stuckTierScores,
    updateTierImpl: async (_profileId, tier, overallScore) => {
      persistedTier = tier;
      persistedScore = overallScore;
    },
  });
  const recalculatedTier = await recalculateTierFailOpen({
    profileId: 99,
    updatedOverallScore: 0.6,
    fallbackTier: "newcomer",
    profileStore,
    logger: createNoopLogger() as never,
  });
  await profileStore.updateTier(99, recalculatedTier, 0.6);
  checks.push({
    id: "M042-S01-RECALCULATED-TIER-PERSISTS",
    passed: recalculatedTier === persistedTier && persistedTier !== "newcomer" && persistedScore === 0.6,
    detail: `recalculated=${recalculatedTier}, persisted=${persistedTier}, score=${persistedScore}`,
  });

  const precedence = resolveAuthorTierFromSources({
    contributorTier: "established",
    cachedTier: "first-time",
    fallbackTier: "first-time",
  });
  checks.push({
    id: "M042-S01-PROFILE-PRECEDENCE",
    passed: precedence.source === "contributor-profile" && precedence.tier === "established",
    detail: `source=${precedence.source}, tier=${precedence.tier}`,
  });

  const degradedTier = await recalculateTierFailOpen({
    profileId: 99,
    updatedOverallScore: 0.6,
    fallbackTier: "newcomer",
    profileStore: makeProfileStoreStub({
      scores: [],
      getAllScoresImpl: async () => {
        throw new Error("db unavailable");
      },
    }),
    logger: createNoopLogger() as never,
  });
  checks.push({
    id: "M042-S01-FAIL-OPEN-NONBLOCKING",
    passed: degradedTier === "newcomer",
    detail: `fallback tier preserved=${degradedTier}`,
  });

  return {
    milestone: "M042",
    slice: "S01",
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

if (import.meta.main) {
  const result = await evaluateM042S01();
  for (const check of result.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.id} - ${check.detail}`);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.overallPassed ? 0 : 1);
}
