import {
  matchPathInstructions,
  type MatchedInstruction,
  type PathInstruction,
} from "../execution/review-prompt.ts";

export function resolveReviewPathInstructions({
  pathInstructions,
  changedFiles,
  matchPathInstructionsFn = matchPathInstructions,
}: {
  pathInstructions: PathInstruction[];
  changedFiles: string[];
  matchPathInstructionsFn?: (
    pathInstructions: PathInstruction[],
    changedFiles: string[],
  ) => MatchedInstruction[];
}): MatchedInstruction[] {
  if (pathInstructions.length === 0) {
    return [];
  }

  return matchPathInstructionsFn(pathInstructions, changedFiles);
}
