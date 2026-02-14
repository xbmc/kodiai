/**
 * Adjust a base confidence score based on user feedback reactions.
 *
 * Formula: baseConfidence + (thumbsUp * 10) - (thumbsDown * 20)
 * Result is clamped to [0, 100].
 */
export function adjustConfidenceForFeedback(
  baseConfidence: number,
  feedback: { thumbsUp: number; thumbsDown: number },
): number {
  const adjusted =
    baseConfidence + feedback.thumbsUp * 10 - feedback.thumbsDown * 20;
  return Math.max(0, Math.min(100, adjusted));
}
