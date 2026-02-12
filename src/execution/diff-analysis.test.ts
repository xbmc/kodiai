import { expect, test } from "bun:test";
import {
  analyzeDiff,
  MAX_ANALYSIS_FILES,
  type DiffAnalysisInput,
} from "./diff-analysis.ts";

function run(input: Partial<DiffAnalysisInput> = {}) {
  return analyzeDiff({
    changedFiles: [],
    numstatLines: [],
    ...input,
  });
}

test("empty input returns empty analysis", () => {
  const result = run();

  expect(result.filesByCategory).toEqual({
    source: [],
    test: [],
    config: [],
    docs: [],
    infra: [],
  });
  expect(result.riskSignals).toEqual([]);
  expect(result.metrics).toEqual({
    totalFiles: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    hunksCount: 0,
  });
  expect(result.isLargePR).toBe(false);
});

test("source files are categorized as source", () => {
  const result = run({ changedFiles: ["src/app.ts"] });
  expect(result.filesByCategory.source).toEqual(["src/app.ts"]);
});

test("test files are categorized as test", () => {
  const result = run({ changedFiles: ["src/app.test.ts"] });
  expect(result.filesByCategory.test).toEqual(["src/app.test.ts"]);
});

test("config files are categorized as config", () => {
  const result = run({ changedFiles: ["package.json"] });
  expect(result.filesByCategory.config).toEqual(["package.json"]);
});

test("docs files are categorized as docs", () => {
  const result = run({ changedFiles: ["README.md"] });
  expect(result.filesByCategory.docs).toEqual(["README.md"]);
});

test("infra files are categorized as infra", () => {
  const result = run({ changedFiles: ["Dockerfile"] });
  expect(result.filesByCategory.infra).toEqual(["Dockerfile"]);
});

test("user fileCategories overrides are additive", () => {
  const result = run({
    changedFiles: ["docs/architecture.guide", "src/app.test.ts"],
    fileCategories: {
      docs: ["**/*.guide"],
    },
  });

  expect(result.filesByCategory.docs).toEqual(["docs/architecture.guide"]);
  expect(result.filesByCategory.test).toEqual(["src/app.test.ts"]);
});

test("path-based risk signal detects auth changes", () => {
  const result = run({ changedFiles: ["src/auth-service.ts"] });
  expect(result.riskSignals).toContain("Modifies authentication/authorization code");
});

test("path-based risk signal detects dependency changes", () => {
  const result = run({ changedFiles: ["package.json"] });
  expect(result.riskSignals).toContain("Modifies dependency manifest");
});

test("numstat parsing computes metrics", () => {
  const result = run({
    changedFiles: ["src/a.ts", "src/b.ts", "assets/logo.png"],
    numstatLines: ["10\t5\tsrc/a.ts", "7\t3\tsrc/b.ts", "-\t-\tassets/logo.png"],
  });

  expect(result.metrics.totalFiles).toBe(3);
  expect(result.metrics.totalLinesAdded).toBe(17);
  expect(result.metrics.totalLinesRemoved).toBe(8);
});

test("hunk count is extracted from diff markers", () => {
  const result = run({
    changedFiles: ["src/a.ts"],
    diffContent: "@@ -1,2 +1,2 @@\n+one\n@@ -5,3 +5,4 @@\n+two\n",
  });

  expect(result.metrics.hunksCount).toBe(2);
});

test("content-based risk signals are detected when diff content is present", () => {
  const result = run({
    changedFiles: ["src/a.ts"],
    diffContent: "try {\n  dangerous();\n} catch (err) {}\n",
  });

  expect(result.riskSignals).toContain("Modifies error handling logic");
});

test("content-based risk signals are skipped when diff content exceeds 50KB", () => {
  const result = run({
    changedFiles: ["src/a.ts"],
    diffContent: `${"x".repeat(51 * 1024)} try {}`,
  });

  expect(result.riskSignals).not.toContain("Modifies error handling logic");
});

test("large PR detection triggers for file-count and line-count thresholds", () => {
  const fileCountLarge = run({
    changedFiles: Array.from({ length: MAX_ANALYSIS_FILES + 1 }, (_, i) =>
      `src/file-${i}.ts`,
    ),
  });
  const lineCountLarge = run({
    changedFiles: ["src/a.ts"],
    numstatLines: ["4000\t1200\tsrc/a.ts"],
  });

  expect(fileCountLarge.isLargePR).toBe(true);
  expect(lineCountLarge.isLargePR).toBe(true);
});

test("files beyond analysis cap count in metrics but are not classified", () => {
  const changedFiles = Array.from({ length: MAX_ANALYSIS_FILES + 5 }, (_, i) =>
    `src/file-${i}.ts`,
  );

  const result = run({ changedFiles });

  expect(result.metrics.totalFiles).toBe(MAX_ANALYSIS_FILES + 5);
  expect(result.filesByCategory.source).toHaveLength(MAX_ANALYSIS_FILES);
});
