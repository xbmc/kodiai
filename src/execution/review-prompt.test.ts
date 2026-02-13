import { test, expect, describe } from "bun:test";
import type { DiffAnalysis } from "./diff-analysis.ts";
import {
  buildConfidenceInstructions,
  buildDiffAnalysisSection,
  buildLanguageGuidanceSection,
  buildMetricsInstructions,
  buildOutputLanguageSection,
  buildPathInstructionsSection,
  buildPrIntentScopingSection,
  buildRetrievalContextSection,
  buildReviewedCategoriesLine,
  buildReviewPrompt,
  buildSuppressionRulesSection,
  buildToneGuidelinesSection,
  buildVerdictLogicSection,
  matchPathInstructions,
} from "./review-prompt.ts";

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    owner: "acme",
    repo: "app",
    prNumber: 42,
    prTitle: "Fix bug",
    prBody: "Fixes a critical bug",
    prAuthor: "alice",
    baseBranch: "main",
    headBranch: "fix/bug",
    changedFiles: ["src/index.ts"],
    ...overrides,
  };
}

function baseDiffAnalysis(overrides: Partial<DiffAnalysis> = {}): DiffAnalysis {
  return {
    filesByCategory: {
      source: ["src/index.ts"],
      test: ["src/index.test.ts"],
      config: ["package.json"],
      docs: [],
      infra: [],
    },
    filesByLanguage: {
      TypeScript: ["src/index.ts", "src/index.test.ts"],
    },
    riskSignals: [],
    metrics: {
      totalFiles: 3,
      totalLinesAdded: 120,
      totalLinesRemoved: 45,
      hunksCount: 0,
    },
    isLargePR: false,
    ...overrides,
  };
}

test("default config includes severity classification guidelines", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("Severity Classification");
  expect(prompt).toContain("CRITICAL");
  expect(prompt).toContain("MAJOR");
  expect(prompt).toContain("MEDIUM");
  expect(prompt).toContain("MINOR");
});

test("default config includes noise suppression rules", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("Noise Suppression");
  expect(prompt).toContain("NEVER flag");
  expect(prompt).toContain("Style-only");
});

test("default config includes comment cap of 7", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("at most 7 inline comments");
});

test("default config uses standard mode format", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("[CRITICAL]");
  expect(prompt).toContain("[MAJOR]");
  expect(prompt).toContain("Standard Mode");
  expect(prompt).not.toContain("```yaml");
});

test("default config preserves summary comment section with five-section template", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("Kodiai Review Summary");
  expect(prompt).toContain("summary comment");
  expect(prompt).toContain("## What Changed");
  expect(prompt).toContain("## Observations");
  expect(prompt).toContain("## Verdict");
  expect(prompt).toContain(":white_check_mark:");
  expect(prompt).not.toContain("MUST be issues-only");
});

test("enhanced mode includes YAML code block format", () => {
  const prompt = buildReviewPrompt(baseContext({ mode: "enhanced" }));
  expect(prompt).toContain("```yaml");
  expect(prompt).toContain("severity:");
  expect(prompt).toContain("category:");
  expect(prompt).toContain("suggested_action:");
  expect(prompt).toContain("Enhanced Mode");
});

test("enhanced mode suppresses summary comment", () => {
  const prompt = buildReviewPrompt(baseContext({ mode: "enhanced" }));
  expect(prompt).toContain("Do NOT post a top-level summary comment");
  expect(prompt).not.toContain("Kodiai Review Summary");
});

test("severityMinLevel major filters out medium and minor", () => {
  const prompt = buildReviewPrompt(
    baseContext({ severityMinLevel: "major" }),
  );
  expect(prompt).toContain("critical, major");
  expect(prompt).toContain("Do NOT generate findings below major");
});

test("severityMinLevel minor (default) does not add filter", () => {
  const prompt = buildReviewPrompt(
    baseContext({ severityMinLevel: "minor" }),
  );
  expect(prompt).not.toContain("Do NOT generate findings below");
});

test("focusAreas filters by category", () => {
  const prompt = buildReviewPrompt(
    baseContext({ focusAreas: ["security", "correctness"] }),
  );
  expect(prompt).toContain(
    "Concentrate your review on these categories: security, correctness",
  );
  expect(prompt).toContain("only report CRITICAL");
});

test("ignoredAreas excludes categories", () => {
  const prompt = buildReviewPrompt(
    baseContext({ ignoredAreas: ["style"] }),
  );
  expect(prompt).toContain("SKIP these categories");
  expect(prompt).toContain("style");
});

test("maxComments overrides default", () => {
  const prompt = buildReviewPrompt(baseContext({ maxComments: 3 }));
  expect(prompt).toContain("at most 3 inline comments");
});

test("buildSuppressionRulesSection formats string and object suppressions", () => {
  const section = buildSuppressionRulesSection([
    "missing JSDoc",
    {
      pattern: "regex:missing.*handling",
      severity: ["major"],
      category: ["correctness"],
      paths: ["src/**"],
    },
  ]);
  expect(section).toContain("## Suppression Rules");
  expect(section).toContain("pattern: missing JSDoc");
  expect(section).toContain("pattern: regex:missing.*handling");
  expect(section).toContain("severity=[major]");
  expect(section).toContain("category=[correctness]");
  expect(section).toContain("paths=[src/**]");
});

test("buildSuppressionRulesSection returns empty for no suppressions", () => {
  expect(buildSuppressionRulesSection([])).toBe("");
});

test("buildSuppressionRulesSection includes CRITICAL safety clause", () => {
  const section = buildSuppressionRulesSection(["missing docs"]);
  expect(section).toContain("NEVER suppress findings at CRITICAL severity");
});

test("buildConfidenceInstructions handles minConfidence settings", () => {
  const noThreshold = buildConfidenceInstructions(0);
  expect(noThreshold).toContain("## Confidence Display");
  expect(noThreshold).not.toContain("separate collapsible section");

  const threshold = buildConfidenceInstructions(40);
  expect(threshold).toContain("below 40% confidence");
});

test("buildMetricsInstructions returns metrics section", () => {
  const section = buildMetricsInstructions();
  expect(section).toContain("## Review Metrics");
  expect(section).toContain("Review Details");
  expect(section).toContain("Files reviewed");
  expect(section).toContain("Lines analyzed/changed");
  expect(section).toContain("Issue counts grouped by severity");
  expect(section.length).toBeGreaterThan(0);
});

test("standard mode includes quantitative review details contract", () => {
  const prompt = buildReviewPrompt(baseContext({ mode: "standard" }));
  expect(prompt).toContain("## Review Metrics");
  expect(prompt).toContain("collapsible `Review Details` section");
  expect(prompt).toContain("Files reviewed");
  expect(prompt).toContain("Lines analyzed/changed");
  expect(prompt).toContain("Issue counts grouped by severity");
  expect(prompt).toContain("CRITICAL/MAJOR/MEDIUM/MINOR");
});

test("custom instructions appear after noise suppression", () => {
  const prompt = buildReviewPrompt(
    baseContext({ customInstructions: "Check for SQL injection" }),
  );
  const noiseIdx = prompt.indexOf("Noise Suppression");
  const customIdx = prompt.indexOf("Custom instructions");
  expect(noiseIdx).toBeGreaterThan(-1);
  expect(customIdx).toBeGreaterThan(-1);
  expect(customIdx).toBeGreaterThan(noiseIdx);
});

test("path context severity rules included", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("Test files");
  expect(prompt).toContain("downgrade");
});

test("matchPathInstructions matches files for single glob", () => {
  const matched = matchPathInstructions(
    [{ path: "src/api/**", instructions: "Check security" }],
    ["src/api/auth.ts", "src/db/query.ts"],
  );
  expect(matched).toHaveLength(1);
  expect(matched[0]?.matchedFiles).toEqual(["src/api/auth.ts"]);
});

test("matchPathInstructions supports union across array patterns", () => {
  const matched = matchPathInstructions(
    [{ path: ["src/api/**", "src/db/**"], instructions: "Check service logic" }],
    ["src/api/auth.ts", "src/db/query.ts", "README.md"],
  );
  expect(matched).toHaveLength(1);
  expect(matched[0]?.matchedFiles).toEqual(["src/api/auth.ts", "src/db/query.ts"]);
});

test("matchPathInstructions supports negation patterns", () => {
  const matched = matchPathInstructions(
    [
      {
        path: ["src/**", "!**/*.test.ts"],
        instructions: "Skip tests",
      },
    ],
    ["src/main.ts", "src/main.test.ts"],
  );
  expect(matched).toHaveLength(1);
  expect(matched[0]?.matchedFiles).toEqual(["src/main.ts"]);
});

test("matchPathInstructions with only negation matches all except excluded", () => {
  const matched = matchPathInstructions(
    [{ path: ["!**/*.md"], instructions: "All non-doc files" }],
    ["src/main.ts", "README.md", "src/db/query.sql"],
  );
  expect(matched).toHaveLength(1);
  expect(matched[0]?.matchedFiles).toEqual(["src/main.ts", "src/db/query.sql"]);
});

test("matchPathInstructions returns empty when no files match", () => {
  const matched = matchPathInstructions(
    [{ path: "docs/**", instructions: "Docs only" }],
    ["src/main.ts"],
  );
  expect(matched).toEqual([]);
});

test("matchPathInstructions applies cumulative matching", () => {
  const matched = matchPathInstructions(
    [
      { path: "src/**", instructions: "General source checks" },
      { path: "src/api/**", instructions: "API security checks" },
    ],
    ["src/api/auth.ts"],
  );
  expect(matched).toHaveLength(2);
  expect(matched[0]?.matchedFiles).toEqual(["src/api/auth.ts"]);
  expect(matched[1]?.matchedFiles).toEqual(["src/api/auth.ts"]);
});

test("buildPathInstructionsSection formats matched instructions", () => {
  const section = buildPathInstructionsSection([
    {
      pattern: "src/api/**",
      instructions: "Check auth boundaries",
      matchedFiles: ["src/api/auth.ts", "src/api/users.ts"],
    },
  ]);
  expect(section).toContain("Path-Specific Review Instructions");
  expect(section).toContain("**src/api/** (applies to: src/api/auth.ts, src/api/users.ts)");
  expect(section).toContain("Check auth boundaries");
});

test("buildPathInstructionsSection truncates when over character budget", () => {
  const section = buildPathInstructionsSection(
    [
      {
        pattern: "src/api/**",
        instructions: "A".repeat(400),
        matchedFiles: ["src/api/auth.ts"],
      },
      {
        pattern: "src/db/**",
        instructions: "B".repeat(400),
        matchedFiles: ["src/db/queries.ts"],
      },
    ],
    500,
  );
  expect(section).toContain("truncated due to prompt size limits");
});

test("buildPathInstructionsSection returns empty for no matches", () => {
  expect(buildPathInstructionsSection([])).toBe("");
});

test("buildPathInstructionsSection caps displayed file list to five", () => {
  const section = buildPathInstructionsSection([
    {
      pattern: "src/**",
      instructions: "Check broadly",
      matchedFiles: [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
      ],
    },
  ]);
  expect(section).toContain("src/a.ts, src/b.ts, src/c.ts, src/d.ts, src/e.ts (and 1 more)");
});

test("buildDiffAnalysisSection formats metrics and categories", () => {
  const section = buildDiffAnalysisSection(baseDiffAnalysis());
  expect(section).toContain("This PR modifies 3 files (+120 / -45 lines).");
  expect(section).toContain("File breakdown:");
  expect(section).toContain("- source: 1 file(s)");
  expect(section).toContain("- test: 1 file(s)");
  expect(section).toContain("- config: 1 file(s)");
});

test("buildDiffAnalysisSection includes risk signals", () => {
  const section = buildDiffAnalysisSection(
    baseDiffAnalysis({ riskSignals: ["Modifies authentication/authorization code"] }),
  );
  expect(section).toContain("Pay special attention to these areas:");
  expect(section).toContain("Modifies authentication/authorization code");
});

test("buildDiffAnalysisSection includes large PR note", () => {
  const section = buildDiffAnalysisSection(baseDiffAnalysis({ isLargePR: true }));
  expect(section).toContain("This is a large PR. Focus on the most critical changes.");
});

test("buildDiffAnalysisSection returns empty for zero files", () => {
  const section = buildDiffAnalysisSection(
    baseDiffAnalysis({
      metrics: { totalFiles: 0, totalLinesAdded: 0, totalLinesRemoved: 0, hunksCount: 0 },
      filesByCategory: { source: [], test: [], config: [], docs: [], infra: [] },
    }),
  );
  expect(section).toBe("");
});

test("buildDiffAnalysisSection includes hunk count when present", () => {
  const section = buildDiffAnalysisSection(
    baseDiffAnalysis({
      metrics: { totalFiles: 3, totalLinesAdded: 120, totalLinesRemoved: 45, hunksCount: 9 },
    }),
  );
  expect(section).toContain("across 9 hunks");
});

test("buildReviewPrompt includes diff analysis section when provided", () => {
  const prompt = buildReviewPrompt(
    baseContext({ diffAnalysis: baseDiffAnalysis({ riskSignals: ["Modifies dependency manifest"] }) }),
  );
  expect(prompt).toContain("## Change Context");
  expect(prompt).toContain("Modifies dependency manifest");
});

test("buildReviewPrompt includes path instructions section when provided", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      matchedPathInstructions: [
        {
          pattern: "src/api/**",
          instructions: "Check auth and validation",
          matchedFiles: ["src/api/auth.ts"],
        },
      ],
    }),
  );
  expect(prompt).toContain("## Path-Specific Review Instructions");
  expect(prompt).toContain("Check auth and validation");
});

test("buildReviewPrompt includes suppression section when suppressions provided", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      suppressions: ["missing JSDoc"],
      minConfidence: 40,
      mode: "enhanced",
    }),
  );
  expect(prompt).toContain("## Suppression Rules");
  expect(prompt).toContain("missing JSDoc");
  expect(prompt).toContain("below 40% confidence");
  expect(prompt).toContain("## Review Metrics");
  expect(prompt).toContain("Issue counts grouped by severity");
});

test("buildReviewPrompt omits suppression section when suppressions are empty", () => {
  const prompt = buildReviewPrompt(baseContext({ suppressions: [] }));
  expect(prompt).not.toContain("## Suppression Rules");
});

test("buildReviewPrompt remains backward compatible without new fields", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("Changed files:");
  expect(prompt).not.toContain("## Change Context");
  expect(prompt).not.toContain("## Path-Specific Review Instructions");
});

// ---------------------------------------------------------------------------
// buildLanguageGuidanceSection tests
// ---------------------------------------------------------------------------

test("buildLanguageGuidanceSection returns empty string for empty input", () => {
  expect(buildLanguageGuidanceSection({})).toBe("");
});

test("buildLanguageGuidanceSection returns empty string for languages without guidance", () => {
  expect(buildLanguageGuidanceSection({ Unknown: ["file.unk"] })).toBe("");
});

test("buildLanguageGuidanceSection includes Python guidance when Python files present", () => {
  const section = buildLanguageGuidanceSection({ Python: ["app.py", "utils.py"] });
  expect(section).toContain("### Python (2 file(s))");
  expect(section).toContain("Mutable default arguments");
  expect(section).toContain("Context managers");
  expect(section).toContain("Bare `except:`");
  expect(section).toContain("Type hint consistency");
});

test("buildLanguageGuidanceSection caps at 5 languages", () => {
  const section = buildLanguageGuidanceSection({
    Python: ["a.py"],
    Go: ["a.go"],
    Rust: ["a.rs"],
    Java: ["a.java"],
    "C++": ["a.cpp"],
    C: ["a.c"],
    Ruby: ["a.rb"],
  });
  // Count the number of ### headings -- should be exactly 5
  const headings = section.match(/^### /gm) ?? [];
  expect(headings.length).toBe(5);
});

test("buildLanguageGuidanceSection sorts by file count (most files first)", () => {
  const section = buildLanguageGuidanceSection({
    Ruby: ["a.rb"],
    Python: ["a.py", "b.py", "c.py"],
    Go: ["a.go", "b.go"],
  });
  const pythonIdx = section.indexOf("### Python");
  const goIdx = section.indexOf("### Go");
  const rubyIdx = section.indexOf("### Ruby");
  expect(pythonIdx).toBeLessThan(goIdx);
  expect(goIdx).toBeLessThan(rubyIdx);
});

test("buildLanguageGuidanceSection includes taxonomy preservation note", () => {
  const section = buildLanguageGuidanceSection({ Python: ["a.py"] });
  expect(section).toContain("CRITICAL/MAJOR/MEDIUM/MINOR");
  expect(section).toContain("security, correctness, performance, error-handling, resource-management, concurrency");
});

// ---------------------------------------------------------------------------
// buildOutputLanguageSection tests
// ---------------------------------------------------------------------------

test("buildOutputLanguageSection returns empty for 'en'", () => {
  expect(buildOutputLanguageSection("en")).toBe("");
});

test("buildOutputLanguageSection returns empty for 'EN' (case insensitive)", () => {
  expect(buildOutputLanguageSection("EN")).toBe("");
});

test("buildOutputLanguageSection returns section for 'ja' containing the literal value", () => {
  const section = buildOutputLanguageSection("ja");
  expect(section).toContain("## Output Language");
  expect(section).toContain("in ja");
});

test("buildOutputLanguageSection includes severity/category English preservation list", () => {
  const section = buildOutputLanguageSection("ja");
  expect(section).toContain("CRITICAL");
  expect(section).toContain("MAJOR");
  expect(section).toContain("MEDIUM");
  expect(section).toContain("MINOR");
  expect(section).toContain("security");
  expect(section).toContain("correctness");
  expect(section).toContain("performance");
  expect(section).toContain("error-handling");
  expect(section).toContain("resource-management");
  expect(section).toContain("concurrency");
  expect(section).toContain("Code identifiers");
  expect(section).toContain("Code snippets");
  expect(section).toContain("File paths");
  expect(section).toContain("YAML metadata blocks");
  expect(section).toContain("Only the human-readable explanation text should be localized.");
});

// ---------------------------------------------------------------------------
// buildReviewPrompt integration tests for language + output language
// ---------------------------------------------------------------------------

test("buildReviewPrompt includes language guidance section when filesByLanguage provided", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      filesByLanguage: { Python: ["app.py"], Go: ["main.go"] },
    }),
  );
  expect(prompt).toContain("## Language-Specific Guidance");
  expect(prompt).toContain("### Python");
  expect(prompt).toContain("### Go");
});

test("buildReviewPrompt includes output language section when outputLanguage is non-English", () => {
  const prompt = buildReviewPrompt(
    baseContext({ outputLanguage: "ja" }),
  );
  expect(prompt).toContain("## Output Language");
  expect(prompt).toContain("in ja");
});

test("buildReviewPrompt omits both language sections when not provided (backward compatible)", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).not.toContain("## Language-Specific Guidance");
  expect(prompt).not.toContain("## Output Language");
});

// ---------------------------------------------------------------------------
// buildRetrievalContextSection tests
// ---------------------------------------------------------------------------

test("buildRetrievalContextSection includes provenance citation instruction when findings present", () => {
  const section = buildRetrievalContextSection({
    findings: [
      {
        findingText: "SQL injection risk in query builder",
        severity: "major",
        category: "security",
        filePath: "src/db.ts",
        outcome: "accepted",
        distance: 0.12,
        sourceRepo: "owner/other-repo",
      },
    ],
  });
  expect(section).toContain("Prior pattern:");
  expect(section).toContain("append a brief provenance note");
  expect(section).toContain("When a finding in your review directly relates to one of these prior patterns");
});

test("buildRetrievalContextSection returns empty string when no findings", () => {
  const section = buildRetrievalContextSection({ findings: [] });
  expect(section).toBe("");
});

// ---------------------------------------------------------------------------
// buildReviewedCategoriesLine tests
// ---------------------------------------------------------------------------

describe("buildReviewedCategoriesLine", () => {
  test("returns 'Reviewed: core logic, tests' when source and test have files", () => {
    const result = buildReviewedCategoriesLine({
      source: ["a.ts"],
      test: ["a.test.ts"],
      config: [],
      docs: [],
      infra: [],
    });
    expect(result).toBe("Reviewed: core logic, tests");
  });

  test("returns all labels when all categories have files", () => {
    const result = buildReviewedCategoriesLine({
      source: ["a.ts"],
      test: ["a.test.ts"],
      config: ["tsconfig.json"],
      docs: ["README.md"],
      infra: ["Dockerfile"],
    });
    expect(result).toBe("Reviewed: core logic, tests, config, docs, infrastructure");
  });

  test("returns empty string when all categories are empty arrays", () => {
    const result = buildReviewedCategoriesLine({
      source: [],
      test: [],
      config: [],
      docs: [],
      infra: [],
    });
    expect(result).toBe("");
  });

  test("returns 'Reviewed: tests' when only test has files", () => {
    const result = buildReviewedCategoriesLine({
      test: ["a.test.ts"],
    });
    expect(result).toBe("Reviewed: tests");
  });

  test("handles unknown category keys gracefully by using key as label", () => {
    const result = buildReviewedCategoriesLine({
      customCategory: ["x.ts"],
    });
    expect(result).toBe("Reviewed: customCategory");
  });
});

// ---------------------------------------------------------------------------
// buildReviewPrompt standard-mode reviewed categories integration tests
// ---------------------------------------------------------------------------

test("standard mode includes reviewed categories line when diffAnalysis provided", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      diffAnalysis: baseDiffAnalysis({
        filesByCategory: {
          source: ["a.ts"],
          test: ["a.test.ts"],
          config: [],
          docs: [],
          infra: [],
        },
      }),
    }),
  );
  expect(prompt).toContain("Reviewed: core logic, tests");
});

test("standard mode omits reviewed categories when no diffAnalysis", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).not.toContain("Reviewed:");
});

// ---------------------------------------------------------------------------
// Phase 35: Impact/Preference template, PR intent scoping, tone guidelines,
//           PR labels threading
// ---------------------------------------------------------------------------

describe("Phase 35: Findings organization and tone", () => {
  // 1. Impact/Preference template presence
  test("standard mode contains ### Impact and ### Preference in Observations", () => {
    const prompt = buildReviewPrompt(baseContext());
    const impactIdx = prompt.indexOf("### Impact");
    const prefIdx = prompt.indexOf("### Preference");
    expect(impactIdx).toBeGreaterThan(-1);
    expect(prefIdx).toBeGreaterThan(-1);
    expect(prefIdx).toBeGreaterThan(impactIdx);
    // Old severity sub-headings must NOT be present
    expect(prompt).not.toContain("### Critical");
    expect(prompt).not.toContain("### Major");
    expect(prompt).not.toContain("### Medium");
    expect(prompt).not.toContain("### Minor");
  });

  // 2. Severity tags in template
  test("Observations template contains inline severity tags", () => {
    const prompt = buildReviewPrompt(baseContext());
    const observationsStart = prompt.indexOf("## Observations");
    const observationsSection = prompt.slice(observationsStart, observationsStart + 800);
    expect(observationsSection).toContain("[CRITICAL]");
    expect(observationsSection).toContain("[MAJOR]");
    expect(observationsSection).toContain("[MINOR]");
  });

  // 3. Impact required, Preference optional rule
  test("hard requirements state Impact is required and Preference is optional", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("### Impact is REQUIRED");
    expect(prompt).toContain("### Preference is optional");
  });

  // 4. Severity cap rule
  test("hard requirements enforce severity caps for Impact and Preference", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("CRITICAL and MAJOR findings MUST go under ### Impact");
    expect(prompt).toContain("Preference findings are capped at MEDIUM severity");
  });

  // 5. PR intent scoping section present
  test("standard mode prompt contains PR Intent Scoping section", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("## PR Intent Scoping");
  });

  // 6. PR labels in prompt when provided
  test("PR labels appear in prompt when provided", () => {
    const prompt = buildReviewPrompt(baseContext({ prLabels: ["bug", "ci-fix"] }));
    expect(prompt).toContain("Labels: bug, ci-fix");
  });

  // 7. PR labels omitted when empty
  test("PR labels omitted from prompt when empty array", () => {
    const prompt = buildReviewPrompt(baseContext({ prLabels: [] }));
    expect(prompt).not.toContain("Labels:");
  });

  // 8. PR labels omitted when undefined
  test("PR labels omitted from prompt when undefined", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).not.toContain("Labels:");
  });

  // 9. Tone guidelines section present
  test("prompt contains Finding Language Guidelines section", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("## Finding Language Guidelines");
  });

  // 10. Tone guidelines contain stabilizing language
  test("tone guidelines include stabilizing language phrases", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("preserves existing behavior");
    expect(prompt).toContain("backward compatible");
    expect(prompt).toContain("minimal impact");
  });

  // 11. Tone guidelines contain anti-patterns
  test("tone guidelines include hedged language anti-patterns", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("could potentially");
  });

  // 12. buildPrIntentScopingSection helper includes branch and scoping rules
  test("buildPrIntentScopingSection includes branch name and scoping rules", () => {
    const section = buildPrIntentScopingSection("Fix auth bug", [], "fix/auth-bypass");
    expect(section).toContain("## PR Intent Scoping");
    expect(section).toContain("Branch: fix/auth-bypass");
    expect(section).toContain("CI/test fix");
    expect(section).toContain("Bug fix");
    expect(section).toContain("Feature");
    expect(section).toContain("Findings outside the PR's intent belong in Preference unless CRITICAL severity");
    // Labels should NOT be present when empty
    expect(section).not.toContain("Labels");
  });

  // 13. buildPrIntentScopingSection includes labels when provided
  test("buildPrIntentScopingSection includes labels when provided", () => {
    const section = buildPrIntentScopingSection("Add feature", ["enhancement", "frontend"], "feat/new-ui");
    expect(section).toContain("Labels (if present): enhancement, frontend");
    expect(section).toContain("Branch: feat/new-ui");
  });

  // 14. buildToneGuidelinesSection returns complete guidelines
  test("buildToneGuidelinesSection returns complete guidelines content", () => {
    const section = buildToneGuidelinesSection();
    expect(section).toContain("## Finding Language Guidelines");
    expect(section).toContain("WHAT happens");
    expect(section).toContain("WHEN it happens");
    expect(section).toContain("WHY it matters");
    expect(section).toContain("causes [specific issue] when [specific condition]");
    expect(section).toContain("Optional:");
    expect(section).toContain("consider refactoring");
    expect(section).toContain("this might have problems");
  });

  // 15. Enhanced mode is NOT changed
  test("enhanced mode prompt is not affected by Phase 35 changes", () => {
    const prompt = buildReviewPrompt(baseContext({ mode: "enhanced" }));
    expect(prompt).toContain("Do NOT post a top-level summary comment");
    expect(prompt).not.toContain("### Impact");
    expect(prompt).not.toContain("### Preference");
  });

  // 16. PR labels appear in context header after Branches line
  test("PR labels appear in context header between Branches and Scale Notes", () => {
    const prompt = buildReviewPrompt(baseContext({ prLabels: ["perf", "urgent"] }));
    const branchesIdx = prompt.indexOf("Branches:");
    const labelsIdx = prompt.indexOf("Labels: perf, urgent");
    expect(branchesIdx).toBeGreaterThan(-1);
    expect(labelsIdx).toBeGreaterThan(-1);
    expect(labelsIdx).toBeGreaterThan(branchesIdx);
  });

  // 17. PR Intent Scoping appears after Noise Suppression
  test("PR Intent Scoping section appears after Noise Suppression", () => {
    const prompt = buildReviewPrompt(baseContext());
    const noiseIdx = prompt.indexOf("## Noise Suppression");
    const intentIdx = prompt.indexOf("## PR Intent Scoping");
    expect(noiseIdx).toBeGreaterThan(-1);
    expect(intentIdx).toBeGreaterThan(-1);
    expect(intentIdx).toBeGreaterThan(noiseIdx);
  });

  // 18. Finding Language Guidelines appears after PR Intent Scoping
  test("Finding Language Guidelines section appears after PR Intent Scoping", () => {
    const prompt = buildReviewPrompt(baseContext());
    const intentIdx = prompt.indexOf("## PR Intent Scoping");
    const toneIdx = prompt.indexOf("## Finding Language Guidelines");
    expect(intentIdx).toBeGreaterThan(-1);
    expect(toneIdx).toBeGreaterThan(-1);
    expect(toneIdx).toBeGreaterThan(intentIdx);
  });
});

// ---------------------------------------------------------------------------
// Phase 36: Verdict & Merge Confidence
// ---------------------------------------------------------------------------

describe("Phase 36: Verdict & Merge Confidence", () => {
  // 1. Verdict template includes three merge-recommendation states
  test("verdict template includes three merge-recommendation states", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("Ready to merge");
    expect(prompt).toContain("Ready to merge with minor items");
    expect(prompt).toContain("Address before merging");
  });

  // 2. Verdict template uses correct emoji mapping
  test("verdict template uses correct emoji mapping", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain(":green_circle: **Ready to merge**");
    expect(prompt).toContain(":yellow_circle: **Ready to merge with minor items**");
    expect(prompt).toContain(":red_circle: **Address before merging**");
  });

  // 3. Verdict logic section defines blocker as CRITICAL or MAJOR
  test("verdict logic section defines blocker as CRITICAL or MAJOR", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain('A "blocker" is any finding with severity CRITICAL or MAJOR under ### Impact');
  });

  // 4. Verdict logic section provides deterministic counting rules
  test("verdict logic section provides deterministic counting rules", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("1. Count the number of [CRITICAL] and [MAJOR] findings under ### Impact.");
    expect(prompt).toContain("2. If count > 0:");
    expect(prompt).toContain("3. If count == 0 AND there are non-blocking findings");
    expect(prompt).toContain("4. If count == 0 AND there are no findings at all:");
  });

  // 5. Suggestions template requires Optional or Future consideration prefix
  test("suggestions template requires Optional or Future consideration prefix", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("Optional: <low-friction cleanup");
    expect(prompt).toContain("Future consideration: <larger improvement");
  });

  // 6. Hard requirements enforce blocker-driven verdict
  test("hard requirements enforce blocker-driven verdict", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("determine which one using the Verdict Logic rules above");
    expect(prompt).toContain("Zero blockers = :green_circle: or :yellow_circle: verdict. Never :red_circle: without blockers");
  });

  // 7. Hard requirements enforce suggestion labeling
  test("hard requirements enforce suggestion labeling", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("every item MUST start with 'Optional:' or 'Future consideration:'");
    expect(prompt).toContain("suggestions are NEVER counted against merge readiness");
  });

  // 8. Verdict logic section not included in enhanced mode
  test("verdict logic section not included in enhanced mode", () => {
    const prompt = buildReviewPrompt(baseContext({ mode: "enhanced" }));
    expect(prompt).not.toContain("Verdict Logic");
  });
});
