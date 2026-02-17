import type { RetrievalResult } from "./types.ts";

export type MultiQueryVariantType = "intent" | "file-path" | "code-shape";

export type BuildRetrievalVariantsInput = {
  title: string;
  body?: string;
  conventionalType?: string | null;
  prLanguages: string[];
  riskSignals: string[];
  filePaths: string[];
  authorTier?: string;
};

export type MultiQueryVariant = {
  type: MultiQueryVariantType;
  query: string;
  priority: number;
};

export type VariantRetrievalResult = {
  variant: MultiQueryVariant;
  results?: RetrievalResult[];
  error?: unknown;
};

export type MergedRetrievalResult = RetrievalResult & {
  score: number;
  matchedVariants: MultiQueryVariantType[];
};

export function buildRetrievalVariants(_input: BuildRetrievalVariantsInput): MultiQueryVariant[] {
  return [];
}

export function mergeVariantResults(_params: {
  resultsByVariant: VariantRetrievalResult[];
  topK: number;
}): MergedRetrievalResult[] {
  return [];
}
