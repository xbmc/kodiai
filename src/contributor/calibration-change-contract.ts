import type { CalibrationRecommendationVerdict } from "./calibration-evaluator.ts";

export type CalibrationChangeBucket = "keep" | "change" | "replace";

export type CalibrationChangeRecommendationInput = {
  verdict?: unknown;
  rationale?: unknown;
} | null | undefined;

export type CalibrationChangeContractEntry = {
  mechanism: string;
  summary: string;
  rationale: string;
  evidence: string[];
  impactedSurfaces: string[];
};

export type CalibrationChangeContract = {
  verdict: CalibrationRecommendationVerdict;
  rationale: string[];
  keep: CalibrationChangeContractEntry[];
  change: CalibrationChangeContractEntry[];
  replace: CalibrationChangeContractEntry[];
};

export type CalibrationChangeContractInventoryEntry = {
  appliesTo: readonly CalibrationRecommendationVerdict[];
  bucket: CalibrationChangeBucket;
  mechanism: string;
  summary: string;
  rationale: string;
  evidence: readonly string[];
  impactedSurfaces: readonly string[];
};

export class CalibrationChangeContractError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "CalibrationChangeContractError";
    this.code = code;
  }
}

const DEFAULT_CHANGE_CONTRACT_INVENTORY: readonly CalibrationChangeContractInventoryEntry[] = [
  {
    appliesTo: ["keep", "retune", "replace"],
    bucket: "keep",
    mechanism: "m045-contributor-experience-contract-vocabulary",
    summary:
      "Keep the M045 contributor-experience contract vocabulary as the durable interface for prompt and profile projections.",
    rationale:
      "The replace verdict targets calibration and scoring internals, not the public contributor-experience states already introduced in M045.",
    evidence: [
      "src/contributor/experience-contract.ts already defines stable `profile-backed`, `coarse-fallback`, and generic contributor-experience states.",
      "src/contributor/experience-contract.ts already projects prompt and Slack guidance from that vocabulary without depending on calibration-specific score math.",
    ],
    impactedSurfaces: [
      "src/contributor/experience-contract.ts::projectContributorExperienceContract",
      "src/contributor/experience-contract.ts::buildContributorExperiencePromptSection",
    ],
  },
  {
    appliesTo: ["retune", "replace"],
    bucket: "change",
    mechanism: "stored-tier-consumer-surfaces",
    summary:
      "Change review and Slack consumers to read the future M047 contract without changing their outward contributor-guidance surfaces.",
    rationale:
      "These consumers should survive M047, but they must stop trusting today’s stored tier inputs as the source of truth for contributor guidance.",
    evidence: [
      "src/handlers/review.ts currently derives review behavior from stored contributor tiers via `projectContributorExperienceContract(...)` and preserves coarse-fallback cache behavior.",
      "src/slack/slash-command-handler.ts formats linked-profile status from `profile.overallTier` through `resolveContributorExperienceSlackProfileProjection(...)`.",
    ],
    impactedSurfaces: [
      "src/handlers/review.ts::resolveAuthorTier",
      "src/slack/slash-command-handler.ts::formatProfileCard",
      "src/contributor/experience-contract.ts::resolveContributorExperienceSlackProfileProjection",
    ],
  },
  {
    appliesTo: ["replace"],
    bucket: "replace",
    mechanism: "live-incremental-pr-authored-scoring",
    summary:
      "Replace the live incremental `pr_authored`-only contributor scoring path with the M047 full-signal calibration contract.",
    rationale:
      "S02’s replace recommendation is driven by the live path collapsing retained contributors into the newcomer default while the intended full-signal model separates them.",
    evidence: [
      "src/handlers/review.ts only emits incremental expertise updates for `type: \"pr_authored\"`, which matches the S02 live-path compression finding.",
      "The S02 recommendation reports that the full-signal model differentiates retained contributors beyond the live newcomer default.",
    ],
    impactedSurfaces: [
      "src/handlers/review.ts::updateExpertiseIncremental(type=pr_authored)",
    ],
  },
] as const;

export function buildCalibrationChangeContract(
  recommendation: CalibrationChangeRecommendationInput,
  options: {
    inventory?: readonly CalibrationChangeContractInventoryEntry[];
  } = {},
): CalibrationChangeContract {
  const normalizedRecommendation = normalizeRecommendation(recommendation);
  const inventory = options.inventory ?? DEFAULT_CHANGE_CONTRACT_INVENTORY;
  const activeEntries = inventory.filter((entry) =>
    entry.appliesTo.includes(normalizedRecommendation.verdict),
  );

  validateActiveInventory(activeEntries);

  return {
    verdict: normalizedRecommendation.verdict,
    rationale: normalizedRecommendation.rationale,
    keep: buildBucketEntries(activeEntries, "keep"),
    change: buildBucketEntries(activeEntries, "change"),
    replace: buildBucketEntries(activeEntries, "replace"),
  };
}

function normalizeRecommendation(
  recommendation: CalibrationChangeRecommendationInput,
): {
  verdict: CalibrationRecommendationVerdict;
  rationale: string[];
} {
  if (!isSupportedVerdict(recommendation?.verdict)) {
    if (recommendation?.verdict == null) {
      throw new CalibrationChangeContractError(
        "Calibration recommendation must include a verdict.",
        "missing-recommendation-verdict",
      );
    }

    throw new CalibrationChangeContractError(
      `Unsupported calibration recommendation verdict: ${String(recommendation.verdict)}`,
      "unsupported-recommendation-verdict",
    );
  }

  if (!Array.isArray(recommendation?.rationale)) {
    throw new CalibrationChangeContractError(
      "Calibration recommendation must include rationale lines.",
      "missing-recommendation-rationale",
    );
  }

  const rationale = recommendation.rationale
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (rationale.length === 0) {
    throw new CalibrationChangeContractError(
      "Calibration recommendation must include at least one rationale line.",
      "missing-recommendation-rationale",
    );
  }

  return {
    verdict: recommendation.verdict,
    rationale,
  };
}

function validateActiveInventory(
  activeEntries: readonly CalibrationChangeContractInventoryEntry[],
): void {
  const bucketByMechanism = new Map<string, CalibrationChangeBucket>();

  for (const entry of activeEntries) {
    validateInventoryEntry(entry);

    const priorBucket = bucketByMechanism.get(entry.mechanism);
    if (priorBucket) {
      if (priorBucket === entry.bucket) {
        throw new CalibrationChangeContractError(
          `Duplicate contract mechanism in ${entry.bucket}: ${entry.mechanism}`,
          "duplicate-mechanism",
        );
      }

      throw new CalibrationChangeContractError(
        `Contract mechanism ${entry.mechanism} cannot appear in both ${priorBucket} and ${entry.bucket}.`,
        "contradictory-mechanism-bucket",
      );
    }

    bucketByMechanism.set(entry.mechanism, entry.bucket);
  }
}

function validateInventoryEntry(
  entry: CalibrationChangeContractInventoryEntry,
): void {
  if (entry.mechanism.trim().length === 0) {
    throw new CalibrationChangeContractError(
      "Contract inventory entries must include a mechanism id.",
      "missing-mechanism",
    );
  }

  if (entry.summary.trim().length === 0 || entry.rationale.trim().length === 0) {
    throw new CalibrationChangeContractError(
      `Contract mechanism ${entry.mechanism} must include summary and rationale text.`,
      "missing-contract-text",
    );
  }

  const evidence = entry.evidence
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (evidence.length === 0) {
    throw new CalibrationChangeContractError(
      `Contract mechanism ${entry.mechanism} must include evidence strings.`,
      "missing-evidence",
    );
  }

  const impactedSurfaces = entry.impactedSurfaces
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (impactedSurfaces.length === 0) {
    throw new CalibrationChangeContractError(
      `Contract mechanism ${entry.mechanism} must include impacted surfaces.`,
      "missing-impacted-surface",
    );
  }
}

function buildBucketEntries(
  activeEntries: readonly CalibrationChangeContractInventoryEntry[],
  bucket: CalibrationChangeBucket,
): CalibrationChangeContractEntry[] {
  return activeEntries
    .filter((entry) => entry.bucket === bucket)
    .map((entry) => ({
      mechanism: entry.mechanism,
      summary: entry.summary,
      rationale: entry.rationale,
      evidence: [...entry.evidence],
      impactedSurfaces: [...entry.impactedSurfaces],
    }));
}

function isSupportedVerdict(
  verdict: unknown,
): verdict is CalibrationRecommendationVerdict {
  return verdict === "keep" || verdict === "retune" || verdict === "replace";
}
