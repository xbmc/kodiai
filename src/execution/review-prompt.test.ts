import { test, expect, describe } from "bun:test";
import type { DiffAnalysis } from "./diff-analysis.ts";
import type { ReviewCommentMatch } from "../knowledge/review-comment-retrieval.ts";
import {
  SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE,
  buildAuthorExperienceSection,
  buildConfidenceInstructions,
  buildDeltaReviewContext,
  buildDeltaVerdictLogicSection,
  buildDiffAnalysisSection,
  buildLanguageGuidanceSection,
  buildOutputLanguageSection,
  buildPathInstructionsSection,
  buildPrIntentScopingSection,
  buildRetrievalContextSection,
  buildReviewedCategoriesLine,
  buildReviewPrompt,
  buildSuppressionRulesSection,
  buildToneGuidelinesSection,
  buildVerdictLogicSection,
  formatClusterPatterns,
  formatReviewPrecedents,
  matchPathInstructions,
} from "./review-prompt.ts";
import type { ClusterPatternMatch } from "../knowledge/cluster-types.ts";

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

test("buildReviewPrompt includes Focus Hints section when focusHints provided", () => {
  const prompt = buildReviewPrompt(
    baseContext({ focusHints: ["auth", "ios"] }),
  );
  expect(prompt).toContain("## Focus Hints");
  expect(prompt).toContain("- [AUTH]");
  expect(prompt).toContain("- [IOS]");
});

test("buildReviewPrompt omits Focus Hints section when focusHints empty", () => {
  const prompt = buildReviewPrompt(baseContext({ focusHints: [] }));
  expect(prompt).not.toContain("## Focus Hints");
});

test("buildAuthorExperienceSection returns educational directives for first-time tier", () => {
  const section = buildAuthorExperienceSection({
    tier: "first-time",
    authorLogin: "newdev",
  });

  expect(section).toContain("Author Experience Context");
  expect(section).toContain("first-time or new contributor");
  expect(section).toContain("encouraging, welcoming");
  expect(section).toContain("Explain WHY");
  expect(section).toContain("learning opportunities");
  expect(section).toContain("newdev");
});

test("buildAuthorExperienceSection returns terse directives for core tier", () => {
  const section = buildAuthorExperienceSection({
    tier: "core",
    authorLogin: "maintainer",
  });

  expect(section).toContain("Author Experience Context");
  expect(section).toContain("core contributor");
  expect(section).toContain("concise");
  expect(section).toContain("terse");
  expect(section).toContain("maintainer");
});

test("buildAuthorExperienceSection returns empty string for regular tier", () => {
  expect(
    buildAuthorExperienceSection({ tier: "regular", authorLogin: "someone" }),
  ).toBe("");
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

test("buildReviewPrompt includes partial-analysis disclaimer instructions when search degradation is active", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      searchRateLimitDegradation: {
        degraded: true,
        retryAttempts: 1,
        skippedQueries: 1,
        degradationPath: "search-api-rate-limit",
      },
    }),
  );

  expect(prompt).toContain("## Search API Degradation Context");
  expect(prompt).toContain(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE);
  expect(prompt).toContain(`"${SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE}"`);
  const disclosureOccurrences = prompt.split(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE).length - 1;
  expect(disclosureOccurrences).toBe(2);
});

test("buildReviewPrompt omits degradation instructions when search degradation is inactive", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      searchRateLimitDegradation: {
        degraded: false,
        retryAttempts: 0,
        skippedQueries: 0,
        degradationPath: "none",
      },
    }),
  );

  expect(prompt).not.toContain("## Search API Degradation Context");
  expect(prompt).not.toContain(SEARCH_RATE_LIMIT_DISCLOSURE_SENTENCE);
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
        path: "src/db.ts",
        line: 42,
        snippet: "const query = `SELECT * FROM users WHERE id = ${userId}`",
        outcome: "accepted",
        distance: 0.12,
        sourceRepo: "owner/other-repo",
      },
    ],
  });
  expect(section).toContain("Prior pattern:");
  expect(section).toContain("When a finding directly matches prior context, append");
  expect(section).toContain("`src/db.ts:42` --");
});

test("buildRetrievalContextSection returns empty string when no findings", () => {
  const section = buildRetrievalContextSection({ findings: [] });
  expect(section).toBe("");
});

test("buildRetrievalContextSection uses path-only fallback formatting when snippet evidence missing", () => {
  const section = buildRetrievalContextSection({
    findings: [
      {
        findingText: "Missing null guard before dereference",
        severity: "major",
        category: "correctness",
        path: "src/handler.ts",
        outcome: "accepted",
        distance: 0.15,
        sourceRepo: "owner/repo",
      },
    ],
  });

  expect(section).toContain("`src/handler.ts` -- Missing null guard before dereference");
});

test("buildRetrievalContextSection trims overflow by dropping highest-distance findings first", () => {
  const section = buildRetrievalContextSection({
    findings: [
      {
        findingText: "high value",
        severity: "major",
        category: "correctness",
        path: "src/a.ts",
        line: 10,
        snippet: "const stable = true;",
        outcome: "accepted",
        distance: 0.1,
        sourceRepo: "owner/repo",
      },
      {
        findingText: "low value",
        severity: "major",
        category: "correctness",
        path: "src/z.ts",
        line: 90,
        snippet: "const noisy = veryLongValue.repeat(20);",
        outcome: "accepted",
        distance: 0.9,
        sourceRepo: "owner/repo",
      },
    ],
    maxChars: 380,
  });

  expect(section).toContain("`src/a.ts:10`");
  expect(section).not.toContain("`src/z.ts:90`");
});

test("buildRetrievalContextSection omits section when all findings are trimmed by budget", () => {
  const section = buildRetrievalContextSection({
    findings: [
      {
        findingText: "very long finding text ".repeat(20),
        severity: "major",
        category: "correctness",
        path: "src/overflow.ts",
        line: 1,
        snippet: "const longLine = 'x'.repeat(400);",
        outcome: "accepted",
        distance: 0.2,
        sourceRepo: "owner/repo",
      },
    ],
    maxChars: 40,
  });

  expect(section).toBe("");
});

test("buildReviewPrompt keeps degraded retrieval context well-formed and within configured budget", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      searchRateLimitDegradation: {
        degraded: true,
        retryAttempts: 1,
        skippedQueries: 1,
        degradationPath: "search-api-rate-limit",
      },
      retrievalContext: {
        maxChars: 420,
        findings: [
          {
            findingText: "fallback `text` should stay safe",
            severity: "major",
            category: "correctness",
            path: "src/a.ts",
            line: 10,
            snippet: "const kept = true;",
            outcome: "accepted",
            distance: 0.1,
            sourceRepo: "acme/repo",
          },
          {
            findingText: "lower value finding",
            severity: "major",
            category: "correctness",
            path: "src/z.ts",
            line: 99,
            snippet: "const dropped = veryLongExpression.repeat(50);",
            outcome: "accepted",
            distance: 0.9,
            sourceRepo: "acme/repo",
          },
        ],
      },
    }),
  );

  expect(prompt).toContain("## Search API Degradation Context");
  expect(prompt).toContain("## Similar Prior Findings (Learning Context)");
  expect(prompt).toContain("`src/a.ts:10` -- `const kept = true;`");

  const retrievalMatch = prompt.match(
    /## Similar Prior Findings \(Learning Context\)[\s\S]*?(?=\n## |$)/,
  );
  expect(retrievalMatch).toBeDefined();
  expect(retrievalMatch![0].length).toBeLessThanOrEqual(420);
});

test("buildReviewPrompt omits degraded retrieval section cleanly when budget removes all findings", () => {
  const prompt = buildReviewPrompt(
    baseContext({
      searchRateLimitDegradation: {
        degraded: true,
        retryAttempts: 1,
        skippedQueries: 1,
        degradationPath: "search-api-rate-limit",
      },
      retrievalContext: {
        maxChars: 40,
        findings: [
          {
            findingText: "very long finding text ".repeat(20),
            severity: "major",
            category: "correctness",
            path: "src/overflow.ts",
            line: 1,
            snippet: "const longLine = 'x'.repeat(300);",
            outcome: "accepted",
            distance: 0.2,
            sourceRepo: "acme/repo",
          },
        ],
      },
    }),
  );

  expect(prompt).toContain("## Search API Degradation Context");
  expect(prompt).not.toContain("## Similar Prior Findings (Learning Context)");
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

// ---------------------------------------------------------------------------
// Phase 38: Delta Re-Review Formatting
// ---------------------------------------------------------------------------

describe("Phase 38: Delta Re-Review Formatting", () => {
  const sampleDeltaContext = {
    lastReviewedHeadSha: "abc1234def5678",
    changedFilesSinceLastReview: ["src/index.ts", "src/auth.ts"],
    priorFindings: [
      { filePath: "src/auth.ts", title: "SQL injection in login query", severity: "critical", category: "security" },
      { filePath: "src/db.ts", title: "Missing transaction for batch write", severity: "major", category: "correctness" },
    ],
  };

  // 1. buildDeltaReviewContext includes prior findings and changed files
  test("buildDeltaReviewContext includes prior findings and changed files", () => {
    const section = buildDeltaReviewContext(sampleDeltaContext);
    expect(section).toContain("## Delta Review Context");
    expect(section).toContain("abc1234");
    expect(section).toContain("src/index.ts");
    expect(section).toContain("src/auth.ts");
    expect(section).toContain("[CRITICAL] src/auth.ts: SQL injection in login query");
    expect(section).toContain("[MAJOR] src/db.ts: Missing transaction for batch write");
    expect(section).toContain("Prior review findings (2):");
    expect(section).toContain("NEW");
    expect(section).toContain("RESOLVED");
    expect(section).toContain("STILL OPEN");
  });

  // 2. buildDeltaVerdictLogicSection includes three delta verdict states
  test("buildDeltaVerdictLogicSection includes three delta verdict states", () => {
    const section = buildDeltaVerdictLogicSection();
    expect(section).toContain("Verdict Update Logic");
    expect(section).toContain(":green_circle:");
    expect(section).toContain(":yellow_circle:");
    expect(section).toContain(":large_blue_circle:");
    expect(section).toContain("New blockers found");
    expect(section).toContain("Blockers resolved");
    expect(section).toContain("Still ready");
  });

  // 3. buildReviewPrompt with deltaContext produces delta template
  test("buildReviewPrompt with deltaContext produces delta template", () => {
    const prompt = buildReviewPrompt(baseContext({ deltaContext: sampleDeltaContext }));
    expect(prompt).toContain("Kodiai Re-Review Summary");
    expect(prompt).toContain("## Re-review");
    expect(prompt).toContain("## What Changed");
    expect(prompt).toContain("## Verdict Update");
    expect(prompt).toContain(":new:");
    expect(prompt).toContain(":white_check_mark:");
    // The standard five-section summary header tag must NOT appear as a template tag
    // (it may appear in the hard requirements as a negative instruction: "NOT 'Kodiai Review Summary'")
    expect(prompt).not.toContain("<summary>Kodiai Review Summary</summary>");
  });

  // 4. buildReviewPrompt without deltaContext produces standard template
  test("buildReviewPrompt without deltaContext produces standard template", () => {
    const prompt = buildReviewPrompt(baseContext({ deltaContext: null }));
    expect(prompt).toContain("Kodiai Review Summary");
    expect(prompt).not.toContain("Kodiai Re-Review Summary");
  });

  // 5. delta template hard requirements include section rules
  test("delta template hard requirements include section rules", () => {
    const prompt = buildReviewPrompt(baseContext({ deltaContext: sampleDeltaContext }));
    expect(prompt).toContain("## New Findings");
    expect(prompt).toContain("## Resolved Findings");
    expect(prompt).toContain("## Still Open");
    expect(prompt).toContain("at least one must be present");
  });

  // 6. delta template omits Impact/Preference subsections
  test("delta template omits Impact/Preference subsections", () => {
    const prompt = buildReviewPrompt(baseContext({ deltaContext: sampleDeltaContext }));
    // The hard requirements section should NOT mention ### Impact or ### Preference
    const hardReqStart = prompt.indexOf("Hard requirements for the re-review summary:");
    const hardReqSection = prompt.slice(hardReqStart, hardReqStart + 1500);
    expect(hardReqSection).not.toContain("### Impact");
    expect(hardReqSection).not.toContain("### Preference");
  });
});

// ---------------------------------------------------------------------------
// depBumpContext — Dependency Bump Context prompt section
// ---------------------------------------------------------------------------
describe("depBumpContext", () => {
  function makeDepBumpContext(overrides: Record<string, unknown> = {}) {
    return {
      detection: {
        source: "dependabot" as const,
        signals: ["title", "sender"],
      },
      details: {
        packageName: "lodash",
        oldVersion: "4.17.20",
        newVersion: "4.17.21",
        ecosystem: "npm",
        isGroup: false,
      },
      classification: {
        bumpType: "patch" as const,
        isBreaking: false,
      },
      ...overrides,
    };
  }

  test("includes dependency bump section for major bump", () => {
    const depBumpContext = makeDepBumpContext({
      details: {
        packageName: "@angular/core",
        oldVersion: "15.2.0",
        newVersion: "16.0.0",
        ecosystem: "npm",
        isGroup: false,
      },
      classification: {
        bumpType: "major",
        isBreaking: true,
      },
    });
    const prompt = buildReviewPrompt(baseContext({ depBumpContext }));
    expect(prompt).toContain("Dependency Bump Context");
    expect(prompt).toContain("MAJOR version bump");
    expect(prompt).toContain("@angular/core");
    expect(prompt).toContain("15.2.0");
    expect(prompt).toContain("16.0.0");
    expect(prompt).toContain("npm");
    expect(prompt).toContain("Breaking API changes");
  });

  test("includes dependency bump section for minor/patch bump", () => {
    const depBumpContext = makeDepBumpContext({
      classification: {
        bumpType: "patch",
        isBreaking: false,
      },
    });
    const prompt = buildReviewPrompt(baseContext({ depBumpContext }));
    expect(prompt).toContain("Dependency Bump Context");
    expect(prompt).toContain("minor/patch dependency update");
    expect(prompt).not.toContain("MAJOR version bump");
    expect(prompt).toContain("routine maintenance");
  });

  test("includes group bump note", () => {
    const depBumpContext = makeDepBumpContext({
      details: {
        packageName: null,
        oldVersion: null,
        newVersion: null,
        ecosystem: "npm",
        isGroup: true,
      },
    });
    const prompt = buildReviewPrompt(baseContext({ depBumpContext }));
    expect(prompt).toContain("group dependency update");
  });

  test("renders workspace usage evidence when present", () => {
    const depBumpContext = makeDepBumpContext({
      usageEvidence: {
        evidence: [
          {
            filePath: "src/auth.ts",
            line: 42,
            snippet: "import { merge } from 'lodash';",
          },
        ],
        searchTerms: ["lodash", "merge"],
        timedOut: false,
      },
    });

    const prompt = buildReviewPrompt(baseContext({ depBumpContext }));
    expect(prompt).toContain("Workspace Usage Evidence");
    expect(prompt).toContain("`src/auth.ts:42`");
    expect(prompt).toContain("lodash");
  });

  test("renders multi-package coordination groups when present", () => {
    const depBumpContext = makeDepBumpContext({
      details: {
        packageName: null,
        oldVersion: null,
        newVersion: null,
        ecosystem: "npm",
        isGroup: true,
      },
      scopeGroups: [
        {
          scope: "@babel",
          packages: ["@babel/core", "@babel/parser"],
        },
      ],
    });

    const prompt = buildReviewPrompt(baseContext({ depBumpContext }));
    expect(prompt).toContain("Multi-Package Coordination");
    expect(prompt).toContain("@babel/core, @babel/parser");
  });

  test("omits section when depBumpContext is null", () => {
    const prompt = buildReviewPrompt(baseContext({ depBumpContext: null }));
    expect(prompt).not.toContain("Dependency Bump Context");
  });

  test("omits section when depBumpContext is undefined", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).not.toContain("Dependency Bump Context");
  });
});

describe("draft PR review prompt", () => {
  test("isDraft true includes draft badge and suggestive tone", () => {
    const prompt = buildReviewPrompt(baseContext({ isDraft: true }));
    expect(prompt).toContain("\ud83d\udcdd Kodiai Draft Review Summary");
    expect(prompt).toContain("> **Draft**");
    expect(prompt).toContain("suggestive framing");
    expect(prompt).toContain("Consider...");
    expect(prompt).not.toMatch(/<summary>Kodiai Review Summary<\/summary>/);
  });

  test("isDraft false uses standard summary tag without draft framing", () => {
    const prompt = buildReviewPrompt(baseContext({ isDraft: false }));
    expect(prompt).toContain("<summary>Kodiai Review Summary</summary>");
    expect(prompt).not.toContain("Draft Review Summary");
    expect(prompt).not.toContain("> **Draft**");
    expect(prompt).not.toContain("suggestive framing");
  });

  test("isDraft undefined uses standard summary tag without draft framing", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).toContain("<summary>Kodiai Review Summary</summary>");
    expect(prompt).not.toContain("Draft Review Summary");
    expect(prompt).not.toContain("> **Draft**");
  });

  test("isDraft true with deltaContext does not include draft badge (delta takes precedence)", () => {
    const prompt = buildReviewPrompt(baseContext({
      isDraft: true,
      deltaContext: {
        lastReviewedHeadSha: "abc123",
        changedFilesSinceLastReview: ["src/index.ts"],
        priorFindings: [{ filePath: "src/index.ts", title: "Bug", severity: "MAJOR", category: "Impact" }],
      },
    }));
    // Delta template uses its own summary format, not the standard one
    expect(prompt).not.toContain("\ud83d\udcdd Kodiai Draft Review Summary");
    expect(prompt).not.toContain("> **Draft**");
  });
});

// ---------------------------------------------------------------------------
// Phase 89-04: Review Precedents (KI-05/KI-06)
// ---------------------------------------------------------------------------

function makeReviewCommentMatch(overrides: Partial<ReviewCommentMatch> = {}): ReviewCommentMatch {
  return {
    chunkText: "This lock ordering can cause deadlocks when called from the rendering thread",
    distance: 0.25,
    repo: "owner/repo",
    prNumber: 5678,
    prTitle: "Fix threading issue",
    filePath: "src/video/VideoPlayer.cpp",
    authorLogin: "contributor",
    authorAssociation: "MEMBER",
    githubCreatedAt: "2025-08-15T10:00:00Z",
    startLine: 120,
    endLine: 145,
    source: "review_comment",
    ...overrides,
  };
}

describe("formatReviewPrecedents", () => {
  test("empty matches produces no section", () => {
    expect(formatReviewPrecedents([])).toBe("");
  });

  test("single match formats correctly with PR number, author, date, file path", () => {
    const section = formatReviewPrecedents([makeReviewCommentMatch()]);
    expect(section).toContain("## Human Review Precedents");
    expect(section).toContain("**PR #5678**");
    expect(section).toContain("@contributor");
    expect(section).toContain("2025-08-15");
    expect(section).toContain("`src/video/VideoPlayer.cpp:120-145`");
    expect(section).toContain("deadlocks");
    expect(section).toContain("Only cite when there is a strong match");
  });

  test("multiple matches sorted by distance (best first)", () => {
    const matches = [
      makeReviewCommentMatch({ distance: 0.5, prNumber: 111 }),
      makeReviewCommentMatch({ distance: 0.1, prNumber: 222 }),
      makeReviewCommentMatch({ distance: 0.3, prNumber: 333 }),
    ];
    const section = formatReviewPrecedents(matches);
    const pr222Idx = section.indexOf("PR #222");
    const pr333Idx = section.indexOf("PR #333");
    const pr111Idx = section.indexOf("PR #111");
    expect(pr222Idx).toBeLessThan(pr333Idx);
    expect(pr333Idx).toBeLessThan(pr111Idx);
  });

  test("long chunk text truncated to 200 chars at word boundary", () => {
    const longText = "This is a very long review comment that goes on and on about various issues. " +
      "It discusses threading, memory management, lock ordering, and many other important topics " +
      "that are relevant to the code review. The reviewer was very thorough in their analysis.";
    const match = makeReviewCommentMatch({ chunkText: longText });
    const section = formatReviewPrecedents([match]);
    // The excerpt should be truncated and end with "..."
    expect(section).toContain("...");
    // Should not contain the full text
    expect(section).not.toContain("very thorough in their analysis");
  });

  test("matches without filePath show general review instead", () => {
    const match = makeReviewCommentMatch({ filePath: null });
    const section = formatReviewPrecedents([match]);
    expect(section).toContain("general review");
    expect(section).not.toContain("`null`");
  });

  test("matches with filePath but no line range show file only", () => {
    const match = makeReviewCommentMatch({ startLine: null, endLine: null });
    const section = formatReviewPrecedents([match]);
    expect(section).toContain("`src/video/VideoPlayer.cpp`");
    expect(section).not.toContain("120-145");
  });

  test("section appears after Learning Context section in full prompt", () => {
    const prompt = buildReviewPrompt(baseContext({
      retrievalContext: {
        findings: [{
          findingText: "SQL injection risk",
          severity: "major",
          category: "security",
          path: "src/db.ts",
          outcome: "accepted",
          distance: 0.12,
          sourceRepo: "owner/repo",
        }],
      },
      reviewPrecedents: [makeReviewCommentMatch()],
    }));
    const learningIdx = prompt.indexOf("## Similar Prior Findings (Learning Context)");
    const precedentsIdx = prompt.indexOf("## Human Review Precedents");
    expect(learningIdx).toBeGreaterThan(-1);
    expect(precedentsIdx).toBeGreaterThan(-1);
    expect(precedentsIdx).toBeGreaterThan(learningIdx);
  });

  test("existing prompt tests continue to pass without reviewPrecedents", () => {
    const prompt = buildReviewPrompt(baseContext());
    expect(prompt).not.toContain("## Human Review Precedents");
  });

  test("caps at 5 matches", () => {
    const matches = Array.from({ length: 8 }, (_, i) =>
      makeReviewCommentMatch({ prNumber: 100 + i, distance: 0.1 + i * 0.05 }),
    );
    const section = formatReviewPrecedents(matches);
    const prMatches = section.match(/\*\*PR #\d+\*\*/g);
    expect(prMatches).toHaveLength(5);
  });
});

// ── Cluster Pattern Tests (CLST-03) ──────────────────────────────────

function makeClusterPattern(overrides: Partial<ClusterPatternMatch> = {}): ClusterPatternMatch {
  return {
    clusterId: 1,
    slug: "null-check-missing",
    label: "Missing null/undefined checks before property access",
    memberCount: 12,
    similarityScore: 0.85,
    filePathOverlap: 0.4,
    combinedScore: 0.62,
    representativeSample: "Should check for null before accessing .data property",
    ...overrides,
  };
}

describe("formatClusterPatterns", () => {
  test("empty patterns produces no section", () => {
    expect(formatClusterPatterns([])).toBe("");
  });

  test("single pattern formats with slug, label, count, and sample", () => {
    const section = formatClusterPatterns([makeClusterPattern()]);
    expect(section).toContain("## Recurring Review Patterns");
    expect(section).toContain("**null-check-missing**");
    expect(section).toContain("Missing null/undefined checks");
    expect(section).toContain("12 occurrences in last 60 days");
    expect(section).toContain('Example: "Should check for null');
    expect(section).toContain("append a subtle footnote");
  });

  test("caps at 3 patterns even with more input", () => {
    const patterns = Array.from({ length: 5 }, (_, i) =>
      makeClusterPattern({ clusterId: i + 1, slug: `pattern-${i + 1}` }),
    );
    const section = formatClusterPatterns(patterns);
    const slugMatches = section.match(/\*\*pattern-\d+\*\*/g);
    expect(slugMatches).toHaveLength(3);
  });

  test("truncates long representative samples", () => {
    const longSample = "This is an extremely long representative sample text that goes on and on about " +
      "various code review issues including null checks, error handling, type safety, performance " +
      "optimization, and many other topics that reviewers have flagged repeatedly over many months.";
    const section = formatClusterPatterns([makeClusterPattern({ representativeSample: longSample })]);
    expect(section).toContain("...");
    expect(section).not.toContain("flagged repeatedly over many months");
  });

  test("buildReviewPrompt includes cluster patterns section when provided", () => {
    const prompt = buildReviewPrompt(baseContext({
      clusterPatterns: [makeClusterPattern()],
    }));
    expect(prompt).toContain("## Recurring Review Patterns");
    expect(prompt).toContain("**null-check-missing**");
  });

  test("buildReviewPrompt omits cluster patterns section when empty or undefined", () => {
    const promptEmpty = buildReviewPrompt(baseContext({ clusterPatterns: [] }));
    expect(promptEmpty).not.toContain("## Recurring Review Patterns");

    const promptUndef = buildReviewPrompt(baseContext());
    expect(promptUndef).not.toContain("## Recurring Review Patterns");
  });
});
