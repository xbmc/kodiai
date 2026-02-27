import type { Logger } from "pino";
import type { EmbeddingProvider, LearningMemoryStore, RetrievalResult } from "./types.ts";
import type { IsolationLayer } from "./isolation.ts";
import type { MergedRetrievalResult, MultiQueryVariantType } from "./multi-query-retrieval.ts";
import type { SnippetAnchor } from "./retrieval-snippets.ts";
import type { ReviewCommentStore } from "./review-comment-types.ts";
import type { WikiPageStore } from "./wiki-types.ts";
import { executeRetrievalVariants, mergeVariantResults } from "./multi-query-retrieval.ts";
import { rerankByLanguage } from "./retrieval-rerank.ts";
import { applyRecencyWeighting } from "./retrieval-recency.ts";
import { computeAdaptiveThreshold } from "./adaptive-threshold.ts";
import { buildSnippetAnchors, trimSnippetAnchorsToBudget } from "./retrieval-snippets.ts";
import { searchReviewComments, type ReviewCommentMatch } from "./review-comment-retrieval.ts";
import { searchWikiPages, type WikiKnowledgeMatch } from "./wiki-retrieval.ts";
import { searchCodeSnippets, type CodeSnippetMatch } from "./code-snippet-retrieval.ts";
import type { CodeSnippetStore } from "./code-snippet-types.ts";
import { searchIssues, type IssueKnowledgeMatch } from "./issue-retrieval.ts";
import type { IssueStore } from "./issue-types.ts";
import { hybridSearchMerge } from "./hybrid-search.ts";
import {
  crossCorpusRRF,
  type UnifiedRetrievalChunk,
  type RankedSourceList,
} from "./cross-corpus-rrf.ts";
import { deduplicateChunks } from "./dedup.ts";
import { classifyFileLanguage, RELATED_LANGUAGES } from "../execution/diff-analysis.ts";

export type TriggerType = "pr_review" | "issue" | "question" | "slack";

export type RetrieveOptions = {
  repo: string;
  owner: string;
  /** Raw text queries -- multi-query is first-class. Single query: pass ['query']. */
  queries: string[];
  /** Workspace dir for snippet anchoring. If omitted, skip snippet building. */
  workspaceDir?: string;
  /** PR languages for language-based reranking. Default: [] */
  prLanguages?: string[];
  /** Override topK from config. */
  topK?: number;
  /** Override distance threshold from config. */
  distanceThreshold?: number;
  /** Override adaptive threshold from config. */
  adaptive?: boolean;
  /** Override maxContextChars from config. */
  maxContextChars?: number;
  /** Logger instance for request-scoped logging. */
  logger: Logger;
  /** Context-dependent source weighting trigger type. */
  triggerType?: TriggerType;
};

export type RetrieveResult = {
  /** Legacy: learning memory findings (backward compat). */
  findings: MergedRetrievalResult[];
  snippetAnchors: SnippetAnchor[];
  /** Legacy: separate review comment matches (backward compat). */
  reviewPrecedents: ReviewCommentMatch[];
  /** Legacy: separate wiki matches (backward compat). */
  wikiKnowledge: WikiKnowledgeMatch[];
  /** NEW: unified cross-corpus results with source attribution. */
  unifiedResults: UnifiedRetrievalChunk[];
  /** NEW: pre-assembled context window with source labels. */
  contextWindow: string;
  provenance: {
    queryCount: number;
    candidateCount: number;
    sharedPoolUsed: boolean;
    thresholdMethod: string;
    thresholdValue: number;
    reviewCommentCount: number;
    wikiPageCount: number;
    snippetCount: number;
    issueCount: number;
    unifiedResultCount: number;
    hybridSearchUsed: boolean;
    rrfK: number;
    dedupThreshold: number;
    triggerType: string;
  };
};

export type RetrieverConfig = {
  retrieval: {
    enabled: boolean;
    topK: number;
    distanceThreshold: number;
    adaptive: boolean;
    maxContextChars: number;
  };
  sharing: {
    enabled: boolean;
  };
};

const VARIANT_TYPE_SEQUENCE: MultiQueryVariantType[] = ["intent", "file-path", "code-shape"];
const RRF_K = 60;
const DEDUP_THRESHOLD = 0.9;

/** Source weight multipliers for context-dependent re-ranking. */
const SOURCE_WEIGHTS: Record<TriggerType, Record<string, number>> = {
  pr_review: { code: 1.2, review_comment: 1.2, wiki: 1.0, snippet: 1.1, issue: 0.8 },
  issue: { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8, issue: 1.5 },
  question: { code: 1.0, review_comment: 1.0, wiki: 1.2, snippet: 0.8, issue: 1.2 },
  slack: { code: 1.0, review_comment: 1.0, wiki: 1.0, snippet: 1.0, issue: 1.0 },
};

/** How much to boost exact-language matches in the unified pipeline. */
const LANGUAGE_BOOST_FACTOR = 0.25;
/** Related language gets this fraction of the exact match boost. */
const LANGUAGE_AFFINITY_RATIO = 0.5;

/**
 * Build proportional language weights from the PR languages array.
 * E.g. ["cpp", "cpp", "cpp", "cpp", "python"] -> Map { "cpp": 0.8, "python": 0.2 }
 * Languages are normalized to lowercase before counting.
 */
function buildProportionalLanguageWeights(prLanguages: string[]): Map<string, number> {
  if (prLanguages.length === 0) return new Map();
  const counts = new Map<string, number>();
  for (const lang of prLanguages) {
    const normalized = lang.toLowerCase()
      .replace("c++", "cpp")
      .replace("c#", "csharp")
      .replace("objective-c++", "objectivecpp")
      .replace("objective-c", "objectivec")
      .replace("f#", "fsharp");
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  const total = prLanguages.length;
  const weights = new Map<string, number>();
  for (const [lang, count] of counts) {
    weights.set(lang, count / total);
  }
  return weights;
}

/**
 * Extract the language from a unified chunk for language boost purposes.
 * - code chunks: reads metadata.language
 * - wiki chunks: reads first non-"general" tag from metadata.languageTags
 * - review_comment chunks: classifies from metadata.filePath
 */
function getChunkLanguage(chunk: UnifiedRetrievalChunk): string | null {
  if (chunk.source === "code") {
    const lang = chunk.metadata?.language as string | undefined;
    return lang ?? null;
  }
  if (chunk.source === "wiki") {
    const tags = chunk.metadata?.languageTags as string[] | undefined;
    if (!tags || tags.length === 0) return null;
    // Prefer specific language over "general"
    const specific = tags.find((t) => t !== "general");
    return specific ?? (tags[0] === "general" ? null : (tags[0] ?? null));
  }
  if (chunk.source === "review_comment") {
    const filePath = chunk.metadata?.filePath as string | undefined;
    if (!filePath) return null;
    const classified = classifyFileLanguage(filePath);
    if (classified === "Unknown") return null;
    return classified.toLowerCase()
      .replace("c++", "cpp")
      .replace("c#", "csharp")
      .replace("objective-c++", "objectivecpp")
      .replace("objective-c", "objectivec")
      .replace("f#", "fsharp");
  }
  if (chunk.source === "snippet") {
    const lang = chunk.metadata?.language as string | undefined;
    return lang ?? null;
  }
  return null;
}

function hasRelatedLanguage(lang: string, weightMap: Map<string, number>): boolean {
  const related = RELATED_LANGUAGES[lang];
  return related?.some((r) => weightMap.has(r)) ?? false;
}

function getMaxRelatedWeight(lang: string, weightMap: Map<string, number>): number {
  const related = RELATED_LANGUAGES[lang];
  if (!related) return 0;
  return Math.max(0, ...related.map((r) => weightMap.get(r) ?? 0));
}

/**
 * Normalize a review comment match to UnifiedRetrievalChunk.
 */
function reviewMatchToUnified(match: ReviewCommentMatch, repo: string): UnifiedRetrievalChunk {
  return {
    id: `review:${repo}:${match.prNumber}:${match.distance}`,
    text: match.chunkText,
    source: "review_comment",
    sourceLabel: `[review: PR #${match.prNumber}]`,
    sourceUrl: `https://github.com/${repo}/pull/${match.prNumber}`,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.githubCreatedAt,
    metadata: {
      prNumber: match.prNumber,
      prTitle: match.prTitle,
      filePath: match.filePath,
      authorLogin: match.authorLogin,
      authorAssociation: match.authorAssociation,
      startLine: match.startLine,
      endLine: match.endLine,
    },
  };
}

/**
 * Normalize a wiki match to UnifiedRetrievalChunk.
 */
function wikiMatchToUnified(match: WikiKnowledgeMatch): UnifiedRetrievalChunk {
  return {
    id: `wiki:${match.pageId}:${match.distance}`,
    text: match.chunkText,
    source: "wiki",
    sourceLabel: `[wiki: ${match.pageTitle}]`,
    sourceUrl: match.pageUrl,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.lastModified,
    metadata: {
      pageId: match.pageId,
      pageTitle: match.pageTitle,
      namespace: match.namespace,
      sectionHeading: match.sectionHeading,
      languageTags: match.languageTags ?? [],
    },
  };
}

/**
 * Normalize a code snippet match to UnifiedRetrievalChunk.
 */
function snippetToUnified(match: CodeSnippetMatch, repo: string): UnifiedRetrievalChunk {
  return {
    id: `snippet:${match.contentHash}:${match.distance}`,
    text: match.embeddedText,
    source: "snippet",
    sourceLabel: `[snippet] PR #${match.prNumber}: ${match.prTitle ?? "untitled"} — ${match.filePath}:${match.startLine}-${match.endLine}`,
    sourceUrl: `https://github.com/${repo}/pull/${match.prNumber}`,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.createdAt,
    metadata: {
      contentHash: match.contentHash,
      filePath: match.filePath,
      startLine: match.startLine,
      endLine: match.endLine,
      prNumber: match.prNumber,
      prTitle: match.prTitle,
      language: match.language,
    },
  };
}

/**
 * Normalize an issue match to UnifiedRetrievalChunk.
 */
function issueMatchToUnified(match: IssueKnowledgeMatch, repo: string): UnifiedRetrievalChunk {
  return {
    id: `issue:${repo}:${match.issueNumber}:${match.distance}`,
    text: match.chunkText,
    source: "issue",
    sourceLabel: `[issue: #${match.issueNumber}] ${match.title} (${match.state})`,
    sourceUrl: `https://github.com/${repo}/issues/${match.issueNumber}`,
    vectorDistance: match.distance,
    rrfScore: 0,
    createdAt: match.githubCreatedAt,
    metadata: {
      issueNumber: match.issueNumber,
      title: match.title,
      state: match.state,
      authorLogin: match.authorLogin,
    },
  };
}

/**
 * Normalize a learning memory result to UnifiedRetrievalChunk.
 */
function memoryToUnified(result: MergedRetrievalResult): UnifiedRetrievalChunk {
  // Use stored language; fallback to runtime classification for old records without language field
  const language = result.record.language
    ?? classifyFileLanguage(result.record.filePath).toLowerCase()
         .replace("c#", "csharp")
         .replace("c++", "cpp")
         .replace("objective-c++", "objectivecpp")
         .replace("objective-c", "objectivec")
         .replace("f#", "fsharp")
         .replace("unknown", "unknown");

  return {
    id: `code:${result.memoryId}`,
    text: result.record.findingText,
    source: "code",
    sourceLabel: `[code: ${result.record.filePath}]`,
    sourceUrl: null,
    vectorDistance: result.distance,
    rrfScore: 0,
    createdAt: result.record.createdAt ?? null,
    metadata: {
      memoryId: result.memoryId,
      filePath: result.record.filePath,
      severity: result.record.severity,
      category: result.record.category,
      outcome: result.record.outcome,
      language,
    },
  };
}

/**
 * Assemble a context window from unified chunks respecting token budget.
 * Each chunk is prefixed with its source label.
 */
function assembleContextWindow(
  chunks: UnifiedRetrievalChunk[],
  maxChars: number,
): string {
  const parts: string[] = [];
  let totalChars = 0;
  const missingCorpora: string[] = [];

  for (const chunk of chunks) {
    const entry = `${chunk.sourceLabel}: ${chunk.text}`;
    if (totalChars + entry.length > maxChars) break;
    parts.push(entry);
    totalChars += entry.length;
  }

  // Check which corpora are represented
  const sourcesPresent = new Set(chunks.map((c) => c.source));
  if (!sourcesPresent.has("code") && chunks.length > 0) missingCorpora.push("code");
  if (!sourcesPresent.has("review_comment") && chunks.length > 0) missingCorpora.push("review comment");
  if (!sourcesPresent.has("wiki") && chunks.length > 0) missingCorpora.push("wiki");

  let result = parts.join("\n\n");
  if (missingCorpora.length > 0) {
    result += `\n\nNote: ${missingCorpora.join(", ")} corpus not yet available.`;
  }
  return result;
}

/**
 * Create a retriever with injected dependencies. Returns a retrieve() function
 * that encapsulates the entire retrieval pipeline: embedding, isolation, merging,
 * reranking, thresholding, snippet anchoring, hybrid search, RRF, and dedup.
 */
export function createRetriever(deps: {
  embeddingProvider: EmbeddingProvider;
  isolationLayer: IsolationLayer;
  config: RetrieverConfig;
  reviewCommentStore?: ReviewCommentStore;
  wikiPageStore?: WikiPageStore;
  memoryStore?: LearningMemoryStore;
  codeSnippetStore?: CodeSnippetStore;
  issueStore?: IssueStore;
}): { retrieve: (opts: RetrieveOptions) => Promise<RetrieveResult | null> } {
  const { embeddingProvider, isolationLayer, config } = deps;

  async function retrieve(opts: RetrieveOptions): Promise<RetrieveResult | null> {
    if (!config.retrieval.enabled) {
      return null;
    }

    if (!opts.queries || opts.queries.length === 0) {
      return null;
    }

    const logger = opts.logger;
    const topK = opts.topK ?? config.retrieval.topK;
    const distanceThreshold = opts.distanceThreshold ?? config.retrieval.distanceThreshold;
    const adaptive = opts.adaptive ?? config.retrieval.adaptive;
    const maxContextChars = opts.maxContextChars ?? config.retrieval.maxContextChars;
    const prLanguages = opts.prLanguages ?? [];
    const triggerType = opts.triggerType ?? "pr_review";
    const intentQuery = opts.queries[0]!;

    try {
      // Step 1: Build variants from query strings
      const variants = opts.queries.map((query, index) => ({
        type: (VARIANT_TYPE_SEQUENCE[index] ?? "intent") as MultiQueryVariantType,
        query,
        priority: Math.min(index, 2),
      }));

      // Step 2: Execute retrieval variants for learning memories (vector search)
      const maxVariantConcurrency = 2;
      const variantTopK = Math.max(1, Math.ceil(topK / Math.max(variants.length, 1)));

      // Step 3: Parallel fan-out — all 7 searches (4 vector + 3 BM25) at once
      const [
        variantResults,
        reviewVectorResult,
        wikiVectorResult,
        memoryFullTextResult,
        reviewFullTextResult,
        wikiFullTextResult,
        snippetVectorResult,
        issueVectorResult,
        issueFullTextResult,
      ] = await Promise.allSettled([
        // (a) Learning memory vector search (multi-variant)
        executeRetrievalVariants({
          variants,
          maxConcurrency: maxVariantConcurrency,
          execute: async (variant) => {
            const embedResult = await embeddingProvider.generate(variant.query, "query");
            if (!embedResult) {
              throw new Error(`Embedding unavailable for ${variant.type} retrieval variant`);
            }
            const retrieval = await isolationLayer.retrieveWithIsolation({
              queryEmbedding: embedResult.embedding,
              repo: opts.repo,
              owner: opts.owner,
              sharingEnabled: config.sharing.enabled,
              topK: variantTopK,
              distanceThreshold,
              adaptive,
              logger,
            });
            return retrieval.results;
          },
        }),
        // (b) Review comment vector search
        deps.reviewCommentStore
          ? searchReviewComments({
              store: deps.reviewCommentStore,
              embeddingProvider: deps.embeddingProvider,
              query: intentQuery,
              repo: opts.repo,
              topK: 5,
              logger: opts.logger,
            })
          : Promise.resolve([] as ReviewCommentMatch[]),
        // (c) Wiki vector search
        deps.wikiPageStore
          ? searchWikiPages({
              store: deps.wikiPageStore,
              embeddingProvider: deps.embeddingProvider,
              query: intentQuery,
              topK: 5,
              logger: opts.logger,
            })
          : Promise.resolve([] as WikiKnowledgeMatch[]),
        // (d) Learning memory BM25 full-text search
        deps.memoryStore?.searchByFullText
          ? deps.memoryStore.searchByFullText({
              query: intentQuery,
              repo: opts.repo,
              topK: variantTopK,
            })
          : Promise.resolve([] as { memoryId: number; rank: number }[]),
        // (e) Review comment BM25 full-text search
        deps.reviewCommentStore?.searchByFullText
          ? deps.reviewCommentStore.searchByFullText({
              query: intentQuery,
              repo: opts.repo,
              topK: 5,
            })
          : Promise.resolve([]),
        // (f) Wiki BM25 full-text search
        deps.wikiPageStore?.searchByFullText
          ? deps.wikiPageStore.searchByFullText({
              query: intentQuery,
              topK: 5,
            })
          : Promise.resolve([]),
        // (g) Code snippet vector search
        deps.codeSnippetStore
          ? searchCodeSnippets({
              store: deps.codeSnippetStore,
              embeddingProvider: deps.embeddingProvider,
              query: intentQuery,
              repo: opts.repo,
              topK: 5,
              logger: opts.logger,
            })
          : Promise.resolve([] as CodeSnippetMatch[]),
        // (h) Issue vector search
        deps.issueStore
          ? searchIssues({
              store: deps.issueStore,
              embeddingProvider: deps.embeddingProvider,
              query: intentQuery,
              repo: opts.repo,
              topK: 5,
              logger: opts.logger,
            })
          : Promise.resolve([] as IssueKnowledgeMatch[]),
        // (i) Issue BM25 full-text search
        deps.issueStore?.searchByFullText
          ? deps.issueStore.searchByFullText({
              query: intentQuery,
              repo: opts.repo,
              topK: 5,
            })
          : Promise.resolve([]),
      ]);

      // Extract settled results (fail-open)
      const resultsByVariant =
        variantResults.status === "fulfilled" ? variantResults.value : [];
      const reviewPrecedents =
        reviewVectorResult.status === "fulfilled" ? reviewVectorResult.value : [];
      const wikiKnowledge =
        wikiVectorResult.status === "fulfilled" ? wikiVectorResult.value : [];
      const snippetResults =
        snippetVectorResult.status === "fulfilled" ? snippetVectorResult.value : [];

      // Log failures
      if (variantResults.status === "rejected") {
        logger.warn({ err: variantResults.reason }, "Learning memory variant search failed (fail-open)");
      }
      if (reviewVectorResult.status === "rejected") {
        logger.warn({ err: reviewVectorResult.reason }, "Review comment vector search failed (fail-open)");
      }
      if (wikiVectorResult.status === "rejected") {
        logger.warn({ err: wikiVectorResult.reason }, "Wiki vector search failed (fail-open)");
      }
      if (snippetVectorResult.status === "rejected") {
        logger.warn({ err: snippetVectorResult.reason }, "Code snippet vector search failed (fail-open)");
      }

      const issueResults =
        issueVectorResult.status === "fulfilled" ? issueVectorResult.value : [];
      if (issueVectorResult.status === "rejected") {
        logger.warn({ err: issueVectorResult.reason }, "Issue vector search failed (fail-open)");
      }
      if (issueFullTextResult.status === "rejected") {
        logger.warn({ err: issueFullTextResult.reason }, "Issue BM25 full-text search failed (fail-open)");
      }

      // Log variant-level failures
      if (Array.isArray(resultsByVariant)) {
        for (const failed of resultsByVariant.filter((v) => v.error)) {
          logger.warn(
            { variant: failed.variant.type, err: failed.error },
            "Retrieval variant failed (fail-open)",
          );
        }
      }

      // Step 4: Process learning memory results (legacy pipeline)
      const mergedResults = mergeVariantResults({
        resultsByVariant: Array.isArray(resultsByVariant) ? resultsByVariant : [],
        topK,
      });

      const languageReranked = mergedResults.length > 0
        ? rerankByLanguage({ results: mergedResults, prLanguages })
        : [];

      const reranked = languageReranked.length > 0
        ? applyRecencyWeighting({ results: languageReranked })
        : [];

      // Adaptive threshold
      let thresholdMethod = "configured";
      let thresholdValue = distanceThreshold;
      let finalReranked = reranked.slice(0, topK);

      if (adaptive && reranked.length > 0) {
        const distances = reranked.map((r) => r.adjustedDistance);
        const adaptiveResult = computeAdaptiveThreshold({
          distances,
          configuredThreshold: distanceThreshold,
        });

        thresholdMethod = adaptiveResult.method;
        thresholdValue = adaptiveResult.threshold;

        const thresholdFiltered = reranked.filter(
          (r) => r.adjustedDistance <= adaptiveResult.threshold,
        );
        finalReranked = thresholdFiltered.slice(0, topK);
      }

      // Step 5: Snippet anchoring (legacy)
      let snippetAnchors: SnippetAnchor[] = [];
      if (opts.workspaceDir && finalReranked.length > 0) {
        snippetAnchors = await buildSnippetAnchors({
          workspaceDir: opts.workspaceDir,
          findings: finalReranked as RetrievalResult[],
        });
        snippetAnchors = trimSnippetAnchorsToBudget({
          anchors: snippetAnchors,
          maxChars: maxContextChars,
          maxItems: topK,
        });
      }

      // ============================================
      // Step 6: Unified cross-corpus pipeline (NEW)
      // ============================================

      // 6a: Normalize all results to UnifiedRetrievalChunk
      const codeChunks = finalReranked.map((r) => memoryToUnified(r as unknown as MergedRetrievalResult));
      const reviewChunks = reviewPrecedents.map((m) => reviewMatchToUnified(m, opts.repo));
      const wikiChunks = wikiKnowledge.map(wikiMatchToUnified);
      const snippetChunks = snippetResults.map((m) => snippetToUnified(m, opts.repo));
      const issueChunks = issueResults.map((m) => issueMatchToUnified(m, opts.repo));

      // 6b: Per-corpus hybrid merge (vector + BM25 via RRF)
      // Review comments: merge vector + BM25
      const reviewBm25 =
        reviewFullTextResult.status === "fulfilled"
          ? reviewFullTextResult.value.map((r) => {
              const record = (r as { record?: unknown }).record;
              if (record && typeof record === "object" && "chunkText" in record) {
                const rec = record as { chunkText: string; prNumber?: number; filePath?: string; authorLogin?: string; authorAssociation?: string | null; githubCreatedAt?: string; prTitle?: string | null; startLine?: number | null; endLine?: number | null };
                return reviewMatchToUnified(
                  {
                    chunkText: rec.chunkText,
                    distance: 1 - Number((r as { distance?: number }).distance ?? 0),
                    repo: opts.repo,
                    prNumber: rec.prNumber ?? 0,
                    prTitle: rec.prTitle ?? null,
                    filePath: rec.filePath ?? null,
                    authorLogin: rec.authorLogin ?? "unknown",
                    authorAssociation: rec.authorAssociation ?? null,
                    githubCreatedAt: rec.githubCreatedAt ?? "",
                    startLine: rec.startLine ?? null,
                    endLine: rec.endLine ?? null,
                    source: "review_comment",
                  },
                  opts.repo,
                );
              }
              return null;
            }).filter((x): x is UnifiedRetrievalChunk => x !== null)
          : [];

      const hybridReview = hybridSearchMerge({
        vectorResults: reviewChunks,
        bm25Results: reviewBm25,
        getKey: (c) => c.id,
        k: RRF_K,
      });

      // Wiki: merge vector + BM25
      const wikiBm25 =
        wikiFullTextResult.status === "fulfilled"
          ? wikiFullTextResult.value.map((r) => {
              const record = (r as { record?: unknown }).record;
              if (record && typeof record === "object" && "chunkText" in record) {
                const rec = record as { chunkText: string; pageId?: number; pageTitle?: string; namespace?: string; pageUrl?: string; sectionHeading?: string | null; sectionAnchor?: string | null; lastModified?: string | null; languageTags?: string[] };
                return wikiMatchToUnified({
                  chunkText: rec.chunkText,
                  rawText: rec.chunkText,
                  distance: 1 - Number((r as { distance?: number }).distance ?? 0),
                  pageId: rec.pageId ?? 0,
                  pageTitle: rec.pageTitle ?? "",
                  namespace: rec.namespace ?? "",
                  pageUrl: rec.pageUrl ?? "",
                  sectionHeading: rec.sectionHeading ?? null,
                  sectionAnchor: rec.sectionAnchor ?? null,
                  lastModified: rec.lastModified ?? null,
                  source: "wiki",
                  languageTags: rec.languageTags ?? [],
                });
              }
              return null;
            }).filter((x): x is UnifiedRetrievalChunk => x !== null)
          : [];

      const hybridWiki = hybridSearchMerge({
        vectorResults: wikiChunks,
        bm25Results: wikiBm25,
        getKey: (c) => c.id,
        k: RRF_K,
      });

      // Issue: merge vector + BM25
      const issueBm25 =
        issueFullTextResult.status === "fulfilled"
          ? issueFullTextResult.value.map((r) => {
              const record = (r as { record?: unknown }).record;
              if (record && typeof record === "object" && "issueNumber" in record) {
                const rec = record as { issueNumber: number; title: string; body?: string | null; repo: string; state: string; authorLogin: string; githubCreatedAt: string };
                return issueMatchToUnified(
                  {
                    chunkText: `#${rec.issueNumber} ${rec.title}\n\n${(rec.body ?? "").slice(0, 2000)}`,
                    distance: 1 - Number((r as { distance?: number }).distance ?? 0),
                    repo: rec.repo,
                    issueNumber: rec.issueNumber,
                    title: rec.title,
                    state: rec.state,
                    authorLogin: rec.authorLogin,
                    githubCreatedAt: rec.githubCreatedAt,
                    source: "issue",
                  },
                  opts.repo,
                );
              }
              return null;
            }).filter((x): x is UnifiedRetrievalChunk => x !== null)
          : [];

      const hybridIssue = hybridSearchMerge({
        vectorResults: issueChunks,
        bm25Results: issueBm25,
        getKey: (c) => c.id,
        k: RRF_K,
      });

      // Code: for now, use vector-only (learning memories have BM25 but the
      // multi-variant pipeline already provides good coverage)
      const hybridCode = codeChunks;

      // 6c: Within-corpus dedup (prevents duplicate inflation per CONTEXT.md)
      const dedupedCode = deduplicateChunks({
        chunks: hybridCode,
        similarityThreshold: DEDUP_THRESHOLD,
        mode: "within-corpus",
      });
      const dedupedReview = deduplicateChunks({
        chunks: hybridReview.map((h) => h.item),
        similarityThreshold: DEDUP_THRESHOLD,
        mode: "within-corpus",
      });
      const dedupedWiki = deduplicateChunks({
        chunks: hybridWiki.map((h) => h.item),
        similarityThreshold: DEDUP_THRESHOLD,
        mode: "within-corpus",
      });
      const dedupedSnippets = deduplicateChunks({
        chunks: snippetChunks,
        similarityThreshold: DEDUP_THRESHOLD,
        mode: "within-corpus",
      });
      const dedupedIssues = deduplicateChunks({
        chunks: hybridIssue.map((h) => h.item),
        similarityThreshold: DEDUP_THRESHOLD,
        mode: "within-corpus",
      });

      // 6d: Cross-corpus RRF
      const sourceLists: RankedSourceList[] = [];
      if (dedupedCode.length > 0) {
        sourceLists.push({ source: "code", items: dedupedCode });
      }
      if (dedupedReview.length > 0) {
        sourceLists.push({ source: "review_comment", items: dedupedReview });
      }
      if (dedupedWiki.length > 0) {
        sourceLists.push({ source: "wiki", items: dedupedWiki });
      }
      if (dedupedSnippets.length > 0) {
        sourceLists.push({ source: "snippet", items: dedupedSnippets });
      }
      if (dedupedIssues.length > 0) {
        sourceLists.push({ source: "issue", items: dedupedIssues });
      }

      let unifiedResults = crossCorpusRRF({
        sourceLists,
        k: RRF_K,
        topK: topK * 2, // get more than needed before applying source weights
      });

      // 6e: Apply context-dependent source weights
      const weights = SOURCE_WEIGHTS[triggerType] ?? SOURCE_WEIGHTS.slack;
      for (const chunk of unifiedResults) {
        const weight = weights[chunk.source] ?? 1.0;
        chunk.rrfScore *= weight;
      }

      // 6e-bis: Apply language-aware boost to unified results (LANG-03/LANG-04)
      // Single location for language weighting — unified pipeline only.
      // Legacy rerankByLanguage in step 4 only affects findings[] output (backward compat).
      // Policy: boost-only — non-matching results NEVER penalized.
      const langWeightMap = buildProportionalLanguageWeights(prLanguages);
      if (langWeightMap.size > 0) {
        for (const chunk of unifiedResults) {
          const chunkLang = getChunkLanguage(chunk);
          if (!chunkLang || chunkLang === "unknown" || chunkLang === "general") continue;

          let boost = 0;
          if (langWeightMap.has(chunkLang)) {
            // Exact match: boost proportional to that language's share of PR changes
            boost = langWeightMap.get(chunkLang)! * LANGUAGE_BOOST_FACTOR;
          } else if (hasRelatedLanguage(chunkLang, langWeightMap)) {
            // Related language: fraction of exact match boost
            boost = getMaxRelatedWeight(chunkLang, langWeightMap) * LANGUAGE_BOOST_FACTOR * LANGUAGE_AFFINITY_RATIO;
          }
          // else: no match — no change to score (NEVER penalize)

          if (boost > 0) {
            chunk.rrfScore *= (1 + boost);
          }
        }
      }

      unifiedResults.sort((a, b) => b.rrfScore - a.rrfScore);
      unifiedResults = unifiedResults.slice(0, topK);

      // 6f: Cross-corpus dedup
      unifiedResults = deduplicateChunks({
        chunks: unifiedResults,
        similarityThreshold: DEDUP_THRESHOLD,
        mode: "cross-corpus",
      });

      // 6g: Context assembly
      const contextWindow = assembleContextWindow(unifiedResults, maxContextChars);

      // Compute provenance
      const totalCandidates = (Array.isArray(resultsByVariant) ? resultsByVariant : []).reduce((sum, v) => {
        return sum + (v.results?.length ?? 0);
      }, 0);

      const sharedPoolUsed = (Array.isArray(resultsByVariant) ? resultsByVariant : []).some((v) =>
        v.results?.some((r) => r.sourceRepo !== `${opts.repo}`),
      );

      return {
        findings: finalReranked as unknown as MergedRetrievalResult[],
        snippetAnchors,
        reviewPrecedents,
        wikiKnowledge,
        unifiedResults,
        contextWindow,
        provenance: {
          queryCount: opts.queries.length,
          candidateCount: totalCandidates,
          sharedPoolUsed,
          thresholdMethod,
          thresholdValue,
          reviewCommentCount: reviewPrecedents.length,
          wikiPageCount: wikiKnowledge.length,
          snippetCount: snippetResults.length,
          issueCount: issueResults.length,
          unifiedResultCount: unifiedResults.length,
          hybridSearchUsed: true,
          rrfK: RRF_K,
          dedupThreshold: DEDUP_THRESHOLD,
          triggerType,
        },
      };
    } catch (err) {
      logger.warn({ err }, "Retrieval pipeline failed (fail-open)");
      return null;
    }
  }

  return { retrieve };
}
