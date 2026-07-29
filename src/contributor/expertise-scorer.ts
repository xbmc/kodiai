import type { Logger } from "pino";
import { classifyFileLanguageWithContext } from "../execution/diff-analysis.ts";
import { sleep } from "../lib/with-timeout.ts";
import { calculateTierForProfile } from "./tier-calculator.ts";
import type {
  ContributorExpertise,
  ContributorExpertiseUpsert,
  ContributorProfileStore,
  ContributorTier,
  ExpertiseDimension,
} from "./types.ts";

const DECAY_HALF_LIFE_DAYS = 180;
const DECAY_LAMBDA = Math.LN2 / DECAY_HALF_LIFE_DAYS;

export const ACTIVITY_SIGNAL_WEIGHTS = {
  commit: 1,
  pr_review: 2,
  pr_authored: 3,
} as const;

const SIGMOID_K = 0.05;
const SIGMOID_MIDPOINT = 50;

export type ActivitySignal = {
  type: "commit" | "pr_review" | "pr_authored";
  date: Date;
  languages: string[];
  fileAreas: string[];
};

/**
 * Extract two-level directory prefix from a file path.
 * `src/handlers/review.ts` -> `src/handlers/`
 * Root-level files return `.`
 */
export function extractFileArea(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 1) return ".";
  const area = parts.slice(0, 2).join("/").toLowerCase();
  return area.endsWith("/") ? area : `${area}/`;
}

/**
 * Compute decayed score from activity signals using exponential decay.
 * More recent signals weigh more; 180-day half-life.
 */
export function computeDecayedScore(signals: ActivitySignal[]): number {
  const now = Date.now();
  let total = 0;

  for (const signal of signals) {
    const daysSince = (now - signal.date.getTime()) / (1000 * 60 * 60 * 24);
    const weight = ACTIVITY_SIGNAL_WEIGHTS[signal.type];
    total += weight * Math.exp(-DECAY_LAMBDA * daysSince);
  }

  return total;
}

/**
 * Sigmoid normalization mapping raw score to 0.0-1.0.
 */
export function normalizeScore(raw: number): number {
  return 1 / (1 + Math.exp(-SIGMOID_K * (raw - SIGMOID_MIDPOINT)));
}

/**
 * Classify a file's language from its extension, returning lowercase name.
 * Returns null for unknown extensions.
 */
function classifyLanguage(filePath: string): string | null {
  const lang = classifyFileLanguageWithContext(filePath);
  return lang === "unknown" ? null : lang;
}

type ExpertiseTopic = {
  dimension: ExpertiseDimension;
  topic: string;
};

type ExpertiseDimensionScore = Pick<
  ContributorExpertise,
  "dimension" | "topic" | "score"
>;

type ExpertiseBucket = {
  dimension: ExpertiseDimension;
  topic: string;
  signals: ActivitySignal[];
};

function bucketSignals(
  signals: ActivitySignal[],
): Map<string, ExpertiseBucket> {
  const buckets = new Map<string, ExpertiseBucket>();

  for (const signal of signals) {
    for (const lang of signal.languages) {
      const key = `language:${lang}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { dimension: "language", topic: lang, signals: [] };
        buckets.set(key, bucket);
      }
      bucket.signals.push(signal);
    }
    for (const area of signal.fileAreas) {
      const key = `file_area:${area}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { dimension: "file_area", topic: area, signals: [] };
        buckets.set(key, bucket);
      }
      bucket.signals.push(signal);
    }
  }

  return buckets;
}

export function deriveUpdatedOverallScore(params: {
  existingExpertise: ExpertiseDimensionScore[];
  touchedTopics: ExpertiseTopic[];
  signal: ActivitySignal;
}): number {
  const { existingExpertise, touchedTopics, signal } = params;
  const scoreByTopic = new Map(
    existingExpertise.map((entry) => [
      `${entry.dimension}:${entry.topic}`,
      entry.score,
    ]),
  );

  const newRaw = computeDecayedScore([signal]);
  const normalizedContribution = normalizeScore(newRaw);

  for (const touched of touchedTopics) {
    const key = `${touched.dimension}:${touched.topic}`;
    const existingScore = scoreByTopic.get(key) ?? 0;
    const blended = existingScore * 0.9 + normalizedContribution * 0.1;
    scoreByTopic.set(key, Math.min(1, blended));
  }

  const topScores = [...scoreByTopic.values()]
    .sort((a, b) => b - a)
    .slice(0, 5);

  return topScores.length > 0
    ? topScores.reduce((a, b) => a + b, 0) / topScores.length
    : 0;
}

export async function recalculateTierFailOpen(params: {
  profileId: number;
  updatedOverallScore: number;
  fallbackTier: ContributorTier;
  profileStore: ContributorProfileStore;
  logger: Logger;
}): Promise<ContributorTier> {
  const { profileId, updatedOverallScore, fallbackTier, profileStore, logger } =
    params;

  try {
    const allScores = await profileStore.getAllScores();
    return calculateTierForProfile({
      profileId,
      updatedOverallScore,
      scores: allScores,
    });
  } catch (err) {
    logger.warn(
      {
        err,
        profileId,
        updatedOverallScore,
        fallbackTier,
      },
      "Contributor tier recalculation failed; persisting existing tier",
    );
    return fallbackTier;
  }
}

type ExpertiseScorerOctokit = {
  rest: {
    pulls: {
      listFiles: (args: Record<string, unknown>) => Promise<{
        data: Array<{ filename: string }>;
      }>;
    };
  };
};

async function listPullRequestFilesPaged(
  octokit: ExpertiseScorerOctokit,
  params: { owner: string; repo: string; pullNumber: number },
): Promise<string[]> {
  const files: string[] = [];
  const perPage = 100;

  for (let page = 1; ; page++) {
    const response = await octokit.rest.pulls.listFiles({
      owner: params.owner,
      repo: params.repo,
      pull_number: params.pullNumber,
      per_page: perPage,
      page,
    });
    files.push(...response.data.map((file) => file.filename));

    if (response.data.length < perPage) {
      return files;
    }
  }
}

/**
 * Full expertise scoring from GitHub activity. Fetches commits, PRs, reviews
 * and computes per-dimension expertise scores.
 *
 * NOTE: This function is designed for batch/background use. For real-time
 * per-PR updates, use updateExpertiseIncremental instead.
 */
export async function computeExpertiseScores(params: {
  githubUsername: string;
  octokit: {
    rest: {
      repos: {
        listCommits: (args: Record<string, unknown>) => Promise<{
          data: Array<{
            sha: string;
            commit: { author: { date?: string } };
            files?: Array<{ filename: string }>;
          }>;
        }>;
      };
      pulls: {
        list: (args: Record<string, unknown>) => Promise<{
          data: Array<{
            number: number;
            user: { login: string } | null;
            merged_at: string | null;
            files?: Array<{ filename: string }>;
          }>;
        }>;
        listFiles: (args: Record<string, unknown>) => Promise<{
          data: Array<{ filename: string }>;
        }>;
      };
    };
  };
  owner: string;
  repo: string;
  profileStore: ContributorProfileStore;
  logger: Logger;
  monthsBack?: number;
}): Promise<void> {
  const {
    githubUsername,
    octokit,
    owner,
    repo,
    profileStore,
    logger,
    monthsBack = 12,
  } = params;

  const profile =
    await profileStore.getOrCreateByGithubUsername(githubUsername);
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  const sinceIso = since.toISOString();

  const allSignals: ActivitySignal[] = [];

  try {
    for (let page = 1; page <= 5; page++) {
      const resp = await octokit.rest.repos.listCommits({
        owner,
        repo,
        author: githubUsername,
        since: sinceIso,
        per_page: 100,
        page,
      });
      if (resp.data.length === 0) break;

      for (const commit of resp.data) {
        const files = commit.files?.map((f) => f.filename) ?? [];
        const languages = [
          ...new Set(
            files
              .map((f) => classifyLanguage(f))
              .filter((l): l is string => l !== null),
          ),
        ];
        const fileAreas = [...new Set(files.map((f) => extractFileArea(f)))];
        allSignals.push({
          type: "commit",
          date: new Date(commit.commit.author?.date ?? Date.now()),
          languages,
          fileAreas,
        });
      }
      await sleep(200);
    }
  } catch (err) {
    logger.warn({ err, githubUsername }, "Failed to fetch commits (fail-open)");
  }

  try {
    for (let page = 1; page <= 3; page++) {
      const resp = await octokit.rest.pulls.list({
        owner,
        repo,
        state: "closed",
        per_page: 100,
        page,
      });
      if (resp.data.length === 0) break;

      for (const pr of resp.data) {
        if (pr.user?.login !== githubUsername || !pr.merged_at) continue;

        let files: string[] = [];
        try {
          files = await listPullRequestFilesPaged(octokit, {
            owner,
            repo,
            pullNumber: pr.number,
          });
        } catch {
          // fail-open
        }

        const languages = [
          ...new Set(
            files
              .map((f) => classifyLanguage(f))
              .filter((l): l is string => l !== null),
          ),
        ];
        const fileAreas = [...new Set(files.map((f) => extractFileArea(f)))];
        allSignals.push({
          type: "pr_authored",
          date: new Date(pr.merged_at),
          languages,
          fileAreas,
        });
      }
      await sleep(200);
    }
  } catch (err) {
    logger.warn(
      { err, githubUsername },
      "Failed to fetch authored PRs (fail-open)",
    );
  }

  const buckets = bucketSignals(allSignals);
  for (const bucket of buckets.values()) {
    const raw = computeDecayedScore(bucket.signals);
    const score = normalizeScore(raw);
    await profileStore.upsertExpertise({
      profileId: profile.id,
      dimension: bucket.dimension,
      topic: bucket.topic,
      score,
      rawSignals: bucket.signals.length,
      lastActive: bucket.signals[0]?.date ?? new Date(),
    });
  }

  const expertise = await profileStore.getExpertise(profile.id);
  const topScores = expertise.slice(0, 5).map((e) => e.score);
  const overallScore =
    topScores.length > 0
      ? topScores.reduce((a, b) => a + b, 0) / topScores.length
      : 0;

  const updatedTier = await recalculateTierFailOpen({
    profileId: profile.id,
    updatedOverallScore: overallScore,
    fallbackTier: profile.overallTier,
    profileStore,
    logger,
  });

  await profileStore.updateTier(profile.id, updatedTier, overallScore);
  logger.info(
    {
      githubUsername,
      signalCount: allSignals.length,
      bucketCount: buckets.size,
      overallScore,
      updatedTier,
    },
    "Computed expertise scores",
  );
}

/**
 * Lightweight incremental expertise update — fire-and-forget after PR review.
 * Updates scores for languages and file areas touched in a single PR.
 */
export async function updateExpertiseIncremental(params: {
  githubUsername: string;
  filesChanged: string[];
  type: "commit" | "pr_review" | "pr_authored";
  profileStore: ContributorProfileStore;
  logger: Logger;
}): Promise<void> {
  const { githubUsername, filesChanged, type, profileStore, logger } = params;
  const profile =
    await profileStore.getOrCreateByGithubUsername(githubUsername);

  const languages = [
    ...new Set(
      filesChanged
        .map((f) => classifyLanguage(f))
        .filter((l): l is string => l !== null),
    ),
  ];
  const fileAreas = [...new Set(filesChanged.map((f) => extractFileArea(f)))];

  const now = new Date();
  const signal: ActivitySignal = { type, date: now, languages, fileAreas };

  const dimensions: Array<{ dimension: ExpertiseDimension; topics: string[] }> =
    [
      { dimension: "language", topics: languages },
      { dimension: "file_area", topics: fileAreas },
    ];

  const existingExpertise = await profileStore.getExpertise(profile.id);
  const scoreByTopic = new Map<string, ExpertiseDimensionScore>();
  const rawSignalsByTopic = new Map<string, number>();
  for (const entry of existingExpertise) {
    const key = `${entry.dimension}:${entry.topic}`;
    scoreByTopic.set(key, {
      dimension: entry.dimension,
      topic: entry.topic,
      score: entry.score,
    });
    rawSignalsByTopic.set(key, entry.rawSignals);
  }
  const newRaw = computeDecayedScore([signal]);
  const normalizedContribution = normalizeScore(newRaw);
  const expertiseUpdates: ContributorExpertiseUpsert[] = [];
  // Snapshot pre-blend scores for deriveUpdatedOverallScore below -- it blends the new
  // signal into each touched topic itself, so passing it the already-blended scores
  // (mutated into scoreByTopic in the loop) would double-count this signal's contribution.
  const preBlendExpertise = [...scoreByTopic.values()];

  for (const { dimension, topics } of dimensions) {
    for (const topic of topics) {
      const key = `${dimension}:${topic}`;
      const entry = scoreByTopic.get(key);

      const existingScore = entry?.score ?? 0;
      const blended = Math.min(1, existingScore * 0.9 + normalizedContribution * 0.1);
      const rawSignals = (rawSignalsByTopic.get(key) ?? 0) + 1;

      expertiseUpdates.push({
        profileId: profile.id,
        dimension,
        topic,
        score: blended,
        rawSignals,
        lastActive: now,
      });

      scoreByTopic.set(key, { dimension, topic, score: blended });
      rawSignalsByTopic.set(key, rawSignals);
    }
  }

  if (expertiseUpdates.length > 0) {
    await profileStore.upsertExpertiseMany(expertiseUpdates);
  }

  const overallScore = deriveUpdatedOverallScore({
    existingExpertise: preBlendExpertise,
    touchedTopics: [
      ...languages.map((topic) => ({
        dimension: "language" as const,
        topic,
      })),
      ...fileAreas.map((topic) => ({
        dimension: "file_area" as const,
        topic,
      })),
    ],
    signal,
  });

  const updatedTier = await recalculateTierFailOpen({
    profileId: profile.id,
    updatedOverallScore: overallScore,
    fallbackTier: profile.overallTier,
    profileStore,
    logger,
  });

  await profileStore.updateTier(profile.id, updatedTier, overallScore);
  logger.debug(
    { githubUsername, type, languages, fileAreas, overallScore, updatedTier },
    "Incremental expertise update complete",
  );
}
