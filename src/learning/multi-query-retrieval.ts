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

const MAX_QUERY_LENGTH = 800;
const MAX_BODY_LENGTH = 200;
const MAX_LANGUAGES = 5;
const MAX_RISK_SIGNALS = 5;
const MAX_FILE_PATHS = 8;

const VARIANT_PRIORITY: Record<MultiQueryVariantType, number> = {
  intent: 0,
  "file-path": 1,
  "code-shape": 2,
};

const VARIANT_WEIGHT: Record<MultiQueryVariantType, number> = {
  intent: 1.0,
  "file-path": 0.95,
  "code-shape": 0.9,
};

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeList(values: string[], max: number, sort = true): string[] {
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  const normalized = Array.from(deduped);
  if (sort) {
    normalized.sort();
  }
  return normalized.slice(0, max);
}

function boundedJoin(parts: string[]): string {
  const query = parts.filter(Boolean).join("\n").trim();
  if (query.length <= MAX_QUERY_LENGTH) {
    return query;
  }
  return query.slice(0, MAX_QUERY_LENGTH);
}

export function buildRetrievalVariants(input: BuildRetrievalVariantsInput): MultiQueryVariant[] {
  const title = normalizeText(input.title);
  const body = normalizeText(input.body).slice(0, MAX_BODY_LENGTH);
  const conventionalType = normalizeText(input.conventionalType);
  const authorTier = normalizeText(input.authorTier);
  const prLanguages = normalizeList(input.prLanguages, MAX_LANGUAGES);
  const riskSignals = normalizeList(input.riskSignals, MAX_RISK_SIGNALS);
  const filePaths = normalizeList(input.filePaths, MAX_FILE_PATHS, false);

  const intent = boundedJoin([
    title,
    body,
    conventionalType ? `[${conventionalType}]` : "",
    authorTier ? `author: ${authorTier}` : "",
  ]);

  const filePath = boundedJoin([
    title,
    "files:",
    ...filePaths,
  ]);

  const codeShape = boundedJoin([
    title,
    prLanguages.length > 0 ? `languages: ${prLanguages.join(" ")}` : "",
    riskSignals.length > 0 ? `risk: ${riskSignals.join(" ")}` : "",
    conventionalType ? `type: ${conventionalType}` : "",
  ]);

  return [
    { type: "intent", query: intent, priority: VARIANT_PRIORITY.intent },
    { type: "file-path", query: filePath, priority: VARIANT_PRIORITY["file-path"] },
    { type: "code-shape", query: codeShape, priority: VARIANT_PRIORITY["code-shape"] },
  ];
}

function buildStableResultKey(result: RetrievalResult): string {
  const recordId = result.record.id ?? result.memoryId;
  if (recordId !== undefined && recordId !== null) {
    return `id:${recordId}`;
  }

  const fingerprint = [
    normalizeText(result.sourceRepo),
    normalizeText(result.record.filePath),
    normalizeText(result.record.findingText),
    normalizeText(result.record.severity),
    normalizeText(result.record.category),
  ].join("|");
  return `fp:${fingerprint}`;
}

export function mergeVariantResults(params: {
  resultsByVariant: VariantRetrievalResult[];
  topK: number;
}): MergedRetrievalResult[] {
  if (params.topK <= 0 || params.resultsByVariant.length === 0) {
    return [];
  }

  const mergedByKey = new Map<
    string,
    {
      representative: RetrievalResult;
      weightedScore: number;
      bestDistance: number;
      bestVariantPriority: number;
      matchedVariants: Set<MultiQueryVariantType>;
    }
  >();

  for (const variantResult of params.resultsByVariant) {
    if (variantResult.error || !variantResult.results || variantResult.results.length === 0) {
      continue;
    }

    const variantType = variantResult.variant.type;
    const variantPriority = VARIANT_PRIORITY[variantType];
    const variantWeight = VARIANT_WEIGHT[variantType];
    const ordered = [...variantResult.results].sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return buildStableResultKey(a).localeCompare(buildStableResultKey(b));
    });

    for (const result of ordered) {
      const key = buildStableResultKey(result);
      const score = (1 / (1 + Math.max(0, result.distance))) * variantWeight;
      const existing = mergedByKey.get(key);

      if (!existing) {
        mergedByKey.set(key, {
          representative: result,
          weightedScore: score,
          bestDistance: result.distance,
          bestVariantPriority: variantPriority,
          matchedVariants: new Set([variantType]),
        });
        continue;
      }

      existing.weightedScore += score;
      existing.bestDistance = Math.min(existing.bestDistance, result.distance);
      existing.bestVariantPriority = Math.min(existing.bestVariantPriority, variantPriority);
      existing.matchedVariants.add(variantType);

      if (result.distance < existing.representative.distance) {
        existing.representative = result;
      }
    }
  }

  const merged = Array.from(mergedByKey.values()).map((entry) => ({
    ...entry.representative,
    score: Number(entry.weightedScore.toFixed(8)),
    matchedVariants: Array.from(entry.matchedVariants).sort(
      (a, b) => VARIANT_PRIORITY[a] - VARIANT_PRIORITY[b],
    ),
    _bestDistance: entry.bestDistance,
    _bestVariantPriority: entry.bestVariantPriority,
    _stableKey: buildStableResultKey(entry.representative),
  }));

  merged.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a._bestDistance !== b._bestDistance) {
      return a._bestDistance - b._bestDistance;
    }
    if (a._bestVariantPriority !== b._bestVariantPriority) {
      return a._bestVariantPriority - b._bestVariantPriority;
    }
    return a._stableKey.localeCompare(b._stableKey);
  });

  return merged.slice(0, params.topK).map(({ _bestDistance, _bestVariantPriority, _stableKey, ...result }) => result);
}
