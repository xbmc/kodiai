export function buildReviewRetryCustomInstructions(params: {
  basePrompt?: string;
  isTimeout: boolean;
  checkpointEnabled: boolean;
}): string {
  const retryInstruction = [
    params.isTimeout
      ? "This is a retry of a timed-out review with reduced scope."
      : "This is a retry of a review that exhausted max turns with reduced scope.",
    "Focus ONLY on the changed files listed above.",
    "Do NOT post a top-level summary comment; only publish inline comments.",
    params.checkpointEnabled
      ? "At the end, call save_review_checkpoint with a summaryDraft that summarizes findings so far and a findingCount total."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const basePrompt = params.basePrompt?.trim() ?? "";
  return basePrompt.length > 0
    ? `${basePrompt}\n\n${retryInstruction}`
    : retryInstruction;
}
