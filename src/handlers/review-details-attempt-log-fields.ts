export type ReviewDetailsAttemptLogFields = {
  deltaNew: number | null;
  deltaResolved: number | null;
  deltaStillOpen: number | null;
  provenanceCount: number | null;
};

export function buildReviewDetailsAttemptLogFields(params: {
  deltaCounts: {
    new: number;
    resolved: number;
    stillOpen: number;
  } | null;
  retrievalFindingCount: number | null;
}): ReviewDetailsAttemptLogFields {
  return {
    deltaNew: params.deltaCounts?.new ?? null,
    deltaResolved: params.deltaCounts?.resolved ?? null,
    deltaStillOpen: params.deltaCounts?.stillOpen ?? null,
    provenanceCount: params.retrievalFindingCount,
  };
}
