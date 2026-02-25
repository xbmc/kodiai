import { describe, test, expect } from "bun:test";
import {
  computeDependsVerdict,
  buildDependsReviewComment,
  buildDependsInlineComments,
  type DependsReviewData,
  type InlineComment,
} from "./depends-review-builder.ts";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSafeData(overrides: Partial<DependsReviewData> = {}): DependsReviewData {
  return {
    info: {
      packages: [{ name: "zlib", newVersion: "1.3.2", oldVersion: "1.3.1" }],
      platform: null,
      isGroup: false,
      rawTitle: "[depends] Bump zlib to 1.3.2",
    },
    versionDiffs: [
      {
        packageName: "zlib",
        oldVersion: "1.3.1",
        newVersion: "1.3.2",
        versionFileDiff: null,
      },
    ],
    changelogs: [
      {
        packageName: "zlib",
        changelog: {
          source: "github-releases",
          highlights: ["**v1.3.2:** Bug fixes and performance improvements"],
          breakingChanges: [],
          url: "https://github.com/madler/zlib/releases",
          degradationNote: null,
        },
      },
    ],
    hashResults: [
      {
        packageName: "zlib",
        result: {
          status: "verified",
          detail: "SHA512 matches upstream tarball",
          expectedHash: "abc123",
          actualHash: "abc123",
        },
      },
    ],
    patchChanges: [],
    impact: {
      consumers: [
        { filePath: "xbmc/utils/Compress.cpp", line: 5, includeDirective: '#include <zlib.h>', isDirect: true },
        { filePath: "xbmc/utils/Archive.cpp", line: 12, includeDirective: '#include <zlib.h>', isDirect: true },
      ],
      transitive: { dependents: [], newDependencies: [], circular: [] },
      timeLimitReached: false,
      degradationNote: null,
    },
    transitive: { dependents: [], newDependencies: [], circular: [] },
    retrievalContext: null,
    platform: null,
    ...overrides,
  };
}

function makeRiskyData(): DependsReviewData {
  return makeSafeData({
    hashResults: [
      {
        packageName: "zlib",
        result: {
          status: "mismatch",
          detail: "SHA512 mismatch: expected abc... got def...",
          expectedHash: "abc123",
          actualHash: "def456",
        },
      },
    ],
  });
}

function makeNeedsAttentionData(): DependsReviewData {
  return makeSafeData({
    changelogs: [
      {
        packageName: "zlib",
        changelog: {
          source: "github-releases",
          highlights: ["**v1.3.2:** Major API changes"],
          breakingChanges: ["Removed deflateInit() in favor of deflateInit2()"],
          url: "https://github.com/madler/zlib/releases",
          degradationNote: null,
        },
      },
    ],
  });
}

// ─── computeDependsVerdict ──────────────────────────────────────────────────

describe("computeDependsVerdict", () => {
  test("returns safe when no issues", () => {
    const verdict = computeDependsVerdict(makeSafeData());
    expect(verdict.level).toBe("safe");
    expect(verdict.label).toBe("Safe to merge");
  });

  test("returns risky on hash mismatch", () => {
    const verdict = computeDependsVerdict(makeRiskyData());
    expect(verdict.level).toBe("risky");
    expect(verdict.summary).toContain("SHA512 hash mismatch");
  });

  test("returns risky on breaking changes with many consumers", () => {
    const data = makeSafeData({
      changelogs: [
        {
          packageName: "zlib",
          changelog: {
            source: "github-releases",
            highlights: [],
            breakingChanges: ["API removed"],
            url: null,
            degradationNote: null,
          },
        },
      ],
      impact: {
        consumers: Array.from({ length: 8 }, (_, i) => ({
          filePath: `file${i}.cpp`,
          line: 1,
          includeDirective: "#include <zlib.h>",
          isDirect: true,
        })),
        transitive: { dependents: [], newDependencies: [], circular: [] },
        timeLimitReached: false,
        degradationNote: null,
      },
    });
    const verdict = computeDependsVerdict(data);
    expect(verdict.level).toBe("risky");
    expect(verdict.summary).toContain("Breaking changes");
  });

  test("returns risky on patch removals", () => {
    const data = makeSafeData({
      patchChanges: [{ file: "tools/depends/target/zlib/01-fix.patch", action: "removed" }],
    });
    const verdict = computeDependsVerdict(data);
    expect(verdict.level).toBe("risky");
    expect(verdict.summary).toContain("Patches removed");
  });

  test("returns needs-attention on breaking changes alone", () => {
    const verdict = computeDependsVerdict(makeNeedsAttentionData());
    expect(verdict.level).toBe("needs-attention");
    expect(verdict.summary).toContain("Breaking changes");
  });

  test("returns needs-attention on new transitive deps", () => {
    const data = makeSafeData({
      transitive: { dependents: [], newDependencies: ["icu"], circular: [] },
    });
    const verdict = computeDependsVerdict(data);
    expect(verdict.level).toBe("needs-attention");
    expect(verdict.summary).toContain("icu");
  });

  test("returns needs-attention on many consumers", () => {
    const data = makeSafeData({
      impact: {
        consumers: Array.from({ length: 7 }, (_, i) => ({
          filePath: `file${i}.cpp`,
          line: 1,
          includeDirective: "#include <zlib.h>",
          isDirect: true,
        })),
        transitive: { dependents: [], newDependencies: [], circular: [] },
        timeLimitReached: false,
        degradationNote: null,
      },
    });
    const verdict = computeDependsVerdict(data);
    expect(verdict.level).toBe("needs-attention");
    expect(verdict.summary).toContain("7 files");
  });

  test("returns needs-attention on hash unavailable", () => {
    const data = makeSafeData({
      hashResults: [
        {
          packageName: "zlib",
          result: {
            status: "unavailable",
            detail: "Could not fetch upstream tarball",
          },
        },
      ],
    });
    const verdict = computeDependsVerdict(data);
    expect(verdict.level).toBe("needs-attention");
    expect(verdict.summary).toContain("unavailable");
  });
});

// ─── buildDependsReviewComment ──────────────────────────────────────────────

describe("buildDependsReviewComment", () => {
  test("includes TL;DR verdict section", () => {
    const comment = buildDependsReviewComment(makeSafeData());
    expect(comment).toContain("## ");
    expect(comment).toContain("Safe to merge");
  });

  test("includes version diff table", () => {
    const comment = buildDependsReviewComment(makeSafeData());
    expect(comment).toContain("### Version Diff");
    expect(comment).toContain("| zlib | 1.3.1 | 1.3.2 |");
  });

  test("includes changelog highlights", () => {
    const comment = buildDependsReviewComment(makeSafeData());
    expect(comment).toContain("### Changelog Highlights");
    expect(comment).toContain("Bug fixes and performance improvements");
  });

  test("includes impact assessment", () => {
    const comment = buildDependsReviewComment(makeSafeData());
    expect(comment).toContain("### Impact Assessment");
    expect(comment).toContain("2 consuming files");
    expect(comment).toContain("Compress.cpp");
  });

  test("includes hash verification", () => {
    const comment = buildDependsReviewComment(makeSafeData());
    expect(comment).toContain("### Hash Verification");
    expect(comment).toContain("zlib");
    expect(comment).toContain("SHA512 matches");
  });

  test("includes degradation note when changelog unavailable", () => {
    const data = makeSafeData({
      changelogs: [
        {
          packageName: "zlib",
          changelog: {
            source: "unavailable",
            highlights: [],
            breakingChanges: [],
            url: null,
            degradationNote: "Changelog unavailable -- check upstream manually",
          },
        },
      ],
    });
    const comment = buildDependsReviewComment(data);
    expect(comment).toContain("Changelog unavailable");
  });

  test("includes patch changes section", () => {
    const data = makeSafeData({
      patchChanges: [
        { file: "tools/depends/target/zlib/01-fix.patch", action: "removed" },
        { file: "tools/depends/target/zlib/02-new.patch", action: "added" },
      ],
    });
    const comment = buildDependsReviewComment(data);
    expect(comment).toContain("### Patch Changes");
    expect(comment).toContain("01-fix.patch");
    expect(comment).toContain("02-new.patch");
  });

  test("includes historical context when available", () => {
    const data = makeSafeData({
      retrievalContext: "Previous zlib bump in PR #1234 caused build issues on Windows.",
    });
    const comment = buildDependsReviewComment(data);
    expect(comment).toContain("### Historical Context");
    expect(comment).toContain("Previous zlib bump");
  });

  test("includes Windows platform note", () => {
    const data = makeSafeData({ platform: "windows" });
    const comment = buildDependsReviewComment(data);
    expect(comment).toContain("Windows dependencies use pre-built binaries");
  });

  test("does not include Windows note for non-Windows platforms", () => {
    const comment = buildDependsReviewComment(makeSafeData());
    expect(comment).not.toContain("Windows dependencies");
  });

  test("handles multi-package bumps with per-package sections", () => {
    const data = makeSafeData({
      info: {
        packages: [
          { name: "zlib", newVersion: "1.3.2", oldVersion: "1.3.1" },
          { name: "openssl", newVersion: "3.0.19", oldVersion: "3.0.18" },
        ],
        platform: null,
        isGroup: false,
        rawTitle: "[depends] Bump zlib to 1.3.2 / openssl to 3.0.19",
      },
      versionDiffs: [
        { packageName: "zlib", oldVersion: "1.3.1", newVersion: "1.3.2", versionFileDiff: null },
        { packageName: "openssl", oldVersion: "3.0.18", newVersion: "3.0.19", versionFileDiff: null },
      ],
      changelogs: [
        {
          packageName: "zlib",
          changelog: {
            source: "github-releases",
            highlights: ["**v1.3.2:** Fixes"],
            breakingChanges: [],
            url: null,
            degradationNote: null,
          },
        },
        {
          packageName: "openssl",
          changelog: {
            source: "github-releases",
            highlights: ["**v3.0.19:** Security patch"],
            breakingChanges: [],
            url: null,
            degradationNote: null,
          },
        },
      ],
      hashResults: [
        { packageName: "zlib", result: { status: "verified", detail: "SHA512 matches" } },
        { packageName: "openssl", result: { status: "verified", detail: "SHA512 matches" } },
      ],
    });
    const comment = buildDependsReviewComment(data);
    expect(comment).toContain("**zlib:**");
    expect(comment).toContain("**openssl:**");
    expect(comment).toContain("| zlib |");
    expect(comment).toContain("| openssl |");
  });

  test("includes transitive dependency info in impact section", () => {
    const data = makeSafeData({
      transitive: {
        dependents: ["FindHarfBuzz"],
        newDependencies: ["icu"],
        circular: [],
      },
    });
    const comment = buildDependsReviewComment(data);
    expect(comment).toContain("FindHarfBuzz");
    expect(comment).toContain("New transitive dependencies");
    expect(comment).toContain("icu");
  });
});

// ─── buildDependsInlineComments ─────────────────────────────────────────────

describe("buildDependsInlineComments", () => {
  test("generates inline comment for hash mismatch on VERSION file", () => {
    const data = makeRiskyData();
    const prFiles = [
      {
        filename: "tools/depends/target/zlib/VERSION",
        patch: "@@ -1,4 +1,4 @@\n LIBNAME=zlib\n-VERSION=1.3.1\n+VERSION=1.3.2\n-SHA512=oldold\n+SHA512=newsha",
      },
    ];
    const comments = buildDependsInlineComments(data, prFiles);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0]!.path).toBe("tools/depends/target/zlib/VERSION");
    expect(comments[0]!.body).toContain("Hash mismatch");
  });

  test("generates inline comment for removed patches", () => {
    const data = makeSafeData({
      patchChanges: [{ file: "tools/depends/target/zlib/01-fix.patch", action: "removed" }],
    });
    const prFiles = [
      { filename: "tools/depends/target/zlib/01-fix.patch" },
    ];
    const comments = buildDependsInlineComments(data, prFiles);
    expect(comments.length).toBe(1);
    expect(comments[0]!.body).toContain("Patch removed");
  });

  test("generates inline comment for new transitive dep in cmake files", () => {
    const data = makeSafeData({
      transitive: { dependents: [], newDependencies: ["icu"], circular: [] },
    });
    const prFiles = [
      {
        filename: "cmake/modules/FindHarfBuzz.cmake",
        patch: "@@ -1,3 +1,4 @@\n find_package(HarfBuzz)\n+  find_dependency(icu)\n",
      },
    ];
    const comments = buildDependsInlineComments(data, prFiles);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0]!.body).toContain("New transitive dependency");
    expect(comments[0]!.body).toContain("icu");
  });

  test("returns empty array when no issues found", () => {
    const comments = buildDependsInlineComments(makeSafeData(), []);
    expect(comments).toEqual([]);
  });
});
