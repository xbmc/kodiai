import { test, expect, describe } from "bun:test";
import {
  parseDiffHunks,
  buildEmbeddingText,
  isExcludedPath,
  applyHunkCap,
  computeContentHash,
  type ParsedHunk,
} from "./code-snippet-chunker.ts";

describe("parseDiffHunks", () => {
  test("extracts single hunk with additions", () => {
    const diff = `@@ -10,5 +10,8 @@ function handleClick()
 context line
+added line 1
+added line 2
+added line 3
 more context`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/main.ts" });
    expect(result).toHaveLength(1);
    expect(result[0]!.startLine).toBe(10);
    expect(result[0]!.addedLines).toEqual(["added line 1", "added line 2", "added line 3"]);
    expect(result[0]!.functionContext).toBe("function handleClick()");
    expect(result[0]!.filePath).toBe("src/main.ts");
  });

  test("extracts multiple hunks from one file", () => {
    const diff = `@@ -1,3 +1,6 @@
+line a
+line b
+line c
 context
@@ -20,3 +23,6 @@ class Foo
+line x
+line y
+line z
 end`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/foo.ts" });
    expect(result).toHaveLength(2);
    expect(result[0]!.addedLines).toEqual(["line a", "line b", "line c"]);
    expect(result[1]!.startLine).toBe(23);
    expect(result[1]!.functionContext).toBe("class Foo");
  });

  test("only counts + lines as added (not context or deletions)", () => {
    const diff = `@@ -5,7 +5,7 @@
 context
-old line 1
-old line 2
+new line 1
+new line 2
+new line 3
 more context`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/bar.ts" });
    expect(result).toHaveLength(1);
    expect(result[0]!.addedLines).toEqual(["new line 1", "new line 2", "new line 3"]);
  });

  test("excludes pure-deletion hunks (no + lines)", () => {
    const diff = `@@ -5,5 +5,2 @@
 context
-deleted line 1
-deleted line 2
-deleted line 3
 end`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/del.ts" });
    expect(result).toHaveLength(0);
  });

  test("extracts function context from hunk header", () => {
    const diff = `@@ -10,5 +10,7 @@ function handleClick()
+a
+b
+c`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/fn.ts" });
    expect(result[0]!.functionContext).toBe("function handleClick()");
  });

  test("empty function context when not present in header", () => {
    const diff = `@@ -10,5 +10,7 @@
+a
+b
+c`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/fn.ts" });
    expect(result[0]!.functionContext).toBe("");
  });

  test("returns empty array for empty diff", () => {
    expect(parseDiffHunks({ diffText: "", filePath: "src/empty.ts" })).toEqual([]);
  });

  test("ignores 'no newline at end of file' marker", () => {
    const diff = `@@ -1,2 +1,4 @@
+line 1
+line 2
+line 3
\\ No newline at end of file`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/nl.ts" });
    expect(result).toHaveLength(1);
    expect(result[0]!.addedLines).toEqual(["line 1", "line 2", "line 3"]);
  });

  test("does not count +++ header as added line", () => {
    const diff = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,5 @@
+real add 1
+real add 2
+real add 3
 context`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/file.ts" });
    expect(result).toHaveLength(1);
    expect(result[0]!.addedLines).toEqual(["real add 1", "real add 2", "real add 3"]);
  });

  test("filters hunks below minChangedLines threshold", () => {
    const diff = `@@ -1,2 +1,3 @@
+only two
+lines
 context
@@ -10,2 +12,5 @@
+three
+lines
+here
 end`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/min.ts", minChangedLines: 3 });
    expect(result).toHaveLength(1);
    expect(result[0]!.addedLines).toEqual(["three", "lines", "here"]);
  });

  test("includes hunk with exactly minChangedLines", () => {
    const diff = `@@ -1,2 +1,5 @@
+one
+two
+three
 context`;
    const result = parseDiffHunks({ diffText: diff, filePath: "src/exact.ts", minChangedLines: 3 });
    expect(result).toHaveLength(1);
  });

  test("classifies language from file path", () => {
    const diff = `@@ -1,2 +1,5 @@
+a
+b
+c`;
    const ts = parseDiffHunks({ diffText: diff, filePath: "src/main.ts" });
    expect(ts[0]!.language).toBe("TypeScript");

    const py = parseDiffHunks({ diffText: diff, filePath: "lib/util.py" });
    expect(py[0]!.language).toBe("Python");
  });
});

describe("buildEmbeddingText", () => {
  test("includes PR title, file path, function context, and added lines", () => {
    const hunk: ParsedHunk = {
      filePath: "src/codec/ffmpeg.cpp",
      startLine: 142,
      lineCount: 10,
      functionContext: "void decode()",
      addedLines: ["int x = 0;", "return x;", "// done"],
      language: "C++",
    };
    const result = buildEmbeddingText({ hunk, prTitle: "Fix buffer overflow" });
    expect(result).toContain("Fix buffer overflow");
    expect(result).toContain("src/codec/ffmpeg.cpp");
    expect(result).toContain("void decode()");
    expect(result).toContain("int x = 0;");
    expect(result).toContain("return x;");
  });

  test("omits function context when empty", () => {
    const hunk: ParsedHunk = {
      filePath: "src/main.ts",
      startLine: 1,
      lineCount: 5,
      functionContext: "",
      addedLines: ["const x = 1;", "const y = 2;", "export { x, y };"],
      language: "TypeScript",
    };
    const result = buildEmbeddingText({ hunk, prTitle: "Add exports" });
    expect(result).toBe("Add exports | src/main.ts\nconst x = 1;\nconst y = 2;\nexport { x, y };");
  });

  test("format is 'title | path | fn\\nlines'", () => {
    const hunk: ParsedHunk = {
      filePath: "lib/mod.rs",
      startLine: 10,
      lineCount: 3,
      functionContext: "fn main()",
      addedLines: ["let x = 1;", "let y = 2;", "return x + y;"],
      language: "Rust",
    };
    const result = buildEmbeddingText({ hunk, prTitle: "PR title" });
    expect(result).toBe("PR title | lib/mod.rs | fn main()\nlet x = 1;\nlet y = 2;\nreturn x + y;");
  });
});

describe("isExcludedPath", () => {
  const defaultPatterns = [
    "*.lock", "vendor/**", "generated/**", "*.generated.*",
    "*.min.js", "*.min.css", "dist/**", "build/**", "node_modules/**",
  ];

  test("excludes lock files", () => {
    expect(isExcludedPath("yarn.lock", defaultPatterns)).toBe(true);
    expect(isExcludedPath("Gemfile.lock", defaultPatterns)).toBe(true);
  });

  test("excludes vendor directory", () => {
    expect(isExcludedPath("vendor/lib/foo.ts", defaultPatterns)).toBe(true);
  });

  test("excludes generated directory", () => {
    expect(isExcludedPath("generated/types.ts", defaultPatterns)).toBe(true);
  });

  test("excludes dist directory", () => {
    expect(isExcludedPath("dist/bundle.js", defaultPatterns)).toBe(true);
  });

  test("does not exclude normal source files", () => {
    expect(isExcludedPath("src/main.ts", defaultPatterns)).toBe(false);
    expect(isExcludedPath("lib/utils.py", defaultPatterns)).toBe(false);
  });

  test("custom patterns override defaults", () => {
    expect(isExcludedPath("src/main.ts", ["src/**"])).toBe(true);
    expect(isExcludedPath("lib/utils.py", ["src/**"])).toBe(false);
  });
});

describe("applyHunkCap", () => {
  function makeHunk(addedCount: number): ParsedHunk {
    return {
      filePath: "test.ts",
      startLine: 1,
      lineCount: addedCount,
      functionContext: "",
      addedLines: Array.from({ length: addedCount }, (_, i) => `line ${i}`),
      language: "TypeScript",
    };
  }

  test("returns all when under cap", () => {
    const hunks = [makeHunk(5), makeHunk(3), makeHunk(4)];
    expect(applyHunkCap(hunks, 100)).toHaveLength(3);
  });

  test("caps to maxHunks, keeping largest by addedLines count", () => {
    const hunks = [makeHunk(3), makeHunk(10), makeHunk(5), makeHunk(8), makeHunk(1)];
    const result = applyHunkCap(hunks, 3);
    expect(result).toHaveLength(3);
    expect(result.map(h => h.addedLines.length)).toEqual([10, 8, 5]);
  });

  test("preserves order for equal-size hunks (stable sort)", () => {
    const h1 = { ...makeHunk(5), filePath: "a.ts" };
    const h2 = { ...makeHunk(5), filePath: "b.ts" };
    const h3 = { ...makeHunk(5), filePath: "c.ts" };
    const result = applyHunkCap([h1, h2, h3], 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.filePath).toBe("a.ts");
    expect(result[1]!.filePath).toBe("b.ts");
  });

  test("returns empty for cap of 0", () => {
    expect(applyHunkCap([makeHunk(5)], 0)).toEqual([]);
  });
});

describe("computeContentHash", () => {
  test("same text produces same hash", () => {
    const a = computeContentHash("hello world");
    const b = computeContentHash("hello world");
    expect(a).toBe(b);
  });

  test("different text produces different hash", () => {
    const a = computeContentHash("hello");
    const b = computeContentHash("world");
    expect(a).not.toBe(b);
  });

  test("returns 64-char hex string (SHA-256)", () => {
    const hash = computeContentHash("test");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
