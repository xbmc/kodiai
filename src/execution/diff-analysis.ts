import picomatch from "picomatch";

export const MAX_ANALYSIS_FILES = 200;
export const MAX_ANALYSIS_TIME_MS = 50;
const MAX_DIFF_CONTENT_BYTES = 50 * 1024;
const CATEGORY_NAMES = ["source", "test", "config", "docs", "infra"] as const;
const TIME_BUDGET_TRUNCATION_SIGNAL = "Analysis truncated due to time budget";

export const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  pyw: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  cs: "C#",
  cpp: "C++",
  cc: "C++",
  cxx: "C++",
  hpp: "C++",
  hxx: "C++",
  c: "C",
  h: "C",
  rb: "Ruby",
  php: "PHP",
  scala: "Scala",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  sql: "SQL",
  dart: "Dart",
  lua: "Lua",
  ex: "Elixir",
  exs: "Elixir",
  zig: "Zig",
  // Functional languages
  r: "R",
  R: "R",
  m: "Objective-C",
  mm: "Objective-C++",
  pl: "Perl",
  pm: "Perl",
  clj: "Clojure",
  cljs: "Clojure",
  cljc: "Clojure",
  erl: "Erlang",
  hrl: "Erlang",
  hs: "Haskell",
  ml: "OCaml",
  mli: "OCaml",
  fs: "F#",
  fsx: "F#",
  fsi: "F#",
  jl: "Julia",
  groovy: "Groovy",
  gvy: "Groovy",
  // Hardware description
  v: "Verilog",
  sv: "Verilog",
  vhd: "VHDL",
  vhdl: "VHDL",
  // Build systems
  cmake: "CMake",
};

/**
 * Map of language names (lowercase) to related languages for affinity boosting.
 * Used by retrieval reranking to give partial boost to related languages.
 */
export const RELATED_LANGUAGES: Record<string, string[]> = {
  c: ["cpp"],
  cpp: ["c"],
  typescript: ["javascript"],
  javascript: ["typescript"],
  objectivec: ["c", "cpp"],
  objectivecpp: ["c", "cpp", "objectivec"],
  kotlin: ["java"],
};

/**
 * C++ context extensions — presence in context files signals a C++ project.
 */
const CPP_EXTENSIONS = new Set(["cpp", "cc", "cxx", "hpp", "hxx"]);

export function classifyFileLanguage(filePath: string): string {
  const ext = filePath.split(".").pop();
  if (!ext) return "Unknown";
  // Preserve case for R (extension is case-sensitive)
  return EXTENSION_LANGUAGE_MAP[ext] ?? "Unknown";
}

/**
 * Context-aware language classification. Returns lowercase language names for
 * consistency with database storage. Resolves ambiguous extensions (e.g., .h)
 * using context files from the same PR/repository.
 *
 * @param filePath - Path to classify
 * @param contextFiles - Other files in the PR/repo (used to resolve .h ambiguity)
 */
export function classifyFileLanguageWithContext(
  filePath: string,
  contextFiles?: string[],
): string {
  const ext = filePath.split(".").pop();
  if (!ext) return "unknown";

  // Resolve .h ambiguity: C++ if any C++ files present in context, else C
  if (ext === "h" || ext === "H") {
    if (contextFiles && contextFiles.length > 0) {
      const hasCpp = contextFiles.some((f) => {
        const ctxExt = f.split(".").pop()?.toLowerCase();
        return ctxExt !== undefined && CPP_EXTENSIONS.has(ctxExt);
      });
      return hasCpp ? "cpp" : "c";
    }
    return "c"; // fallback: default to C
  }

  const displayLang = EXTENSION_LANGUAGE_MAP[ext];
  if (!displayLang) return "unknown";
  return displayLang.toLowerCase()
    .replace("c#", "csharp")
    .replace("c++", "cpp")
    .replace("objective-c++", "objectivecpp")
    .replace("objective-c", "objectivec")
    .replace("f#", "fsharp");
}

export function classifyLanguages(files: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const file of files) {
    const lang = classifyFileLanguage(file);
    if (lang === "Unknown") continue;
    if (!result[lang]) result[lang] = [];
    result[lang]!.push(file);
  }
  return result;
}

type CategoryName = (typeof CATEGORY_NAMES)[number];

export interface DiffAnalysisInput {
  changedFiles: string[];
  numstatLines: string[];
  diffContent?: string;
  fileCategories?: Record<string, string[]>;
}

export interface DiffAnalysis {
  filesByCategory: Record<string, string[]>;
  filesByLanguage: Record<string, string[]>;
  riskSignals: string[];
  metrics: {
    totalFiles: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    hunksCount: number;
  };
  isLargePR: boolean;
}

export const DEFAULT_FILE_CATEGORIES: Record<CategoryName, string[]> = {
  source: [],
  test: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
  ],
  config: [
    "**/*.json",
    "**/*.yml",
    "**/*.yaml",
    "**/*.toml",
    "**/tsconfig*",
    "**/.eslintrc*",
    "**/.prettierrc*",
    "**/jest.config*",
    "**/vite.config*",
    "**/webpack.config*",
  ],
  docs: ["**/*.md", "**/*.txt", "**/*.rst", "**/LICENSE*", "**/CHANGELOG*"],
  infra: [
    "**/Dockerfile*",
    "**/.github/**",
    "**/terraform/**",
    "**/pulumi/**",
    "**/.gitlab-ci*",
    "**/Jenkinsfile*",
    "**/deploy*",
  ],
};

const PATH_RISK_SIGNALS: Array<{ patterns: string[]; signal: string }> = [
  {
    patterns: [
      "**/auth*",
      "**/login*",
      "**/session*",
      "**/token*",
      "**/jwt*",
      "**/oauth*",
    ],
    signal: "Modifies authentication/authorization code",
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
    signal: "Touches credential/secret-related files",
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
    signal: "Modifies dependency manifest",
  },
  {
    patterns: ["**/Dockerfile*", "**/.github/**", "**/terraform/**", "**/deploy*"],
    signal: "Changes CI/CD or infrastructure configuration",
  },
  {
    patterns: ["**/*migration*", "**/*schema*"],
    signal: "Modifies database schema or migrations",
  },
];

const CONTENT_RISK_SIGNALS: Array<{ pattern: RegExp; signal: string }> = [
  {
    pattern: /(?:try\s*\{|catch\s*\(|\.catch\(|panic\(|recover\()/i,
    signal: "Modifies error handling logic",
  },
  {
    pattern: /(?:crypto|encrypt|decrypt|hash|sign|verify|bcrypt|argon)/i,
    signal: "Touches cryptographic code",
  },
];

export type PerFileStats = Map<string, { added: number; removed: number }>;

export function parseNumstatPerFile(numstatLines: string[]): PerFileStats {
  const result: PerFileStats = new Map();

  for (const line of numstatLines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const [addedRaw, removedRaw, ...pathParts] = parts;
    const filePath = pathParts.join("\t"); // handles paths with tabs (rare)

    if (!addedRaw || !removedRaw || !filePath) continue;

    const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10);
    const removed = removedRaw === "-" ? 0 : Number.parseInt(removedRaw, 10);

    result.set(filePath, {
      added: Number.isNaN(added) ? 0 : added,
      removed: Number.isNaN(removed) ? 0 : removed,
    });
  }

  return result;
}

function parseNumstat(numstatLines: string[]): { added: number; removed: number } {
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;

  for (const line of numstatLines) {
    const [addedRaw, removedRaw] = line.split("\t");
    if (!addedRaw || !removedRaw) {
      continue;
    }

    const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10);
    const removed = removedRaw === "-" ? 0 : Number.parseInt(removedRaw, 10);

    if (!Number.isNaN(added)) {
      totalLinesAdded += added;
    }
    if (!Number.isNaN(removed)) {
      totalLinesRemoved += removed;
    }
  }

  return { added: totalLinesAdded, removed: totalLinesRemoved };
}

function mergeFileCategories(
  overrides?: Record<string, string[]>,
): Record<CategoryName, string[]> {
  const merged: Record<CategoryName, string[]> = {
    source: [],
    test: [],
    config: [],
    docs: [],
    infra: [],
  };

  for (const category of CATEGORY_NAMES) {
    const patterns = DEFAULT_FILE_CATEGORIES[category];
    const userPatterns = overrides?.[category] ?? [];
    merged[category] = [...patterns, ...userPatterns];
  }

  return merged;
}

function countHunks(diffContent?: string): number {
  if (!diffContent) {
    return 0;
  }

  const matches = diffContent.match(/^@@/gm);
  return matches?.length ?? 0;
}

export function analyzeDiff(input: DiffAnalysisInput): DiffAnalysis {
  const analysisStartTime = Date.now();
  const isTimeBudgetExceeded = () => Date.now() - analysisStartTime >= MAX_ANALYSIS_TIME_MS;
  const changedFiles = input.changedFiles ?? [];
  const analyzedFiles = changedFiles.slice(0, MAX_ANALYSIS_FILES);
  const mergedCategories = mergeFileCategories(input.fileCategories);

  const filesByCategory: Record<CategoryName, string[]> = {
    source: [],
    test: [],
    config: [],
    docs: [],
    infra: [],
  };

  const categoryMatchers = {
    test: mergedCategories.test.map((pattern) => picomatch(pattern, { dot: true })),
    config: mergedCategories.config.map((pattern) =>
      picomatch(pattern, { dot: true }),
    ),
    docs: mergedCategories.docs.map((pattern) => picomatch(pattern, { dot: true })),
    infra: mergedCategories.infra.map((pattern) => picomatch(pattern, { dot: true })),
  };

  let isTimeBudgetTruncated = false;

  for (const file of analyzedFiles) {
    if (isTimeBudgetExceeded()) {
      isTimeBudgetTruncated = true;
      break;
    }

    if (categoryMatchers.test.some((matcher) => matcher(file))) {
      filesByCategory.test.push(file);
    } else if (categoryMatchers.config.some((matcher) => matcher(file))) {
      filesByCategory.config.push(file);
    } else if (categoryMatchers.docs.some((matcher) => matcher(file))) {
      filesByCategory.docs.push(file);
    } else if (categoryMatchers.infra.some((matcher) => matcher(file))) {
      filesByCategory.infra.push(file);
    } else {
      filesByCategory.source.push(file);
    }

    if (isTimeBudgetExceeded()) {
      isTimeBudgetTruncated = true;
      break;
    }
  }

  const filesByLanguage = classifyLanguages(analyzedFiles);

  const riskSignals: string[] = [];

  for (const risk of PATH_RISK_SIGNALS) {
    if (isTimeBudgetExceeded()) {
      isTimeBudgetTruncated = true;
      break;
    }

    const matchers = risk.patterns.map((pattern) => picomatch(pattern, { dot: true }));
    const hasMatch = analyzedFiles.some((file) =>
      matchers.some((matcher) => matcher(file)),
    );

    if (hasMatch) {
      riskSignals.push(risk.signal);
    }
  }

  if (input.diffContent && input.diffContent.length < MAX_DIFF_CONTENT_BYTES) {
    for (const contentRisk of CONTENT_RISK_SIGNALS) {
      if (isTimeBudgetExceeded()) {
        isTimeBudgetTruncated = true;
        break;
      }

      if (contentRisk.pattern.test(input.diffContent)) {
        riskSignals.push(contentRisk.signal);
      }
    }
  }

  if (isTimeBudgetTruncated) {
    riskSignals.push(TIME_BUDGET_TRUNCATION_SIGNAL);
  }

  const parsedNumstat = parseNumstat(input.numstatLines ?? []);
  const metrics = {
    totalFiles: changedFiles.length,
    totalLinesAdded: parsedNumstat.added,
    totalLinesRemoved: parsedNumstat.removed,
    hunksCount: countHunks(input.diffContent),
  };

  const isLargePR =
    changedFiles.length > MAX_ANALYSIS_FILES ||
    metrics.totalLinesAdded + metrics.totalLinesRemoved > 5000;

  return {
    filesByCategory,
    filesByLanguage,
    riskSignals,
    metrics,
    isLargePR,
  };
}
