import { classifyFileLanguage } from "../execution/diff-analysis.ts";
import type { RetrievalResult } from "./types.ts";

export type RerankConfig = {
  sameLanguageBoost: number;
  crossLanguagePenalty: number;
};

export const DEFAULT_RERANK_CONFIG: RerankConfig = {
  sameLanguageBoost: 0.85,
  crossLanguagePenalty: 1.15,
};

export type RerankedResult = RetrievalResult & {
  adjustedDistance: number;
  languageMatch: boolean;
};

export function rerankByLanguage(params: {
  results: RetrievalResult[];
  prLanguages: string[];
  config?: RerankConfig;
}): RerankedResult[] {
  const { results, prLanguages, config = DEFAULT_RERANK_CONFIG } = params;
  const prLangSet = new Set(prLanguages);

  const reranked: RerankedResult[] = results.map((result) => {
    const language = classifyFileLanguage(result.record.filePath);

    let multiplier: number;
    let languageMatch: boolean;

    if (language === "Unknown") {
      // Neutral — no boost, no penalty (prevents config/docs demotion)
      multiplier = 1.0;
      languageMatch = false;
    } else if (prLangSet.has(language)) {
      // Same language — boost (lower distance = better match)
      multiplier = config.sameLanguageBoost;
      languageMatch = true;
    } else {
      // Cross language — penalty
      multiplier = config.crossLanguagePenalty;
      languageMatch = false;
    }

    return {
      ...result,
      adjustedDistance: result.distance * multiplier,
      languageMatch,
    };
  });

  // Sort by adjustedDistance ascending (lower = better)
  reranked.sort((a, b) => a.adjustedDistance - b.adjustedDistance);

  return reranked;
}
