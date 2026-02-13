import { test, expect } from "bun:test";
import type { DiffAnalysis } from "./diff-analysis.ts";
import {
  buildConfidenceInstructions,
  buildDiffAnalysisSection,
  buildLanguageGuidanceSection,
  buildMetricsInstructions,
  buildOutputLanguageSection,
  buildPathInstructionsSection,
  buildReviewPrompt,
  buildSuppressionRulesSection,
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

test("default config preserves summary comment section", () => {
  const prompt = buildReviewPrompt(baseContext());
  expect(prompt).toContain("Kodiai Review Summary");
  expect(prompt).toContain("summary comment");
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
