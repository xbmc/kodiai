import picomatch from "picomatch";
import {
  classifyFileLanguage,
  type PerFileStats,
} from "../execution/diff-analysis.ts";
import type {
  ReviewGraphBlastRadiusResult,
  ReviewGraphRankedFile,
  ReviewGraphLikelyTest,
} from "../review-graph/query.ts";

export type RiskWeights = {
  linesChanged: number;
  pathRisk: number;
  fileCategory: number;
  languageRisk: number;
  fileExtension: number;
};

export type FileRiskScore = {
  filePath: string;
  score: number; // 0-100
  breakdown: {
    linesChanged: number;
    pathRisk: number;
    fileCategory: number;
    languageRisk: number;
    fileExtension: number;
  };
};

export type RiskTier = "full" | "abbreviated" | "mention-only";

export type TieredFiles = {
  full: FileRiskScore[];
  abbreviated: FileRiskScore[];
  mentionOnly: FileRiskScore[];
  totalFiles: number;
  threshold: number;
  isLargePR: boolean;
};

export type GraphAwareSelectionResult = {
  riskScores: FileRiskScore[];
  usedGraph: boolean;
  graphHits: number;
  graphRankedSelections: number;
  graphImpactedFiles: string[];
  graphLikelyTests: string[];
};

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  linesChanged: 0.3,
  pathRisk: 0.3,
  fileCategory: 0.2,
  languageRisk: 0.1,
  fileExtension: 0.1,
};

export const PATH_RISK_PATTERNS: Array<{
  patterns: string[];
  weight: number;
}> = [
  {
    patterns: [
      "**/auth*",
      "**/login*",
      "**/session*",
      "**/token*",
      "**/jwt*",
      "**/oauth*",
    ],
    weight: 1.0,
  },
  {
    patterns: [
      "**/password*",
      "**/secret*",
      "**/credential*",
      "**/api?key*",
      "**/*.pem",
      "**/*.key",
    ],
    weight: 1.0,
  },
  {
    patterns: ["**/*migration*", "**/*schema*"],
    weight: 0.8,
  },
  {
    patterns: [
      "**/Dockerfile*",
      "**/.github/**",
      "**/terraform/**",
      "**/deploy*",
    ],
    weight: 0.5,
  },
  {
    patterns: [
      "package.json",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "go.mod",
      "go.sum",
      "Cargo.toml",
      "Cargo.lock",
      "requirements.txt",
      "Pipfile.lock",
      "Gemfile.lock",
    ],
    weight: 0.4,
  },
];

export const CATEGORY_RISK: Record<string, number> = {
  source: 1.0,
  infra: 0.7,
  config: 0.4,
  test: 0.2,
  docs: 0.1,
};

export const LANGUAGE_RISK: Record<string, number> = {
  C: 1.0,
  "C++": 1.0,
  PHP: 0.6,
  Go: 0.6,
  Rust: 0.5,
  Java: 0.5,
  JavaScript: 0.5,
  TypeScript: 0.4,
  Python: 0.4,
  Ruby: 0.4,
  Unknown: 0.3,
};

const EXECUTABLE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "py",
  "pyw",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "cs",
  "cpp",
  "cc",
  "cxx",
  "c",
  "rb",
  "php",
  "scala",
  "sh",
  "bash",
  "zsh",
  "sql",
  "dart",
  "lua",
  "ex",
  "exs",
  "zig",
]);

const GRAPH_IMPACT_SCORE_SCALE = 35;
const GRAPH_TEST_SCORE_SCALE = 35;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function buildGraphBoostMap(items: ReviewGraphRankedFile[], scale: number): Map<string, number> {
  return new Map(
    items.map((item) => {
      const weighted = Math.round(item.score * item.confidence * scale);
      return [normalizePath(item.path), weighted];
    }),
  );
}

function mergeGraphScores(params: {
  riskScores: FileRiskScore[];
  graph: ReviewGraphBlastRadiusResult;
}): GraphAwareSelectionResult {
  const { riskScores, graph } = params;
  const impactedBoosts = buildGraphBoostMap(graph.impactedFiles, GRAPH_IMPACT_SCORE_SCALE);
  const testBoosts = buildGraphBoostMap(graph.likelyTests, GRAPH_TEST_SCORE_SCALE);
  const boostablePaths = new Set([...impactedBoosts.keys(), ...testBoosts.keys()]);

  if (boostablePaths.size === 0) {
    return {
      riskScores,
      usedGraph: false,
      graphHits: 0,
      graphRankedSelections: 0,
      graphImpactedFiles: graph.impactedFiles.map((item) => normalizePath(item.path)),
      graphLikelyTests: graph.likelyTests.map((item) => normalizePath(item.path)),
    };
  }

  const originalOrder = new Map(riskScores.map((score, index) => [normalizePath(score.filePath), index]));
  const mergedEntries = riskScores
    .map((score) => {
      const normalizedPath = normalizePath(score.filePath);
      const impactedBoost = impactedBoosts.get(normalizedPath) ?? 0;
      const testBoost = testBoosts.get(normalizedPath) ?? 0;
      return {
        normalizedPath,
        originalIndex: originalOrder.get(normalizedPath) ?? 0,
        mergedScore: clamp(score.score + impactedBoost + testBoost),
        original: score,
      };
    })
    .sort((a, b) => {
      if (b.mergedScore !== a.mergedScore) return b.mergedScore - a.mergedScore;
      return a.originalIndex - b.originalIndex;
    });

  const graphRankedSelections = mergedEntries.reduce((count, entry, index) => {
    return boostablePaths.has(entry.normalizedPath) && index < entry.originalIndex
      ? count + 1
      : count;
  }, 0);

  const merged = mergedEntries.map((entry) => ({
    ...entry.original,
    score: entry.mergedScore,
  }));

  return {
    riskScores: merged,
    usedGraph: true,
    graphHits: boostablePaths.size,
    graphRankedSelections,
    graphImpactedFiles: graph.impactedFiles.map((item) => normalizePath(item.path)),
    graphLikelyTests: graph.likelyTests.map((item) => normalizePath(item.path)),
  };
}

export function applyGraphAwareSelection(params: {
  riskScores: FileRiskScore[];
  graph?: ReviewGraphBlastRadiusResult | null;
}): GraphAwareSelectionResult {
  const { riskScores, graph } = params;
  if (!graph) {
    return {
      riskScores,
      usedGraph: false,
      graphHits: 0,
      graphRankedSelections: 0,
      graphImpactedFiles: [],
      graphLikelyTests: [],
    };
  }

  return mergeGraphScores({ riskScores, graph });
}

export function isExecutableExtension(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXECUTABLE_EXTENSIONS.has(ext);
}

export function computeFileRiskScores(params: {
  files: string[];
  perFileStats: PerFileStats;
  filesByCategory: Record<string, string[]>;
  weights: RiskWeights;
}): FileRiskScore[] {
  const { files, perFileStats, filesByCategory, weights } = params;

  // Normalize weights at runtime so user configs that don't sum to 1.0 still work
  const weightSum =
    weights.linesChanged +
    weights.pathRisk +
    weights.fileCategory +
    weights.languageRisk +
    weights.fileExtension;
  const normalizedWeights: RiskWeights =
    weightSum > 0
      ? {
          linesChanged: weights.linesChanged / weightSum,
          pathRisk: weights.pathRisk / weightSum,
          fileCategory: weights.fileCategory / weightSum,
          languageRisk: weights.languageRisk / weightSum,
          fileExtension: weights.fileExtension / weightSum,
        }
      : DEFAULT_RISK_WEIGHTS;

  // Build reverse category lookup
  const fileCategoryMap = new Map<string, string>();
  for (const [category, categoryFiles] of Object.entries(filesByCategory)) {
    for (const file of categoryFiles) {
      fileCategoryMap.set(file, category);
    }
  }

  // Find max lines changed for normalization
  let maxLines = 0;
  for (const file of files) {
    const stats = perFileStats.get(file);
    if (stats) {
      maxLines = Math.max(maxLines, stats.added + stats.removed);
    }
  }

  // Pre-compile path risk matchers
  const pathRiskMatchers = PATH_RISK_PATTERNS.map(({ patterns, weight }) => ({
    matchers: patterns.map((p) => picomatch(p, { dot: true })),
    weight,
  }));

  return files
    .map((filePath) => {
      const stats = perFileStats.get(filePath) ?? { added: 0, removed: 0 };
      const totalLines = stats.added + stats.removed;

      // 1. Lines changed (log-normalized)
      const linesScore =
        maxLines > 0
          ? Math.min(
              1.0,
              Math.log10(totalLines + 1) / Math.log10(maxLines + 1),
            )
          : 0;

      // 2. Path risk (highest matching pattern weight)
      let pathScore = 0;
      for (const { matchers, weight: patternWeight } of pathRiskMatchers) {
        if (matchers.some((m) => m(filePath))) {
          pathScore = Math.max(pathScore, patternWeight);
        }
      }

      // 3. File category risk
      const category = fileCategoryMap.get(filePath) ?? "source";
      const categoryScore = CATEGORY_RISK[category] ?? 0.5;

      // 4. Language risk
      const language = classifyFileLanguage(filePath);
      const langScore = LANGUAGE_RISK[language] ?? 0.3;

      // 5. Extension-based executable risk
      const extScore = isExecutableExtension(filePath) ? 1.0 : 0.3;

      // Weighted composite score scaled to 0-100
      const rawScore =
        linesScore * normalizedWeights.linesChanged +
        pathScore * normalizedWeights.pathRisk +
        categoryScore * normalizedWeights.fileCategory +
        langScore * normalizedWeights.languageRisk +
        extScore * normalizedWeights.fileExtension;

      const score = Math.round(rawScore * 100);

      return {
        filePath,
        score,
        breakdown: {
          linesChanged: Math.round(linesScore * 100),
          pathRisk: Math.round(pathScore * 100),
          fileCategory: Math.round(categoryScore * 100),
          languageRisk: Math.round(langScore * 100),
          fileExtension: Math.round(extScore * 100),
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function triageFilesByRisk(params: {
  riskScores: FileRiskScore[];
  fileThreshold: number;
  fullReviewCount: number;
  abbreviatedCount: number;
  /** Override the file count used for the threshold check.
   *  Defaults to riskScores.length. In incremental mode, pass
   *  the full PR file count so the threshold decision uses the
   *  real PR size, not the filtered review subset. */
  totalFileCount?: number;
}): TieredFiles {
  const { riskScores, fileThreshold, fullReviewCount, abbreviatedCount } =
    params;
  const totalFiles = params.totalFileCount ?? riskScores.length;
  const isLargePR = totalFiles > fileThreshold;

  if (!isLargePR) {
    return {
      full: riskScores,
      abbreviated: [],
      mentionOnly: [],
      totalFiles,
      threshold: fileThreshold,
      isLargePR: false,
    };
  }

  // Already sorted by risk score (descending) from computeFileRiskScores
  const full = riskScores.slice(0, fullReviewCount);
  const abbreviated = riskScores.slice(
    fullReviewCount,
    fullReviewCount + abbreviatedCount,
  );
  const mentionOnly = riskScores.slice(fullReviewCount + abbreviatedCount);

  return {
    full,
    abbreviated,
    mentionOnly,
    totalFiles,
    threshold: fileThreshold,
    isLargePR: true,
  };
}
