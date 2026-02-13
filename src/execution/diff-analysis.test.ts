import { expect, test } from "bun:test";
import {
  analyzeDiff,
  classifyFileLanguage,
  classifyLanguages,
  MAX_ANALYSIS_FILES,
  MAX_ANALYSIS_TIME_MS,
  type DiffAnalysisInput,
} from "./diff-analysis.ts";

function run(input: Partial<DiffAnalysisInput> = {}) {
  return analyzeDiff({
    changedFiles: [],
    numstatLines: [],
    ...input,
  });
}

function withMockedDateNow(times: number[], fn: () => void) {
  const originalNow = Date.now;
  let callIndex = 0;

  Date.now = () => {
    const index = Math.min(callIndex, times.length - 1);
    callIndex += 1;
    return times[index] ?? 0;
  };

  try {
    fn();
  } finally {
    Date.now = originalNow;
  }
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
  expect(result.filesByLanguage).toEqual({});
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

test("time budget keeps full analysis behavior within budget", () => {
  withMockedDateNow(Array(40).fill(0), () => {
    const result = run({
      changedFiles: ["src/auth.ts", "package.json"],
      numstatLines: ["3\t1\tsrc/auth.ts", "5\t2\tpackage.json"],
      diffContent: "try {\n  doWork();\n} catch (err) {}\n",
    });

    expect(result.riskSignals).toContain("Modifies authentication/authorization code");
    expect(result.riskSignals).toContain("Modifies dependency manifest");
    expect(result.riskSignals).toContain("Modifies error handling logic");
    expect(result.riskSignals).not.toContain("Analysis truncated due to time budget");
    expect(result.filesByCategory.source).toContain("src/auth.ts");
    expect(result.filesByCategory.config).toContain("package.json");
    expect(result.metrics).toEqual({
      totalFiles: 2,
      totalLinesAdded: 8,
      totalLinesRemoved: 3,
      hunksCount: 0,
    });
  });
});

test("time budget exceeded returns deterministic truncation signal", () => {
  withMockedDateNow([0, MAX_ANALYSIS_TIME_MS + 1], () => {
    const result = run({
      changedFiles: ["src/auth.ts", "package.json"],
      numstatLines: ["3\t1\tsrc/auth.ts", "5\t2\tpackage.json"],
      diffContent: "try {\n  doWork();\n} catch (err) {}\n",
    });

    expect(result.riskSignals).toEqual(["Analysis truncated due to time budget"]);
    expect(result.metrics).toEqual({
      totalFiles: 2,
      totalLinesAdded: 8,
      totalLinesRemoved: 3,
      hunksCount: 0,
    });
    expect(result.filesByCategory).toEqual({
      source: [],
      test: [],
      config: [],
      docs: [],
      infra: [],
    });
    expect(result.isLargePR).toBe(false);
  });
});

// Language classification tests

test("classifyFileLanguage returns correct language for known extensions", () => {
  expect(classifyFileLanguage("src/main.ts")).toBe("TypeScript");
  expect(classifyFileLanguage("app.py")).toBe("Python");
  expect(classifyFileLanguage("cmd/server.go")).toBe("Go");
  expect(classifyFileLanguage("lib.rs")).toBe("Rust");
  expect(classifyFileLanguage("App.java")).toBe("Java");
  expect(classifyFileLanguage("script.rb")).toBe("Ruby");
  expect(classifyFileLanguage("widget.cpp")).toBe("C++");
  expect(classifyFileLanguage("main.c")).toBe("C");
  expect(classifyFileLanguage("util.h")).toBe("C");
  expect(classifyFileLanguage("index.php")).toBe("PHP");
});

test("classifyFileLanguage returns Unknown for unrecognized extension", () => {
  expect(classifyFileLanguage("data.xyz")).toBe("Unknown");
  expect(classifyFileLanguage("file.unknown")).toBe("Unknown");
});

test("classifyFileLanguage returns Unknown for extensionless file", () => {
  expect(classifyFileLanguage("README")).toBe("Unknown");
  expect(classifyFileLanguage("Makefile")).toBe("Unknown");
});

test("classifyLanguages groups files correctly and omits Unknown", () => {
  const result = classifyLanguages([
    "src/app.ts",
    "src/utils.ts",
    "lib/main.py",
    "README",
    "cmd/server.go",
    "Makefile",
  ]);

  expect(result).toEqual({
    TypeScript: ["src/app.ts", "src/utils.ts"],
    Python: ["lib/main.py"],
    Go: ["cmd/server.go"],
  });
});

test("analyzeDiff result includes filesByLanguage with correct grouping for mixed-language input", () => {
  const result = run({
    changedFiles: ["a.ts", "b.py", "c.go", "d.rs", "README.md"],
  });

  expect(result.filesByLanguage).toEqual({
    TypeScript: ["a.ts"],
    Python: ["b.py"],
    Go: ["c.go"],
    Rust: ["d.rs"],
  });
});

test("empty input returns empty filesByLanguage", () => {
  const result = run();
  expect(result.filesByLanguage).toEqual({});
});
