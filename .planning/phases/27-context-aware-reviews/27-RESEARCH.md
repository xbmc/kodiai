# Phase 27: Context-Aware Reviews - Research

**Researched:** 2026-02-11
**Domain:** Path-scoped review instructions, profile presets, deterministic diff analysis, and prompt enrichment
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Path Instruction Matching
- Support negative patterns with `!` prefix for exclusions (e.g., `!**/*.test.ts`)
- Multiple match handling: Claude's discretion (choose sensible approach)
- Config structure: Claude's discretion (array vs map - pick most intuitive)
- Fallback behavior: Claude's discretion (define what happens when no patterns match)

#### Diff Analysis Strategy
- File categorization: Hybrid approach with sensible defaults that users can override
- Risk signals to detect:
  - Auth/security patterns (auth*, login, password, token, jwt, session files/imports)
  - Dependency changes (package.json, go.mod, requirements.txt modifications)
  - Error handling changes (try/catch, error boundaries, panic/recover patterns)
- Complexity metrics: Full metrics tracked (lines added/removed, files touched, hunks count)
- Performance boundaries: Both time budget AND file count limit with graceful degradation for large PRs

#### Prompt Enrichment
- Path instruction presentation: Claude's discretion (group by pattern/file/inline - choose clearest)
- Diff analysis formatting: Claude's discretion (structured summary vs prose vs tags - pick what Claude reads best)
- Token budget overflow: Claude's discretion (design smart truncation/prioritization strategy)
- Analysis metadata: Implicit context only - provide enriched data without meta-commentary about what analysis was performed

### Claude's Discretion
- Exact glob matching algorithm and precedence rules
- Config schema structure (array of objects vs map)
- Fallback behavior for unmatched paths
- Prompt formatting for path instructions and diff analysis
- Token budget management strategy
- File categorization default patterns

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

Profile preset design was listed as a gray area but not selected for discussion. Implementation of profiles (what strict/balanced/minimal configure, customization, interaction with explicit config) is left to researcher and planner.

</user_constraints>

## Summary

Phase 27 adds three capabilities to the review system: (1) path-scoped review instructions that let users define different review rules for different directories, (2) named profile presets that bundle severity, focus, and noise settings, and (3) deterministic diff analysis that classifies changed files and detects risk signals before the LLM call. All three enrich the review prompt built by `buildReviewPrompt()` in `src/execution/review-prompt.ts` -- no changes to the executor, MCP servers, or job pipeline are needed.

The implementation surface is well-bounded. Config schema extension follows the exact pattern established in Phase 26 (Zod fields with defaults in `reviewSchema`). Glob matching uses `picomatch`, already a dependency at v4.0.2 with verified negation support via the `scan()` API. Diff analysis is a pure function operating on `git diff --numstat` and `git diff --name-only` output, both already available in the review handler. Profile presets are a thin mapping layer that applies defaults to the existing Phase 26 config fields.

The highest-risk area is the path instruction matching algorithm for multiple overlapping patterns. The recommended approach -- collect all matching instructions cumulatively (like CodeRabbit) with negation patterns filtering out matches -- is simple, predictable, and consistent with how `picomatch` works natively. The prompt token budget requires explicit management since path instructions and diff analysis context are variable-length inputs.

**Primary recommendation:** Implement as two plans: (1) Config schema for pathInstructions and profile presets + diff analysis module, (2) Prompt enrichment integration and handler wiring. Keep all new code as pure functions with no side effects -- diff analysis reads git output, path matching compiles globs, and prompt enrichment concatenates strings.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `picomatch` | ^4.0.2 | Glob pattern matching for pathInstructions | Already used in `review.ts` and `workspace.ts` for skipPaths. Supports negation detection via `scan()`. |
| `zod` | ^4.3.6 | Config schema validation for new fields | Already used for all `.kodiai.yml` parsing in `config.ts` |
| `js-yaml` | ^4.1.1 | YAML config parsing | Already used in `loadRepoConfig()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All requirements use existing dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `picomatch` for glob matching | `micromatch` or `minimatch` | `picomatch` is already installed and used; adding another glob library creates unnecessary divergence |
| Manual negation handling | `picomatch` array patterns | picomatch's array pattern matching with `!` prefix has OR semantics (negation = "everything except"), not AND semantics. Manual separation of include/exclude patterns is more predictable. |
| Regex-based risk signal detection | AST parsing | Regex on file paths and diff content is fast, deterministic, and sufficient for the declared risk signals. AST parsing would be overkill and slow. |

**Installation:**
```bash
# No new packages needed -- all requirements use existing dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── execution/
│   ├── config.ts              # MODIFIED: add review.pathInstructions, review.profile, review.fileCategories
│   ├── config.test.ts         # MODIFIED: tests for new config fields
│   ├── diff-analysis.ts       # NEW: deterministic diff analyzer (pure function)
│   ├── diff-analysis.test.ts  # NEW: tests for diff analyzer
│   ├── review-prompt.ts       # MODIFIED: accept pathInstructions match results, diff analysis, profile context
│   ├── review-prompt.test.ts  # MODIFIED: tests for new prompt sections
│   └── mcp/                   # (unchanged)
├── handlers/
│   └── review.ts              # MODIFIED: run diff analysis, match path instructions, pass to prompt builder
└── (all other files unchanged)
```

### Pattern 1: Path Instruction Matching with Separate Include/Exclude

**What:** Parse `pathInstructions` array, separate patterns into include/exclude groups using `picomatch.scan()`, compile matchers, and for each changed file collect all instructions whose include pattern matches AND whose exclude patterns do not match.

**When to use:** Evaluating which instructions apply to which files.

**Why:** picomatch's `!` prefix means "everything except this". When used in arrays, patterns have OR semantics which produces counterintuitive results (a `!**/*.test.ts` pattern in an array matches everything non-test). Manual separation using `scan().negated` gives precise control.

**Example:**
```typescript
import picomatch from "picomatch";

interface PathInstruction {
  path: string | string[];
  instructions: string;
}

interface MatchedInstruction {
  pattern: string | string[];
  instructions: string;
  matchedFiles: string[];
}

function matchPathInstructions(
  pathInstructions: PathInstruction[],
  changedFiles: string[],
): MatchedInstruction[] {
  const results: MatchedInstruction[] = [];

  for (const pi of pathInstructions) {
    const patterns = Array.isArray(pi.path) ? pi.path : [pi.path];
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];

    for (const p of patterns) {
      const scanned = picomatch.scan(p);
      if (scanned.negated) {
        excludePatterns.push(scanned.glob);
      } else {
        includePatterns.push(p);
      }
    }

    // If no include patterns, treat as match-all (excludes only)
    const includeMatchers = includePatterns.length > 0
      ? includePatterns.map((p) => picomatch(p, { dot: true }))
      : [() => true];
    const excludeMatchers = excludePatterns.map((p) => picomatch(p, { dot: true }));

    const matchedFiles = changedFiles.filter((file) => {
      const included = includeMatchers.some((m) => m(file));
      const excluded = excludeMatchers.some((m) => m(file));
      return included && !excluded;
    });

    if (matchedFiles.length > 0) {
      results.push({
        pattern: pi.path,
        instructions: pi.instructions,
        matchedFiles,
      });
    }
  }

  return results;
}
```

### Pattern 2: Profile Presets as Config Defaults Override

**What:** A profile preset (`strict`, `balanced`, `minimal`) maps to a set of default values for existing Phase 26 config fields (severityMinLevel, maxComments, focusAreas, ignoredAreas). When a profile is set, its defaults apply first, then any explicitly configured fields override them.

**When to use:** When the user wants a named bundle instead of individual field configuration.

**Why:** This avoids duplicating prompt logic. Profiles just set the same config fields that Phase 26 already handles. The prompt builder does not need to know about profiles -- it receives the resolved config values.

**Example:**
```typescript
const PROFILE_PRESETS: Record<string, Partial<ReviewConfig>> = {
  strict: {
    severityMinLevel: "minor" as const,    // Report everything
    maxComments: 15,                        // More comments allowed
    ignoredAreas: [],                       // Nothing ignored
    // focusAreas: [] means all categories
  },
  balanced: {
    severityMinLevel: "medium" as const,   // Skip minor findings
    maxComments: 7,                         // Standard limit
    ignoredAreas: ["style" as const],       // Suppress style nits
  },
  minimal: {
    severityMinLevel: "major" as const,    // Only major+ issues
    maxComments: 3,                         // Very few comments
    ignoredAreas: ["style" as const, "documentation" as const],
  },
};

function resolveProfileDefaults(
  profile: string | undefined,
  explicit: Partial<ReviewConfig>,
): ReviewConfig {
  const base = profile ? PROFILE_PRESETS[profile] ?? {} : {};
  // Explicit config wins over profile defaults
  return { ...DEFAULTS, ...base, ...explicit };
}
```

### Pattern 3: Deterministic Diff Analysis as Pure Function

**What:** A pure function that takes git diff output (numstat + name-only) and returns structured analysis: file classifications, risk signals, and complexity metrics. No side effects, no git commands inside -- the caller provides the raw data.

**When to use:** Before building the review prompt, after git commands have run.

**Why:** Pure functions are trivially testable, fast, and deterministic. Separation of git I/O from analysis logic makes both easier to test and maintain.

**Example:**
```typescript
interface DiffAnalysisInput {
  changedFiles: string[];
  numstatLines: string[];  // Output of `git diff --numstat`
  fileCategories?: Record<string, string[]>;  // User overrides from config
}

interface DiffAnalysis {
  filesByCategory: Record<string, string[]>;
  riskSignals: string[];
  metrics: {
    totalFiles: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    hunksCount: number;
  };
  isLargePR: boolean;
}

function analyzeDiff(input: DiffAnalysisInput): DiffAnalysis {
  // ... classify files, detect risks, compute metrics
}
```

### Pattern 4: Bounded Context Injection with Priority Truncation

**What:** All variable-length context (path instructions, diff analysis) has explicit character limits. When content exceeds the limit, prioritize by: (1) risk-signal-matched instructions first, (2) shorter/more-specific patterns over broad patterns, (3) truncate from the end with a note.

**When to use:** Injecting any dynamic content into the prompt.

**Why:** Unbounded content can blow up token costs and degrade review quality by diluting the signal. The existing `truncateDeterministic()` helper in `review-prompt.ts` already follows this pattern.

### Anti-Patterns to Avoid
- **LLM call for diff analysis:** The whole point is deterministic analysis without extra API cost. Use regex/string matching, not Claude.
- **Profile preset as a separate prompt path:** Profiles resolve to the same config fields Phase 26 uses. Do not create separate prompt builders for each profile.
- **Storing computed path instruction matches:** These are ephemeral per-review. Do not persist them. Recompute each time.
- **Complex pattern precedence rules:** "Last match wins" or "most specific wins" adds cognitive load. Cumulative matching (all matching instructions apply) is simpler and what CodeRabbit uses.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching | Custom glob parser | `picomatch` (already installed) | Glob matching has edge cases (brace expansion, character classes, dotfiles). picomatch handles all of them. |
| Negation detection | Manual `!` prefix stripping | `picomatch.scan(pattern).negated` | The `scan()` API returns structured parse results including the negation flag and the raw glob. Reliable and tested. |
| Diff stat parsing | Custom line parser | Regex on `git diff --numstat` output | numstat is tab-delimited `added\tremoved\tpath`. A single regex handles it. Don't build a parser class. |
| File extension mapping | Custom extension-to-category map | Hardcoded defaults with user overrides | The category set is small (source/test/config/docs/infra). A simple map with pattern matching covers 95% of cases. |
| Profile resolution | Dedicated profile engine | Object spread with precedence | `{ ...defaults, ...profileDefaults, ...explicitConfig }` is the entire "engine". |

**Key insight:** Phase 27 is fundamentally about data preparation and prompt enrichment. Every component is a pure function that transforms inputs (config, file list, diff stats) into prompt text. No persistent state, no external calls, no complex engines needed.

## Common Pitfalls

### Pitfall 1: picomatch Array Negation Semantics

**What goes wrong:** Using `picomatch(['src/**', '!**/*.test.ts'])` as a single compiled matcher gives OR semantics. The `!**/*.test.ts` pattern matches "everything that is NOT a test file", so the combined matcher matches everything (because either pattern is true for any file).

**Why it happens:** picomatch arrays use logical OR -- a path matches if it matches ANY pattern in the array. A negation pattern `!X` means "not X", which matches everything except X. So `['src/**', '!**/*.test.ts']` matches `src/**` OR `not *.test.ts`, which is... everything.

**How to avoid:** Separate include and exclude patterns manually. Use `picomatch.scan(pattern).negated` to detect negation, strip the `!` prefix, compile include and exclude matchers separately, and apply AND logic: `included && !excluded`.

**Warning signs:** If a path instruction with `!` exclusion patterns matches files it should not match, the array negation trap is in play.

### Pitfall 2: Profile Overriding Explicit Config

**What goes wrong:** User sets `review.profile: strict` AND `review.maxComments: 3`. If the profile is applied last, it overrides the explicit `maxComments: 3` with the strict default of 15.

**Why it happens:** Unclear precedence between profile defaults and explicit config values.

**How to avoid:** Always apply in this order: global defaults -> profile defaults -> explicit config. Explicit config always wins over profile defaults. Implement as `{ ...defaults, ...profilePreset, ...explicitConfig }`.

**Warning signs:** User reports that setting both `profile` and individual fields produces unexpected behavior.

### Pitfall 3: Diff Analysis Timeout on Large PRs

**What goes wrong:** A PR with 500+ changed files or 10,000+ lines causes the diff analysis to take too long, delaying the review.

**Why it happens:** Parsing numstat output and running risk signal detection scales linearly with file count and diff size.

**How to avoid:** Enforce two limits: (1) time budget of 500ms for the entire analysis, and (2) file count cap of 200 files. For PRs exceeding these, gracefully degrade: classify only the first N files, skip risk signal content scanning, and add a "large PR" signal to the analysis output. The existing `DEFAULT_MAX_CHANGED_FILES = 200` constant in `review-prompt.ts` already caps the file list.

**Warning signs:** Review latency spikes on large PRs. Monitor the diff analysis duration in logs.

### Pitfall 4: Risk Signal Content Scanning via Diff Body

**What goes wrong:** Attempting to scan the actual diff content (not just file paths) for patterns like `try/catch`, `password`, etc. requires reading the full diff output, which can be very large.

**Why it happens:** The locked decision includes "Error handling changes (try/catch, error boundaries, panic/recover patterns)" as a risk signal, which implies content-level scanning, not just path-level.

**How to avoid:** Tier the risk signal detection: Tier 1 (path-based, always run) detects auth files, dependency files, and infra files by path pattern alone. Tier 2 (content-based, run only for files under the cap) scans diff hunks for specific patterns. Apply the file count cap before Tier 2 scanning. Use `git diff --numstat` for Tier 1 and `git diff` (full output) only for Tier 2 when needed.

**Warning signs:** Memory usage spikes on large PRs due to loading the full diff into memory.

### Pitfall 5: Path Instructions Token Budget Explosion

**What goes wrong:** A user defines 20 path instructions with multi-paragraph instruction text. When 15 of them match files in a PR, the prompt grows by thousands of tokens, increasing cost and potentially degrading review quality.

**How to avoid:** Set a total character limit for the path instructions prompt section (recommended: 3000 characters). When the total exceeds the limit: (1) prioritize instructions that match risk-signal files, (2) truncate individual instructions to their first sentence, (3) if still over budget, drop the least-specific patterns (e.g., `**` before `src/api/**`). Add a truncation note: "Note: Some path instructions were truncated due to prompt size limits."

**Warning signs:** Review cost increases significantly for repos with many path instructions.

### Pitfall 6: Config Schema Interaction Between Profile and Phase 26 Fields

**What goes wrong:** The `review.profile` field sets defaults for fields that Phase 26 already defines (`severity.minLevel`, `maxComments`, `focusAreas`, `ignoredAreas`). If both are present in `.kodiai.yml`, the resolution order is unclear.

**How to avoid:** Document clearly: "When `review.profile` is set, it provides default values for severity, maxComments, focusAreas, and ignoredAreas. Any fields you explicitly set override the profile defaults." Resolution happens in the handler before calling `buildReviewPrompt()`, not in the config parser. The config parser just reads and validates each field independently.

**Warning signs:** Different behavior depending on field order in the YAML file (which should never happen -- YAML objects are unordered).

## Code Examples

Verified patterns from the existing codebase:

### Config Schema Extension for pathInstructions

```typescript
// Recommended schema addition to reviewSchema in config.ts
// Follows the array-of-objects pattern used by CodeRabbit

const pathInstructionSchema = z.object({
  path: z.union([z.string(), z.array(z.string())]),
  instructions: z.string(),
});

// Add to reviewSchema:
pathInstructions: z.array(pathInstructionSchema).default([]),
profile: z.enum(["strict", "balanced", "minimal"]).optional(),

// File categorization overrides (hybrid approach)
fileCategories: z
  .object({
    source: z.array(z.string()).optional(),
    test: z.array(z.string()).optional(),
    config: z.array(z.string()).optional(),
    docs: z.array(z.string()).optional(),
    infra: z.array(z.string()).optional(),
  })
  .optional(),
```

### Example .kodiai.yml with pathInstructions

```yaml
review:
  profile: balanced
  pathInstructions:
    - path: "src/api/**"
      instructions: |
        Apply strict security review: check for SQL injection,
        authentication bypass, and input validation issues.
        All API endpoints must validate request parameters.
    - path: ["src/db/**", "!**/*.test.ts"]
      instructions: |
        Check for proper transaction handling and connection cleanup.
        Verify prepared statements are used for all queries.
    - path: "**/*.test.ts"
      instructions: |
        Verify tests cover error paths and edge cases.
        Do not flag missing tests for trivial changes.
  fileCategories:
    infra:
      - "deploy/**"
      - "scripts/**"
```

### Diff Analysis Pure Function

```typescript
// Source: new file src/execution/diff-analysis.ts

const DEFAULT_FILE_CATEGORIES: Record<string, string[]> = {
  test: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test/**", "**/tests/**"],
  config: [
    "**/*.json", "**/*.yml", "**/*.yaml", "**/*.toml", "**/*.ini",
    "**/tsconfig*", "**/.eslintrc*", "**/.prettierrc*", "**/jest.config*",
    "**/vite.config*", "**/webpack.config*",
  ],
  docs: ["**/*.md", "**/*.txt", "**/*.rst", "**/LICENSE*", "**/CHANGELOG*"],
  infra: [
    "**/Dockerfile*", "**/.github/**", "**/terraform/**", "**/pulumi/**",
    "**/.gitlab-ci*", "**/Jenkinsfile*", "**/deploy*",
  ],
  // source: everything else (default category)
};

const PATH_RISK_PATTERNS = [
  { patterns: ["**/auth*", "**/login*", "**/session*", "**/token*", "**/jwt*", "**/oauth*"],
    signal: "Modifies authentication/authorization code" },
  { patterns: ["**/password*", "**/secret*", "**/credential*", "**/api?key*", "**/*.pem", "**/*.key"],
    signal: "Touches credential/secret-related files" },
  { patterns: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                "go.mod", "go.sum", "Cargo.toml", "Cargo.lock",
                "requirements.txt", "Pipfile.lock", "Gemfile.lock"],
    signal: "Modifies dependency manifest" },
  { patterns: ["**/Dockerfile*", "**/.github/**", "**/terraform/**", "**/deploy*"],
    signal: "Changes CI/CD or infrastructure configuration" },
  { patterns: ["**/*migration*", "**/*schema*"],
    signal: "Modifies database schema or migrations" },
];

// Content-level risk patterns (applied to diff hunks, not paths)
const CONTENT_RISK_PATTERNS = [
  { pattern: /(?:try\s*\{|catch\s*\(|\.catch\(|panic\(|recover\(|error\s+handling)/i,
    signal: "Modifies error handling logic" },
  { pattern: /(?:crypto|encrypt|decrypt|hash|sign|verify|bcrypt|argon)/i,
    signal: "Touches cryptographic code" },
];

interface NumstatEntry {
  added: number;
  removed: number;
  file: string;
}

function parseNumstat(lines: string[]): NumstatEntry[] {
  return lines
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const parts = line.split("\t");
      const added = parts[0] === "-" ? 0 : parseInt(parts[0]!, 10);
      const removed = parts[1] === "-" ? 0 : parseInt(parts[1]!, 10);
      return { added, removed, file: parts[2]! };
    })
    .filter((e) => !isNaN(e.added) && e.file);
}
```

### Profile Preset Resolution

```typescript
// Resolve profile + explicit config into final values
// In the handler, BEFORE calling buildReviewPrompt()

interface ProfilePreset {
  severityMinLevel: "critical" | "major" | "medium" | "minor";
  maxComments: number;
  ignoredAreas: string[];
  focusAreas: string[];
}

const PROFILE_PRESETS: Record<string, ProfilePreset> = {
  strict: {
    severityMinLevel: "minor",
    maxComments: 15,
    ignoredAreas: [],
    focusAreas: [],
  },
  balanced: {
    severityMinLevel: "medium",
    maxComments: 7,
    ignoredAreas: ["style"],
    focusAreas: [],
  },
  minimal: {
    severityMinLevel: "major",
    maxComments: 3,
    ignoredAreas: ["style", "documentation"],
    focusAreas: ["security", "correctness"],
  },
};

// Resolution order: defaults -> profile -> explicit config
// The handler applies this BEFORE calling buildReviewPrompt()
```

### Prompt Enrichment for Path Instructions

```typescript
// Recommended prompt format: group by instruction, list matching files

function buildPathInstructionsSection(
  matched: MatchedInstruction[],
  maxChars: number = 3000,
): string {
  if (matched.length === 0) return "";

  const lines: string[] = ["## Path-Specific Review Instructions", ""];

  let charCount = lines[0]!.length + 2;

  for (const m of matched) {
    const patternStr = Array.isArray(m.pattern) ? m.pattern.join(", ") : m.pattern;
    const filesStr = m.matchedFiles.slice(0, 5).join(", ");
    const filesNote = m.matchedFiles.length > 5
      ? ` (and ${m.matchedFiles.length - 5} more)`
      : "";

    const section = [
      `**${patternStr}** (applies to: ${filesStr}${filesNote})`,
      m.instructions.trim(),
      "",
    ].join("\n");

    if (charCount + section.length > maxChars) {
      lines.push(
        "_Note: Additional path instructions were truncated due to prompt size limits._",
      );
      break;
    }

    lines.push(section);
    charCount += section.length;
  }

  return lines.join("\n");
}
```

### Prompt Enrichment for Diff Analysis

```typescript
// Recommended prompt format: structured implicit context
// (no meta-commentary about "analysis was performed")

function buildDiffAnalysisSection(analysis: DiffAnalysis): string {
  const lines: string[] = ["## Change Context", ""];

  // Scale
  lines.push(
    `This PR modifies ${analysis.metrics.totalFiles} files ` +
    `(+${analysis.metrics.totalLinesAdded} / -${analysis.metrics.totalLinesRemoved} lines).`,
  );

  if (analysis.isLargePR) {
    lines.push("This is a large PR. Focus on the most critical changes.");
  }

  // File categories
  const categories = Object.entries(analysis.filesByCategory)
    .filter(([, files]) => files.length > 0)
    .map(([cat, files]) => `- ${cat}: ${files.length} file(s)`)
    .join("\n");
  if (categories) {
    lines.push("", "File breakdown:", categories);
  }

  // Risk signals
  if (analysis.riskSignals.length > 0) {
    lines.push(
      "",
      "Pay special attention to these areas:",
      ...analysis.riskSignals.map((s) => `- ${s}`),
    );
  }

  return lines.join("\n");
}
```

## Discretion Recommendations

These are recommendations for the areas marked as "Claude's Discretion" in CONTEXT.md.

### 1. Glob Matching Algorithm and Precedence Rules

**Recommendation: Cumulative matching with explicit include/exclude separation.**

When a file matches multiple `pathInstructions` entries, ALL matching instructions apply (cumulative, not "last match wins"). This is the approach CodeRabbit uses and it is the most intuitive: if a file is `src/api/auth.ts`, it gets instructions from both `src/api/**` and `src/**/auth*` patterns.

For negation: use `picomatch.scan(pattern).negated` to detect `!`-prefixed patterns. Separate into include and exclude lists. A file matches an instruction entry when: ANY include pattern matches AND NO exclude patterns match. If no include patterns exist (only excludes), treat as "all files minus excludes".

Precedence within a single entry's pattern array: include/exclude logic (AND). Precedence across entries: cumulative (all matches concatenated in config order).

### 2. Config Schema Structure (Array vs Map)

**Recommendation: Array of objects (like CodeRabbit).**

```yaml
review:
  pathInstructions:
    - path: "src/api/**"
      instructions: "Check for security issues..."
    - path: ["src/db/**", "!**/*.test.ts"]
      instructions: "Check transaction handling..."
```

**Why array over map:**
- Allows the `path` field to be a string OR array of strings (multiple patterns per instruction)
- Preserves declaration order (YAML maps have no guaranteed order in some parsers)
- Easier to add future fields per entry (e.g., `severity` override per path)
- Matches the established `review.skipPaths` array pattern in the codebase
- Same structure as CodeRabbit's `path_instructions`, reducing learning curve

### 3. Fallback Behavior for Unmatched Paths

**Recommendation: No special fallback. Unmatched files get the standard review without extra instructions.**

Files that do not match any `pathInstructions` entry are reviewed using only the base review prompt (severity classification, focus areas, noise suppression, etc.). There is no need for a "default" path instruction. The base prompt already provides comprehensive review guidance.

This is the simplest approach and avoids the question of "what is the fallback instruction?". If a user wants a catch-all instruction, they can add a `path: "**"` entry.

### 4. Prompt Formatting for Path Instructions

**Recommendation: Group by instruction entry, list matching files inline.**

Format in the prompt:

```
## Path-Specific Review Instructions

**src/api/** (applies to: src/api/auth.ts, src/api/users.ts)
Check for SQL injection, authentication bypass, and input validation.
All API endpoints must validate request parameters.

**src/db/** (applies to: src/db/queries.ts)
Check for proper transaction handling and connection cleanup.
```

**Why this format:**
- Grouped by instruction (not by file) reduces repetition when many files match one pattern
- File list gives Claude concrete targets for each instruction set
- Bold pattern header makes it easy for Claude to reference which rule it is applying
- Natural reading order: "for these files, do this"

### 5. Diff Analysis Formatting

**Recommendation: Structured section with implicit context (no meta-commentary).**

The diff analysis appears in the prompt as "## Change Context" with factual statements about the PR scope. No phrasing like "The system analyzed the diff and found..." -- just state the facts:

```
## Change Context

This PR modifies 12 files (+340 / -120 lines).

File breakdown:
- source: 8 file(s)
- test: 3 file(s)
- config: 1 file(s)

Pay special attention to these areas:
- Modifies authentication/authorization code
- Modifies dependency manifest
```

This follows the locked decision: "Implicit context only -- provide enriched data without meta-commentary about what analysis was performed."

### 6. Token Budget Management Strategy

**Recommendation: Character limits per section with priority-based truncation.**

| Section | Character Limit | Priority |
|---------|----------------|----------|
| Path instructions | 3000 chars | Risk-signal-matching instructions first, then by pattern specificity |
| Diff analysis | 1000 chars | Always included (compact format) |
| Risk signals | 500 chars | Always included (bounded by max 10 signals) |

When path instructions exceed 3000 chars:
1. Sort by relevance: instructions matching risk-signal files first
2. Truncate individual instruction text to first 200 chars with "..." suffix
3. Drop the least-specific pattern entries (broadest patterns like `**` first)
4. Add a truncation note at the end

This ensures the most relevant instructions survive truncation.

### 7. File Categorization Default Patterns

**Recommendation: Five categories with sensible defaults, user-overridable.**

| Category | Default Patterns |
|----------|-----------------|
| `test` | `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/test/**`, `**/tests/**` |
| `config` | `**/*.json`, `**/*.yml`, `**/*.yaml`, `**/*.toml`, `tsconfig*`, `.eslintrc*`, `.prettierrc*`, `jest.config*`, `vite.config*`, `webpack.config*` |
| `docs` | `**/*.md`, `**/*.txt`, `**/*.rst`, `LICENSE*`, `CHANGELOG*` |
| `infra` | `Dockerfile*`, `.github/**`, `terraform/**`, `pulumi/**`, `.gitlab-ci*`, `Jenkinsfile*`, `deploy*` |
| `source` | Everything not matching above categories (default/catch-all) |

Users can override with `review.fileCategories` in config to add patterns for their specific project structure. Override is additive -- user patterns are added to defaults for that category.

### 8. Profile Preset Design

**Recommendation: Three profiles mapping to existing Phase 26 config fields.**

| Profile | severity.minLevel | maxComments | ignoredAreas | focusAreas |
|---------|-------------------|-------------|--------------|------------|
| `strict` | `minor` (report all) | 15 | `[]` (none) | `[]` (all) |
| `balanced` | `medium` | 7 | `["style"]` | `[]` (all) |
| `minimal` | `major` | 3 | `["style", "documentation"]` | `["security", "correctness"]` |

Profile sets defaults that explicit config fields override. The profile field is optional -- omitting it preserves Phase 26 behavior.

The `balanced` profile is designed to be the most common choice: it skips minor findings, suppresses style nits, and keeps a reasonable comment count. The `minimal` profile is for repos that only want critical safety reviews. The `strict` profile is for security-critical repos that want thorough review.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single review prompt for all files | Path-scoped instructions with per-directory rules | 2024-2025 (CodeRabbit, Qodo) | Enables repo-specific conventions in AI review |
| Manual configuration of multiple fields | Named profile presets as bundles | 2024-2025 (CodeRabbit "chill"/"assertive") | Reduces configuration burden for common use cases |
| LLM-based diff triage | Deterministic pre-analysis with heuristics | 2025-2026 (industry trend) | Eliminates extra API cost while providing context |
| Flat file list in prompt | Categorized file breakdown with risk signals | 2025-2026 | Helps LLM prioritize review effort |

**Industry patterns observed:**
- CodeRabbit uses `path_instructions` with glob patterns and cumulative matching (multiple instructions can apply to one file)
- CodeRabbit profiles: `chill` and `assertive` map to review strictness settings
- All major AI code review tools now pre-analyze diffs to provide structured context to the LLM
- Risk signal detection is universally done via heuristics (path patterns, keyword matching), not LLM calls

## Open Questions

1. **Hunk count from git diff**
   - What we know: The locked decision requests "hunks count" as a complexity metric. `git diff --numstat` provides lines added/removed per file but not hunk count.
   - What's unclear: Whether we need a separate `git diff --stat` call or can parse hunk headers from the full diff.
   - Recommendation: Use `git diff --stat` which provides a per-file summary line but still no hunk count. For actual hunk count, parse `@@` markers from `git diff` output for each file. Since this requires reading the full diff, only do it for files under the cap (200 files). For large PRs, report "N/A" for hunk count. The cost is low since the review handler already runs `git diff --name-only`.

2. **Content-based risk signal scanning scope**
   - What we know: The locked decision includes "error handling changes (try/catch, error boundaries, panic/recover patterns)" which requires scanning diff content, not just paths.
   - What's unclear: Whether to scan the full diff or just file names for these patterns.
   - Recommendation: Scan diff hunks (not the full file content) for content-based risk signals. Limit to the first 50KB of total diff content to bound memory usage. This provides reasonable coverage without loading entire diffs for very large PRs.

3. **Profile interaction with enhanced mode**
   - What we know: Phase 26 added `review.mode: standard|enhanced`. Profiles set severity/maxComments/focusAreas/ignoredAreas but not mode.
   - What's unclear: Should profiles set mode too? (e.g., `strict` implies `enhanced`)
   - Recommendation: Keep mode independent of profiles. Mode is an output format choice, while profiles are about review strictness. A user might want `profile: strict` with `mode: standard` (strict review, simple format). Let them be orthogonal.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/execution/config.ts` -- config schema pattern, Zod validation, section-level fallback (366 lines)
- Codebase analysis: `src/execution/review-prompt.ts` -- prompt construction, truncation helper, section assembly (389 lines)
- Codebase analysis: `src/handlers/review.ts` -- review handler pipeline, git diff commands, picomatch usage (708 lines)
- Codebase analysis: `src/execution/mcp/inline-review-server.ts` -- inline comment creation (unchanged)
- Codebase analysis: `package.json` -- picomatch ^4.0.2, zod ^4.3.6 confirmed
- Local testing: picomatch negation behavior verified with `scan()` API and manual include/exclude separation
- Phase 26 research and verification: `.planning/phases/26-review-mode-severity-control/26-RESEARCH.md`, `26-VERIFICATION.md`
- Architecture research: `.planning/research/ARCHITECTURE.md` -- diff analyzer design, integration points, prompt enrichment pattern

### Secondary (MEDIUM confidence)
- [CodeRabbit YAML configuration](https://docs.coderabbit.ai/getting-started/yaml-configuration) -- path_instructions structure, profile presets
- [CodeRabbit review instructions and customization (DeepWiki)](https://deepwiki.com/coderabbitai/coderabbit-docs/4.1-review-instructions-and-customization) -- cumulative matching behavior, glob pattern syntax
- Industry survey: path-scoped instructions and deterministic pre-analysis are standard patterns across CodeRabbit, Qodo, and Graphite

### Tertiary (LOW confidence)
- Hunk count parsing from `@@` markers -- approach is sound but needs validation in edge cases (binary files, rename-only diffs, submodules)
- Content-based risk signal scanning performance on very large diffs (>100KB) -- needs testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns verified in codebase and locally tested
- Architecture: HIGH -- extends existing config/prompt/handler pattern with no structural changes; diff analysis is a pure function
- Pitfalls: HIGH -- picomatch negation behavior verified locally; token budget overflow and large PR degradation are known patterns
- Discretion recommendations: HIGH for config structure and matching (verified against CodeRabbit patterns); MEDIUM for profile preset values (reasonable but may need tuning after deployment)

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable domain -- config schema and glob patterns do not change rapidly)
