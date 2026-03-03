/** Composite score weights -- must sum to 1.0 */
export const POPULARITY_WEIGHTS = {
  inboundLinks: 0.3,
  citationFrequency: 0.5,
  editRecency: 0.2,
} as const;

/**
 * Exponential decay lambda for edit recency.
 * lambda = ln(2) / halfLifeDays
 * With halfLife=90 days: a page edited 90 days ago scores 0.5,
 * 180 days ago scores 0.25, etc.
 */
export const RECENCY_HALF_LIFE_DAYS = 90;
export const RECENCY_LAMBDA = Math.LN2 / RECENCY_HALF_LIFE_DAYS; // ~0.0077

/** Rolling window for citation count aggregation */
export const CITATION_WINDOW_DAYS = 90;

/** Linkshere API settings */
export const LINKSHERE_BATCH_SIZE = 50; // Max pageids per API request
export const LINKSHERE_RATE_LIMIT_MS = 500; // Delay between API batches
export const LINKSHERE_MAX_PER_PAGE = 5000; // Cap pagination for extremely popular pages
export const LINKSHERE_NAMESPACE = 0; // Main namespace only

/**
 * Compute composite popularity score using min-max normalized weighted sum.
 * All signals normalized to [0, 1] then combined with configured weights.
 */
export function computeCompositeScore(params: {
  inboundLinks: number;
  citationCount: number;
  daysSinceEdit: number;
  normalization: {
    maxInboundLinks: number;
    minInboundLinks: number;
    maxCitationCount: number;
    minCitationCount: number;
  };
}): { editRecencyScore: number; compositeScore: number } {
  const { inboundLinks, citationCount, daysSinceEdit, normalization } = params;

  // Normalize inbound links (min-max with zero-division guard)
  const linkRange = normalization.maxInboundLinks - normalization.minInboundLinks;
  const normalizedLinks =
    linkRange > 0
      ? (inboundLinks - normalization.minInboundLinks) / linkRange
      : 0;

  // Normalize citation count (min-max with zero-division guard)
  const citRange = normalization.maxCitationCount - normalization.minCitationCount;
  const normalizedCitations =
    citRange > 0
      ? (citationCount - normalization.minCitationCount) / citRange
      : 0;

  // Edit recency via exponential decay
  const editRecencyScore = Math.exp(-RECENCY_LAMBDA * daysSinceEdit);

  // Weighted sum
  const compositeScore =
    POPULARITY_WEIGHTS.inboundLinks * normalizedLinks +
    POPULARITY_WEIGHTS.citationFrequency * normalizedCitations +
    POPULARITY_WEIGHTS.editRecency * editRecencyScore;

  return { editRecencyScore, compositeScore };
}
