# Phase 40: Large PR Intelligence - Research

**Researched:** 2026-02-13
**Domain:** Per-file risk scoring, tiered analysis depth, large PR triage and disclosure
**Confidence:** HIGH

## Summary

This phase adds intelligent prioritization and tiered review depth when a PR exceeds a configurable file threshold. The core challenge is threefold: (1) computing a per-file risk score from composite heuristics that exist entirely within the current data surface (numstat lines, file paths, file categories, language), (2) deciding which files get full LLM review, abbreviated review, or mention-only treatment, and (3) disclosing the triage transparently in the Review Details summary.

The codebase already has every building block needed. The `numstatLines` from `collectDiffContext()` provide per-file added/removed counts. The `PATH_RISK_SIGNALS` in `diff-analysis.ts` already classify files by risk categories (auth, crypto, secrets, DB migrations, CI/CD). The `filesByCategory` classifier separates test/config/docs/infra/source files. The `filesByLanguage` classifier maps files to known languages. The `buildReviewPrompt()` function already accepts a `changedFiles` list and truncates it at 200 -- this is the exact integration point where tiered file selection replaces the current linear cap. The `formatReviewDetailsSummary()` function already generates Review Details blocks -- this is where coverage disclosure gets added.

The critical architectural decision is WHERE the file triage happens. It must occur in the review handler (review.ts) BEFORE the prompt is built, so that the `changedFiles` parameter to `buildReviewPrompt()` contains only the files selected for review. The tiered analysis (full vs abbreviated vs mention-only) is implemented by splitting the selected files into two prompt sections: a primary list (full review depth) and a secondary list (abbreviated -- check for critical issues only). Mention-only files never enter the prompt but are listed in the disclosure summary.

**Primary recommendation:** Build a `FileRiskScorer` module in `src/lib/file-risk-scorer.ts` that takes numstat lines, file paths, category classification, and language data to produce sorted risk scores per file. The review handler calls this before `buildReviewPrompt()`, slices files into tiers, and passes the tiered file lists to the prompt builder. The Review Details summary discloses coverage. All thresholds and weights are configurable via a new `largePR` section in `.kodiai.yml`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `picomatch` | (existing) | Glob pattern matching for path risk signals | Already used throughout codebase |
| `zod` | (existing) | Schema validation for `.kodiai.yml` largePR config | Already used for all config validation |
| `bun:test` | (existing) | Test framework | Already used for all tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:path` | (builtin) | File path manipulation for extension/directory extraction | Risk scoring heuristics |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom composite scoring | ML-based scoring model | ML is overkill for deterministic heuristics on small feature sets; composite weighted sum is transparent and debuggable |
| Per-file numstat parsing in scorer | Reuse existing `parseNumstat()` | Existing `parseNumstat()` returns aggregate totals; we need per-file breakdown, so new parsing needed |
| Prompt-based tiering | Post-LLM filtering | Must happen pre-LLM to avoid wasting tokens on low-priority files; LLM only sees files we want reviewed |

**Installation:** No new dependencies needed. All required libraries are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  lib/
    file-risk-scorer.ts         # NEW: Per-file risk scoring engine
    file-risk-scorer.test.ts    # NEW: Tests for risk scoring
  execution/
    diff-analysis.ts            # MODIFIED: Export parseNumstatPerFile() helper
    review-prompt.ts            # MODIFIED: Accept tiered file lists, add abbreviated section
    config.ts                   # MODIFIED: Add largePR config schema
  handlers/
    review.ts                   # MODIFIED: Integrate file triage before prompt building
```

### Pattern 1: Risk Score Computation (Composite Weighted Sum)
**What:** Each file gets a numeric risk score from 0-100 based on multiple heuristics.
**When to use:** For every PR that exceeds the file threshold (default 50).
**Why this approach:** Weighted sum is transparent, debuggable, configurable, and deterministic. No ML needed -- the heuristics are well-understood from code review research.

```typescript
// Risk scoring heuristics and their default weights
export type RiskWeights = {
  linesChanged: number;    // default: 0.30 -- more changes = more risk
  pathRisk: number;        // default: 0.30 -- auth, crypto, secrets paths
  fileCategory: number;    // default: 0.20 -- source > config > test > docs
  languageRisk: number;    // default: 0.10 -- memory-unsafe languages score higher
  fileExtension: number;   // default: 0.10 -- executable code > data files
};

export type FileRiskScore = {
  filePath: string;
  score: number;           // 0-100
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
  full: FileRiskScore[];           // Top N files -- full LLM review
  abbreviated: FileRiskScore[];     // Next M files -- critical issues only
  mentionOnly: FileRiskScore[];     // Rest -- listed in disclosure, not reviewed
  totalFiles: number;
  threshold: number;
  isLargePR: boolean;               // true when total > threshold
};
```

### Pattern 2: Pre-Prompt File Triage (review.ts Integration)
**What:** The file triage runs BEFORE `buildReviewPrompt()`, replacing the current linear file list approach.
**When to use:** Always -- when file count exceeds threshold, triage activates; below threshold, all files go through full review (existing behavior).
**Integration point:** Between `diffAnalysis = analyzeDiff(...)` (line 1083) and `buildReviewPrompt(...)` (line 1193).

```typescript
// In review.ts, AFTER diffAnalysis and BEFORE buildReviewPrompt:

// Parse per-file numstat data
const perFileStats = parseNumstatPerFile(numstatLines);

// Compute risk scores for all changed files
const riskScores = computeFileRiskScores({
  files: reviewFiles,
  perFileStats,
  filesByCategory: diffAnalysis.filesByCategory,
  filesByLanguage: diffAnalysis.filesByLanguage,
  riskSignals: diffAnalysis.riskSignals,
  weights: config.largePR.riskWeights,
});

// Apply tiered triage if this is a large PR
const tiered = triageFilesByRisk({
  riskScores,
  fileThreshold: config.largePR.fileThreshold,
  fullReviewCount: config.largePR.fullReviewCount,
  abbreviatedCount: config.largePR.abbreviatedCount,
});

// Pass tiered files to prompt builder
const reviewPrompt = buildReviewPrompt({
  ...existingParams,
  changedFiles: tiered.isLargePR
    ? [...tiered.full.map(f => f.filePath), ...tiered.abbreviated.map(f => f.filePath)]
    : reviewFiles,
  largePRContext: tiered.isLargePR ? {
    fullReviewFiles: tiered.full.map(f => f.filePath),
    abbreviatedFiles: tiered.abbreviated.map(f => f.filePath),
    mentionOnlyFiles: tiered.mentionOnly.map(f => f.filePath),
    totalFiles: tiered.totalFiles,
  } : null,
});
```

### Pattern 3: Tiered Prompt Sections
**What:** The review prompt distinguishes between full-review and abbreviated-review files with explicit instructions for each tier.
**When to use:** When `largePRContext` is provided to `buildReviewPrompt()`.

```typescript
// New prompt section builder in review-prompt.ts
export function buildLargePRTriageSection(params: {
  fullReviewFiles: string[];
  abbreviatedFiles: string[];
  mentionOnlyFiles: string[];
  totalFiles: number;
}): string {
  const lines = [
    "## Large PR Triage",
    "",
    `This PR has ${params.totalFiles} files. Files have been prioritized by risk score.`,
    "",
    `### Full Review (${params.fullReviewFiles.length} files)`,
    "Review these files thoroughly for all issue categories:",
  ];

  for (const file of params.fullReviewFiles) {
    lines.push(`- ${file}`);
  }

  lines.push(
    "",
    `### Abbreviated Review (${params.abbreviatedFiles.length} files)`,
    "For these files, ONLY flag CRITICAL and MAJOR issues. Skip MEDIUM and MINOR findings:",
  );

  for (const file of params.abbreviatedFiles) {
    lines.push(`- ${file}`);
  }

  if (params.mentionOnlyFiles.length > 0) {
    lines.push(
      "",
      `${params.mentionOnlyFiles.length} additional files were not reviewed (lower risk score). They are listed in the Review Details section.`,
    );
  }

  return lines.join("\n");
}
```

### Pattern 4: Coverage Disclosure in Review Details (LARGE-05, LARGE-07)
**What:** The Review Details summary discloses how many files were reviewed, the prioritization method, and lists skipped files with their risk scores.
**When to use:** Always for large PRs.

```typescript
// Modified formatReviewDetailsSummary to include triage disclosure
function formatReviewDetailsSummary(params: {
  // ...existing params...
  largePRTriage?: {
    fullReviewFiles: string[];
    abbreviatedFiles: string[];
    mentionOnlyFiles: FileRiskScore[];
    totalFiles: number;
  };
}): string {
  // ... existing sections ...

  if (params.largePRTriage) {
    const reviewed = params.largePRTriage.fullReviewFiles.length +
      params.largePRTriage.abbreviatedFiles.length;

    sections.push(
      "",
      `- Review scope: Reviewed ${reviewed}/${params.largePRTriage.totalFiles} files, prioritized by risk`,
      `- Full review: ${params.largePRTriage.fullReviewFiles.length} files`,
      `- Abbreviated review: ${params.largePRTriage.abbreviatedFiles.length} files`,
      `- Mention only: ${params.largePRTriage.mentionOnlyFiles.length} files`,
    );

    // List skipped files with risk scores (LARGE-07)
    if (params.largePRTriage.mentionOnlyFiles.length > 0) {
      sections.push(
        "",
        "<details>",
        "<summary>Files not fully reviewed (sorted by risk score)</summary>",
        "",
      );
      for (const file of params.largePRTriage.mentionOnlyFiles) {
        sections.push(`- ${file.filePath} (risk: ${file.score})`);
      }
      sections.push("", "</details>");
    }
  }

  // ... rest of existing sections ...
}
```

### Pattern 5: Config Schema for `.kodiai.yml`
**What:** Configurable thresholds, tier sizes, and risk weights.
**When to use:** Repo owners who want to customize large PR behavior.

```typescript
// New schema in config.ts
const riskWeightsSchema = z.object({
  linesChanged: z.number().min(0).max(1).default(0.30),
  pathRisk: z.number().min(0).max(1).default(0.30),
  fileCategory: z.number().min(0).max(1).default(0.20),
  languageRisk: z.number().min(0).max(1).default(0.10),
  fileExtension: z.number().min(0).max(1).default(0.10),
}).default({
  linesChanged: 0.30,
  pathRisk: 0.30,
  fileCategory: 0.20,
  languageRisk: 0.10,
  fileExtension: 0.10,
});

const largePRSchema = z.object({
  /** Number of files that triggers large PR triage. Default 50 per LARGE-02. */
  fileThreshold: z.number().min(10).max(1000).default(50),
  /** Number of files to review at full depth. Default 30 per LARGE-04. */
  fullReviewCount: z.number().min(5).max(200).default(30),
  /** Number of files to review at abbreviated depth. Default 20 per LARGE-04. */
  abbreviatedCount: z.number().min(0).max(200).default(20),
  /** Risk scoring weights -- must sum to approximately 1.0. */
  riskWeights: riskWeightsSchema,
}).default({
  fileThreshold: 50,
  fullReviewCount: 30,
  abbreviatedCount: 20,
  riskWeights: {
    linesChanged: 0.30,
    pathRisk: 0.30,
    fileCategory: 0.20,
    languageRisk: 0.10,
    fileExtension: 0.10,
  },
});
```

### Anti-Patterns to Avoid
- **Alphabetical/random file selection:** Never select files for review based on sort order. Always use risk-based prioritization (LARGE-01).
- **Binary include/exclude:** Do not use a binary "review/skip" model. Must have three tiers: full, abbreviated, mention-only (LARGE-04).
- **Post-LLM file filtering:** Do not review all files then filter output. Triage must happen BEFORE the LLM sees the files, to save tokens and execution time.
- **Risk scoring in the prompt:** Do not ask the LLM to score file risk. Risk scoring must be deterministic and pre-computed, not LLM-driven.
- **Silent file omission:** Never silently skip files without disclosure. Every omitted file must be listed with its risk score in Review Details (LARGE-07).
- **Hardcoded tier sizes:** Do not hardcode 30/20 in the scoring module. Use configurable values from `.kodiai.yml` with sensible defaults.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File category classification | New classifier | `filesByCategory` from `diff-analysis.ts` | Already classifies test/config/docs/infra/source with glob patterns |
| Language detection | Extension mapping | `classifyFileLanguage()` from `diff-analysis.ts` | Already maps 25+ extensions to language names |
| Path risk pattern matching | New risk patterns | `PATH_RISK_SIGNALS` from `diff-analysis.ts` | Already identifies auth, crypto, secrets, DB migrations, CI/CD paths |
| Config schema + parsing | Custom parser | Zod schema + `loadRepoConfig()` section fallback | Battle-tested pattern already used for all other config sections |
| Review Details formatting | New summary format | Extend `formatReviewDetailsSummary()` | Already handles the review summary structure with idempotent markers |
| Glob matching | Custom string matching | `picomatch` (already in project) | Used throughout the codebase consistently |

**Key insight:** Phase 40's risk scoring is a composition of existing data that the codebase already computes. The numstat per-file data exists (lines 528-529 of review.ts), the path risk signals exist (diff-analysis.ts lines 120-167), the file categories exist, and the language map exists. The new module primarily composes these into a weighted score. The only genuinely new computation is the composite scoring formula itself.

## Common Pitfalls

### Pitfall 1: Per-File Numstat Parsing
**What goes wrong:** The existing `parseNumstat()` in diff-analysis.ts returns aggregate totals, not per-file breakdowns. Using it as-is gives no per-file line change data.
**Why it happens:** Phase 40 needs per-file stats that the current function was not designed to provide.
**How to avoid:** Create a `parseNumstatPerFile()` function that returns a `Map<string, { added: number; removed: number }>`. This is a new function, not a modification of the existing one. The numstat line format is `<added>\t<removed>\t<filepath>` -- straightforward to parse. Handle binary files (`-\t-\tpath`) by treating them as 0 lines changed.
**Warning signs:** Risk scores of 0 for all files on the `linesChanged` dimension.

### Pitfall 2: Risk Score Normalization
**What goes wrong:** Raw line counts dominate the score because a file with 500 lines changed dwarfs a file with 10, but both might be high risk for different reasons.
**Why it happens:** Linear line counts are not directly comparable to path-risk boolean signals.
**How to avoid:** Normalize the `linesChanged` component using a logarithmic scale or percentile ranking within the PR. Suggested approach: `min(1.0, log10(linesChanged + 1) / log10(maxLinesInPR + 1))`. This maps the file with the most changes to 1.0 and scales others logarithmically. Path risk, category, and language risk are already 0-1 booleans/scores.
**Warning signs:** Files with 1000 lines changed always dominating the top regardless of their path/category.

### Pitfall 3: Interaction with Incremental Review Mode
**What goes wrong:** In incremental re-review mode, `reviewFiles` is already filtered to only files changed since the last review. If this filtered set has fewer than the threshold, triage never activates -- but the full PR might have 200+ files.
**Why it happens:** The triage threshold should consider the full PR size, not just the incremental file set.
**How to avoid:** The triage decision should be based on `changedFiles.length` (all files in the PR), not `reviewFiles.length` (incremental subset). But the actual scoring and tier assignment only applies to `reviewFiles` (the files being reviewed). This means: check threshold against full PR, but only score/triage files in the review set.
**Warning signs:** Large PRs on re-review not triggering triage because the incremental set is small.

### Pitfall 4: Prompt Token Budget Explosion
**What goes wrong:** Including 50 file names in the prompt plus abbreviated file names plus mention-only file list creates a massive prompt that wastes tokens.
**Why it happens:** File lists can be long, especially for 100+ file PRs.
**How to avoid:** Cap the mention-only file list at 50 entries in the prompt (include count for the rest). The full list goes in Review Details (which is a GitHub comment, not part of the LLM prompt). The prompt only includes full-review and abbreviated-review file names.
**Warning signs:** Token costs spiking on large PRs despite triage.

### Pitfall 5: Existing `maxFilesForFullDiff` Interaction
**What goes wrong:** The existing `collectDiffContext()` only fetches full diff content when `changedFiles.length <= 200`. For very large PRs (300+ files), the LLM gets no diff content and must use `git diff` tool calls.
**Why it happens:** This is an existing guard in review.ts line 1081.
**How to avoid:** This is actually fine -- the existing behavior already handles this. The LLM uses `Bash(git diff origin/base...HEAD)` to read diffs as needed. With Phase 40 triage, the LLM knows which files to focus on from the prompt, so it can selectively read diffs for high-priority files. No change needed to `maxFilesForFullDiff`.
**Warning signs:** None expected -- existing behavior is compatible.

### Pitfall 6: Config Weight Validation
**What goes wrong:** User sets risk weights that sum to 2.0 or 0.0, producing meaningless scores.
**Why it happens:** No validation that weights are reasonable.
**How to avoid:** Add a Zod `.refine()` on the riskWeights schema that warns (via config warnings, not errors) when weights sum outside the 0.8-1.2 range. Do not reject the config -- just normalize the weights at runtime by dividing each by the sum. This is fail-open behavior consistent with existing config handling.
**Warning signs:** All files getting identical risk scores.

### Pitfall 7: Review Details Comment Size Limit
**What goes wrong:** Listing 250 mention-only files with risk scores creates a huge GitHub comment.
**Why it happens:** GitHub comments have a 65536 character body limit.
**How to avoid:** Wrap the mention-only file list in a `<details>` tag (collapsible) and cap at 100 entries. Include a note like "Showing 100 of 250 files. Full list available via API." if truncated.
**Warning signs:** GitHub API returning 422 errors when posting the Review Details comment.

## Code Examples

### Per-File Numstat Parser

```typescript
// Source: Based on review.ts line 528-529 numstat format
export type PerFileStats = Map<string, { added: number; removed: number }>;

export function parseNumstatPerFile(numstatLines: string[]): PerFileStats {
  const result: PerFileStats = new Map();

  for (const line of numstatLines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;

    const [addedRaw, removedRaw, ...pathParts] = parts;
    const filePath = pathParts.join("\t"); // handles paths with tabs (rare)

    if (!addedRaw || !removedRaw || !filePath) continue;

    const added = addedRaw === "-" ? 0 : parseInt(addedRaw, 10);
    const removed = removedRaw === "-" ? 0 : parseInt(removedRaw, 10);

    result.set(filePath, {
      added: Number.isNaN(added) ? 0 : added,
      removed: Number.isNaN(removed) ? 0 : removed,
    });
  }

  return result;
}
```

### Composite Risk Score Computation

```typescript
// Source: Codebase patterns from diff-analysis.ts + confidence.ts
import { classifyFileLanguage } from "../execution/diff-analysis.ts";
import picomatch from "picomatch";

const PATH_RISK_PATTERNS: Array<{ patterns: string[]; weight: number }> = [
  { patterns: ["**/auth*", "**/login*", "**/session*", "**/token*", "**/jwt*", "**/oauth*"], weight: 1.0 },
  { patterns: ["**/password*", "**/secret*", "**/credential*", "**/api?key*"], weight: 1.0 },
  { patterns: ["**/*migration*", "**/*schema*"], weight: 0.8 },
  { patterns: ["**/Dockerfile*", "**/.github/**", "**/terraform/**"], weight: 0.5 },
  { patterns: ["package.json", "go.mod", "Cargo.toml", "requirements.txt"], weight: 0.4 },
];

const CATEGORY_RISK: Record<string, number> = {
  source: 1.0,    // Source code is highest risk
  infra: 0.7,     // Infrastructure changes are risky
  config: 0.4,    // Config changes are moderate risk
  test: 0.2,      // Test changes are low risk
  docs: 0.1,      // Doc changes are lowest risk
};

// Languages with manual memory management or null-safety issues score higher
const LANGUAGE_RISK: Record<string, number> = {
  "C": 1.0,
  "C++": 1.0,
  "Rust": 0.5,   // Rust has safety guarantees but unsafe blocks exist
  "Go": 0.6,
  "Java": 0.5,
  "TypeScript": 0.4,
  "JavaScript": 0.5,
  "Python": 0.4,
  "Ruby": 0.4,
  "PHP": 0.6,
  "Unknown": 0.3,
};

export function computeFileRiskScores(params: {
  files: string[];
  perFileStats: PerFileStats;
  filesByCategory: Record<string, string[]>;
  weights: RiskWeights;
}): FileRiskScore[] {
  const { files, perFileStats, filesByCategory, weights } = params;

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
    matchers: patterns.map(p => picomatch(p, { dot: true })),
    weight,
  }));

  return files.map((filePath) => {
    const stats = perFileStats.get(filePath) ?? { added: 0, removed: 0 };
    const totalLines = stats.added + stats.removed;

    // 1. Lines changed (log-normalized)
    const linesScore = maxLines > 0
      ? Math.min(1.0, Math.log10(totalLines + 1) / Math.log10(maxLines + 1))
      : 0;

    // 2. Path risk (highest matching pattern weight)
    let pathScore = 0;
    for (const { matchers, weight: patternWeight } of pathRiskMatchers) {
      if (matchers.some(m => m(filePath))) {
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

    // Weighted composite score
    const rawScore =
      linesScore * weights.linesChanged +
      pathScore * weights.pathRisk +
      categoryScore * weights.fileCategory +
      langScore * weights.languageRisk +
      extScore * weights.fileExtension;

    // Scale to 0-100
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
  }).sort((a, b) => b.score - a.score); // Highest risk first
}

function isExecutableExtension(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const executableExts = new Set([
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
    "py", "pyw", "go", "rs", "java", "kt", "kts", "swift",
    "cs", "cpp", "cc", "cxx", "c", "rb", "php", "scala",
    "sh", "bash", "zsh", "sql", "dart", "lua", "ex", "exs", "zig",
  ]);
  return executableExts.has(ext);
}
```

### Triage Function

```typescript
// Source: Derived from requirements LARGE-02, LARGE-03, LARGE-04
export function triageFilesByRisk(params: {
  riskScores: FileRiskScore[];
  fileThreshold: number;
  fullReviewCount: number;
  abbreviatedCount: number;
}): TieredFiles {
  const { riskScores, fileThreshold, fullReviewCount, abbreviatedCount } = params;
  const totalFiles = riskScores.length;
  const isLargePR = totalFiles > fileThreshold;

  if (!isLargePR) {
    // Below threshold: all files get full review
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
  const abbreviated = riskScores.slice(fullReviewCount, fullReviewCount + abbreviatedCount);
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
```

### Config Example (`.kodiai.yml`)

```yaml
# Example .kodiai.yml with largePR configuration
review:
  enabled: true
  profile: strict

largePR:
  # Number of files that triggers large PR triage
  fileThreshold: 50
  # How many top-risk files get full review
  fullReviewCount: 30
  # How many next-tier files get abbreviated (critical/major only) review
  abbreviatedCount: 20
  # Custom risk scoring weights (must sum to ~1.0)
  riskWeights:
    linesChanged: 0.30
    pathRisk: 0.30
    fileCategory: 0.20
    languageRisk: 0.10
    fileExtension: 0.10
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cap file list at 200 (flat) | Risk-scored tiered triage | Phase 40 (this phase) | High-risk files reviewed first; low-risk files disclosed but not reviewed |
| `isLargePR` boolean flag | Three-tier classification | Phase 40 (this phase) | Replaces binary large/small with full/abbreviated/mention-only |
| "Focus on critical changes" (prompt-only) | Deterministic file selection | Phase 40 (this phase) | File selection is pre-computed, not left to LLM judgment |
| No coverage disclosure | Transparent "Reviewed X/Y" | Phase 40 (this phase) | Users know exactly what was and was not reviewed |

**Key evolution:** Currently, the codebase handles large PRs by capping the changed files list at 200 (line 847 of review-prompt.ts) and telling the LLM "This is a large PR. Focus on the most critical changes." (line 506). This is insufficient because: (1) which files are "most critical" is left to LLM judgment, (2) the first 200 files are alphabetically sorted (not risk-sorted), and (3) there is no disclosure of what was skipped. Phase 40 replaces this with deterministic, risk-based file selection with transparent disclosure.

## Open Questions

1. **Git churn history (historical file change frequency)**
   - What we know: Git can compute historical churn via `git log --follow --diff-filter=M --name-only` per file, but this is expensive for 100+ files in a shallow clone.
   - What's unclear: Whether the shallow clone (depth 50) has enough history to compute meaningful churn data.
   - Recommendation: Defer historical churn to a future enhancement. The current four heuristics (lines changed, path risk, file category, language risk) provide a solid signal without requiring git log per file. If needed later, churn can be added as an additional weight dimension. This keeps Phase 40 scope manageable and avoids expensive git operations during review.

2. **Abbreviated review depth enforcement**
   - What we know: The prompt instructs the LLM "ONLY flag CRITICAL and MAJOR issues" for abbreviated-tier files. The LLM may not perfectly follow this instruction.
   - What's unclear: Whether post-LLM filtering should also enforce abbreviated depth (suppress MEDIUM/MINOR findings on abbreviated files).
   - Recommendation: Add post-LLM enforcement as a safety net. After finding extraction, check each finding's file against the tier map. If a finding is on an abbreviated file and its severity is below MAJOR, suppress it. This is consistent with the Phase 39 pattern of deterministic post-LLM enforcement.

3. **Interaction with `maxComments` config**
   - What we know: The existing `maxComments` (default 7, max 25) limits total inline comments per review.
   - What's unclear: Should `maxComments` be independently configurable for large PRs, or should the existing limit suffice?
   - Recommendation: Use the existing `maxComments` limit as-is for now. The tiered approach naturally concentrates comments on high-risk files, which is the desired behavior. If the limit is too restrictive for large PRs, users can increase `maxComments` in `.kodiai.yml`.

## Sources

### Primary (HIGH confidence)
- `/home/keith/src/kodiai/src/handlers/review.ts` -- Complete review pipeline: diff collection, file filtering, prompt building, finding extraction, enforcement, Review Details output
- `/home/keith/src/kodiai/src/execution/diff-analysis.ts` -- `analyzeDiff()`, `parseNumstat()`, `PATH_RISK_SIGNALS`, `filesByCategory`, `filesByLanguage`, `classifyFileLanguage()`, `isLargePR` logic
- `/home/keith/src/kodiai/src/execution/review-prompt.ts` -- `buildReviewPrompt()`, `buildDiffAnalysisSection()`, changed files list handling, `DEFAULT_MAX_CHANGED_FILES`
- `/home/keith/src/kodiai/src/execution/config.ts` -- Full Zod schema, section-level fallback parsing, `repoConfigSchema`
- `/home/keith/src/kodiai/src/enforcement/` -- Phase 39 enforcement pipeline: `applyEnforcement()`, `EnforcedFinding`, pattern-matching infrastructure
- `/home/keith/src/kodiai/src/knowledge/confidence.ts` -- `SEVERITY_BOOST`, `CATEGORY_BOOST`, confidence scoring patterns
- `/home/keith/src/kodiai/src/knowledge/types.ts` -- `FindingSeverity`, `FindingCategory`, `ReviewRecord`

### Secondary (MEDIUM confidence)
- Phase 39 RESEARCH.md -- Architecture patterns for post-LLM enforcement, config schema extension, pipeline integration
- [Springer: Enhanced code reviews using PR-based change impact analysis](https://link.springer.com/article/10.1007/s10664-024-10600-2) -- Academic research on risk scoring using churn, bug frequency, co-changed files
- [Graphite: How to prioritize code reviews in large projects](https://graphite.com/guides/prioritize-code-reviews-large-projects) -- Industry patterns for risk-based file prioritization

### Tertiary (LOW confidence)
- [Qodo: 5 AI Code Review Pattern Predictions 2026](https://www.qodo.ai/blog/5-ai-code-review-pattern-predictions-in-2026/) -- Industry trends on specialist agents and severity-driven prioritization
- [GitHub: PR Risk Analyzer](https://github.com/ShaikSazid/github-pr-risk-analyzer) -- Community tool for PR risk analysis using multiple heuristics

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already in project, no new dependencies needed
- Architecture: HIGH -- Direct extension of existing review pipeline; integration points clearly identified at specific line numbers
- Risk scoring algorithm: HIGH -- Composite weighted sum is well-established technique; all input data already available in the codebase
- Pitfalls: HIGH -- Derived from thorough analysis of existing code patterns, data flow, and edge cases
- Config schema: HIGH -- Follows exact same Zod pattern used for all other config sections

**Research date:** 2026-02-13
**Valid until:** 60 days (stable domain; scoring heuristics and pipeline patterns unlikely to change)
