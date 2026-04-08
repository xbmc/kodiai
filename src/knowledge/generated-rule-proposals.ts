import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { MemoryOutcome } from "./types.ts";
import type { GeneratedRuleProposal } from "./generated-rule-store.ts";
import { cosineSimilarity } from "./cluster-pipeline.ts";

const DEFAULT_LOOKBACK_DAYS = 180;
const DEFAULT_SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_MIN_CLUSTER_SIZE = 5;
const DEFAULT_MIN_POSITIVE_MEMBERS = 5;
const DEFAULT_MIN_POSITIVE_RATIO = 0.6;
const DEFAULT_MAX_PROPOSALS = 10;
const DEFAULT_MAX_INPUT_MEMORIES = 250;
const DEFAULT_MAX_TEXT_INPUT_CHARS = 240;
const DEFAULT_MAX_TITLE_CHARS = 80;
const DEFAULT_MAX_RULE_TEXT_CHARS = 200;
const DEFAULT_MIN_TEXT_CHARS = 24;
const DEFAULT_MIN_WORD_COUNT = 4;

const POSITIVE_OUTCOMES = ["accepted", "thumbs_up"] as const satisfies readonly MemoryOutcome[];
const NEGATIVE_OUTCOMES = ["suppressed", "thumbs_down"] as const satisfies readonly MemoryOutcome[];

export type GeneratedRuleProposalCandidate = GeneratedRuleProposal & {
  clusterSize: number;
  positiveCount: number;
  negativeCount: number;
  acceptedCount: number;
  thumbsUpCount: number;
  positiveRatio: number;
  representativeMemoryId: number;
  representativeFindingText: string;
};

export type GeneratePendingRuleProposalsOptions = {
  sql: Sql;
  logger: Logger;
  repo: string;
  lookbackDays?: number;
  similarityThreshold?: number;
  minClusterSize?: number;
  minPositiveMembers?: number;
  minPositiveRatio?: number;
  maxProposals?: number;
  maxInputMemories?: number;
  maxTextInputChars?: number;
  maxTitleChars?: number;
  maxRuleTextChars?: number;
  minTextChars?: number;
  minWordCount?: number;
};

type LearningMemoryClusterRow = {
  id: number;
  outcome: MemoryOutcome;
  findingText: string;
  filePath: string;
  embedding: Float32Array;
  createdAt: string;
};

type MemoryCluster = {
  members: LearningMemoryClusterRow[];
  centroid: Float32Array;
};

type LearningMemoryRow = {
  id: number;
  outcome: string;
  finding_text: string;
  file_path: string;
  embedding: unknown;
  created_at: string;
};

function parseEmbedding(raw: unknown): Float32Array | null {
  if (raw instanceof Float32Array) return raw;
  if (typeof raw === "string") {
    const values = raw
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((value) => Number(value.trim()));
    if (values.length === 0 || values.some((value) => Number.isNaN(value))) {
      return null;
    }
    return new Float32Array(values);
  }
  return null;
}

function meanEmbedding(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(0);
  const dimension = embeddings[0]!.length;
  const result = new Float32Array(dimension);
  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      result[i]! += embedding[i]!;
    }
  }
  for (let i = 0; i < dimension; i++) {
    result[i]! /= embeddings.length;
  }
  return result;
}

function isPositiveOutcome(outcome: MemoryOutcome): boolean {
  return (POSITIVE_OUTCOMES as readonly string[]).includes(outcome);
}

function isNegativeOutcome(outcome: MemoryOutcome): boolean {
  return (NEGATIVE_OUTCOMES as readonly string[]).includes(outcome);
}

function sanitizeProposalTextInput(text: string, maxChars: number): string {
  const sanitized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[\s>*#-]+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return truncateAtWordBoundary(sanitized, maxChars);
}

function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 24 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

function buildProposalTitle(text: string, maxChars: number): string {
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  const withoutTrailingPunctuation = firstSentence.replace(/[.!?]+$/, "").trim();
  return truncateAtWordBoundary(withoutTrailingPunctuation, maxChars);
}

function buildProposalRuleText(text: string, maxChars: number): string {
  const truncated = truncateAtWordBoundary(text, maxChars);
  if (!truncated) return truncated;
  return /[.!?]$/.test(truncated) ? truncated : `${truncated}.`;
}

function hasEnoughSignalText(text: string, minTextChars: number, minWordCount: number): boolean {
  if (text.length < minTextChars) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= minWordCount;
}

function buildClusters(
  memories: LearningMemoryClusterRow[],
  similarityThreshold: number,
): MemoryCluster[] {
  const clusters: MemoryCluster[] = [];

  for (const memory of memories) {
    let bestCluster: MemoryCluster | null = null;
    let bestSimilarity = -1;

    for (const cluster of clusters) {
      if (cluster.centroid.length !== memory.embedding.length || cluster.centroid.length === 0) {
        continue;
      }
      const similarity = cosineSimilarity(memory.embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestSimilarity >= similarityThreshold) {
      bestCluster.members.push(memory);
      bestCluster.centroid = meanEmbedding(bestCluster.members.map((member) => member.embedding));
    } else {
      clusters.push({
        members: [memory],
        centroid: new Float32Array(memory.embedding),
      });
    }
  }

  return clusters;
}

function roundScore(score: number): number {
  return Number(score.toFixed(3));
}

function computeSignalScore(positiveCount: number, clusterSize: number, minPositiveMembers: number): number {
  if (clusterSize === 0 || positiveCount === 0) return 0;
  const positiveRatio = positiveCount / clusterSize;
  const supportScore = Math.min(1, positiveCount / (minPositiveMembers * 2));
  return roundScore(positiveRatio * supportScore);
}

export async function generatePendingRuleProposals(
  opts: GeneratePendingRuleProposalsOptions,
): Promise<GeneratedRuleProposalCandidate[]> {
  const {
    sql,
    logger,
    repo,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    minClusterSize = DEFAULT_MIN_CLUSTER_SIZE,
    minPositiveMembers = DEFAULT_MIN_POSITIVE_MEMBERS,
    minPositiveRatio = DEFAULT_MIN_POSITIVE_RATIO,
    maxProposals = DEFAULT_MAX_PROPOSALS,
    maxInputMemories = DEFAULT_MAX_INPUT_MEMORIES,
    maxTextInputChars = DEFAULT_MAX_TEXT_INPUT_CHARS,
    maxTitleChars = DEFAULT_MAX_TITLE_CHARS,
    maxRuleTextChars = DEFAULT_MAX_RULE_TEXT_CHARS,
    minTextChars = DEFAULT_MIN_TEXT_CHARS,
    minWordCount = DEFAULT_MIN_WORD_COUNT,
  } = opts;

  try {
    const rows = await sql`
      SELECT id, outcome, finding_text, file_path, embedding, created_at
      FROM learning_memories
      WHERE repo = ${repo}
        AND stale = false
        AND embedding IS NOT NULL
        AND created_at >= NOW() - (${lookbackDays} * INTERVAL '1 day')
      ORDER BY created_at DESC
      LIMIT ${maxInputMemories}
    `;

    const memories: LearningMemoryClusterRow[] = [];
    for (const rawRow of rows) {
      const row = rawRow as unknown as LearningMemoryRow;
      const embedding = parseEmbedding(row.embedding);
      if (!embedding || embedding.length === 0) continue;
      memories.push({
        id: Number(row.id),
        outcome: row.outcome as MemoryOutcome,
        findingText: row.finding_text,
        filePath: row.file_path,
        embedding,
        createdAt: row.created_at,
      });
    }

    if (memories.length < minClusterSize) {
      logger.info(
        { repo, memoryCount: memories.length, minClusterSize },
        "Skipped generated-rule proposals: too few clustered memories",
      );
      return [];
    }

    const clusters = buildClusters(memories, similarityThreshold);
    const proposals: GeneratedRuleProposalCandidate[] = [];

    for (const [clusterIndex, cluster] of clusters.entries()) {
      const clusterSize = cluster.members.length;
      const positiveMembers = cluster.members.filter((member) => isPositiveOutcome(member.outcome));
      const acceptedCount = positiveMembers.filter((member) => member.outcome === "accepted").length;
      const thumbsUpCount = positiveMembers.filter((member) => member.outcome === "thumbs_up").length;
      const positiveCount = positiveMembers.length;
      const negativeCount = cluster.members.filter((member) => isNegativeOutcome(member.outcome)).length;
      const positiveRatio = clusterSize === 0 ? 0 : positiveCount / clusterSize;

      if (clusterSize < minClusterSize) {
        logger.info(
          { repo, clusterIndex, clusterSize, reason: "cluster-too-small" },
          "Skipped generated-rule proposal cluster",
        );
        continue;
      }

      if (positiveCount < minPositiveMembers) {
        logger.info(
          { repo, clusterIndex, clusterSize, positiveCount, reason: "insufficient-positive-members" },
          "Skipped generated-rule proposal cluster",
        );
        continue;
      }

      if (positiveRatio < minPositiveRatio) {
        logger.info(
          {
            repo,
            clusterIndex,
            clusterSize,
            positiveCount,
            negativeCount,
            positiveRatio: roundScore(positiveRatio),
            reason: "low-positive-ratio",
          },
          "Skipped generated-rule proposal cluster",
        );
        continue;
      }

      let representative: LearningMemoryClusterRow | null = null;
      let representativeSimilarity = -1;
      for (const member of positiveMembers) {
        const similarity = cosineSimilarity(member.embedding, cluster.centroid);
        if (similarity > representativeSimilarity) {
          representative = member;
          representativeSimilarity = similarity;
        }
      }

      if (!representative) {
        logger.info(
          { repo, clusterIndex, clusterSize, positiveCount, reason: "no-representative-positive-member" },
          "Skipped generated-rule proposal cluster",
        );
        continue;
      }

      const representativeText = sanitizeProposalTextInput(representative.findingText, maxTextInputChars);
      if (!hasEnoughSignalText(representativeText, minTextChars, minWordCount)) {
        logger.info(
          {
            repo,
            clusterIndex,
            clusterSize,
            positiveCount,
            representativeMemoryId: representative.id,
            reason: "insufficient-proposal-text",
          },
          "Skipped generated-rule proposal cluster",
        );
        continue;
      }

      const title = buildProposalTitle(representativeText, maxTitleChars);
      const ruleText = buildProposalRuleText(representativeText, maxRuleTextChars);
      if (!title || !ruleText) {
        logger.info(
          {
            repo,
            clusterIndex,
            clusterSize,
            positiveCount,
            representativeMemoryId: representative.id,
            reason: "empty-proposal-text",
          },
          "Skipped generated-rule proposal cluster",
        );
        continue;
      }

      const signalScore = computeSignalScore(positiveCount, clusterSize, minPositiveMembers);
      proposals.push({
        repo,
        title,
        ruleText,
        signalScore,
        memberCount: positiveCount,
        clusterCentroid: cluster.centroid,
        clusterSize,
        positiveCount,
        negativeCount,
        acceptedCount,
        thumbsUpCount,
        positiveRatio: roundScore(positiveRatio),
        representativeMemoryId: representative.id,
        representativeFindingText: representativeText,
      });

      logger.info(
        {
          repo,
          clusterIndex,
          clusterSize,
          positiveCount,
          negativeCount,
          signalScore,
          representativeMemoryId: representative.id,
        },
        "Generated pending rule proposal candidate",
      );
    }

    proposals.sort((a, b) => b.signalScore - a.signalScore || b.memberCount - a.memberCount);
    const bounded = proposals.slice(0, maxProposals);

    logger.info(
      {
        repo,
        clusterCount: clusters.length,
        proposalCount: bounded.length,
        skippedClusterCount: clusters.length - proposals.length,
      },
      "Generated pending rule proposals",
    );

    return bounded;
  } catch (err) {
    logger.warn({ err, repo }, "Generated-rule proposal generation failed (fail-open)");
    return [];
  }
}
