const EXPLICIT_REVIEW_PROMPT_DIFF_MAX_CHARS = 12_000;
const EXPLICIT_REVIEW_PROMPT_DIFF_MAX_FILES = 3;

export function selectExplicitReviewPromptDiffContent(params: {
  diffContent?: string;
  changedFileCount: number;
}): string | undefined {
  if (!params.diffContent) return undefined;
  if (params.changedFileCount > EXPLICIT_REVIEW_PROMPT_DIFF_MAX_FILES) return undefined;
  if (params.diffContent.length > EXPLICIT_REVIEW_PROMPT_DIFF_MAX_CHARS) return undefined;
  return params.diffContent;
}
