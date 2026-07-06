import type { Logger } from "pino";
import {
  applyGraphAwareSelection,
  type FileRiskScore,
  type GraphAwareSelectionResult,
} from "../lib/file-risk-scorer.ts";
import type {
  ReviewGraphBlastRadiusResult,
} from "../review-graph/query.ts";
import { isTrivialChange } from "../review-graph/validation.ts";
import type { StructuralImpactCache } from "../structural-impact/cache.ts";
import { summarizeStructuralImpactDegradation } from "../structural-impact/degradation.ts";
import {
  fetchReviewStructuralImpact,
  type ReviewGraphQueryFn,
  type ReviewStructuralImpactResult,
} from "../structural-impact/review-integration.ts";
import type { StructuralImpactPayload } from "../structural-impact/types.ts";

type TrivialChangeCheck = typeof isTrivialChange;
type FetchReviewStructuralImpact = typeof fetchReviewStructuralImpact;

export type ReviewStructuralImpactSelectionResult = {
  graphSelection: GraphAwareSelectionResult;
  graphBlastRadius: ReviewGraphBlastRadiusResult | null;
  graphQueryBypassedForTrivialChange: boolean;
  structuralImpactForReview: StructuralImpactPayload | null;
};

export async function resolveReviewStructuralImpactSelection(params: {
  reviewGraphQuery?: ReviewGraphQueryFn;
  structuralImpactCache: StructuralImpactCache;
  logger: Logger;
  baseLog: Record<string, unknown>;
  owner: string;
  repo: string;
  workspaceKey: string;
  baseSha: string;
  headSha: string;
  changedPaths: string[];
  canonicalRef: string;
  fullReviewCount: number;
  abbreviatedCount: number;
  totalLinesChanged: number;
  riskScores: FileRiskScore[];
  isTrivial?: TrivialChangeCheck;
  fetchStructuralImpact?: FetchReviewStructuralImpact;
}): Promise<ReviewStructuralImpactSelectionResult> {
  let graphSelection = applyGraphAwareSelection({ riskScores: params.riskScores });
  let graphBlastRadius: ReviewGraphBlastRadiusResult | null = null;
  let graphQueryBypassedForTrivialChange = false;
  let structuralImpactForReview: StructuralImpactPayload | null = null;

  if (!params.reviewGraphQuery) {
    return {
      graphSelection,
      graphBlastRadius,
      graphQueryBypassedForTrivialChange,
      structuralImpactForReview,
    };
  }

  const isTrivial = params.isTrivial ?? isTrivialChange;
  const fetchStructuralImpact = params.fetchStructuralImpact ?? fetchReviewStructuralImpact;
  const trivialCheck = isTrivial({
    changedFileCount: params.changedPaths.length,
    totalLinesChanged: params.totalLinesChanged,
  });

  if (trivialCheck.bypass) {
    graphQueryBypassedForTrivialChange = true;
    params.logger.info(
      {
        ...params.baseLog,
        gate: "graph-query-bypass",
        reason: trivialCheck.reason,
        fileCount: params.changedPaths.length,
      },
      "Trivial change detected — bypassing graph query",
    );
    return {
      graphSelection,
      graphBlastRadius,
      graphQueryBypassedForTrivialChange,
      structuralImpactForReview,
    };
  }

  try {
    const structuralImpact: ReviewStructuralImpactResult = await fetchStructuralImpact(
      {
        reviewGraphQuery: params.reviewGraphQuery,
        cache: params.structuralImpactCache,
        logger: params.logger,
      },
      {
        repo: `${params.owner}/${params.repo}`,
        owner: params.owner,
        workspaceKey: params.workspaceKey,
        baseSha: params.baseSha,
        headSha: params.headSha,
        changedPaths: params.changedPaths,
        canonicalRef: params.canonicalRef,
        query: params.changedPaths.join(" "),
        graphLimit: Math.max(
          params.fullReviewCount + params.abbreviatedCount,
          20,
        ),
      },
    );
    const structuralImpactDegradation = summarizeStructuralImpactDegradation(
      structuralImpact.payload,
    );
    structuralImpactForReview = {
      ...structuralImpact.payload,
      status: structuralImpactDegradation.status,
      degradations: structuralImpactDegradation.degradations,
    };
    graphBlastRadius = structuralImpact.graphBlastRadius;
    params.logger.info(
      {
        ...params.baseLog,
        gate: "structural-impact",
        status: structuralImpactForReview.status,
        graphPresent: Boolean(structuralImpact.graphBlastRadius),
        probableCallers: structuralImpactForReview.probableCallers.length,
        impactedFiles: structuralImpactForReview.impactedFiles.length,
        likelyTests: structuralImpactForReview.likelyTests.length,
        canonicalEvidence: structuralImpactForReview.canonicalEvidence.length,
        breakingChangeEvidenceUsed:
          structuralImpactForReview.probableCallers.length > 0
          || structuralImpactForReview.impactedFiles.length > 0,
        fallbackUsed: structuralImpactDegradation.fallbackUsed,
        degradationSignals: structuralImpactDegradation.truthfulnessSignals,
        graphAvailable: structuralImpactDegradation.availability.graphAvailable,
        corpusAvailable: structuralImpactDegradation.availability.corpusAvailable,
      },
      "Review structural-impact payload collected",
    );
    if (graphBlastRadius) {
      graphSelection = applyGraphAwareSelection({
        riskScores: params.riskScores,
        graph: graphBlastRadius,
      });
    }
  } catch (err) {
    params.logger.warn(
      { ...params.baseLog, gate: "graph-aware-selection", err },
      "Review structural-impact integration failed (fail-open, continuing with file-risk selection)",
    );
  }

  return {
    graphSelection,
    graphBlastRadius,
    graphQueryBypassedForTrivialChange,
    structuralImpactForReview,
  };
}
