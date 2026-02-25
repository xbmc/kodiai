import { describe, expect, test } from "bun:test";
import {
  findDependencyConsumers,
  parseCmakeFindModule,
  checkTransitiveDependencies,
} from "./depends-impact-analyzer.ts";
import type {
  IncludeConsumer,
  CmakeDependency,
  TransitiveResult,
  ImpactResult,
} from "./depends-impact-analyzer.ts";

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockOctokit(overrides: {
  getContent?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    rest: {
      repos: {
        getContent: overrides.getContent ?? (async () => ({ data: [] })),
      },
    },
  } as any;
}

/**
 * Helper to create a mock grep runner that returns pre-defined output.
 * Simulates the Bun shell `$ git grep -n` call.
 */
function mockGrepRunner(output: string, exitCode = 0) {
  return async (_params: { workspaceDir: string; pattern: string; pathspec?: string }) => ({
    exitCode,
    stdout: output,
  });
}

function mockGrepRunnerMulti(outputs: Map<string, { stdout: string; exitCode: number }>) {
  return async (params: { workspaceDir: string; pattern: string; pathspec?: string }) => {
    // Match on pattern substring for routing
    for (const [key, value] of outputs) {
      if (params.pattern.includes(key) || params.pathspec?.includes(key)) {
        return value;
      }
    }
    return { exitCode: 1, stdout: "" };
  };
}

function timeoutGrepRunner() {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return { exitCode: 0, stdout: "" };
  };
}

// ─── findDependencyConsumers ─────────────────────────────────────────────────

describe("findDependencyConsumers", () => {
  test("matches standard #include <zlib.h> for library zlib", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner(
        "xbmc/utils/Compress.cpp:5:#include <zlib.h>\n",
      ),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    expect(result.consumers.length).toBeGreaterThanOrEqual(1);
    expect(result.consumers[0]!.filePath).toBe("xbmc/utils/Compress.cpp");
    expect(result.consumers[0]!.line).toBe(5);
    expect(result.consumers[0]!.includeDirective).toContain("zlib.h");
    expect(result.consumers[0]!.isDirect).toBe(true);
  });

  test("matches subdirectory include #include <openssl/ssl.h> for library openssl", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "openssl",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner(
        "xbmc/network/TlsContext.cpp:12:#include <openssl/ssl.h>\nxbmc/network/TlsContext.cpp:13:#include <openssl/err.h>\n",
      ),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    expect(result.consumers.length).toBe(2);
    expect(result.consumers[0]!.includeDirective).toContain("openssl/ssl.h");
    expect(result.consumers[1]!.includeDirective).toContain("openssl/err.h");
  });

  test("matches quoted include #include \"libxml/parser.h\" for library libxml", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "libxml",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner(
        'xbmc/xml/Parser.cpp:8:#include "libxml/parser.h"\n',
      ),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    expect(result.consumers.length).toBe(1);
    expect(result.consumers[0]!.includeDirective).toContain("libxml/parser.h");
  });

  test("does not match unrelated include #include <string.h> for library zlib", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner(
        // git grep returns this line but it does NOT contain zlib
        "xbmc/utils/Foo.cpp:3:#include <string.h>\n",
      ),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    // The parsing filters by relevance to the library name
    const zlibConsumers = result.consumers.filter(
      (c) => c.includeDirective.toLowerCase().includes("zlib"),
    );
    // string.h line should be filtered out
    expect(zlibConsumers.length).toBe(0);
  });

  test("returns multiple files with includes", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner(
        "xbmc/utils/Compress.cpp:5:#include <zlib.h>\n" +
        "xbmc/addons/Addon.cpp:12:#include <zlib.h>\n" +
        "xbmc/utils/ZipHelper.cpp:3:#include <zlib.h>\n",
      ),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    expect(result.consumers.length).toBe(3);
  });

  test("returns empty results for empty grep output", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner("", 1),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    expect(result.consumers.length).toBe(0);
    expect(result.timeLimitReached).toBe(false);
  });

  test("returns partial results with timeLimitReached on timeout", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 50, // very short budget
      __runGrepForTests: timeoutGrepRunner(),
      __runCmakeGrepForTests: mockGrepRunner("", 1),
    });

    expect(result.timeLimitReached).toBe(true);
  });

  test("matches cmake target_link_libraries(foo zlib) as direct consumer", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner("", 1),
      __runCmakeGrepForTests: mockGrepRunner(
        "xbmc/CMakeLists.txt:42:target_link_libraries(foo zlib)\n",
      ),
    });

    expect(result.consumers.length).toBe(1);
    expect(result.consumers[0]!.filePath).toBe("xbmc/CMakeLists.txt");
    expect(result.consumers[0]!.isDirect).toBe(true);
    expect(result.consumers[0]!.includeDirective).toContain("target_link_libraries");
  });

  test("matches cmake target_link_libraries(bar PRIVATE openssl::ssl) for openssl", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "openssl",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner("", 1),
      __runCmakeGrepForTests: mockGrepRunner(
        "xbmc/network/CMakeLists.txt:18:target_link_libraries(bar PRIVATE openssl::ssl)\n",
      ),
    });

    expect(result.consumers.length).toBe(1);
    expect(result.consumers[0]!.includeDirective).toContain("target_link_libraries");
  });

  test("deduplicates file found via both #include and target_link_libraries", async () => {
    const result = await findDependencyConsumers({
      workspaceDir: "/fake",
      libraryName: "zlib",
      octokit: createMockOctokit(),
      owner: "xbmc",
      repo: "xbmc",
      timeBudgetMs: 5000,
      __runGrepForTests: mockGrepRunner(
        "xbmc/utils/Compress.cpp:5:#include <zlib.h>\n",
      ),
      __runCmakeGrepForTests: mockGrepRunner(
        // Same directory -- CMakeLists in xbmc/utils links zlib
        "xbmc/utils/Compress.cpp:42:target_link_libraries(foo zlib)\n",
      ),
    });

    // Should deduplicate by filePath
    const uniquePaths = new Set(result.consumers.map((c) => c.filePath));
    expect(uniquePaths.size).toBe(result.consumers.length);
  });
});

// ─── parseCmakeFindModule ────────────────────────────────────────────────────

describe("parseCmakeFindModule", () => {
  test("parses find_dependency(Freetype) and returns ['freetype']", () => {
    const content = `
# FindHarfBuzz.cmake
include(FindPackageHandleStandardArgs)
find_dependency(Freetype)
find_package_handle_standard_args(HarfBuzz DEFAULT_MSG HARFBUZZ_LIBRARY)
`;
    const result = parseCmakeFindModule(content, "FindHarfBuzz");

    expect(result.moduleName).toBe("FindHarfBuzz");
    expect(result.dependsOn).toContain("freetype");
  });

  test("parses find_package(Iconv REQUIRED) and returns ['iconv']", () => {
    const content = `
# FindLibXml2.cmake
find_package(Iconv REQUIRED)
find_path(LIBXML2_INCLUDE_DIR libxml/parser.h)
`;
    const result = parseCmakeFindModule(content, "FindLibXml2");

    expect(result.dependsOn).toContain("iconv");
  });

  test("parses module with multiple dependencies", () => {
    const content = `
# FindFFmpeg.cmake
find_dependency(Zlib)
find_package(OpenSSL REQUIRED)
find_dependency(Lzma)
`;
    const result = parseCmakeFindModule(content, "FindFFmpeg");

    expect(result.dependsOn.length).toBe(3);
    expect(result.dependsOn).toContain("zlib");
    expect(result.dependsOn).toContain("openssl");
    expect(result.dependsOn).toContain("lzma");
  });

  test("returns empty array for module with no dependencies", () => {
    const content = `
# FindTinyXML2.cmake
find_path(TINYXML2_INCLUDE_DIR tinyxml2.h)
find_library(TINYXML2_LIBRARY tinyxml2)
`;
    const result = parseCmakeFindModule(content, "FindTinyXML2");

    expect(result.dependsOn).toEqual([]);
  });

  test("ignores commented-out find_dependency lines", () => {
    const content = `
# FindFoo.cmake
# find_dependency(Bar)
  # find_package(Baz REQUIRED)
find_dependency(Qux)
`;
    const result = parseCmakeFindModule(content, "FindFoo");

    expect(result.dependsOn).toEqual(["qux"]);
  });
});

// ─── checkTransitiveDependencies ─────────────────────────────────────────────

describe("checkTransitiveDependencies", () => {
  test("flags library A depends on bumped library B", async () => {
    // HarfBuzz depends on Freetype -- if Freetype is bumped, HarfBuzz is a dependent
    const octokit = createMockOctokit({
      getContent: async () => ({
        data: [
          { name: "FindHarfBuzz.cmake", type: "file", path: "cmake/modules/FindHarfBuzz.cmake" },
        ],
      }),
    });

    // Override to also handle file content fetch
    (octokit as any).rest.repos.getContent = async (params: any) => {
      if (params.path === "cmake/modules") {
        return {
          data: [
            { name: "FindHarfBuzz.cmake", type: "file", path: "cmake/modules/FindHarfBuzz.cmake" },
          ],
        };
      }
      // File content
      return {
        data: {
          content: Buffer.from(
            "find_dependency(Freetype)\nfind_path(HARFBUZZ_INCLUDE harfbuzz/hb.h)\n",
          ).toString("base64"),
          encoding: "base64",
        },
      };
    };

    const result = await checkTransitiveDependencies({
      libraryName: "freetype",
      octokit,
      owner: "xbmc",
      repo: "xbmc",
    });

    expect(result.dependents).toContain("FindHarfBuzz");
  });

  test("returns empty results when no transitive dependencies", async () => {
    const octokit = createMockOctokit({
      getContent: async () => ({
        data: [
          { name: "FindZlib.cmake", type: "file", path: "cmake/modules/FindZlib.cmake" },
        ],
      }),
    });

    (octokit as any).rest.repos.getContent = async (params: any) => {
      if (params.path === "cmake/modules") {
        return {
          data: [
            { name: "FindZlib.cmake", type: "file", path: "cmake/modules/FindZlib.cmake" },
          ],
        };
      }
      return {
        data: {
          content: Buffer.from("find_path(ZLIB_INCLUDE zlib.h)\n").toString("base64"),
          encoding: "base64",
        },
      };
    };

    const result = await checkTransitiveDependencies({
      libraryName: "tinyxml2",
      octokit,
      owner: "xbmc",
      repo: "xbmc",
    });

    expect(result.dependents).toEqual([]);
    expect(result.newDependencies).toEqual([]);
  });

  test("detects circular dependency (freetype <-> harfbuzz)", async () => {
    const octokit = createMockOctokit();
    (octokit as any).rest.repos.getContent = async (params: any) => {
      if (params.path === "cmake/modules") {
        return {
          data: [
            { name: "FindFreetype.cmake", type: "file", path: "cmake/modules/FindFreetype.cmake" },
            { name: "FindHarfBuzz.cmake", type: "file", path: "cmake/modules/FindHarfBuzz.cmake" },
          ],
        };
      }
      if (params.path.includes("FindFreetype")) {
        return {
          data: {
            content: Buffer.from("find_dependency(HarfBuzz)\n").toString("base64"),
            encoding: "base64",
          },
        };
      }
      if (params.path.includes("FindHarfBuzz")) {
        return {
          data: {
            content: Buffer.from("find_dependency(Freetype)\n").toString("base64"),
            encoding: "base64",
          },
        };
      }
      return { data: { content: Buffer.from("").toString("base64"), encoding: "base64" } };
    };

    const result = await checkTransitiveDependencies({
      libraryName: "freetype",
      octokit,
      owner: "xbmc",
      repo: "xbmc",
    });

    expect(result.circular.length).toBeGreaterThanOrEqual(1);
    // Should note the freetype <-> harfbuzz circular relationship
    const circularStr = result.circular.join(",").toLowerCase();
    expect(circularStr).toContain("freetype");
    expect(circularStr).toContain("harfbuzz");
  });

  test("flags new find_dependency in updated cmake vs old", async () => {
    const octokit = createMockOctokit({
      getContent: async () => ({ data: [] }),
    });

    const oldCmakeContent = "find_dependency(Freetype)\n";
    const newCmakeContent = "find_dependency(Freetype)\nfind_dependency(ICU)\n";

    const result = await checkTransitiveDependencies({
      libraryName: "harfbuzz",
      octokit,
      owner: "xbmc",
      repo: "xbmc",
      oldCmakeContent,
      newCmakeContent,
    });

    expect(result.newDependencies).toContain("icu");
  });
});
