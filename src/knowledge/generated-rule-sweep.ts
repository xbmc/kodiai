import type { Logger } from "pino";
import type { Sql } from "../db/client.ts";
import {
  createGeneratedRuleStore,
  type GeneratedRuleRecord,
  type GeneratedRuleStore,
} from "./generated-rule-store.ts";
import {
  generatePendingRuleProposals,
  type GeneratedRuleProposalCandidate,
} from "./generated-rule-proposals.ts";

const DEFAULT_MAX_REPOS = 25;
const DEFAULT_MIN_REPO_MEMORIES = 5;

type RepoDiscoveryRow = {
  repo: string;
  memory_count: number | string;
};

type ListReposFn = (params: {
  maxRepos: number;
  minRepoMemories: number;
}) => Promise<string[]>;

type GenerateFn = (repo: string) => Promise<GeneratedRuleProposalCandidate[]>;
type SavePendingRuleFn = (proposal: GeneratedRuleProposalCandidate) => Promise<GeneratedRuleRecord>;

export type GeneratedRuleSweepOptions = {
  sql: Sql;
  logger: Logger;
  store?: GeneratedRuleStore;
  maxRepos?: number;
  minRepoMemories?: number;
  _listReposFn?: ListReposFn;
  _generateFn?: GenerateFn;
  _savePendingRuleFn?: SavePendingRuleFn;
};

export type GeneratedRuleSweepRunOptions = {
  repos?: string[];
  dryRun?: boolean;
};

export type GeneratedRuleSweepRepoResult = {
  repo: string;
  proposalCount: number;
  persistedCount: number;
  persistFailureCount: number;
  representativeMemoryIds: number[];
};

export type GeneratedRuleSweepResult = {
  repoCount: number;
  reposProcessed: number;
  reposWithProposals: number;
  reposFailed: number;
  proposalsGenerated: number;
  proposalsPersisted: number;
  persistFailures: number;
  dryRun: boolean;
  durationMs: number;
  repoResults: GeneratedRuleSweepRepoResult[];
};

function dedupeRepos(repos: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const repo of repos) {
    if (!repo || seen.has(repo)) continue;
    seen.add(repo);
    ordered.push(repo);
  }
  return ordered;
}

function getLogger(logger: Logger): Logger {
  return typeof logger.child === "function"
    ? logger.child({ module: "generated-rule-sweep" })
    : logger;
}

export function createGeneratedRuleSweep(opts: GeneratedRuleSweepOptions): {
  run(runOpts?: GeneratedRuleSweepRunOptions): Promise<GeneratedRuleSweepResult>;
} {
  const {
    sql,
    logger,
    store = createGeneratedRuleStore({ sql, logger }),
    maxRepos = DEFAULT_MAX_REPOS,
    minRepoMemories = DEFAULT_MIN_REPO_MEMORIES,
    _listReposFn,
    _generateFn,
    _savePendingRuleFn,
  } = opts;

  const sweepLogger = getLogger(logger);

  const listRepos: ListReposFn = _listReposFn ?? (async ({ maxRepos, minRepoMemories }) => {
    const rows = await sql`
      SELECT repo, COUNT(*)::int AS memory_count
      FROM learning_memories
      WHERE stale = false
        AND embedding IS NOT NULL
      GROUP BY repo
      HAVING COUNT(*) >= ${minRepoMemories}
      ORDER BY COUNT(*) DESC, repo ASC
      LIMIT ${maxRepos}
    `;

    return rows.map((row) => (row as unknown as RepoDiscoveryRow).repo);
  });

  const generateFn: GenerateFn = _generateFn ?? (async (repo) => {
    return generatePendingRuleProposals({
      sql,
      logger: sweepLogger,
      repo,
    });
  });

  const savePendingRuleFn: SavePendingRuleFn = _savePendingRuleFn ?? (async (proposal) => {
    return store.savePendingRule(proposal);
  });

  return {
    async run(runOpts?: GeneratedRuleSweepRunOptions): Promise<GeneratedRuleSweepResult> {
      const startTime = Date.now();
      const dryRun = runOpts?.dryRun ?? false;

      let repos: string[];
      if (runOpts?.repos && runOpts.repos.length > 0) {
        repos = dedupeRepos(runOpts.repos);
      } else {
        try {
          repos = dedupeRepos(await listRepos({ maxRepos, minRepoMemories }));
        } catch (err) {
          sweepLogger.warn({ err }, "Generated-rule repo discovery failed (fail-open)");
          return {
            repoCount: 0,
            reposProcessed: 0,
            reposWithProposals: 0,
            reposFailed: 0,
            proposalsGenerated: 0,
            proposalsPersisted: 0,
            persistFailures: 0,
            dryRun,
            durationMs: Date.now() - startTime,
            repoResults: [],
          };
        }
      }

      sweepLogger.info(
        { repoCount: repos.length, dryRun, maxRepos, minRepoMemories },
        "Generated-rule sweep started",
      );

      if (repos.length === 0) {
        sweepLogger.info({ dryRun }, "Generated-rule sweep found no eligible repos");
        return {
          repoCount: 0,
          reposProcessed: 0,
          reposWithProposals: 0,
          reposFailed: 0,
          proposalsGenerated: 0,
          proposalsPersisted: 0,
          persistFailures: 0,
          dryRun,
          durationMs: Date.now() - startTime,
          repoResults: [],
        };
      }

      const repoResults: GeneratedRuleSweepRepoResult[] = [];
      let reposProcessed = 0;
      let reposWithProposals = 0;
      let reposFailed = 0;
      let proposalsGenerated = 0;
      let proposalsPersisted = 0;
      let persistFailures = 0;

      for (const repo of repos) {
        try {
          const proposals = await generateFn(repo);
          const repoResult: GeneratedRuleSweepRepoResult = {
            repo,
            proposalCount: proposals.length,
            persistedCount: 0,
            persistFailureCount: 0,
            representativeMemoryIds: proposals.map((proposal) => proposal.representativeMemoryId),
          };

          reposProcessed++;
          proposalsGenerated += proposals.length;

          if (proposals.length > 0) {
            reposWithProposals++;
          }

          if (!dryRun) {
            for (const proposal of proposals) {
              try {
                await savePendingRuleFn(proposal);
                repoResult.persistedCount++;
                proposalsPersisted++;
              } catch (err) {
                repoResult.persistFailureCount++;
                persistFailures++;
                sweepLogger.warn(
                  { err, repo, title: proposal.title },
                  "Generated-rule proposal persistence failed (fail-open)",
                );
              }
            }
          }

          repoResults.push(repoResult);

          sweepLogger.info(
            {
              repo,
              proposalCount: repoResult.proposalCount,
              persistedCount: repoResult.persistedCount,
              persistFailureCount: repoResult.persistFailureCount,
              representativeMemoryIds: repoResult.representativeMemoryIds,
              dryRun,
            },
            "Generated-rule sweep repo complete",
          );
        } catch (err) {
          reposFailed++;
          sweepLogger.warn({ err, repo }, "Generated-rule sweep failed for repo (fail-open)");
        }
      }

      const result: GeneratedRuleSweepResult = {
        repoCount: repos.length,
        reposProcessed,
        reposWithProposals,
        reposFailed,
        proposalsGenerated,
        proposalsPersisted,
        persistFailures,
        dryRun,
        durationMs: Date.now() - startTime,
        repoResults,
      };

      sweepLogger.info(
        {
          repoCount: result.repoCount,
          reposProcessed: result.reposProcessed,
          reposWithProposals: result.reposWithProposals,
          reposFailed: result.reposFailed,
          proposalsGenerated: result.proposalsGenerated,
          proposalsPersisted: result.proposalsPersisted,
          persistFailures: result.persistFailures,
          dryRun: result.dryRun,
          durationMs: result.durationMs,
        },
        "Generated-rule sweep completed",
      );

      return result;
    },
  };
}
