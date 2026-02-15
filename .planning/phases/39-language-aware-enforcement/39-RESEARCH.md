# Phase 39: Language-Aware Enforcement - Research

**Researched:** 2026-02-13
**Domain:** Post-LLM finding filtering, severity enforcement, language-aware tooling detection
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Severity Floor Enforcement Strategy
- **Context-aware enforcement**: Severity floors apply conditionally based on code context, not unconditionally to all instances
- **Factors that affect enforcement**:
  - File type (test vs production vs example code) -- relax floors in test files
  - Code criticality markers -- use file paths, comments, or annotations to identify critical sections
  - Language ecosystem norms -- adjust based on how the language community treats the pattern (e.g., Go's strict error handling culture)
- **When a pattern is detected**: Check context factors first, then apply floor if context indicates production/critical code

#### Pattern Catalog Scope
- **Hybrid approach to pattern sources**:
  - **Built-in catalog**: Core universally-dangerous patterns (C++ null deref/uninitialized members -> CRITICAL, Go unchecked errors/Python bare except -> MAJOR)
  - **Project-derived patterns**: Analyze last 100 closed PRs in kodiai repo, extract common safety-critical patterns specific to this project
  - **Pattern classification logic**: If a pattern from PR history is obviously universal (e.g., null pointer issues), add to built-in catalog. If project-specific (e.g., specific API misuse), keep in example `.kodiai.yml` config
- **Initial seed set**: Start with patterns mentioned in requirements + patterns derived from kodiai PR history (not a comprehensive multi-language catalog on day one)
- **Extensibility**: Design pattern definition format to allow easy addition without code changes

#### Pattern Analysis from PR History
- **Data source**: Last 100 closed PRs in the kodiai repository
- **What to extract**: Patterns that appeared in review comments or fixes -- particularly those related to correctness, safety, or security
- **Focus languages**: TypeScript (primary), any other languages present in the codebase
- **Output**: Document patterns found, severity levels applied, and whether they should be built-in or project-specific

### Claude's Discretion
- Exact data structure for storing patterns (JSON schema, TypeScript types)
- How to detect file type (test vs prod) -- heuristics, path patterns, etc.
- How to match LLM-generated findings to known patterns for floor enforcement
- Configuration file format details for `.kodiai.yml` language rules

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

## Summary

This phase adds two deterministic post-LLM enforcement layers to the existing review pipeline: (1) suppression of auto-fixable findings when language-specific formatter/linter config exists in the repo, and (2) elevation of safety-critical finding severity to minimum floors based on pattern matching. Both operate on `ExtractedFinding[]` objects after Claude produces review comments but before they are finalized -- the exact same pipeline stage where existing suppression rules and confidence filtering already operate in `review.ts` lines 1284-1335.

The codebase already has all the architectural scaffolding needed. The `filesByCategory` from `diff-analysis.ts` classifies test files using glob patterns (`**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`). The `LANGUAGE_GUIDANCE` map in `review-prompt.ts` already maps language names to safety patterns. The `.kodiai.yml` config system uses Zod schemas with section-level fallback parsing. The `matchesSuppression()` function in `confidence.ts` supports glob, regex, and substring patterns. All of these are direct extension points.

The primary engineering challenge is designing the pattern-matching between LLM-generated finding titles (free-form English text) and known dangerous patterns (structured identifiers). This is a fuzzy matching problem -- the LLM might write "Potential null pointer dereference" or "NPE when user is null" for the same underlying issue. The recommended approach is keyword-set matching (presence of multiple required keywords) rather than exact string matching or regex.

**Primary recommendation:** Build a `LanguageEnforcementEngine` module with two pure functions (`suppressToolingFindings` and `enforceSeverityFloors`) that slot into the existing post-extraction processing pipeline in `review.ts`, between finding extraction (line 1271) and suppression matching (line 1284). Detect formatter/linter configs by checking workspace filesystem at review time. Use keyword-set pattern matching for severity floor enforcement.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `picomatch` | (existing) | Glob pattern matching for file paths | Already used throughout codebase for path matching |
| `zod` | (existing) | Schema validation for `.kodiai.yml` language rules | Already used for all config validation |
| `js-yaml` | (existing) | YAML parsing for `.kodiai.yml` | Already used in `loadRepoConfig()` |
| `bun:test` | (existing) | Test framework | Already used for all tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs/promises` | (builtin) | Check for formatter/linter config files in workspace | Detecting `.prettierrc`, `.eslintrc`, etc. |
| `node:path` | (builtin) | File path manipulation | Joining workspace dir with config file names |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Keyword-set matching | Regex matching | Regex is more precise but brittle -- LLM output varies unpredictably |
| Filesystem config detection | Git tree listing | Filesystem is simpler and workspace already exists on disk |
| Inline severity rewriting | Post-hoc comment editing | Rewriting inline comment text requires API calls and marker management; severity field override in finding metadata is simpler |

**Installation:** No new dependencies needed. All required libraries are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── enforcement/                    # NEW: Language-aware enforcement module
│   ├── types.ts                    # Pattern, config, and enforcement types
│   ├── tooling-detection.ts        # Detect formatter/linter configs in workspace
│   ├── tooling-detection.test.ts
│   ├── severity-floors.ts          # Pattern catalog + severity floor enforcement
│   ├── severity-floors.test.ts
│   ├── tooling-suppression.ts      # Suppress findings covered by detected tooling
│   ├── tooling-suppression.test.ts
│   └── index.ts                    # Public API: enforcementPipeline()
├── execution/
│   ├── config.ts                   # MODIFIED: Add languageRules schema
│   └── review-prompt.ts            # MINOR CHANGE: Use enforcement-aware suppression text
└── handlers/
    └── review.ts                   # MODIFIED: Call enforcement pipeline post-extraction
```

### Pattern 1: Post-Extraction Processing Pipeline
**What:** The enforcement engine operates on `ExtractedFinding[]` after LLM execution but before final filtering/publishing.
**When to use:** Always -- this is the core architectural insertion point.
**Why this location:** The existing code already has this exact pattern at lines 1284-1335 in `review.ts`. Findings are extracted from review comments, then processed through suppression/confidence before filtered findings get their inline comments deleted. The enforcement engine slots in just before this existing processing.

```typescript
// Source: review.ts existing pipeline (lines 1270-1335)
// Current flow:
//   1. extractFindingsFromReviewComments() -> ExtractedFinding[]
//   2. suppressionMatchCounts + processedFindings mapping
//   3. visibleFindings / lowConfidenceFindings / filteredInlineFindings
//   4. removeFilteredInlineComments()

// NEW flow (insert between steps 1 and 2):
//   1. extractFindingsFromReviewComments() -> ExtractedFinding[]
//   1a. detectRepoTooling(workspace.dir) -> ToolingConfig
//   1b. suppressToolingFindings(findings, toolingConfig) -> findings with .toolingSuppressed
//   1c. enforceSeverityFloors(findings, filesByCategory, config.languageRules) -> findings with elevated severity
//   2. existing suppression matching (unchanged)
//   3-4. existing filtering (unchanged)
```

### Pattern 2: Tooling Config Detection (Filesystem-Based)
**What:** Scan the workspace directory for known formatter/linter config files.
**When to use:** Once per review, before finding processing.

```typescript
// Recommended implementation pattern
export type DetectedTooling = {
  formatters: Map<string, string[]>;  // language -> config files found
  linters: Map<string, string[]>;     // language -> config files found
};

// Config files to detect per language
const FORMATTER_CONFIGS: Record<string, string[]> = {
  JavaScript: [".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.js", ".prettierrc.cjs", "prettier.config.js", "prettier.config.cjs", ".editorconfig"],
  TypeScript: [".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.js", ".prettierrc.cjs", "prettier.config.js", "prettier.config.cjs", ".editorconfig"],
  Python: [".black.toml", "pyproject.toml", ".editorconfig"],  // pyproject.toml needs [tool.black] check
  "C++": [".clang-format", ".editorconfig"],
  C: [".clang-format", ".editorconfig"],
  Go: [".editorconfig"],  // gofmt is built-in, always active
  Rust: ["rustfmt.toml", ".rustfmt.toml", ".editorconfig"],
  Java: [".editorconfig", "google-java-format.xml"],
};

const LINTER_CONFIGS: Record<string, string[]> = {
  JavaScript: [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"],
  TypeScript: [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"],
  Python: ["setup.cfg", "tox.ini", ".flake8", ".pylintrc", "pyproject.toml"],  // pyproject.toml needs [tool.flake8] or [tool.ruff]
  Go: [".golangci.yml", ".golangci.yaml", ".golangci.json"],
  Rust: ["clippy.toml", ".clippy.toml"],
};

async function detectRepoTooling(workspaceDir: string): Promise<DetectedTooling> {
  // Check file existence using Bun.file(path).exists()
  // Return map of detected tooling per language
}
```

### Pattern 3: Keyword-Set Pattern Matching for Severity Floors
**What:** Match LLM finding titles against known dangerous patterns using keyword sets.
**When to use:** For severity floor enforcement.
**Why keyword sets:** LLM output is inherently variable. A finding about "null pointer dereference" might appear as any of: "Potential null dereference", "NPE risk when user is null", "Null pointer access in handler", "Missing null check before dereference". Keyword-set matching handles all of these.

```typescript
export type SeverityPattern = {
  id: string;                          // e.g., "cpp-null-deref"
  language: string;                    // e.g., "C++"
  keywords: string[][];                // OR of AND groups: [[kw1, kw2], [kw3, kw4]]
  minSeverity: FindingSeverity;        // Floor to enforce
  category: FindingCategory;           // Expected finding category
  contextRelaxation?: {
    testFiles: boolean;                // If true, skip enforcement in test files
    relaxedSeverity?: FindingSeverity; // Optional: use lower floor in test files instead of skipping
  };
  description: string;                 // Human-readable explanation
};

// Example pattern definition
const CPP_NULL_DEREF: SeverityPattern = {
  id: "cpp-null-deref",
  language: "C++",
  keywords: [
    ["null", "dereference"],
    ["null", "pointer"],
    ["nullptr", "dereference"],
    ["null", "deref"],
    ["npe"],
  ],
  minSeverity: "critical",
  category: "correctness",
  contextRelaxation: { testFiles: true },
  description: "C++ null pointer dereference must be CRITICAL in production code",
};

function matchesPattern(findingTitle: string, pattern: SeverityPattern): boolean {
  const normalized = findingTitle.toLowerCase();
  return pattern.keywords.some(group =>
    group.every(keyword => normalized.includes(keyword.toLowerCase()))
  );
}
```

### Pattern 4: Config Schema Extension for `.kodiai.yml`
**What:** Add `languageRules` section to the existing Zod config schema.
**When to use:** User wants to override built-in severity floors or add custom patterns.

```typescript
// Extension to existing config.ts schema
const severityFloorOverrideSchema = z.object({
  pattern: z.string().min(1),         // keyword or regex pattern
  language: z.string().optional(),     // if omitted, applies to all languages
  minSeverity: z.enum(["critical", "major", "medium", "minor"]),
  skipTestFiles: z.boolean().default(true),
});

const toolingOverrideSchema = z.object({
  language: z.string(),
  suppressFormatting: z.boolean().default(true),
  suppressImportOrder: z.boolean().default(true),
  configFiles: z.array(z.string()).optional(),  // override which config files to check
});

const languageRulesSchema = z.object({
  severityFloors: z.array(severityFloorOverrideSchema).default([]),
  toolingOverrides: z.array(toolingOverrideSchema).default([]),
  disableBuiltinFloors: z.boolean().default(false),
}).default({
  severityFloors: [],
  toolingOverrides: [],
  disableBuiltinFloors: false,
});
```

### Anti-Patterns to Avoid
- **Prompt-driven enforcement:** Do NOT try to enforce severity floors by modifying the LLM prompt. The LLM is non-deterministic and will sometimes ignore instructions. Enforcement MUST be post-execution and deterministic (LANG-07).
- **Regex-only matching:** Do NOT use complex regexes for matching finding titles. LLM output is too variable. Keyword-set matching is more robust.
- **Global severity override:** Do NOT unconditionally elevate severity for all instances of a pattern. The user decision requires context-aware enforcement (test files, config files, example code should be relaxed).
- **Modifying inline comments directly:** Do NOT try to edit the text of inline comments to change severity. Instead, modify the `ExtractedFinding.severity` field in the processing pipeline and let the existing metadata flow handle it. The severity tag in the inline comment text will mismatch with the enforced severity, but the finding record in the knowledge store (which drives metrics and reporting) will reflect the enforced severity. If the user-visible severity must match, consider adding a comment edit step, but this is lower priority.
- **Blocking the review on config detection failure:** Tooling detection should be fail-open. If filesystem access fails, skip tooling suppression (never block the review).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching for file paths | Custom string matching | `picomatch` (already in project) | Battle-tested, handles edge cases, brace expansion, negation |
| YAML config parsing | Custom parser | `js-yaml` + `zod` (already in project) | Already proven in `loadRepoConfig()` with section fallback |
| File category detection (test/prod) | New classification system | `filesByCategory` from `diff-analysis.ts` | Already classifies test/config/docs/infra/source files |
| Language detection | Extension-to-language mapping | `classifyFileLanguage()` from `diff-analysis.ts` | Already maps 25+ extensions to language names |

**Key insight:** The codebase already has robust infrastructure for file classification, language detection, config parsing, and pattern matching. Phase 39's modules should compose existing utilities rather than rebuild them.

## Common Pitfalls

### Pitfall 1: Fuzzy Match False Positives
**What goes wrong:** A pattern like keywords `["null", "check"]` matches "Null check added correctly" (a positive finding about adding a check, not a vulnerability).
**Why it happens:** Keyword matching is inherently imprecise on LLM-generated text.
**How to avoid:** Use multi-keyword AND groups that require both the problem indicator AND the pattern. For example: `["null", "dereference"]` or `["null", "pointer", "risk"]`. Also match on finding category -- a `correctness` finding about "null dereference" is different from a `style` finding mentioning "null".
**Warning signs:** Tests show patterns matching positive/benign findings. Review false positive rates during verification.

### Pitfall 2: Test File Detection Edge Cases
**What goes wrong:** Files like `src/testutils.ts` or `src/components/TestPage.tsx` get classified as test files and have severity relaxed.
**Why it happens:** Naive path-based detection uses substring matching on "test".
**How to avoid:** Use the existing `filesByCategory.test` from `diff-analysis.ts` which uses precise glob patterns: `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/test/**`, `**/tests/**`. These match test framework conventions, not arbitrary "test" substrings. A file is a test file if and only if it appears in `filesByCategory.test`.
**Warning signs:** Production helper files named with "test" in the path getting severity relaxation.

### Pitfall 3: Config File Detection Race Condition
**What goes wrong:** Checking for `.prettierrc` in a repo that has the file but it is not in the workspace due to shallow clone depth.
**Why it happens:** The workspace is a shallow clone (depth 50). Config files at the repo root should always be present, but nested configs might be missed.
**How to avoid:** Config detection should check root-level files only (where formatters/linters are typically configured). Document that nested tool configs (e.g., `packages/foo/.prettierrc` in a monorepo) are not detected by default -- users can override via `.kodiai.yml`.
**Warning signs:** Config files not being detected despite being in the repo.

### Pitfall 4: Go `gofmt` Is Always Active
**What goes wrong:** Waiting for a `.gofmt` config file that doesn't exist because Go's formatter has no config.
**Why it happens:** Go's toolchain includes `gofmt` by default -- there is no config file.
**How to avoid:** For Go, treat formatting suppression as always-on when Go files are present (Go community norm). The `go.mod` file presence could serve as the "config exists" signal for formatting. Similarly, `rustfmt` is part of the Rust toolchain.
**Warning signs:** Go formatting findings not being suppressed despite Go being a "formatter built-in" language.

### Pitfall 5: Severity Floor + Existing Suppression Interaction
**What goes wrong:** A severity floor elevates a finding to CRITICAL, but an existing suppression rule then suppresses it. Or: the CRITICAL safety clause in existing suppression prevents valid user suppression of a floor-elevated finding.
**Why it happens:** The enforcement pipeline and suppression pipeline are sequential; their interaction needs explicit ordering rules.
**How to avoid:** Define clear ordering: (1) extract findings, (2) enforce severity floors, (3) apply tooling suppression, (4) apply user suppression rules. The existing rule "NEVER suppress findings at CRITICAL severity" (line 329 of review-prompt.ts) should still apply after severity floor elevation. Document this interaction clearly.
**Warning signs:** Unexpected behavior when both severity floors and suppression rules match the same finding.

### Pitfall 6: Tooling Suppression Scope Creep
**What goes wrong:** Suppressing ALL findings in a language when its linter config is detected, not just the auto-fixable formatting/import-order findings.
**Why it happens:** Overly broad suppression logic.
**How to avoid:** Only suppress two specific categories: (1) formatting/style findings when formatter config exists, (2) import ordering findings when linter config exists. Use keyword matching on finding titles to identify formatting and import-order findings specifically: keywords like `["formatting"]`, `["import", "order"]`, `["import", "sort"]`, `["style", "indent"]`, `["bracket", "placement"]`, `["trailing", "comma"]`, `["semicolon"]`.
**Warning signs:** Legitimate correctness findings being suppressed because a `.prettierrc` exists.

## Code Examples

### Integrating into the Review Handler Pipeline

```typescript
// Source: Based on review.ts lines 1270-1335 (existing pipeline)
// This shows where the new enforcement code slots in

// Step 1: Extract findings (EXISTING)
const extractedFindings = shouldProcessReviewOutput
  ? await extractFindingsFromReviewComments({ ... })
  : [];

// Step 1a: Detect tooling config (NEW)
const detectedTooling = await detectRepoTooling(workspace.dir);

// Step 1b: Suppress tooling-covered findings (NEW)
// Returns findings with a new `toolingSuppressed` flag
const toolingProcessed = suppressToolingFindings({
  findings: extractedFindings,
  detectedTooling,
  filesByLanguage: diffAnalysis.filesByLanguage,
});

// Step 1c: Enforce severity floors (NEW)
// Returns findings with potentially elevated severity
const enforced = enforceSeverityFloors({
  findings: toolingProcessed,
  filesByCategory: diffAnalysis.filesByCategory,
  languageRules: config.languageRules,
  filesByLanguage: diffAnalysis.filesByLanguage,
});

// Step 2: Existing suppression pipeline (EXISTING, operates on enforced findings)
const processedFindings: ProcessedFinding[] = enforced.map((finding) => {
  // ... existing suppression logic unchanged
  // toolingSuppressed findings also marked as suppressed
  const suppressed = finding.toolingSuppressed || Boolean(matchedSuppression) || dedupSuppressed;
  return { ...finding, suppressed, confidence, suppressionPattern };
});
```

### Tooling Detection Function

```typescript
// Source: Codebase pattern from execution/config.ts (Bun.file for file existence checks)
export async function detectRepoTooling(workspaceDir: string): Promise<DetectedTooling> {
  const formatters = new Map<string, string[]>();
  const linters = new Map<string, string[]>();

  for (const [language, configFiles] of Object.entries(FORMATTER_CONFIGS)) {
    const found: string[] = [];
    for (const configFile of configFiles) {
      const filePath = join(workspaceDir, configFile);
      if (await Bun.file(filePath).exists()) {
        found.push(configFile);
      }
    }
    if (found.length > 0) {
      formatters.set(language, found);
    }
  }

  // Special case: Go always has gofmt
  // If any .go files exist, treat formatter as detected
  const goModPath = join(workspaceDir, "go.mod");
  if (await Bun.file(goModPath).exists()) {
    formatters.set("Go", ["go.mod (gofmt built-in)"]);
  }

  // Similar for linters...
  for (const [language, configFiles] of Object.entries(LINTER_CONFIGS)) {
    const found: string[] = [];
    for (const configFile of configFiles) {
      const filePath = join(workspaceDir, configFile);
      if (await Bun.file(filePath).exists()) {
        found.push(configFile);
      }
    }
    if (found.length > 0) {
      linters.set(language, found);
    }
  }

  return { formatters, linters };
}
```

### Severity Floor Enforcement

```typescript
// Source: Based on knowledge/confidence.ts pattern (pure function, testable)
export function enforceSeverityFloors(params: {
  findings: ExtractedFinding[];
  filesByCategory: Record<string, string[]>;
  filesByLanguage: Record<string, string[]>;
  languageRules?: LanguageRulesConfig;
}): EnforcedFinding[] {
  const { findings, filesByCategory, filesByLanguage, languageRules } = params;
  const testFiles = new Set(filesByCategory.test ?? []);

  // Merge built-in patterns with user-configured patterns
  const patterns = languageRules?.disableBuiltinFloors
    ? (languageRules.severityFloors ?? [])
    : [...BUILTIN_SEVERITY_PATTERNS, ...(languageRules?.severityFloors ?? [])];

  return findings.map((finding) => {
    const isTestFile = testFiles.has(finding.filePath);

    // Determine language for this finding's file
    const fileLanguage = classifyFileLanguage(finding.filePath);

    // Find matching pattern
    const matchedPattern = patterns.find((pattern) => {
      // Language filter
      if (pattern.language && pattern.language !== fileLanguage) return false;
      // Keyword match
      return matchesPattern(finding.title, pattern);
    });

    if (!matchedPattern) {
      return { ...finding, severityElevated: false, originalSeverity: finding.severity };
    }

    // Context relaxation: skip test files if configured
    if (isTestFile && matchedPattern.contextRelaxation?.testFiles) {
      if (matchedPattern.contextRelaxation.relaxedSeverity) {
        // Use relaxed severity for test files
        const current = severityRank(finding.severity);
        const relaxed = severityRank(matchedPattern.contextRelaxation.relaxedSeverity);
        if (current < relaxed) {
          return {
            ...finding,
            originalSeverity: finding.severity,
            severity: matchedPattern.contextRelaxation.relaxedSeverity,
            severityElevated: true,
            enforcementPatternId: matchedPattern.id,
          };
        }
      }
      // Skip enforcement entirely for test files
      return { ...finding, severityElevated: false, originalSeverity: finding.severity };
    }

    // Apply floor: only elevate, never downgrade
    const currentRank = severityRank(finding.severity);
    const floorRank = severityRank(matchedPattern.minSeverity);

    if (currentRank >= floorRank) {
      // Already at or above floor
      return { ...finding, severityElevated: false, originalSeverity: finding.severity };
    }

    return {
      ...finding,
      originalSeverity: finding.severity,
      severity: matchedPattern.minSeverity,
      severityElevated: true,
      enforcementPatternId: matchedPattern.id,
    };
  });
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  minor: 0,
  medium: 1,
  major: 2,
  critical: 3,
};

function severityRank(severity: FindingSeverity): number {
  return SEVERITY_RANK[severity] ?? 0;
}
```

### Config Schema Example (`.kodiai.yml`)

```yaml
# Example .kodiai.yml with languageRules section
review:
  enabled: true
  profile: strict

languageRules:
  # Override or add severity floor patterns
  severityFloors:
    - pattern: "unvalidated input"
      language: TypeScript
      minSeverity: major
      skipTestFiles: true
    - pattern: "hardcoded secret"
      minSeverity: critical
      skipTestFiles: false  # Always enforce, even in tests

  # Override tooling detection behavior
  toolingOverrides:
    - language: Python
      suppressFormatting: true
      suppressImportOrder: false  # Keep import order findings even with linter config

  # Set to true to disable all built-in severity patterns (use only custom ones)
  disableBuiltinFloors: false
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prompt-only severity guidance | Post-LLM deterministic enforcement | Phase 39 (this phase) | Guarantees severity floors regardless of LLM behavior |
| No tooling awareness | Config-file-based suppression | Phase 39 (this phase) | Eliminates noise when formatters/linters handle auto-fixable issues |
| `LANGUAGE_GUIDANCE` in prompt | `LANGUAGE_GUIDANCE` + `SeverityPattern[]` enforcement | Phase 39 (this phase) | Prompt guides LLM, enforcement corrects its output |
| Manual suppression patterns only | Tooling-aware auto-suppression + manual patterns | Phase 39 (this phase) | Reduces config burden for repos with standard tooling |

**Key evolution:** The existing `LANGUAGE_GUIDANCE` record (review-prompt.ts lines 14-60) tells the LLM what to look for. Phase 39 adds a deterministic enforcement layer that corrects the LLM's output when it gets severity wrong. This is defense-in-depth -- the prompt guidance helps the LLM get it right, the enforcement layer fixes it when it doesn't.

## PR History Analysis

Analysis of the 32 closed PRs in the kodiai repository:

### Patterns Found

The kodiai codebase is TypeScript-only (Bun runtime). The closed PRs reveal these recurring safety patterns:

1. **Error handling resilience** (PRs #24, #27, #37): Multiple fixes for making external API calls resilient -- fallback reviewers, retry logic, graceful degradation. Pattern: "missing error handling on external call" -> MAJOR.

2. **Idempotency/duplicate prevention** (PRs #7, #9, #10, #33): Several fixes for preventing duplicate reviews, duplicate approvals, or double-execution. Pattern: "missing idempotency guard" -> MAJOR.

3. **Format enforcement for LLM output** (PRs #9, #13): Fixes where the LLM produced comments in wrong format and the code did not enforce structure deterministically. This is exactly the class of problem Phase 39 addresses.

4. **Write-mode security guardrails** (PRs #5, #8, #16, #20): Path-based deny policies, secret scanning, rate limiting. Pattern: "missing security guardrail on write operation" -> CRITICAL.

5. **Configuration validation resilience** (PR #3, throughout): The section-level fallback parsing pattern in config.ts is used heavily. Malformed config should never crash the bot.

### Built-in Pattern Catalog (Recommended Seed)

Based on requirements + PR history analysis:

| Pattern ID | Language | Keywords | Min Severity | Source |
|------------|----------|----------|-------------|--------|
| `cpp-null-deref` | C++ | `[["null", "dereference"], ["null", "pointer"], ["npe"]]` | CRITICAL | LANG-03 requirement |
| `cpp-uninitialized` | C++ | `[["uninitialized", "member"], ["uninitialized", "variable"]]` | CRITICAL | LANG-04 requirement |
| `go-unchecked-error` | Go | `[["unchecked", "error"], ["error", "ignored"], ["error", "discarded"]]` | MAJOR | LANG-05 requirement |
| `python-bare-except` | Python | `[["bare", "except"], ["bare", "exception"], ["catch-all", "exception"]]` | MAJOR | LANG-06 requirement |
| `c-null-deref` | C | `[["null", "dereference"], ["null", "pointer"]]` | CRITICAL | Extension of C++ pattern |
| `c-buffer-overflow` | C | `[["buffer", "overflow"], ["buffer", "overrun"], ["strcpy"], ["sprintf"]]` | CRITICAL | Common C safety pattern |
| `rust-unwrap` | Rust | `[["unwrap", "panic"], ["unwrap", "crash"]]` | MAJOR | From LANGUAGE_GUIDANCE |
| `java-unclosed-resource` | Java | `[["unclosed", "resource"], ["resource", "leak"], ["missing", "close"]]` | MAJOR | From LANGUAGE_GUIDANCE |
| `sql-injection` | (any) | `[["sql", "injection"], ["sql", "concatenation"]]` | CRITICAL | Universal security pattern |
| `ts-unhandled-promise` | TypeScript | `[["unhandled", "promise"], ["floating", "promise"], ["missing", "await"]]` | MAJOR | Project-specific (from PR history) |

## Open Questions

1. **Inline comment severity text mismatch**
   - What we know: When a severity floor elevates a finding from MINOR to CRITICAL, the inline comment text still says `[MINOR]` because it was generated by the LLM.
   - What's unclear: Should we edit the inline comment to fix the severity text? This requires an additional API call per elevated finding.
   - Recommendation: For v1, accept the mismatch. The knowledge store records the enforced severity. The summary comment (if present) could note floor-enforced findings. Adding inline comment editing can be a follow-up improvement. The finding counts in Review Details already reflect post-enforcement severity.

2. **pyproject.toml multi-tool detection**
   - What we know: `pyproject.toml` can contain configuration for Black (formatter), Ruff (linter/formatter), Flake8, and others.
   - What's unclear: Should we parse `pyproject.toml` TOML sections to detect which tool is configured, or just treat its presence as "formatter likely configured"?
   - Recommendation: Treat `pyproject.toml` presence as "Python formatter/linter likely configured." Parsing TOML sections adds complexity for marginal benefit. Users can override via `.kodiai.yml` if this heuristic is wrong.

3. **ESLint flat config detection**
   - What we know: ESLint migrated from `.eslintrc.*` to `eslint.config.*` (flat config) starting ESLint v8.21.
   - What's unclear: Should we detect both old and new config formats?
   - Recommendation: Yes, detect both. The config file list should include both `.eslintrc*` variants and `eslint.config.*` variants. This is a simple addition to the detection list.

## Sources

### Primary (HIGH confidence)
- `/home/keith/src/kodiai/src/handlers/review.ts` - Complete review pipeline, finding extraction, suppression, and post-processing (lines 1270-1390)
- `/home/keith/src/kodiai/src/execution/review-prompt.ts` - LANGUAGE_GUIDANCE map, severity guidelines, noise suppression rules, existing suppression infrastructure
- `/home/keith/src/kodiai/src/execution/config.ts` - Full Zod schema for `.kodiai.yml`, section-level fallback parsing pattern
- `/home/keith/src/kodiai/src/execution/diff-analysis.ts` - File classification (test/config/docs/infra/source), language detection, EXTENSION_LANGUAGE_MAP
- `/home/keith/src/kodiai/src/knowledge/confidence.ts` - matchesSuppression(), matchPattern(), computeConfidence() -- the pattern matching infrastructure
- `/home/keith/src/kodiai/src/knowledge/types.ts` - FindingSeverity, FindingCategory, FindingRecord type definitions
- `/home/keith/src/kodiai/src/lib/finding-dedup.ts` - PriorFindingContext, shouldSuppressFinding() -- dedup pattern
- `/home/keith/src/kodiai/src/lib/delta-classifier.ts` - DeltaClassification types and fingerprinting
- `/home/keith/src/kodiai/.kodiai.yml` - Current repo config (example of real-world usage)

### Secondary (MEDIUM confidence)
- PR history analysis (32 closed PRs via `gh pr list`) - Patterns derived from actual project fixes
- ESLint flat config migration - Based on training knowledge; ESLint v8.21+ supports `eslint.config.*`

### Tertiary (LOW confidence)
- `pyproject.toml` multi-tool detection heuristic - Needs validation against real Python repos
- Go `gofmt` always-active assumption - Correct as of training data but should be validated

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project, no new dependencies
- Architecture: HIGH - Direct extension of existing, well-understood review pipeline
- Patterns: HIGH - Based on thorough codebase analysis of existing types, functions, and data flow
- Pitfalls: HIGH - Derived from actual codebase patterns and PR history
- PR history analysis: MEDIUM - Based on 32 PRs (repo has 37 closed total); patterns are real but sample is small

**Research date:** 2026-02-13
**Valid until:** 60 days (stable domain; patterns unlikely to change)
