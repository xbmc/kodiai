import { classifyFileLanguage, RELATED_LANGUAGES } from "../execution/diff-analysis.ts";
import type { RetrievalResult } from "./types.ts";

export type RerankConfig = {
  /** Distance multiplier for same-language match (< 1.0 = better). Default 0.85. */
  sameLanguageBoost: number;
  /** Fraction of exact-match boost applied to related languages. Default 0.5. */
  relatedLanguageRatio: number;
};

export const DEFAULT_RERANK_CONFIG: RerankConfig = {
  sameLanguageBoost: 0.85,
  relatedLanguageRatio: 0.5,
};

export type RerankedResult = RetrievalResult & {
  adjustedDistance: number;
  languageMatch: boolean;
};

/**
 * Check if `lang` is related (via RELATED_LANGUAGES) to any language in `prLangSet`.
 */
function isRelatedLanguage(lang: string, prLangSet: Set<string>): boolean {
  const related = RELATED_LANGUAGES[lang];
  if (!related) return false;
  return related.some((r) => prLangSet.has(r));
}

/**
 * Rerank retrieval results by language affinity.
 *
 * Policy (LANG-03/LANG-04 compliant):
 * - Exact match: boost (multiplier < 1.0 — lower distance = better match)
 * - Related language (C/C++, TS/JS): partial boost at relatedLanguageRatio of exact
 * - Non-matching: NO change — multiplier stays 1.0 (NEVER penalize)
 * - Unknown/undefined language: neutral (multiplier 1.0)
 *
 * Language source (in priority order):
 * 1. result.record.language (stored at ingest time via Plan 01)
 * 2. classifyFileLanguage(result.record.filePath) — backward compat for old records
 */
export function rerankByLanguage(params: {
  results: RetrievalResult[];
  prLanguages: string[];
  config?: RerankConfig;
}): RerankedResult[] {
  const { results, prLanguages, config = DEFAULT_RERANK_CONFIG } = params;
  // Normalize PR languages to lowercase for comparison
  const prLangSet = new Set(prLanguages.map((l) => l.toLowerCase()));

  return results
    .map((result) => {
      // Use stored language if present, fallback to runtime classification for old records
      const rawLanguage = result.record.language ?? classifyFileLanguage(result.record.filePath);
      const language = rawLanguage.toLowerCase();

      let multiplier = 1.0; // DEFAULT: no change (no penalty ever)
      let languageMatch = false;

      if (!language || language === "unknown") {
        // Neutral — no boost, no penalty
      } else if (prLangSet.has(language)) {
        // Exact match — boost
        multiplier = config.sameLanguageBoost;
        languageMatch = true;
      } else if (isRelatedLanguage(language, prLangSet)) {
        // Related language affinity: relatedLanguageRatio of exact boost
        multiplier = 1.0 - (1.0 - config.sameLanguageBoost) * config.relatedLanguageRatio;
        languageMatch = false; // partial match, not exact
      }
      // else: non-matching language — multiplier stays 1.0 (NO PENALTY)

      return {
        ...result,
        adjustedDistance: result.distance * multiplier,
        languageMatch,
      };
    })
    .sort((a, b) => a.adjustedDistance - b.adjustedDistance);
}
