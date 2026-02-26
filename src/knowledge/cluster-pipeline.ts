/**
 * Cluster pipeline: UMAP dimensionality reduction + HDBSCAN clustering
 * + LLM label generation on review comment embeddings.
 *
 * Flow:
 * 1. Fetch 6-month review comment embeddings from Postgres
 * 2. Incremental merge: assign new embeddings to existing clusters
 * 3. UMAP reduce remaining embeddings to 15 dimensions
 * 4. HDBSCAN cluster the reduced data
 * 5. LLM-generate two-layer labels (slug + description)
 * 6. Persist clusters and assignments
 * 7. Retire stale clusters (< 3 members in 60-day window)
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { TaskRouter } from "../llm/task-router.ts";
import type { ClusterStore, ClusterRunState, ReviewCluster } from "./cluster-types.ts";
import { hdbscan } from "./hdbscan.ts";
import { generateWithFallback } from "../llm/generate.ts";
import { TASK_TYPES } from "../llm/task-types.ts";
import { UMAP } from "umap-js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_MIN_CLUSTER_SIZE = 3;
const UMAP_N_COMPONENTS = 15;
const UMAP_N_NEIGHBORS = 15;
const UMAP_MIN_DIST = 0.0;
const INCREMENTAL_MERGE_THRESHOLD = 0.5; // cosine similarity threshold
const LABEL_REGEN_THRESHOLD = 0.2; // 20% membership change triggers relabel
const REPRESENTATIVE_SAMPLE_COUNT = 5;
const RETIREMENT_MEMBER_THRESHOLD = 3;

// ── Seeded Random ────────────────────────────────────────────────────

/** Simple LCG for reproducible UMAP results. */
function seedRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Cosine similarity between two Float32Arrays. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Parse pgvector string to Float32Array. */
function parseEmbedding(raw: unknown): Float32Array | null {
  if (raw instanceof Float32Array) return raw;
  if (typeof raw === "string") {
    const nums = raw
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map(Number);
    if (nums.some(isNaN)) return null;
    return new Float32Array(nums);
  }
  return null;
}

/** Compute mean of Float32Arrays. */
function meanEmbedding(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array(0);
  const dim = embeddings[0]!.length;
  const result = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i]! += emb[i]!;
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i]! /= embeddings.length;
  }
  return result;
}

type EmbeddingRow = {
  id: number;
  embedding: Float32Array;
  filePath: string | null;
  chunkText: string;
  githubCreatedAt: string;
};

// ── Pipeline ─────────────────────────────────────────────────────────

export async function runClusterPipeline(opts: {
  sql: Sql;
  store: ClusterStore;
  taskRouter: TaskRouter;
  logger: Logger;
  repo: string;
  minClusterSize?: number;
}): Promise<ClusterRunState> {
  const { sql, store, taskRouter, logger, repo } = opts;
  const minClusterSize = opts.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE;

  // Save running state
  const runState: ClusterRunState = {
    lastRunAt: new Date(),
    clustersDiscovered: 0,
    commentsProcessed: 0,
    labelsGenerated: 0,
    status: "running",
    errorMessage: null,
  };

  try {
    await store.saveRunState(runState);

    // Step 1: Fetch embeddings from 6-month window
    const rows = await sql`
      SELECT id, embedding, file_path, chunk_text, github_created_at
      FROM review_comments
      WHERE repo = ${repo}
        AND deleted = false
        AND stale = false
        AND embedding IS NOT NULL
        AND github_created_at >= NOW() - INTERVAL '6 months'
      ORDER BY github_created_at DESC
    `;

    const embeddings: EmbeddingRow[] = [];
    for (const row of rows) {
      const emb = parseEmbedding(row.embedding);
      if (emb && emb.length > 0) {
        embeddings.push({
          id: row.id as number,
          embedding: emb,
          filePath: (row.file_path as string) ?? null,
          chunkText: row.chunk_text as string,
          githubCreatedAt: row.github_created_at as string,
        });
      }
    }

    runState.commentsProcessed = embeddings.length;
    logger.info({ repo, embeddingCount: embeddings.length }, "Fetched embeddings for clustering");

    // Step 2: Check threshold
    if (embeddings.length < minClusterSize) {
      runState.status = "completed";
      await store.saveRunState(runState);
      logger.info({ repo, count: embeddings.length, minClusterSize }, "Too few embeddings for clustering");
      return runState;
    }

    // Step 3: Load existing clusters for incremental merge
    const existingClusters = await store.getActiveClusters(repo);

    // Step 4: Incremental merge
    let poolForClustering = embeddings;
    const mergedAssignments: Array<{ clusterId: number; embRow: EmbeddingRow; similarity: number }> = [];

    if (existingClusters.length > 0) {
      const unassigned: EmbeddingRow[] = [];

      for (const emb of embeddings) {
        let bestCluster: ReviewCluster | null = null;
        let bestSim = -1;

        for (const cluster of existingClusters) {
          if (cluster.centroid.length === 0) continue;
          const sim = cosineSimilarity(emb.embedding, cluster.centroid);
          if (sim > bestSim) {
            bestSim = sim;
            bestCluster = cluster;
          }
        }

        if (bestCluster && bestSim >= INCREMENTAL_MERGE_THRESHOLD) {
          mergedAssignments.push({
            clusterId: bestCluster.id,
            embRow: emb,
            similarity: bestSim,
          });
        } else {
          unassigned.push(emb);
        }
      }

      // Write merged assignments
      if (mergedAssignments.length > 0) {
        // Group by cluster to update centroids
        const byCluster = new Map<number, EmbeddingRow[]>();
        for (const m of mergedAssignments) {
          if (!byCluster.has(m.clusterId)) byCluster.set(m.clusterId, []);
          byCluster.get(m.clusterId)!.push(m.embRow);
        }

        for (const [clusterId, newMembers] of byCluster) {
          const cluster = existingClusters.find((c) => c.id === clusterId);
          if (!cluster) continue;

          // Update centroid with new members
          const allEmbeddings = [cluster.centroid, ...newMembers.map((m) => m.embedding)];
          const newCentroid = meanEmbedding(allEmbeddings);
          const newMemberCount = cluster.memberCount + newMembers.length;
          const newFilePaths = [
            ...new Set([
              ...cluster.filePaths,
              ...newMembers.map((m) => m.filePath).filter((p): p is string => p !== null),
            ]),
          ];

          await store.upsertCluster({
            ...cluster,
            centroid: newCentroid,
            memberCount: newMemberCount,
            filePaths: newFilePaths,
          });

          await store.writeAssignments(
            newMembers.map((m) => ({
              clusterId,
              reviewCommentId: m.id,
              probability: 0.8, // Assigned via merge, moderate confidence
            })),
          );
        }
      }

      // Use unassigned pool for new cluster discovery
      poolForClustering = unassigned.length >= minClusterSize ? unassigned : [];

      logger.info(
        { repo, merged: mergedAssignments.length, unassigned: unassigned.length },
        "Incremental merge complete",
      );
    }

    // Step 5: UMAP + HDBSCAN on remaining pool
    let newClustersCount = 0;

    if (poolForClustering.length >= minClusterSize) {
      // UMAP reduction
      const rawData = poolForClustering.map((e) => Array.from(e.embedding));
      const nComponents = Math.min(UMAP_N_COMPONENTS, poolForClustering.length - 1);
      const nNeighbors = Math.min(UMAP_N_NEIGHBORS, poolForClustering.length - 1);

      const umap = new UMAP({
        nComponents,
        nNeighbors,
        minDist: UMAP_MIN_DIST,
        random: seedRandom(42),
      });

      const reduced = umap.fit(rawData);

      logger.info(
        { repo, points: reduced.length, nComponents, nNeighbors },
        "UMAP reduction complete",
      );

      // HDBSCAN clustering
      const result = hdbscan(reduced, { minClusterSize });

      logger.info(
        { repo, clusterCount: result.clusterCount, noiseCount: result.labels.filter((l) => l === -1).length },
        "HDBSCAN clustering complete",
      );

      // Build and persist new clusters
      if (result.clusterCount > 0) {
        // Group points by cluster
        const clusterMembers = new Map<number, Array<{ idx: number; prob: number }>>();
        for (let i = 0; i < result.labels.length; i++) {
          const label = result.labels[i]!;
          if (label < 0) continue;
          if (!clusterMembers.has(label)) clusterMembers.set(label, []);
          clusterMembers.get(label)!.push({ idx: i, prob: result.probabilities[i]! });
        }

        for (const [clusterLabel, members] of clusterMembers) {
          const memberEmbeddings = members.map((m) => poolForClustering[m.idx]!.embedding);
          const centroid = meanEmbedding(memberEmbeddings);
          const filePaths = [
            ...new Set(
              members
                .map((m) => poolForClustering[m.idx]!.filePath)
                .filter((p): p is string => p !== null),
            ),
          ];

          // Generate label via LLM
          const sortedMembers = [...members].sort((a, b) => b.prob - a.prob);
          const representatives = sortedMembers
            .slice(0, REPRESENTATIVE_SAMPLE_COUNT)
            .map((m) => poolForClustering[m.idx]!.chunkText);

          const { slug, description } = await generateClusterLabel(
            representatives,
            taskRouter,
            logger,
            repo,
          );

          const cluster = await store.upsertCluster({
            repo,
            slug,
            label: description,
            centroid,
            memberCount: members.length,
            memberCountAtLabel: members.length,
            filePaths,
            labelUpdatedAt: new Date(),
            pinned: false,
            retired: false,
          });

          // Write assignments
          await store.writeAssignments(
            members.map((m) => ({
              clusterId: cluster.id,
              reviewCommentId: poolForClustering[m.idx]!.id,
              probability: m.prob,
            })),
          );

          newClustersCount++;
          runState.labelsGenerated++;
        }
      }
    }

    // Step 6: Check label regeneration for existing clusters
    for (const cluster of existingClusters) {
      if (cluster.pinned) continue;
      if (cluster.memberCountAtLabel === 0) continue;

      const changeRatio = Math.abs(cluster.memberCount - cluster.memberCountAtLabel) / cluster.memberCountAtLabel;
      if (changeRatio > LABEL_REGEN_THRESHOLD) {
        // Fetch representative samples for relabeling
        const assignments = await store.getAssignmentsByCluster(cluster.id);
        const topAssignments = assignments.slice(0, REPRESENTATIVE_SAMPLE_COUNT);

        if (topAssignments.length > 0) {
          const sampleRows = await sql`
            SELECT chunk_text FROM review_comments
            WHERE id = ANY(${topAssignments.map((a) => a.reviewCommentId)}::bigint[])
          `;
          const samples = sampleRows.map((r) => r.chunk_text as string);

          if (samples.length > 0) {
            const { slug, description } = await generateClusterLabel(
              samples,
              taskRouter,
              logger,
              repo,
            );
            await store.updateClusterLabel(cluster.id, slug, description, cluster.memberCount);
            runState.labelsGenerated++;
          }
        }
      }
    }

    // Step 7: Retire stale clusters (< 3 members in 60-day window)
    for (const cluster of existingClusters) {
      const recentCountRows = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM review_cluster_assignments rca
        JOIN review_comments rc ON rca.review_comment_id = rc.id
        WHERE rca.cluster_id = ${cluster.id}
          AND rc.github_created_at >= NOW() - INTERVAL '60 days'
          AND rc.deleted = false
      `;
      const recentCount = (recentCountRows[0]?.cnt as number) ?? 0;
      if (recentCount < RETIREMENT_MEMBER_THRESHOLD) {
        await store.retireCluster(cluster.id);
        logger.info(
          { clusterId: cluster.id, slug: cluster.slug, recentCount },
          "Retired cluster with insufficient recent members",
        );
      }
    }

    // Finalize
    runState.clustersDiscovered = newClustersCount;
    runState.status = "completed";
    await store.saveRunState(runState);

    logger.info(
      {
        repo,
        newClusters: newClustersCount,
        merged: mergedAssignments.length,
        labelsGenerated: runState.labelsGenerated,
        commentsProcessed: runState.commentsProcessed,
      },
      "Cluster pipeline completed",
    );

    return runState;
  } catch (err) {
    // Fail-open: log error, save failed state, do NOT throw
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, repo }, "Cluster pipeline failed (fail-open)");

    runState.status = "failed";
    runState.errorMessage = message;
    try {
      await store.saveRunState(runState);
    } catch (saveErr) {
      logger.error({ err: saveErr }, "Failed to save cluster run state");
    }

    return runState;
  }
}

// ── LLM Label Generation ─────────────────────────────────────────────

async function generateClusterLabel(
  samples: string[],
  taskRouter: TaskRouter,
  logger: Logger,
  repo: string,
): Promise<{ slug: string; description: string }> {
  try {
    const resolved = taskRouter.resolve(TASK_TYPES.CLUSTER_LABEL);
    const result = await generateWithFallback({
      taskType: TASK_TYPES.CLUSTER_LABEL,
      resolved,
      prompt: `Given these ${samples.length} review comments from the same code review pattern cluster, generate:
1. A short technical slug using lowercase-kebab-case (e.g., "null-check-missing", "error-handling-incomplete")
2. A natural language description (e.g., "Missing null checks on API response fields")

Review comments:
${samples.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}

Return ONLY valid JSON: { "slug": "...", "description": "..." }`,
      system:
        "You generate concise labels for clusters of code review comments. " +
        "Return ONLY valid JSON with slug (kebab-case) and description (natural language) fields. " +
        "No markdown, no explanation.",
      logger,
      repo,
    });

    // Parse JSON response
    const text = result.text.trim();
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.slug === "string" && typeof parsed.description === "string") {
        return {
          slug: parsed.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"),
          description: parsed.description,
        };
      }
    }

    // Fallback: create slug from first sample
    logger.warn({ text }, "Failed to parse LLM label response, using fallback");
    return {
      slug: `pattern-${Date.now()}`,
      description: samples[0]?.slice(0, 100) ?? "Unnamed pattern",
    };
  } catch (err) {
    logger.warn({ err }, "LLM label generation failed, using fallback");
    return {
      slug: `pattern-${Date.now()}`,
      description: samples[0]?.slice(0, 100) ?? "Unnamed pattern",
    };
  }
}
