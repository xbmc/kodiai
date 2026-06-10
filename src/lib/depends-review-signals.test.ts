import { describe, expect, mock, test } from "bun:test";
import type { DependsBumpInfo } from "./depends-bump-detector.ts";
import {
  buildDependsReviewData,
  buildDependsVersionDiffs,
  collectDependsReviewSignals,
  createDependsReviewSignalCollector,
  type DependsReviewSignalDependencies,
  hasNonDependsSourceChanges,
} from "./depends-review-signals.ts";

const logger = {
  info: mock(() => undefined),
  warn: mock(() => undefined),
} as never;

function makeInfo(overrides: Partial<DependsBumpInfo> = {}): DependsBumpInfo {
  return {
    packages: [{ name: "zlib", oldVersion: null, newVersion: null }],
    platform: null,
    isGroup: false,
    rawTitle: "[depends] Bump zlib",
    ...overrides,
  };
}

describe("hasNonDependsSourceChanges", () => {
  test("treats pure depends metadata, VERSION, and patch files as no source changes", () => {
    expect(hasNonDependsSourceChanges([
      { filename: "tools/depends/target/zlib/ZLIB-VERSION" },
      { filename: "tools/depends/target/zlib/0_package.target-x64-v143.list" },
      { filename: "tools/depends/target/zlib/01-fix-build.patch" },
      { filename: "cmake/modules/FindZLIB.cmake" },
      { filename: "project/BuildDependencies/scripts/zlib.cmake" },
    ])).toBe(false);
  });

  test("detects mixed source files so standard review can still run", () => {
    expect(hasNonDependsSourceChanges([
      { filename: "tools/depends/target/zlib/ZLIB-VERSION" },
      { filename: "xbmc/filesystem/ZlibFile.cpp" },
    ])).toBe(true);
  });
});

describe("buildDependsVersionDiffs", () => {
  test("uses 0_package.target list fallback when no VERSION file is present", () => {
    const versionDiffs = buildDependsVersionDiffs(
      makeInfo(),
      [
        {
          filename: "tools/depends/target/zlib/0_package.target-x64-v143.list",
          patch: [
            "-zlib-1.3.1-x64-v143-20250101.tar.gz",
            "+zlib-1.3.2-x64-v143-20250102.tar.gz",
          ].join("\n"),
        },
      ],
      logger,
      { deliveryId: "test" },
    );

    expect(versionDiffs).toEqual([
      {
        packageName: "zlib",
        oldVersion: "1.3.1",
        newVersion: "1.3.2",
        versionFileDiff: null,
      },
    ]);
  });
});

describe("buildDependsReviewData", () => {
  test("assembles final review data from collected signals and retrieval summary", () => {
    const info = makeInfo();
    const reviewData = buildDependsReviewData(
      {
        info,
        versionDiffs: [{ packageName: "zlib", oldVersion: "1.3.1", newVersion: "1.3.2", versionFileDiff: null }],
        changelogs: [],
        hashResults: [],
        patchChanges: [],
        impact: null,
        transitive: null,
        platform: null,
      },
      {
        retrievalContext: [],
        contextSummary: "Past zlib reviews mention ABI care.",
      },
    );

    expect(reviewData.info).toBe(info);
    expect(reviewData.retrievalContext).toEqual([]);
    expect(reviewData.contextSummary).toBe("Past zlib reviews mention ABI care.");
  });
});

describe("collectDependsReviewSignals", () => {
  test("uses caller-provided PR files instead of fetching them internally", async () => {
    const prFiles = [
      {
        filename: "tools/depends/target/localonly/0_package.target-x64-v143.list",
        patch: [
          "-localonly-1.0.0-x64-v143-20250101.tar.gz",
          "+localonly-1.1.0-x64-v143-20250102.tar.gz",
        ].join("\n"),
      },
    ];

    const result = await collectDependsReviewSignals({
      info: makeInfo({
        packages: [{ name: "localonly", oldVersion: null, newVersion: null }],
      }),
      prFiles,
      octokit: {} as never,
      owner: "xbmc",
      repo: "xbmc",
      workspaceDir: null,
      logger,
      baseLog: { deliveryId: "test" },
    });

    expect(result.prFiles).toBe(prFiles);
    expect(result.signals.versionDiffs[0]?.oldVersion).toBe("1.0.0");
    expect(result.signals.versionDiffs[0]?.newVersion).toBe("1.1.0");
  });

  test("collects independent signal families concurrently after version diffs are known", async () => {
    const events: string[] = [];
    let releaseChangelog: () => void = () => {};
    const changelogGate = new Promise<void>((resolve) => {
      releaseChangelog = resolve;
    });

    const dependencies: DependsReviewSignalDependencies = {
      fetchDependsChangelog: async () => {
        events.push("changelog:start");
        await changelogGate;
        events.push("changelog:end");
        return { source: "unavailable", highlights: [], breakingChanges: [], url: null, degradationNote: null };
      },
      verifyHash: async () => {
        events.push("hash:start");
        releaseChangelog();
        return { status: "verified", detail: "ok" };
      },
      detectPatchChanges: () => {
        events.push("patch");
        return [];
      },
      findDependencyConsumers: async () => {
        events.push("impact");
        return { consumers: [], searchedPatterns: [] };
      },
      checkTransitiveDependencies: async () => {
        events.push("transitive");
        return { newDependencies: [], removedDependencies: [] };
      },
    };

    const collectWithDependencies = createDependsReviewSignalCollector(dependencies);

    await collectWithDependencies({
      info: makeInfo(),
      prFiles: [
        {
          filename: "tools/depends/target/zlib/ZLIB-VERSION",
          patch: [
            "-VERSION=1.3.1",
            "+VERSION=1.3.2",
            "+SHA512=abc123",
            "+ARCHIVE=zlib-1.3.2.tar.gz",
            "+BASE_URL=https://example.test",
          ].join("\n"),
        },
      ],
      octokit: {} as never,
      owner: "xbmc",
      repo: "xbmc",
      workspaceDir: "/tmp/workspace",
      logger,
      baseLog: { deliveryId: "test" },
      dependencies,
    });

    expect(events.indexOf("hash:start")).toBeGreaterThan(-1);
    expect(events.indexOf("hash:start")).toBeLessThan(events.indexOf("changelog:end"));
    expect(events).toContain("impact");
    expect(events).toContain("transitive");
  });
});
