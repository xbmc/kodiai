import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  parseVersionFileDiff,
  parseVersionFileContent,
  resolveUpstreamRepo,
  fetchDependsChangelog,
  verifyHash,
  detectPatchChanges,
  KODI_LIB_REPO_MAP,
} from "./depends-bump-enrichment.ts";
import type {
  VersionFileDiff,
  VersionFileData,
  HashVerificationResult,
  DependsChangelogContext,
  PatchChange,
} from "./depends-bump-enrichment.ts";

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockOctokit(overrides: {
  listReleases?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    rest: {
      repos: {
        listReleases: overrides.listReleases ?? (async () => ({ data: [] })),
      },
    },
  } as any;
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  fetchMock = mock(() => Promise.resolve(new Response("Not Found", { status: 404 })));
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── parseVersionFileDiff ───────────────────────────────────────────────────

describe("parseVersionFileDiff", () => {
  test("extracts old/new VERSION and SHA512 from standard version bump diff", () => {
    const patch = `--- a/tools/depends/target/zlib/ZLIB-VERSION
+++ b/tools/depends/target/zlib/ZLIB-VERSION
@@ -1,4 +1,4 @@
 LIBNAME=zlib
-VERSION=1.3.1
+VERSION=1.3.2
-SHA512=1e8e70b362d64a233591906a1f6947a0a612d1feb
+SHA512=cf3d49fbabddc57ccaf5fc4e6e53846acbf1e5db`;

    const result = parseVersionFileDiff(patch);
    expect(result.oldVersion).toBe("1.3.1");
    expect(result.newVersion).toBe("1.3.2");
    expect(result.oldSha512).toBe("1e8e70b362d64a233591906a1f6947a0a612d1feb");
    expect(result.newSha512).toBe("cf3d49fbabddc57ccaf5fc4e6e53846acbf1e5db");
  });

  test("extracts ARCHIVE and BASE_URL changes", () => {
    const patch = `--- a/tools/depends/target/openssl/OPENSSL-VERSION
+++ b/tools/depends/target/openssl/OPENSSL-VERSION
@@ -1,6 +1,6 @@
 LIBNAME=openssl
-VERSION=3.0.18
+VERSION=3.0.19
-ARCHIVE=$(LIBNAME)-$(VERSION).tar.gz
+ARCHIVE=$(LIBNAME)-$(VERSION).tar.xz
-BASE_URL=https://www.openssl.org/source
+BASE_URL=https://github.com/openssl/openssl/releases/download/openssl-$(VERSION)
-SHA512=abc123
+SHA512=def456`;

    const result = parseVersionFileDiff(patch);
    expect(result.oldVersion).toBe("3.0.18");
    expect(result.newVersion).toBe("3.0.19");
    expect(result.oldArchive).toBe("$(LIBNAME)-$(VERSION).tar.gz");
    expect(result.newArchive).toBe("$(LIBNAME)-$(VERSION).tar.xz");
    expect(result.oldBaseUrl).toBe("https://www.openssl.org/source");
    expect(result.newBaseUrl).toBe("https://github.com/openssl/openssl/releases/download/openssl-$(VERSION)");
  });

  test("handles diff with only VERSION change (no hash change)", () => {
    const patch = `--- a/tools/depends/target/foo/FOO-VERSION
+++ b/tools/depends/target/foo/FOO-VERSION
@@ -1,3 +1,3 @@
 LIBNAME=foo
-VERSION=2.0.0
+VERSION=2.1.0
 SHA512=samehash123`;

    const result = parseVersionFileDiff(patch);
    expect(result.oldVersion).toBe("2.0.0");
    expect(result.newVersion).toBe("2.1.0");
    expect(result.oldSha512).toBeNull();
    expect(result.newSha512).toBeNull();
  });

  test("handles diff with only hash change (typo fix)", () => {
    const patch = `--- a/tools/depends/target/bar/BAR-VERSION
+++ b/tools/depends/target/bar/BAR-VERSION
@@ -2,2 +2,2 @@
 VERSION=1.0.0
-SHA512=wronghash111
+SHA512=correcthash222`;

    const result = parseVersionFileDiff(patch);
    expect(result.oldVersion).toBeNull();
    expect(result.newVersion).toBeNull();
    expect(result.oldSha512).toBe("wronghash111");
    expect(result.newSha512).toBe("correcthash222");
  });

  test("returns all nulls for empty/irrelevant diff", () => {
    const patch = `--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old text
+new text`;

    const result = parseVersionFileDiff(patch);
    expect(result.oldVersion).toBeNull();
    expect(result.newVersion).toBeNull();
    expect(result.oldSha512).toBeNull();
    expect(result.newSha512).toBeNull();
    expect(result.oldArchive).toBeNull();
    expect(result.newArchive).toBeNull();
    expect(result.oldBaseUrl).toBeNull();
    expect(result.newBaseUrl).toBeNull();
  });

  test("handles Makefile-style variable expansion in ARCHIVE line", () => {
    const patch = `--- a/tools/depends/target/lib/LIB-VERSION
+++ b/tools/depends/target/lib/LIB-VERSION
@@ -1,3 +1,3 @@
 LIBNAME=mylib
-ARCHIVE=$(LIBNAME)-$(VERSION).tar.xz
+ARCHIVE=$(LIBNAME)-$(VERSION).tar.gz`;

    const result = parseVersionFileDiff(patch);
    expect(result.oldArchive).toBe("$(LIBNAME)-$(VERSION).tar.xz");
    expect(result.newArchive).toBe("$(LIBNAME)-$(VERSION).tar.gz");
  });
});

// ─── parseVersionFileContent ────────────────────────────────────────────────

describe("parseVersionFileContent", () => {
  test("parses full VERSION file with all fields", () => {
    const content = `LIBNAME=zlib
VERSION=1.3.2
ARCHIVE=$(LIBNAME)-$(VERSION).tar.xz
SHA512=cf3d49fbabddc57ccaf5fc4e6e
BASE_URL=https://github.com/madler/zlib/releases/download/v$(VERSION)`;

    const result = parseVersionFileContent(content);
    expect(result.libName).toBe("zlib");
    expect(result.version).toBe("1.3.2");
    expect(result.archive).toBe("zlib-1.3.2.tar.xz");
    expect(result.sha512).toBe("cf3d49fbabddc57ccaf5fc4e6e");
    expect(result.baseUrl).toBe("https://github.com/madler/zlib/releases/download/v1.3.2");
  });

  test("resolves $(LIBNAME) and $(VERSION) variable references", () => {
    const content = `LIBNAME=openssl
VERSION=3.0.19
ARCHIVE=$(LIBNAME)-$(VERSION).tar.gz
BASE_URL=https://www.openssl.org/source`;

    const result = parseVersionFileContent(content);
    expect(result.archive).toBe("openssl-3.0.19.tar.gz");
    expect(result.baseUrl).toBe("https://www.openssl.org/source");
  });

  test("handles file with comments and empty lines", () => {
    const content = `# Zlib dependency configuration
LIBNAME=zlib

VERSION=1.3.2
# Archive settings
ARCHIVE=$(LIBNAME)-$(VERSION).tar.xz
SHA512=abc123`;

    const result = parseVersionFileContent(content);
    expect(result.libName).toBe("zlib");
    expect(result.version).toBe("1.3.2");
    expect(result.archive).toBe("zlib-1.3.2.tar.xz");
    expect(result.sha512).toBe("abc123");
  });
});

// ─── resolveUpstreamRepo ────────────────────────────────────────────────────

describe("resolveUpstreamRepo", () => {
  test("returns coords for known library: zlib", () => {
    const result = resolveUpstreamRepo("zlib");
    expect(result).toEqual({ owner: "madler", repo: "zlib" });
  });

  test("returns coords for known library: openssl", () => {
    const result = resolveUpstreamRepo("openssl");
    expect(result).toEqual({ owner: "openssl", repo: "openssl" });
  });

  test("returns null for unknown library", () => {
    const result = resolveUpstreamRepo("obscure-lib");
    expect(result).toBeNull();
  });

  test("case-insensitive lookup: FFmpeg and ffmpeg both resolve", () => {
    const upper = resolveUpstreamRepo("FFmpeg");
    const lower = resolveUpstreamRepo("ffmpeg");
    expect(upper).toEqual({ owner: "FFmpeg", repo: "FFmpeg" });
    expect(lower).toEqual({ owner: "FFmpeg", repo: "FFmpeg" });
  });
});

// ─── fetchDependsChangelog ──────────────────────────────────────────────────

describe("fetchDependsChangelog", () => {
  test("returns changelog from GitHub releases when available", async () => {
    const octokit = createMockOctokit({
      listReleases: async () => ({
        data: [
          {
            draft: false,
            tag_name: "v1.3.2",
            body: "## Changes\n- Fixed buffer overflow\n- Security patch for CVE-2024-1234\n- BREAKING CHANGE: removed deflateInit macro",
          },
        ],
      }),
    });

    const result = await fetchDependsChangelog({
      libraryName: "zlib",
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      octokit,
      timeoutMs: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("github-releases");
    expect(result!.highlights.length).toBeGreaterThan(0);
    expect(result!.url).toContain("github.com");
  });

  test("returns degradation note when no releases found", async () => {
    const octokit = createMockOctokit({
      listReleases: async () => ({ data: [] }),
    });

    const result = await fetchDependsChangelog({
      libraryName: "zlib",
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      octokit,
      timeoutMs: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.degradationNote).toBeTruthy();
  });

  test("returns degradation note on API timeout (fail-open)", async () => {
    const octokit = createMockOctokit({
      listReleases: async () => { throw new Error("Request timeout"); },
    });

    const result = await fetchDependsChangelog({
      libraryName: "zlib",
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      octokit,
      timeoutMs: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.degradationNote).toBeTruthy();
  });

  test("returns diff-analysis source with synthesized highlights when no releases but versionFileDiff provided", async () => {
    const octokit = createMockOctokit({
      listReleases: async () => ({ data: [] }),
    });

    const versionFileDiff: VersionFileDiff = {
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      oldSha512: "abc123",
      newSha512: "def456",
      oldArchive: null,
      newArchive: null,
      oldBaseUrl: "https://old.example.com",
      newBaseUrl: "https://new.example.com",
    };

    const result = await fetchDependsChangelog({
      libraryName: "zlib",
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      octokit,
      timeoutMs: 5000,
      versionFileDiff,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("diff-analysis");
    expect(result!.highlights.length).toBeGreaterThan(0);
    // Should contain version change info
    expect(result!.highlights.some(h => h.includes("1.3.1") && h.includes("1.3.2"))).toBe(true);
    // Should contain hash change info
    expect(result!.highlights.some(h => h.toLowerCase().includes("hash"))).toBe(true);
    // Should contain URL change info
    expect(result!.highlights.some(h => h.toLowerCase().includes("url") || h.toLowerCase().includes("archive"))).toBe(true);
    expect(result!.degradationNote).toBeTruthy();
  });

  test("returns unavailable source when no releases and no versionFileDiff", async () => {
    const octokit = createMockOctokit({
      listReleases: async () => ({ data: [] }),
    });

    const result = await fetchDependsChangelog({
      libraryName: "zlib",
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      octokit,
      timeoutMs: 5000,
      versionFileDiff: null,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("unavailable");
    expect(result!.highlights).toEqual([]);
    expect(result!.degradationNote).toBeTruthy();
  });

  test("filters releases between old and new version only", async () => {
    const octokit = createMockOctokit({
      listReleases: async () => ({
        data: [
          { draft: false, tag_name: "v1.3.3", body: "Future release" },
          { draft: false, tag_name: "v1.3.2", body: "Target release with API changes" },
          { draft: false, tag_name: "v1.3.1", body: "Old release" },
          { draft: false, tag_name: "v1.3.0", body: "Ancient release" },
        ],
      }),
    });

    const result = await fetchDependsChangelog({
      libraryName: "zlib",
      oldVersion: "1.3.1",
      newVersion: "1.3.2",
      octokit,
      timeoutMs: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("github-releases");
    // Should only include v1.3.2 (old < tag <= new)
    expect(result!.highlights.some(h => h.includes("Future"))).toBe(false);
    expect(result!.highlights.some(h => h.includes("Old release"))).toBe(false);
    expect(result!.highlights.some(h => h.includes("Ancient"))).toBe(false);
  });

  test("returns unavailable when library is unknown", async () => {
    const octokit = createMockOctokit();

    const result = await fetchDependsChangelog({
      libraryName: "totally-unknown-lib",
      oldVersion: "1.0",
      newVersion: "2.0",
      octokit,
      timeoutMs: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("unavailable");
    expect(result!.degradationNote).toBeTruthy();
  });
});

// ─── verifyHash ─────────────────────────────────────────────────────────────

describe("verifyHash", () => {
  test("returns verified when hash matches upstream tarball", async () => {
    // Create a known content and compute its SHA512
    const content = "test tarball content";
    const crypto = await import("node:crypto");
    const expectedHash = crypto.createHash("sha512").update(content).digest("hex");

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(content, { status: 200 }))
    ) as any;

    const result = await verifyHash({
      url: "https://example.com/tarball.tar.gz",
      expectedSha512: expectedHash,
      timeoutMs: 5000,
    });

    expect(result.status).toBe("verified");
    expect(result.detail).toContain("match");
  });

  test("returns mismatch when hash does not match", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("different content", { status: 200 }))
    ) as any;

    const result = await verifyHash({
      url: "https://example.com/tarball.tar.gz",
      expectedSha512: "0000000000000000000000000000000000000000",
      timeoutMs: 5000,
    });

    expect(result.status).toBe("mismatch");
  });

  test("returns unavailable when fetch fails", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network error"))
    ) as any;

    const result = await verifyHash({
      url: "https://example.com/tarball.tar.gz",
      expectedSha512: "somehash",
      timeoutMs: 5000,
    });

    expect(result.status).toBe("unavailable");
    expect(result.detail).toContain("fetch");
  });

  test("returns skipped when no hash provided", async () => {
    const result = await verifyHash({
      url: "https://example.com/tarball.tar.gz",
      expectedSha512: null,
      timeoutMs: 5000,
    });

    expect(result.status).toBe("skipped");
  });
});

// ─── detectPatchChanges ─────────────────────────────────────────────────────

describe("detectPatchChanges", () => {
  test("detects patch file addition", () => {
    const files = [
      { filename: "tools/depends/target/zlib/01-fix-build.patch", status: "added" },
      { filename: "tools/depends/target/zlib/ZLIB-VERSION", status: "modified" },
    ];

    const result = detectPatchChanges(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe("tools/depends/target/zlib/01-fix-build.patch");
    expect(result[0]!.action).toBe("added");
  });

  test("detects patch file removal", () => {
    const files = [
      { filename: "tools/depends/target/openssl/old-fix.patch", status: "removed" },
    ];

    const result = detectPatchChanges(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe("removed");
  });

  test("returns empty array when no patch changes", () => {
    const files = [
      { filename: "tools/depends/target/zlib/ZLIB-VERSION", status: "modified" },
      { filename: "tools/depends/target/zlib/CMakeLists.txt", status: "modified" },
    ];

    const result = detectPatchChanges(files);
    expect(result).toHaveLength(0);
  });

  test("detects multiple patch changes", () => {
    const files = [
      { filename: "tools/depends/target/ffmpeg/01-fix-decode.patch", status: "added" },
      { filename: "tools/depends/target/ffmpeg/02-kodi-specific.patch", status: "modified" },
      { filename: "tools/depends/target/ffmpeg/old-workaround.diff", status: "removed" },
      { filename: "tools/depends/target/ffmpeg/FFMPEG-VERSION", status: "modified" },
    ];

    const result = detectPatchChanges(files);
    expect(result).toHaveLength(3);
    expect(result.some(p => p.action === "added")).toBe(true);
    expect(result.some(p => p.action === "removed")).toBe(true);
    expect(result.some(p => p.action === "modified")).toBe(true);
  });
});

// ─── KODI_LIB_REPO_MAP ─────────────────────────────────────────────────────

describe("KODI_LIB_REPO_MAP", () => {
  test("contains essential Kodi dependencies", () => {
    expect(KODI_LIB_REPO_MAP.zlib).toBeDefined();
    expect(KODI_LIB_REPO_MAP.openssl).toBeDefined();
    expect(KODI_LIB_REPO_MAP.ffmpeg).toBeDefined();
    expect(KODI_LIB_REPO_MAP.curl).toBeDefined();
    expect(KODI_LIB_REPO_MAP.python3).toBeDefined();
  });

  test("maps have valid owner/repo structure", () => {
    for (const [name, coords] of Object.entries(KODI_LIB_REPO_MAP)) {
      expect(coords.owner).toBeTruthy();
      expect(coords.repo).toBeTruthy();
    }
  });
});
