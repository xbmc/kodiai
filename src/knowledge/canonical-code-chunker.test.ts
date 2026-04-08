import { describe, expect, test } from "bun:test";
import {
  chunkCanonicalCodeFile,
  getCanonicalChunkExclusionReason,
  isCanonicalCodePathExcluded,
} from "./canonical-code-chunker.ts";

describe("canonical-code-chunker exclusions", () => {
  test("excludes generated, vendored, lockfile, and build output paths with explicit reasons", () => {
    expect(getCanonicalChunkExclusionReason("src/generated/types.ts")).toBe("generated");
    expect(getCanonicalChunkExclusionReason("third_party/sqlite/sqlite3.c")).toBe("vendored");
    expect(getCanonicalChunkExclusionReason("yarn.lock")).toBe("lockfile");
    expect(getCanonicalChunkExclusionReason("dist/bundle.js")).toBe("build_output");
    expect(isCanonicalCodePathExcluded("src/main.py")).toBe(false);
  });

  test("returns excluded observability when a path is filtered", () => {
    const result = chunkCanonicalCodeFile({
      filePath: "vendor/lib/foo.py",
      fileContent: "def should_not_embed():\n    return True\n",
    });

    expect(result.chunks).toEqual([]);
    expect(result.observability.excluded).toBe(true);
    expect(result.observability.exclusionReason).toBe("vendored");
    expect(result.observability.boundaryDecisions).toEqual([]);
  });
});

describe("canonical-code-chunker boundaries", () => {
  test("chunks python files into module, class, and function boundaries", () => {
    const content = [
      '"""module doc"""',
      "",
      "class Player:",
      "    def play(self):",
      "        return 'ok'",
      "",
      "def helper():",
      "    return 1",
      "",
      "SETTING = True",
    ].join("\n");

    const result = chunkCanonicalCodeFile({ filePath: "lib/player.py", fileContent: content });

    expect(result.chunks.map((chunk) => chunk.chunkType)).toEqual(["module", "class", "function"]);
    expect(result.chunks.map((chunk) => chunk.symbolName)).toEqual([null, "Player", "helper"]);
    expect(result.observability.boundaryDecisions).toEqual(["module", "class", "function"]);
    expect(result.chunks[0]!.chunkText).toContain('"""module doc"""');
    expect(result.chunks[1]!.chunkText).toContain("class Player:");
    expect(result.chunks[2]!.chunkText).toContain("def helper():");
  });

  test("chunks C++ files into module and function boundaries", () => {
    const content = [
      "#include <string>",
      "",
      "namespace demo {",
      "int helper(int value) {",
      "  return value + 1;",
      "}",
      "",
      "class Engine {",
      " public:",
      "  void Run() {",
      "    helper(1);",
      "  }",
      "};",
      "}",
    ].join("\n");

    const result = chunkCanonicalCodeFile({ filePath: "xbmc/Engine.cpp", fileContent: content });

    expect(result.chunks.map((chunk) => chunk.chunkType)).toEqual(["module", "function", "class"]);
    expect(result.chunks.map((chunk) => chunk.symbolName)).toEqual([null, "helper", "Engine"]);
    expect(result.observability.boundaryDecisions).toEqual(["module", "function", "class"]);
    expect(result.chunks[1]!.chunkText).toContain("int helper(int value) {");
    expect(result.chunks[2]!.chunkText).toContain("class Engine {");
  });

  test("falls back to block chunk for symbol-poor C++ files", () => {
    const content = [
      "#ifdef TARGET_LINUX",
      "#define ENABLE_FEATURE 1",
      "#endif",
      "",
      "MACRO_ONLY_CALL();",
    ].join("\n");

    const result = chunkCanonicalCodeFile({ filePath: "xbmc/platform/linux/symbols.cpp", fileContent: content });

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.chunkType).toBe("block");
    expect(result.chunks[0]!.symbolName).toBeNull();
    expect(result.observability.boundaryDecisions).toEqual(["block"]);
  });

  test("keeps TypeScript chunking separate from diff-hunk semantics", () => {
    const content = [
      "export const config = { enabled: true };",
      "",
      "export function boot() {",
      "  return config.enabled;",
      "}",
    ].join("\n");

    const result = chunkCanonicalCodeFile({ filePath: "src/bootstrap.ts", fileContent: content });

    expect(result.chunks.map((chunk) => chunk.chunkType)).toEqual(["module", "function"]);
    expect(result.chunks.every((chunk) => !("addedLines" in (chunk as unknown as Record<string, unknown>)))).toBe(true);
    expect(result.chunks[1]!.startLine).toBe(3);
    expect(result.chunks[1]!.endLine).toBe(5);
  });

  test("returns stable content hashes per chunk", () => {
    const content = "def helper():\n    return 1\n";
    const first = chunkCanonicalCodeFile({ filePath: "lib/hash.py", fileContent: content });
    const second = chunkCanonicalCodeFile({ filePath: "lib/hash.py", fileContent: content });

    expect(first.chunks[0]!.contentHash).toBe(second.chunks[0]!.contentHash);
    expect(first.chunks[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
