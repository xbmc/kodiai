import { describe, expect, test } from "bun:test";
import {
  analyzeDiff,
  classifyFileLanguage,
  classifyFileLanguageWithContext,
  classifyLanguages,
  parseNumstatPerFile,
  EXTENSION_LANGUAGE_MAP,
  RELATED_LANGUAGES,
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

// ---------- parseNumstatPerFile ----------

describe("parseNumstatPerFile", () => {
  test("standard lines: parses added and removed per file", () => {
    const result = parseNumstatPerFile([
      "10\t5\tsrc/foo.ts",
      "20\t3\tsrc/bar.ts",
    ]);

    expect(result.get("src/foo.ts")).toEqual({ added: 10, removed: 5 });
    expect(result.get("src/bar.ts")).toEqual({ added: 20, removed: 3 });
    expect(result.size).toBe(2);
  });

  test("binary files: dash values treated as 0 lines", () => {
    const result = parseNumstatPerFile(["-\t-\tsrc/image.png"]);

    expect(result.get("src/image.png")).toEqual({ added: 0, removed: 0 });
  });

  test("empty input: returns empty Map", () => {
    const result = parseNumstatPerFile([]);
    expect(result.size).toBe(0);
  });

  test("malformed lines: skips them gracefully", () => {
    const result = parseNumstatPerFile([
      "10\t5\tsrc/foo.ts",
      "not-a-numstat-line",
      "",
      "20\t3\tsrc/bar.ts",
    ]);

    expect(result.size).toBe(2);
    expect(result.get("src/foo.ts")).toEqual({ added: 10, removed: 5 });
    expect(result.get("src/bar.ts")).toEqual({ added: 20, removed: 3 });
  });
});

// ---------- EXTENSION_LANGUAGE_MAP coverage ----------

test("EXTENSION_LANGUAGE_MAP covers 30+ language extensions", () => {
  expect(Object.keys(EXTENSION_LANGUAGE_MAP).length).toBeGreaterThanOrEqual(30);
});

test("classifyFileLanguage covers newly added language extensions", () => {
  // Functional languages
  expect(classifyFileLanguage("lib/code.hs")).toBe("Haskell");
  expect(classifyFileLanguage("lib/main.ml")).toBe("OCaml");
  expect(classifyFileLanguage("src/lib.mli")).toBe("OCaml");
  expect(classifyFileLanguage("Program.fs")).toBe("F#");
  expect(classifyFileLanguage("Script.fsx")).toBe("F#");
  expect(classifyFileLanguage("app.jl")).toBe("Julia");

  // Systems / hardware
  expect(classifyFileLanguage("core.v")).toBe("Verilog");
  expect(classifyFileLanguage("core.sv")).toBe("Verilog");
  expect(classifyFileLanguage("cpu.vhd")).toBe("VHDL");
  expect(classifyFileLanguage("CMakeLists.cmake")).toBe("CMake");

  // Dynamic / scripting
  expect(classifyFileLanguage("stats.r")).toBe("R");
  expect(classifyFileLanguage("analysis.R")).toBe("R");
  expect(classifyFileLanguage("Controller.m")).toBe("Objective-C");
  expect(classifyFileLanguage("View.mm")).toBe("Objective-C++");
  expect(classifyFileLanguage("script.pl")).toBe("Perl");
  expect(classifyFileLanguage("module.pm")).toBe("Perl");

  // JVM / functional on JVM
  expect(classifyFileLanguage("App.clj")).toBe("Clojure");
  expect(classifyFileLanguage("handler.cljs")).toBe("Clojure");
  expect(classifyFileLanguage("server.erl")).toBe("Erlang");
  expect(classifyFileLanguage("header.hrl")).toBe("Erlang");
  expect(classifyFileLanguage("Build.groovy")).toBe("Groovy");
});

// ---------- classifyFileLanguageWithContext ----------

describe("classifyFileLanguageWithContext", () => {
  test("returns lowercase language for non-ambiguous extensions", () => {
    expect(classifyFileLanguageWithContext("src/main.ts")).toBe("typescript");
    expect(classifyFileLanguageWithContext("lib/code.py")).toBe("python");
    expect(classifyFileLanguageWithContext("cmd/server.go")).toBe("go");
  });

  test(".h file with C++ context returns 'cpp'", () => {
    expect(classifyFileLanguageWithContext("include/header.h", ["src/main.cpp", "src/utils.hpp"])).toBe("cpp");
  });

  test(".h file with C++ context via .cc extension returns 'cpp'", () => {
    expect(classifyFileLanguageWithContext("include/header.h", ["lib/module.cc"])).toBe("cpp");
  });

  test(".h file with C++ context via .cxx extension returns 'cpp'", () => {
    expect(classifyFileLanguageWithContext("include/header.h", ["lib/module.cxx"])).toBe("cpp");
  });

  test(".h file with only C context returns 'c'", () => {
    expect(classifyFileLanguageWithContext("include/header.h", ["src/main.c", "src/util.c"])).toBe("c");
  });

  test(".h file with no context returns 'c' (fallback)", () => {
    expect(classifyFileLanguageWithContext("include/header.h")).toBe("c");
    expect(classifyFileLanguageWithContext("include/header.h", [])).toBe("c");
  });

  test(".h file with mixed C and C++ context returns 'cpp' (C++ wins)", () => {
    expect(classifyFileLanguageWithContext("include/header.h", ["src/main.c", "lib/module.cpp"])).toBe("cpp");
  });

  test("returns 'unknown' for unrecognized extension", () => {
    expect(classifyFileLanguageWithContext("file.xyz")).toBe("unknown");
  });
});

// ---------- RELATED_LANGUAGES ----------

describe("RELATED_LANGUAGES", () => {
  test("c relates to cpp", () => {
    expect(RELATED_LANGUAGES["c"]).toContain("cpp");
  });

  test("cpp relates to c", () => {
    expect(RELATED_LANGUAGES["cpp"]).toContain("c");
  });

  test("typescript relates to javascript", () => {
    expect(RELATED_LANGUAGES["typescript"]).toContain("javascript");
  });

  test("javascript relates to typescript", () => {
    expect(RELATED_LANGUAGES["javascript"]).toContain("typescript");
  });

  test("objectivec relates to c and cpp", () => {
    expect(RELATED_LANGUAGES["objectivec"]).toContain("c");
    expect(RELATED_LANGUAGES["objectivec"]).toContain("cpp");
  });

  test("objectivecpp relates to c, cpp, and objectivec", () => {
    expect(RELATED_LANGUAGES["objectivecpp"]).toContain("c");
    expect(RELATED_LANGUAGES["objectivecpp"]).toContain("cpp");
    expect(RELATED_LANGUAGES["objectivecpp"]).toContain("objectivec");
  });
});
