import type { Sql } from "../db/client.ts";
import { parseReviewOutputKey } from "../handlers/review-idempotency.ts";
import type { NormalizedLogAnalyticsRow } from "./log-analytics.ts";
import type { RecentReviewArtifact, ReviewAuditLane } from "./recent-review-sample.ts";

export type EvidenceAvailability = "present" | "missing" | "unavailable";
export type ProvisionalReviewVerdict =
  | "clean-valid"
  | "findings-published"
  | "publish-failure"
  | "suspicious-approval"
  | "indeterminate";

export type AutomaticLaneEvidence = {
  sourceAvailability: {
    reviewRecord: EvidenceAvailability;
    findings: EvidenceAvailability;
    checkpoint: EvidenceAvailability;
    telemetry: EvidenceAvailability;
  };
  reviewRecord: {
    deliveryId: string;
    findingsTotal: number;
    conclusion: string;
  } | null;
  matchingFindingCount: number | null;
  publishedFindingCount: number | null;
  checkpoint: {
    partialCommentId: number | null;
  } | null;
  telemetry: {
    conclusion: string;
    eventType: string;
  } | null;
};

export type AutomaticLaneLogEvidence = {
  sourceAvailability: {
    azureLogs: EvidenceAvailability;
  };
  evidenceBundleOutcome: string | null;
  reviewOutputPublicationState: string | null;
  idempotencyDecision: string | null;
};

export type ExplicitLaneEvidence = {
  sourceAvailability: {
    telemetry: EvidenceAvailability;
    publishResolution: EvidenceAvailability;
  };
  telemetry: {
    conclusion: string;
    eventType: string;
  } | null;
  publishResolution: string | null;
};

export type CorrelatedReviewEvidence = {
  lane: ReviewAuditLane;
  verdict: ProvisionalReviewVerdict;
  rationale: string;
  sourceAvailability: Record<string, EvidenceAvailability>;
  signals: string[];
};

function makeUnavailableAutomaticEvidence(): AutomaticLaneEvidence {
  return {
    sourceAvailability: {
      reviewRecord: "unavailable",
      findings: "unavailable",
      checkpoint: "unavailable",
      telemetry: "unavailable",
    },
    reviewRecord: null,
    matchingFindingCount: null,
    publishedFindingCount: null,
    checkpoint: null,
    telemetry: null,
  };
}

function makeUnavailableAutomaticLogEvidence(): AutomaticLaneLogEvidence {
  return {
    sourceAvailability: {
      azureLogs: "unavailable",
    },
    evidenceBundleOutcome: null,
    reviewOutputPublicationState: null,
    idempotencyDecision: null,
  };
}

function isFailureConclusion(conclusion: string | null | undefined): boolean {
  if (!conclusion) {
    return false;
  }

  return new Set(["error", "failed", "failure", "timeout"]).has(conclusion.trim().toLowerCase());
}

export function buildAutomaticLaneLogEvidence(rows: NormalizedLogAnalyticsRow[]): AutomaticLaneLogEvidence {
  let evidenceBundleOutcome: string | null = null;
  let reviewOutputPublicationState: string | null = null;
  let idempotencyDecision: string | null = null;

  for (const row of rows) {
    const parsedLog = row.parsedLog;
    if (!parsedLog) {
      continue;
    }

    if (parsedLog.evidenceType === "review" && typeof parsedLog.outcome === "string") {
      evidenceBundleOutcome = parsedLog.outcome;
    }

    if (typeof parsedLog.reviewOutputPublicationState === "string") {
      reviewOutputPublicationState = parsedLog.reviewOutputPublicationState;
    }

    if (typeof parsedLog.idempotencyDecision === "string") {
      idempotencyDecision = parsedLog.idempotencyDecision;
    }
  }

  return {
    sourceAvailability: {
      azureLogs: rows.length > 0 ? "present" : "missing",
    },
    evidenceBundleOutcome,
    reviewOutputPublicationState,
    idempotencyDecision,
  };
}

export function buildExplicitLaneEvidenceFromLogs(rows: NormalizedLogAnalyticsRow[]): ExplicitLaneEvidence {
  let telemetry: ExplicitLaneEvidence["telemetry"] = null;
  let publishResolution: string | null = null;

  for (const row of rows) {
    const parsedLog = row.parsedLog;
    if (!parsedLog) {
      continue;
    }

    if (
      telemetry === null
      && typeof parsedLog.conclusion === "string"
      && (typeof parsedLog.publishResolution === "string" || row.message === "Mention execution completed")
    ) {
      telemetry = {
        conclusion: parsedLog.conclusion,
        eventType: typeof parsedLog.eventType === "string"
          ? parsedLog.eventType
          : "issue_comment.created",
      };
    }

    if (typeof parsedLog.publishResolution === "string") {
      publishResolution = parsedLog.publishResolution;
    }
  }

  return {
    sourceAvailability: {
      telemetry: telemetry ? "present" : (rows.length > 0 ? "missing" : "missing"),
      publishResolution: publishResolution ? "present" : (rows.length > 0 ? "missing" : "missing"),
    },
    telemetry,
    publishResolution,
  };
}

export async function loadAutomaticLaneEvidence(params: {
  sql?: Sql | null;
  artifact: RecentReviewArtifact;
}): Promise<AutomaticLaneEvidence> {
  if (!params.sql) {
    return makeUnavailableAutomaticEvidence();
  }

  const parsed = parseReviewOutputKey(params.artifact.reviewOutputKey);
  if (!parsed) {
    return makeUnavailableAutomaticEvidence();
  }

  const [reviewRow] = await params.sql`
    SELECT id, delivery_id, findings_total, conclusion
    FROM reviews
    WHERE repo = ${parsed.repoFullName}
      AND pr_number = ${params.artifact.prNumber}
      AND delivery_id = ${parsed.effectiveDeliveryId}
    ORDER BY id DESC
    LIMIT 1
  `;

  let matchingFindingCount: number | null = null;
  let publishedFindingCount: number | null = null;
  let findingsAvailability: EvidenceAvailability = reviewRow ? "present" : "missing";

  if (reviewRow) {
    const [findingRow] = await params.sql`
      SELECT
        COUNT(*) AS matching_finding_count,
        COUNT(*) FILTER (WHERE comment_id IS NOT NULL AND comment_surface IS NOT NULL) AS published_finding_count
      FROM findings
      WHERE review_id = ${reviewRow.id}
        AND review_output_key = ${params.artifact.reviewOutputKey}
    `;

    matchingFindingCount = Number(findingRow?.matching_finding_count ?? 0);
    publishedFindingCount = Number(findingRow?.published_finding_count ?? 0);
  }

  const [checkpointRow] = await params.sql`
    SELECT partial_comment_id
    FROM review_checkpoints
    WHERE review_output_key = ${params.artifact.reviewOutputKey}
    LIMIT 1
  `;

  const [telemetryRow] = await params.sql`
    SELECT conclusion, event_type
    FROM telemetry_events
    WHERE repo = ${parsed.repoFullName}
      AND pr_number = ${params.artifact.prNumber}
      AND delivery_id = ${parsed.effectiveDeliveryId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return {
    sourceAvailability: {
      reviewRecord: reviewRow ? "present" : "missing",
      findings: findingsAvailability,
      checkpoint: checkpointRow ? "present" : "missing",
      telemetry: telemetryRow ? "present" : "missing",
    },
    reviewRecord: reviewRow
      ? {
          deliveryId: String(reviewRow.delivery_id),
          findingsTotal: Number(reviewRow.findings_total ?? 0),
          conclusion: String(reviewRow.conclusion ?? "unknown"),
        }
      : null,
    matchingFindingCount,
    publishedFindingCount,
    checkpoint: checkpointRow
      ? {
          partialCommentId: checkpointRow.partial_comment_id == null ? null : Number(checkpointRow.partial_comment_id),
        }
      : null,
    telemetry: telemetryRow
      ? {
          conclusion: String(telemetryRow.conclusion ?? "unknown"),
          eventType: String(telemetryRow.event_type ?? "unknown"),
        }
      : null,
  };
}

function classifyAutomaticEvidence(
  automaticEvidence: AutomaticLaneEvidence,
  automaticLogEvidence: AutomaticLaneLogEvidence,
): Omit<CorrelatedReviewEvidence, "lane"> {
  if (automaticLogEvidence.sourceAvailability.azureLogs === "present") {
    if (automaticLogEvidence.evidenceBundleOutcome === "published-output") {
      return {
        verdict: "findings-published",
        rationale: "Azure log evidence shows the automatic review published output.",
        sourceAvailability: {
          ...automaticEvidence.sourceAvailability,
          ...automaticLogEvidence.sourceAvailability,
        },
        signals: ["automatic-log-published-output"],
      };
    }

    if (automaticLogEvidence.evidenceBundleOutcome === "submitted-approval") {
      return {
        verdict: "clean-valid",
        rationale: "Azure log evidence shows the automatic review submitted an approval outcome.",
        sourceAvailability: {
          ...automaticEvidence.sourceAvailability,
          ...automaticLogEvidence.sourceAvailability,
        },
        signals: ["automatic-log-submitted-approval"],
      };
    }
  }

  if (automaticEvidence.sourceAvailability.reviewRecord === "unavailable") {
    return {
      verdict: "indeterminate",
      rationale: "Automatic-lane DB evidence is unavailable.",
      sourceAvailability: {
        ...automaticEvidence.sourceAvailability,
        ...automaticLogEvidence.sourceAvailability,
      },
      signals: ["automatic-db-unavailable"],
    };
  }

  if (!automaticEvidence.reviewRecord) {
    return {
      verdict: "indeterminate",
      rationale: "No automatic-lane review record matched the artifact delivery identity.",
      sourceAvailability: {
        ...automaticEvidence.sourceAvailability,
        ...automaticLogEvidence.sourceAvailability,
      },
      signals: ["automatic-review-record-missing"],
    };
  }

  if ((automaticEvidence.publishedFindingCount ?? 0) > 0) {
    return {
      verdict: "findings-published",
      rationale: "Matching finding rows with published comment identity were found for this automatic review.",
      sourceAvailability: {
        ...automaticEvidence.sourceAvailability,
        ...automaticLogEvidence.sourceAvailability,
      },
      signals: ["published-finding-rows-present"],
    };
  }

  if (automaticEvidence.reviewRecord.findingsTotal === 0 && !isFailureConclusion(automaticEvidence.reviewRecord.conclusion)) {
    return {
      verdict: "clean-valid",
      rationale: "The automatic review record completed with zero findings, which matches a clean approval / Review Details outcome.",
      sourceAvailability: {
        ...automaticEvidence.sourceAvailability,
        ...automaticLogEvidence.sourceAvailability,
      },
      signals: ["automatic-zero-findings"],
    };
  }

  if (
    automaticEvidence.reviewRecord.findingsTotal > 0
    && (automaticEvidence.matchingFindingCount ?? 0) === 0
    && !isFailureConclusion(automaticEvidence.reviewRecord.conclusion)
  ) {
    return {
      verdict: "suspicious-approval",
      rationale: "The automatic review recorded findings, but no matching published finding rows were found for this artifact.",
      sourceAvailability: {
        ...automaticEvidence.sourceAvailability,
        ...automaticLogEvidence.sourceAvailability,
      },
      signals: ["automatic-findings-without-published-rows"],
    };
  }

  if (
    isFailureConclusion(automaticEvidence.reviewRecord.conclusion)
    || isFailureConclusion(automaticEvidence.telemetry?.conclusion)
  ) {
    return {
      verdict: "publish-failure",
      rationale: "The automatic review shows a failure-shaped execution conclusion without published finding rows.",
      sourceAvailability: {
        ...automaticEvidence.sourceAvailability,
        ...automaticLogEvidence.sourceAvailability,
      },
      signals: ["automatic-failure-conclusion"],
    };
  }

  return {
    verdict: "indeterminate",
    rationale: "Automatic-lane evidence was present but did not resolve to a clean, published, suspicious, or failure-shaped outcome conclusively.",
    sourceAvailability: {
      ...automaticEvidence.sourceAvailability,
      ...automaticLogEvidence.sourceAvailability,
    },
    signals: ["automatic-evidence-ambiguous"],
  };
}

function classifyExplicitEvidence(explicitEvidence: ExplicitLaneEvidence | undefined): Omit<CorrelatedReviewEvidence, "lane"> {
  if (!explicitEvidence || explicitEvidence.sourceAvailability.publishResolution !== "present" || !explicitEvidence.publishResolution) {
    return {
      verdict: "indeterminate",
      rationale: "Explicit-review publish-resolution evidence is unavailable, so the artifact cannot be classified beyond GitHub surface alone.",
      sourceAvailability: explicitEvidence?.sourceAvailability ?? {
        telemetry: "unavailable",
        publishResolution: "unavailable",
      },
      signals: ["explicit-publish-resolution-unavailable"],
    };
  }

  const publishResolution = explicitEvidence.publishResolution;
  if (publishResolution === "executor") {
    return {
      verdict: "findings-published",
      rationale: "The explicit review completed on the executor publication path.",
      sourceAvailability: explicitEvidence.sourceAvailability,
      signals: ["explicit-executor-publication"],
    };
  }

  if (["approval-bridge", "idempotency-skip", "duplicate-suppressed"].includes(publishResolution)) {
    return {
      verdict: "clean-valid",
      rationale: "The explicit review resolved through a clean approval or duplicate-safe publication path.",
      sourceAvailability: explicitEvidence.sourceAvailability,
      signals: [`explicit-${publishResolution}`],
    };
  }

  if (["publish-failure-fallback", "publish-failure-comment-failed"].includes(publishResolution)) {
    return {
      verdict: "publish-failure",
      rationale: "The explicit review ended on a publish-failure path.",
      sourceAvailability: explicitEvidence.sourceAvailability,
      signals: [`explicit-${publishResolution}`],
    };
  }

  return {
    verdict: "indeterminate",
    rationale: "Explicit-review publish evidence was present but did not match a known terminal resolution.",
    sourceAvailability: explicitEvidence.sourceAvailability,
    signals: ["explicit-publish-resolution-unknown"],
  };
}

export function classifyReviewArtifactEvidence(params: {
  artifact: RecentReviewArtifact;
  automaticEvidence?: AutomaticLaneEvidence;
  automaticLogEvidence?: AutomaticLaneLogEvidence;
  explicitEvidence?: ExplicitLaneEvidence;
}): CorrelatedReviewEvidence {
  if (params.artifact.lane === "automatic") {
    return {
      lane: "automatic",
      ...classifyAutomaticEvidence(
        params.automaticEvidence ?? makeUnavailableAutomaticEvidence(),
        params.automaticLogEvidence ?? makeUnavailableAutomaticLogEvidence(),
      ),
    };
  }

  return {
    lane: "explicit",
    ...classifyExplicitEvidence(params.explicitEvidence),
  };
}
