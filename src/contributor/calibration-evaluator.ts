import {
  ACTIVITY_SIGNAL_WEIGHTS,
  normalizeScore,
} from "./expertise-scorer.ts";
import {
  projectContributorExperienceContract,
  type ContributorExperienceContract,
} from "./experience-contract.ts";
import {
  type XbmcExcludedContributorSnapshot,
  type XbmcFixtureProvenanceRecord,
  type XbmcFixtureSnapshot,
  type XbmcRetainedContributorSnapshot,
} from "./xbmc-fixture-snapshot.ts";
import { calculateTierAssignments } from "./tier-calculator.ts";
import type { ContributorTier } from "./types.ts";

export const DEFAULT_XBMC_CALIBRATION_RETAINED_IDS = [
  "fuzzard",
  "koprajs",
  "fkoemep",
] as const;

export type CalibrationRecommendationVerdict = "keep" | "retune" | "replace";
export type CalibrationFreshnessBand = "fresh" | "aging" | "stale" | "unknown";
export type CalibrationLinkedProfileState =
  | "linked-but-unscored-default-newcomer"
  | "modeled-profile-score-available";

export type CalibrationPathKind = "live" | "intended";

export type CalibrationContributorFixtureEvidence = {
  commitCounts: {
    allTime: number;
    since2025: number;
  };
  latestEvidenceAt: string | null;
  signalAvailability: {
    githubCommit: boolean;
    githubPull: boolean;
    githubReview: boolean;
    localGit: boolean;
  };
  provenanceStatus: {
    github: XbmcRetainedContributorSnapshot["provenance"]["github"]["status"];
    localGit: XbmcRetainedContributorSnapshot["provenance"]["localGit"]["status"];
  };
};

export type CalibrationPathFidelity = {
  exact: boolean;
  degradationReasons: string[];
  assumptions: string[];
};

export type CalibrationPathOutcome = {
  path: CalibrationPathKind;
  modeledOverallScore: number;
  rawSignalScore: number;
  rank: number;
  percentile: number;
  signalCounts: {
    commit: number;
    prAuthored: number;
    prReview: number;
  };
  contract: ContributorExperienceContract;
  fidelity: CalibrationPathFidelity;
};

export type CalibrationPathInstability = {
  hasScoreTie: boolean;
  tiedContributorIds: string[];
  possibleRankRange: {
    min: number;
    max: number;
  };
  possibleTiers: ContributorTier[];
  notes: string[];
};

export type CalibrationFreshnessDiagnostics = {
  latestEvidenceAt: string | null;
  daysSinceLatestEvidence: number | null;
  freshnessBand: CalibrationFreshnessBand;
  linkedProfileState: CalibrationLinkedProfileState;
  hasReviewEvidence: boolean;
  findings: string[];
};

export type CalibrationContributorRow = {
  normalizedId: string;
  displayName: string;
  cohort: XbmcRetainedContributorSnapshot["cohort"];
  selectionNotes: string;
  fixtureEvidence: CalibrationContributorFixtureEvidence;
  live: CalibrationPathOutcome;
  intended: CalibrationPathOutcome;
  instability: {
    live: CalibrationPathInstability;
    intended: CalibrationPathInstability;
  };
  freshness: CalibrationFreshnessDiagnostics;
};

export type CalibrationExcludedControl = {
  normalizedId: string;
  displayName: string;
  exclusionReason: XbmcExcludedContributorSnapshot["exclusionReason"];
  exclusionNotes: string;
  relatedNormalizedIds: string[];
  observedCommitCounts: XbmcExcludedContributorSnapshot["observedCommitCounts"];
  includedInEvaluation: false;
};

export type CalibrationRecommendation = {
  verdict: CalibrationRecommendationVerdict;
  rationale: string[];
};

export type CalibrationReport = {
  referenceTime: string;
  retainedIds: string[];
  rows: CalibrationContributorRow[];
  excludedControls: CalibrationExcludedControl[];
  assumptions: string[];
  findings: {
    liveScoreCompression: boolean;
    divergentContributorIds: string[];
    staleContributorIds: string[];
  };
  recommendation: CalibrationRecommendation;
};

export type EvaluateCalibrationSnapshotOptions = {
  referenceTime?: string | Date;
  retainedIds?: string[];
};

export class CalibrationEvaluatorError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "CalibrationEvaluatorError";
    this.code = code;
  }
}

type PreliminaryPathModel = {
  normalizedId: string;
  modeledOverallScore: number;
  rawSignalScore: number;
  signalCounts: {
    commit: number;
    prAuthored: number;
    prReview: number;
  };
  fidelity: CalibrationPathFidelity;
};

type RankedPathModel = PreliminaryPathModel & {
  rank: number;
  percentile: number;
  tier: ContributorTier;
  contract: ContributorExperienceContract;
};

type InstabilitySnapshot = {
  ranks: number[];
  tiers: ContributorTier[];
  tiedContributorIds: string[];
};

export function evaluateCalibrationSnapshot(
  snapshot: XbmcFixtureSnapshot,
  options: EvaluateCalibrationSnapshotOptions = {},
): CalibrationReport {
  const referenceTime = normalizeReferenceTime(
    options.referenceTime ?? snapshot.generatedAt ?? snapshot.curatedAt,
  );
  const retainedIds =
    options.retainedIds && options.retainedIds.length > 0
      ? [...options.retainedIds]
      : [...DEFAULT_XBMC_CALIBRATION_RETAINED_IDS];

  validateRetainedIds(retainedIds);
  const retainedRows = selectRetainedRows(snapshot, retainedIds, {
    strictDefault: !options.retainedIds,
  });
  const excludedIds = new Set(snapshot.excluded.map((entry) => entry.normalizedId));

  for (const row of retainedRows) {
    validateRetainedRow(row, excludedIds);
  }

  const liveModels = retainedRows.map((row) => modelLivePath(row));
  const intendedModels = retainedRows.map((row) => modelIntendedPath(row));

  const rankedLive = rankPathModels(liveModels);
  const rankedIntended = rankPathModels(intendedModels);
  const liveInstability = analyzePathInstability(liveModels);
  const intendedInstability = analyzePathInstability(intendedModels);

  const rows = retainedRows.map((row) => {
    const fixtureEvidence = buildFixtureEvidence(row, referenceTime);
    const live = rankedLive.get(row.normalizedId);
    const intended = rankedIntended.get(row.normalizedId);

    if (!live || !intended) {
      throw new CalibrationEvaluatorError(
        `Missing ranked calibration outcome for ${row.normalizedId}.`,
        "missing-ranked-outcome",
      );
    }

    return {
      normalizedId: row.normalizedId,
      displayName: row.displayName,
      cohort: row.cohort,
      selectionNotes: row.selectionNotes,
      fixtureEvidence,
      live: {
        path: "live" as const,
        modeledOverallScore: live.modeledOverallScore,
        rawSignalScore: live.rawSignalScore,
        rank: live.rank,
        percentile: live.percentile,
        signalCounts: { ...live.signalCounts },
        contract: live.contract,
        fidelity: cloneFidelity(live.fidelity),
      },
      intended: {
        path: "intended" as const,
        modeledOverallScore: intended.modeledOverallScore,
        rawSignalScore: intended.rawSignalScore,
        rank: intended.rank,
        percentile: intended.percentile,
        signalCounts: { ...intended.signalCounts },
        contract: intended.contract,
        fidelity: cloneFidelity(intended.fidelity),
      },
      instability: {
        live: toInstabilityReport(
          row.normalizedId,
          liveInstability.get(row.normalizedId),
        ),
        intended: toInstabilityReport(
          row.normalizedId,
          intendedInstability.get(row.normalizedId),
        ),
      },
      freshness: buildFreshnessDiagnostics(row, fixtureEvidence, live.modeledOverallScore, referenceTime),
    } satisfies CalibrationContributorRow;
  });

  const excludedControls = snapshot.excluded.map((entry) => ({
    normalizedId: entry.normalizedId,
    displayName: entry.displayName,
    exclusionReason: entry.exclusionReason,
    exclusionNotes: entry.exclusionNotes,
    relatedNormalizedIds: [...entry.relatedNormalizedIds],
    observedCommitCounts: { ...entry.observedCommitCounts },
    includedInEvaluation: false as const,
  }));

  const findings = buildReportFindings(rows);
  const assumptions = [
    "Rows are projected through the linked contributor-profile M045 contract rather than coarse fallback surfaces.",
    "The live incremental path is modeled without replaying historical webhooks or inventing changed-file arrays.",
    "The intended full-signal model uses checked-in commit counts plus available PR/review provenance instead of fabricating file-level history.",
  ];

  return {
    referenceTime: referenceTime.toISOString(),
    retainedIds,
    rows,
    excludedControls,
    assumptions,
    findings,
    recommendation: buildRecommendation(rows, findings),
  };
}

function normalizeReferenceTime(referenceTime: string | Date): Date {
  const date = referenceTime instanceof Date ? new Date(referenceTime) : new Date(referenceTime);
  if (Number.isNaN(date.getTime())) {
    throw new CalibrationEvaluatorError(
      `Invalid calibration reference time: ${String(referenceTime)}`,
      "invalid-reference-time",
    );
  }
  return date;
}

function validateRetainedIds(retainedIds: string[]): void {
  const seen = new Set<string>();
  for (const retainedId of retainedIds) {
    if (seen.has(retainedId)) {
      throw new CalibrationEvaluatorError(
        `Duplicate retained calibration id: ${retainedId}`,
        "duplicate-retained-id",
      );
    }
    seen.add(retainedId);
  }
}

function selectRetainedRows(
  snapshot: XbmcFixtureSnapshot,
  retainedIds: string[],
  options: { strictDefault: boolean },
): XbmcRetainedContributorSnapshot[] {
  const retainedMap = new Map(
    snapshot.retained.map((entry) => [entry.normalizedId, entry] as const),
  );
  const snapshotRetainedIds = [...retainedMap.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  if (options.strictDefault) {
    const expectedIds = [...DEFAULT_XBMC_CALIBRATION_RETAINED_IDS].sort((left, right) =>
      left.localeCompare(right),
    );
    if (!arrayEquals(snapshotRetainedIds, expectedIds)) {
      throw new CalibrationEvaluatorError(
        `Retained cohort drifted from the xbmc anchors: expected ${expectedIds.join(", ")} but found ${snapshotRetainedIds.join(", ")}.`,
        "retained-cohort-drift",
      );
    }
  }

  const selected = retainedIds.map((retainedId) => retainedMap.get(retainedId));
  const missingIds = retainedIds.filter((retainedId, index) => !selected[index]);
  if (missingIds.length > 0) {
    throw new CalibrationEvaluatorError(
      `Retained cohort is missing expected calibration contributors: ${missingIds.join(", ")}.`,
      "retained-cohort-missing",
    );
  }

  return selected as XbmcRetainedContributorSnapshot[];
}

function validateRetainedRow(
  row: XbmcRetainedContributorSnapshot,
  excludedIds: Set<string>,
): void {
  if (excludedIds.has(row.normalizedId)) {
    throw new CalibrationEvaluatorError(
      `Retained cohort leaked excluded identity ${row.normalizedId} into evaluation.`,
      "retained-cohort-leak",
    );
  }

  if (row.observedCommitCounts.since2025 > row.observedCommitCounts.allTime) {
    throw new CalibrationEvaluatorError(
      `Malformed commit-count relationship for ${row.normalizedId}: since2025 exceeds allTime.`,
      "malformed-commit-count-relationship",
    );
  }

  const requiredSources = [
    "github-commit",
    "github-pull",
    "github-review",
    "local-git-shortlog",
  ] as const;
  const missingSources = requiredSources.filter(
    (source) => !row.provenanceRecords.some((record) => record.source === source),
  );

  if (missingSources.length > 0) {
    throw new CalibrationEvaluatorError(
      `Missing retained provenance for ${row.normalizedId}: ${missingSources.join(", ")}.`,
      "missing-retained-provenance",
    );
  }
}

function buildFixtureEvidence(
  row: XbmcRetainedContributorSnapshot,
  referenceTime: Date,
): CalibrationContributorFixtureEvidence {
  const latestEvidenceAt = findLatestObservedAt(row.provenanceRecords);

  return {
    commitCounts: {
      allTime: row.observedCommitCounts.allTime,
      since2025: row.observedCommitCounts.since2025,
    },
    latestEvidenceAt: latestEvidenceAt?.toISOString() ?? null,
    signalAvailability: {
      githubCommit: hasAvailableRecord(row.provenanceRecords, "github-commit"),
      githubPull: hasAvailableRecord(row.provenanceRecords, "github-pull"),
      githubReview: hasAvailableRecord(row.provenanceRecords, "github-review"),
      localGit: hasAvailableRecord(row.provenanceRecords, "local-git-shortlog"),
    },
    provenanceStatus: {
      github: row.provenance.github.status,
      localGit: row.provenance.localGit.status,
    },
  };
}

function modelLivePath(row: XbmcRetainedContributorSnapshot): PreliminaryPathModel {
  const hasPullEvidence = hasAvailableRecord(row.provenanceRecords, "github-pull");

  return {
    normalizedId: row.normalizedId,
    modeledOverallScore: 0,
    rawSignalScore: 0,
    signalCounts: {
      commit: 0,
      prAuthored: 0,
      prReview: 0,
    },
    fidelity: {
      exact: false,
      degradationReasons: [
        "The current live incremental path only scores future pr_authored events.",
        hasPullEvidence
          ? "The checked-in snapshot does not include changed-file arrays, so authored PR evidence cannot be replayed through the live incremental path honestly."
          : "No authored PR evidence is available to replay through the live incremental path.",
      ],
      assumptions: [
        "Projected as a linked contributor profile that remains unscored and therefore defaults to newcomer guidance.",
      ],
    },
  };
}

function modelIntendedPath(
  row: XbmcRetainedContributorSnapshot,
): PreliminaryPathModel {
  const commitCount = row.observedCommitCounts.since2025;
  const hasPullEvidence = hasAvailableRecord(row.provenanceRecords, "github-pull");
  const hasReviewEvidence = hasAvailableRecord(row.provenanceRecords, "github-review");

  const signalCounts = {
    commit: commitCount,
    prAuthored: hasPullEvidence ? 1 : 0,
    prReview: hasReviewEvidence ? 1 : 0,
  };
  const rawSignalScore =
    signalCounts.commit * ACTIVITY_SIGNAL_WEIGHTS.commit
    + signalCounts.prAuthored * ACTIVITY_SIGNAL_WEIGHTS.pr_authored
    + signalCounts.prReview * ACTIVITY_SIGNAL_WEIGHTS.pr_review;

  const degradationReasons = [
    "The intended full-signal model is approximated from checked-in commit counts plus PR/review provenance rather than literal file-level replay.",
    "Changed-file arrays are absent from the snapshot, so topic-level expertise cannot be reconstructed exactly.",
  ];

  if (!hasReviewEvidence) {
    degradationReasons.push(
      "Review evidence is unavailable in the checked-in snapshot for this contributor.",
    );
  }

  return {
    normalizedId: row.normalizedId,
    modeledOverallScore: normalizeScore(rawSignalScore),
    rawSignalScore,
    signalCounts,
    fidelity: {
      exact: false,
      degradationReasons,
      assumptions: [
        "The intended model treats since2025 commit counts as the best checked-in proxy for recent commit volume.",
      ],
    },
  };
}

function rankPathModels(models: PreliminaryPathModel[]): Map<string, RankedPathModel> {
  const scoreSnapshots = models.map((model, index) => ({
    profileId: index + 1,
    overallScore: model.modeledOverallScore,
    normalizedId: model.normalizedId,
  }));
  const assignmentByProfileId = calculateTierAssignments(scoreSnapshots.map((snapshot) => ({
    profileId: snapshot.profileId,
    overallScore: snapshot.overallScore,
  })));
  const rankedDescending = [...models].sort((left, right) => right.modeledOverallScore - left.modeledOverallScore);
  const result = new Map<string, RankedPathModel>();

  for (const model of models) {
    const snapshot = scoreSnapshots.find((entry) => entry.normalizedId === model.normalizedId);
    const assignment = snapshot ? assignmentByProfileId.get(snapshot.profileId) : null;
    const rank = rankedDescending.findIndex((entry) => entry.normalizedId === model.normalizedId) + 1;
    const percentile =
      models.length === 1
        ? 0.5
        : (models.length - rank) / (models.length - 1);
    const tier = assignment?.tier ?? "newcomer";

    result.set(model.normalizedId, {
      ...model,
      rank,
      percentile,
      tier,
      contract: projectContributorExperienceContract({
        source: "contributor-profile",
        tier,
      }),
    });
  }

  return result;
}

function analyzePathInstability(
  models: PreliminaryPathModel[],
): Map<string, InstabilitySnapshot> {
  const scoreGroups = buildScoreGroups(models);
  const hasAnyTie = scoreGroups.some((group) => group.length > 1);
  const permutations = buildScoreStablePermutations(scoreGroups);
  const snapshots = new Map<string, InstabilitySnapshot>();

  for (const model of models) {
    snapshots.set(model.normalizedId, {
      ranks: [],
      tiers: [],
      tiedContributorIds: scoreGroups.find((group) =>
        group.some((entry) => entry.normalizedId === model.normalizedId),
      )?.map((entry) => entry.normalizedId) ?? [],
    });
  }

  if (!hasAnyTie) {
    const ranked = rankPathModels(models);
    for (const model of models) {
      const instability = snapshots.get(model.normalizedId)!;
      const rankedModel = ranked.get(model.normalizedId)!;
      instability.ranks.push(rankedModel.rank);
      instability.tiers.push(rankedModel.tier);
    }
    return snapshots;
  }

  for (const ordering of permutations) {
    const ranked = rankPathModels(ordering);
    for (const model of ordering) {
      const instability = snapshots.get(model.normalizedId)!;
      const rankedModel = ranked.get(model.normalizedId)!;
      instability.ranks.push(rankedModel.rank);
      instability.tiers.push(rankedModel.tier);
    }
  }

  return snapshots;
}

function buildScoreGroups(models: PreliminaryPathModel[]): PreliminaryPathModel[][] {
  const sorted = [...models].sort((left, right) => right.modeledOverallScore - left.modeledOverallScore);
  const groups: PreliminaryPathModel[][] = [];

  for (const model of sorted) {
    const last = groups.at(-1);
    if (last && nearlyEqual(last[0]!.modeledOverallScore, model.modeledOverallScore)) {
      last.push(model);
      continue;
    }
    groups.push([model]);
  }

  return groups;
}

function buildScoreStablePermutations(
  groups: PreliminaryPathModel[][],
): PreliminaryPathModel[][] {
  const perGroupPermutations = groups.map((group) => permutations(group));
  const results: PreliminaryPathModel[][] = [];

  function visit(index: number, current: PreliminaryPathModel[]): void {
    if (index >= perGroupPermutations.length) {
      results.push([...current]);
      return;
    }

    for (const candidate of perGroupPermutations[index]!) {
      current.push(...candidate);
      visit(index + 1, current);
      current.splice(current.length - candidate.length, candidate.length);
    }
  }

  visit(0, []);
  return results;
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) {
    return [values];
  }

  const results: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index]!;
    const rest = values.slice(0, index).concat(values.slice(index + 1));
    for (const remainder of permutations(rest)) {
      results.push([current, ...remainder]);
    }
  }
  return results;
}

function toInstabilityReport(
  normalizedId: string,
  snapshot: InstabilitySnapshot | undefined,
): CalibrationPathInstability {
  if (!snapshot || snapshot.ranks.length === 0 || snapshot.tiers.length === 0) {
    throw new CalibrationEvaluatorError(
      `Missing instability snapshot for ${normalizedId}.`,
      "missing-instability-snapshot",
    );
  }

  const uniqueRanks = dedupeNumbers(snapshot.ranks).sort((left, right) => left - right);
  const uniqueTiers = dedupeTiers(snapshot.tiers);
  const hasScoreTie = snapshot.tiedContributorIds.length > 1;
  const notes: string[] = [];

  if (hasScoreTie) {
    if (uniqueTiers.length > 1) {
      notes.push("Equal scores can move this contributor across percentile tiers when cohort order changes.");
    } else {
      notes.push("Scores are tied, but the zero-score newcomer fallback keeps the projected contract tier stable.");
    }
  }

  return {
    hasScoreTie,
    tiedContributorIds: snapshot.tiedContributorIds,
    possibleRankRange: {
      min: uniqueRanks[0]!,
      max: uniqueRanks[uniqueRanks.length - 1]!,
    },
    possibleTiers: uniqueTiers,
    notes,
  };
}

function buildFreshnessDiagnostics(
  row: XbmcRetainedContributorSnapshot,
  evidence: CalibrationContributorFixtureEvidence,
  liveScore: number,
  referenceTime: Date,
): CalibrationFreshnessDiagnostics {
  const latestEvidenceAt = evidence.latestEvidenceAt ? new Date(evidence.latestEvidenceAt) : null;
  const daysSinceLatestEvidence = latestEvidenceAt
    ? Math.round((referenceTime.getTime() - latestEvidenceAt.getTime()) / DAY_MS)
    : null;
  const hasReviewEvidence = evidence.signalAvailability.githubReview;
  const freshnessBand = classifyFreshnessBand(daysSinceLatestEvidence);
  const linkedProfileState: CalibrationLinkedProfileState = liveScore === 0
    ? "linked-but-unscored-default-newcomer"
    : "modeled-profile-score-available";
  const findings: string[] = [];

  if (!hasReviewEvidence) {
    findings.push("Review evidence is unavailable in the snapshot for this contributor.");
  }
  if (linkedProfileState === "linked-but-unscored-default-newcomer") {
    findings.push(
      "A linked but unscored profile would default to newcomer guidance under the current live incremental path.",
    );
  }
  if (freshnessBand === "stale") {
    findings.push("The latest checked-in contributor evidence is stale relative to the calibration reference time.");
  } else if (freshnessBand === "aging") {
    findings.push("The latest checked-in contributor evidence is aging and may understate recent activity.");
  } else if (freshnessBand === "unknown") {
    findings.push("No observed provenance timestamp is available for freshness analysis.");
  }

  return {
    latestEvidenceAt: latestEvidenceAt?.toISOString() ?? null,
    daysSinceLatestEvidence,
    freshnessBand,
    linkedProfileState,
    hasReviewEvidence,
    findings,
  };
}

function buildReportFindings(rows: CalibrationContributorRow[]): CalibrationReport["findings"] {
  const divergentContributorIds = rows
    .filter((row) => row.live.contract.promptTier !== row.intended.contract.promptTier)
    .map((row) => row.normalizedId);
  const staleContributorIds = rows
    .filter((row) => row.freshness.freshnessBand === "stale")
    .map((row) => row.normalizedId);
  const liveScoreCompression = rows.length > 1
    && rows.every((row) => nearlyEqual(row.live.modeledOverallScore, rows[0]!.live.modeledOverallScore));

  return {
    liveScoreCompression,
    divergentContributorIds,
    staleContributorIds,
  };
}

function buildRecommendation(
  rows: CalibrationContributorRow[],
  findings: CalibrationReport["findings"],
): CalibrationRecommendation {
  const rationale: string[] = [];
  const intendedAlignedToCohortTruth = rows.every((row) =>
    row.intended.contract.promptTier === expectedPromptTierForCohort(row.cohort),
  );

  if (findings.liveScoreCompression) {
    rationale.push(
      "The live incremental path compresses the retained cohort into the same unscored outcome because the snapshot cannot replay changed-file arrays honestly.",
    );
  }

  if (findings.divergentContributorIds.length > 0) {
    rationale.push(
      `The full-signal model differentiates ${findings.divergentContributorIds.join(", ")} from the live incremental path instead of leaving them all at the newcomer default.`,
    );
  }

  if (findings.staleContributorIds.length > 0) {
    rationale.push(
      `Freshness caveats remain for ${findings.staleContributorIds.join(", ")}, so snapshot-based calibration still needs explicit degradation reporting.`,
    );
  }

  if (!intendedAlignedToCohortTruth) {
    rationale.push(
      "The intended full-signal model does not preserve the curated senior/middle/newcomer cohort ordering, so calibration should not be trusted yet.",
    );
  }

  const verdict: CalibrationRecommendationVerdict =
    findings.liveScoreCompression || findings.divergentContributorIds.length >= 2 || !intendedAlignedToCohortTruth
      ? "replace"
      : findings.staleContributorIds.length > 0
        ? "retune"
        : "keep";

  if (rationale.length === 0) {
    rationale.push("Live and intended modeled paths align with the curated cohort and no material freshness degradation was observed.");
  }

  return { verdict, rationale };
}

function expectedPromptTierForCohort(
  cohort: XbmcRetainedContributorSnapshot["cohort"],
): ContributorTier {
  switch (cohort) {
    case "senior":
      return "senior";
    case "ambiguous-middle":
      return "established";
    case "newcomer":
    default:
      return "newcomer";
  }
}

function hasAvailableRecord(
  records: XbmcFixtureProvenanceRecord[],
  source: XbmcFixtureProvenanceRecord["source"],
): boolean {
  return records.some((record) => record.source === source && record.status === "available");
}

function findLatestObservedAt(
  records: XbmcFixtureProvenanceRecord[],
): Date | null {
  const timestamps = records
    .map((record) => record.observedAt)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps.map((value) => value.getTime())));
}

function classifyFreshnessBand(
  daysSinceLatestEvidence: number | null,
): CalibrationFreshnessBand {
  if (daysSinceLatestEvidence === null) {
    return "unknown";
  }
  if (daysSinceLatestEvidence <= 45) {
    return "fresh";
  }
  if (daysSinceLatestEvidence <= 180) {
    return "aging";
  }
  return "stale";
}

function cloneFidelity(fidelity: CalibrationPathFidelity): CalibrationPathFidelity {
  return {
    exact: fidelity.exact,
    degradationReasons: [...fidelity.degradationReasons],
    assumptions: [...fidelity.assumptions],
  };
}

function dedupeNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function dedupeTiers(values: ContributorTier[]): ContributorTier[] {
  const order: ContributorTier[] = ["newcomer", "developing", "established", "senior"];
  return [...new Set(values)].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12;
}

const DAY_MS = 1000 * 60 * 60 * 24;
