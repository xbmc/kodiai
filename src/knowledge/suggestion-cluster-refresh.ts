/**
 * Cluster model refresh entrypoint.
 *
 * Provides a bounded background sweep over repos with expired cluster models,
 * calling buildClusterModel for each and accumulating totals. Decoupled from
 * the live review path — the review path only reads from the store; this
 * module writes.
 *
 * Usage:
 *   const refresh = createClusterRefresh({ sql, store, logger });
 *   const result = await refresh.run();           // sweep expired repos from DB
 *   const result = await refresh.run({ repos }); // or pass explicit repo list
 *
 * The `_buildFn` option is an injection point for tests — defaults to
 * buildClusterModel in production. The pattern follows the injectable-deps
 * convention established in M032/S03.
 */

import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import type { SuggestionClusterStore } from "./suggestion-cluster-store.ts";
import {
  buildClusterModel,
  type BuildClusterModelOpts,
  type BuildClusterModelResult,
} from "./suggestion-cluster-builder.ts";

// ── Types ─────────────────────────────────────────────────────────────

/** Per-repo outcome recorded during a refresh sweep. */
export type ClusterRefreshRepoResult = {
  repo: string;
  built: boolean;
  /** Reason not built, if built=false. */
  skipReason?: string;
  /** Whether this repo failed with an unhandled error. */
  failed: boolean;
  positiveCentroidCount: number;
  negativeCentroidCount: number;
};

/** Aggregate result returned by refresh.run(). */
export type ClusterRefreshResult = {
  /** Total repos attempted (expired + any explicitly provided). */
  repoCount: number;
  /** Repos where buildClusterModel returned built=true. */
  reposBuilt: number;
  /** Repos where buildClusterModel returned built=false (data insufficient). */
  reposSkipped: number;
  /** Repos where the build threw an unexpected error. */
  reposFailed: number;
  /** Sum of positiveCentroidCount across all successfully-built models. */
  totalPositiveCentroids: number;
  /** Sum of negativeCentroidCount across all successfully-built models. */
  totalNegativeCentroids: number;
  /** Per-repo breakdown. */
  repoResults: ClusterRefreshRepoResult[];
  /** Wall-clock duration of the sweep in milliseconds. */
  durationMs: number;
};

/** Options for createClusterRefresh. */
export type CreateClusterRefreshOpts = {
  sql: Sql;
  store: SuggestionClusterStore;
  logger: Logger;
  /**
   * Maximum number of expired repos to sweep per run call (when not passing
   * explicit `repos`). Defaults to 50.
   */
  maxReposPerRun?: number;
  /**
   * Injectable override for buildClusterModel.
   * Used in tests to avoid a real DB or HDBSCAN call.
   */
  _buildFn?: (opts: BuildClusterModelOpts) => Promise<BuildClusterModelResult>;
};

/** Options for refresh.run(). */
export type ClusterRefreshRunOpts = {
  /**
   * Explicit list of repos to refresh. If provided, the store is NOT queried
   * for expired repos — only these repos are processed.
   */
  repos?: string[];
};

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Create a cluster refresh sweep instance.
 *
 * Returns an object with a single `run(opts?)` method. Each call to run()
 * performs one sweep and returns aggregate totals.
 */
export function createClusterRefresh(opts: CreateClusterRefreshOpts): {
  run(runOpts?: ClusterRefreshRunOpts): Promise<ClusterRefreshResult>;
} {
  const { sql, store, logger } = opts;
  const maxReposPerRun = opts.maxReposPerRun ?? 50;
  const buildFn = opts._buildFn ?? buildClusterModel;

  const refreshLogger = logger.child({ module: "suggestion-cluster-refresh" });

  return {
    async run(runOpts?: ClusterRefreshRunOpts): Promise<ClusterRefreshResult> {
      const startTime = Date.now();

      // Determine which repos to refresh
      let repos: string[];

      if (runOpts?.repos && runOpts.repos.length > 0) {
        repos = runOpts.repos;
        refreshLogger.info(
          { repoCount: repos.length },
          "Cluster refresh: using explicit repo list",
        );
      } else {
        repos = await store.listExpiredModelRepos(maxReposPerRun);
        refreshLogger.info(
          { repoCount: repos.length, maxReposPerRun },
          "Cluster refresh: fetched expired repos from store",
        );
      }

      if (repos.length === 0) {
        refreshLogger.info("Cluster refresh: no repos to process");
        return {
          repoCount: 0,
          reposBuilt: 0,
          reposSkipped: 0,
          reposFailed: 0,
          totalPositiveCentroids: 0,
          totalNegativeCentroids: 0,
          repoResults: [],
          durationMs: Date.now() - startTime,
        };
      }

      // Process repos sequentially — refresh is background work, no urgency to parallelize
      const repoResults: ClusterRefreshRepoResult[] = [];
      let reposBuilt = 0;
      let reposSkipped = 0;
      let reposFailed = 0;
      let totalPositiveCentroids = 0;
      let totalNegativeCentroids = 0;

      for (const repo of repos) {
        try {
          const buildResult = await buildFn({
            repo,
            sql,
            store,
            logger: refreshLogger,
          });

          if (buildResult.built) {
            reposBuilt++;
            totalPositiveCentroids += buildResult.positiveCentroidCount;
            totalNegativeCentroids += buildResult.negativeCentroidCount;
            repoResults.push({
              repo,
              built: true,
              failed: false,
              positiveCentroidCount: buildResult.positiveCentroidCount,
              negativeCentroidCount: buildResult.negativeCentroidCount,
            });

            refreshLogger.info(
              {
                repo,
                positiveCentroidCount: buildResult.positiveCentroidCount,
                negativeCentroidCount: buildResult.negativeCentroidCount,
                positiveMemberCount: buildResult.positiveMemberCount,
                negativeMemberCount: buildResult.negativeMemberCount,
              },
              "Cluster refresh: model built",
            );
          } else {
            reposSkipped++;
            repoResults.push({
              repo,
              built: false,
              skipReason: buildResult.skipReason,
              failed: false,
              positiveCentroidCount: 0,
              negativeCentroidCount: 0,
            });

            refreshLogger.info(
              { repo, skipReason: buildResult.skipReason },
              "Cluster refresh: model skipped (insufficient data)",
            );
          }
        } catch (err) {
          reposFailed++;
          const message = err instanceof Error ? err.message : String(err);

          repoResults.push({
            repo,
            built: false,
            failed: true,
            skipReason: `Error: ${message}`,
            positiveCentroidCount: 0,
            negativeCentroidCount: 0,
          });

          refreshLogger.warn(
            { err: message, repo },
            "Cluster refresh: build failed for repo (continuing sweep)",
          );
        }
      }

      const durationMs = Date.now() - startTime;

      refreshLogger.info(
        {
          repoCount: repos.length,
          reposBuilt,
          reposSkipped,
          reposFailed,
          totalPositiveCentroids,
          totalNegativeCentroids,
          durationMs,
        },
        "Cluster refresh sweep complete",
      );

      return {
        repoCount: repos.length,
        reposBuilt,
        reposSkipped,
        reposFailed,
        totalPositiveCentroids,
        totalNegativeCentroids,
        repoResults,
        durationMs,
      };
    },
  };
}
