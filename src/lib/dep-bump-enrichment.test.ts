import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  fetchSecurityAdvisories,
  fetchChangelog,
  resolveGitHubRepo,
  extractBreakingChanges,
} from "./dep-bump-enrichment.ts";

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockOctokit(overrides: {
  listGlobalAdvisories?: (...args: unknown[]) => Promise<unknown>;
  listReleases?: (...args: unknown[]) => Promise<unknown>;
  getContent?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    rest: {
      securityAdvisories: {
        listGlobalAdvisories: overrides.listGlobalAdvisories ?? (async () => ({ data: [] })),
      },
      repos: {
        listReleases: overrides.listReleases ?? (async () => ({ data: [] })),
        getContent: overrides.getContent ?? (async () => { throw new Error("Not found"); }),
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

// ─── fetchSecurityAdvisories ─────────────────────────────────────────────────

describe("fetchSecurityAdvisories", () => {
  test("returns advisories for a known-vulnerable package", async () => {
    const octokit = createMockOctokit({
      listGlobalAdvisories: async (params: any) => {
        const version = params.affects?.split("@").pop();
        if (version === "4.17.20") {
          return {
            data: [
              {
                type: "reviewed",
                ghsa_id: "GHSA-xxxx-yyyy-zzzz",
                cve_id: "CVE-2021-23337",
                severity: "high",
                summary: "Prototype Pollution in lodash",
                html_url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
                vulnerabilities: [
                  {
                    package: { name: "lodash", ecosystem: "npm" },
                    vulnerable_version_range: "< 4.17.21",
                    first_patched_version: { identifier: "4.17.21" },
                  },
                ],
              },
            ],
          };
        }
        return { data: [] };
      },
    });

    const result = await fetchSecurityAdvisories({
      packageName: "lodash",
      ecosystem: "npm",
      oldVersion: "4.17.20",
      newVersion: "4.17.21",
      octokit,
    });

    expect(result).not.toBeNull();
    expect(result!.isSecurityBump).toBe(true);
    expect(result!.advisories).toHaveLength(1);
    expect(result!.advisories[0]!.ghsaId).toBe("GHSA-xxxx-yyyy-zzzz");
    expect(result!.advisories[0]!.cveId).toBe("CVE-2021-23337");
    expect(result!.advisories[0]!.severity).toBe("high");
    expect(result!.advisories[0]!.summary).toBe("Prototype Pollution in lodash");
    expect(result!.advisories[0]!.affectsOld).toBe(true);
    expect(result!.advisories[0]!.affectsNew).toBe(false);
  });

  test("returns empty advisories for unknown package", async () => {
    const octokit = createMockOctokit({
      listGlobalAdvisories: async () => ({ data: [] }),
    });

    const result = await fetchSecurityAdvisories({
      packageName: "unknown-package",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "1.0.1",
      octokit,
    });

    expect(result).not.toBeNull();
    expect(result!.advisories).toHaveLength(0);
    expect(result!.isSecurityBump).toBe(false);
  });

  test("returns null on API error (fail-open)", async () => {
    const octokit = createMockOctokit({
      listGlobalAdvisories: async () => {
        throw new Error("API rate limit exceeded");
      },
    });

    const result = await fetchSecurityAdvisories({
      packageName: "lodash",
      ecosystem: "npm",
      oldVersion: "4.17.20",
      newVersion: "4.17.21",
      octokit,
    });

    expect(result).toBeNull();
  });

  test("returns null for unmapped ecosystem", async () => {
    const octokit = createMockOctokit();

    const result = await fetchSecurityAdvisories({
      packageName: "some-pkg",
      ecosystem: "unknown-ecosystem",
      oldVersion: "1.0.0",
      newVersion: "1.0.1",
      octokit,
    });

    expect(result).toBeNull();
  });

  test("maps ecosystem names correctly (python -> pip)", async () => {
    let capturedEcosystem: string | undefined;
    const octokit = createMockOctokit({
      listGlobalAdvisories: async (params: any) => {
        capturedEcosystem = params.ecosystem;
        return { data: [] };
      },
    });

    await fetchSecurityAdvisories({
      packageName: "requests",
      ecosystem: "python",
      oldVersion: "2.25.0",
      newVersion: "2.26.0",
      octokit,
    });

    expect(capturedEcosystem).toBe("pip");
  });

  test("filters to reviewed advisories only", async () => {
    const octokit = createMockOctokit({
      listGlobalAdvisories: async () => ({
        data: [
          {
            type: "reviewed",
            ghsa_id: "GHSA-1111-2222-3333",
            cve_id: null,
            severity: "medium",
            summary: "Reviewed advisory",
            html_url: "https://github.com/advisories/GHSA-1111-2222-3333",
            vulnerabilities: [
              {
                package: { name: "pkg", ecosystem: "npm" },
                vulnerable_version_range: "< 2.0.0",
                first_patched_version: { identifier: "2.0.0" },
              },
            ],
          },
          {
            type: "malware",
            ghsa_id: "GHSA-4444-5555-6666",
            cve_id: null,
            severity: "critical",
            summary: "Malware advisory",
            html_url: "https://github.com/advisories/GHSA-4444-5555-6666",
            vulnerabilities: [],
          },
        ],
      }),
    });

    const result = await fetchSecurityAdvisories({
      packageName: "pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).not.toBeNull();
    // Only the reviewed advisory should be included
    expect(result!.advisories).toHaveLength(1);
    expect(result!.advisories[0]!.ghsaId).toBe("GHSA-1111-2222-3333");
  });

  test("isSecurityBump is false when both versions have same advisories", async () => {
    const octokit = createMockOctokit({
      listGlobalAdvisories: async () => ({
        data: [
          {
            type: "reviewed",
            ghsa_id: "GHSA-aaaa-bbbb-cccc",
            cve_id: null,
            severity: "low",
            summary: "Ongoing issue",
            html_url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
            vulnerabilities: [
              {
                package: { name: "pkg", ecosystem: "npm" },
                vulnerable_version_range: "< 3.0.0",
                first_patched_version: { identifier: "3.0.0" },
              },
            ],
          },
        ],
      }),
    });

    const result = await fetchSecurityAdvisories({
      packageName: "pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).not.toBeNull();
    // Both versions have the same advisory, so it's not a security bump
    expect(result!.isSecurityBump).toBe(false);
  });
});

// ─── resolveGitHubRepo ───────────────────────────────────────────────────────

describe("resolveGitHubRepo", () => {
  test("resolves npm package to GitHub repo", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/expressjs/express.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const result = await resolveGitHubRepo({
      packageName: "express",
      ecosystem: "npm",
    });

    expect(result).not.toBeNull();
    expect(result!.owner).toBe("expressjs");
    expect(result!.repo).toBe("express");
  });

  test("resolves scoped npm package", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/octokit/rest.js.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const result = await resolveGitHubRepo({
      packageName: "@octokit/rest",
      ecosystem: "npm",
    });

    expect(result).not.toBeNull();
    expect(result!.owner).toBe("octokit");
    expect(result!.repo).toBe("rest");
  });

  test("resolves python package from PyPI", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            info: {
              project_urls: {
                Source: "https://github.com/psf/requests",
                Homepage: "https://requests.readthedocs.io",
              },
              home_page: null,
            },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const result = await resolveGitHubRepo({
      packageName: "requests",
      ecosystem: "python",
    });

    expect(result).not.toBeNull();
    expect(result!.owner).toBe("psf");
    expect(result!.repo).toBe("requests");
  });

  test("resolves ruby gem from RubyGems", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            source_code_uri: "https://github.com/rails/rails",
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const result = await resolveGitHubRepo({
      packageName: "rails",
      ecosystem: "ruby",
    });

    expect(result).not.toBeNull();
    expect(result!.owner).toBe("rails");
    expect(result!.repo).toBe("rails");
  });

  test("returns null for unsupported ecosystem", async () => {
    const result = await resolveGitHubRepo({
      packageName: "some-pkg",
      ecosystem: "docker",
    });

    expect(result).toBeNull();
  });

  test("returns null on 404", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    ) as any;

    const result = await resolveGitHubRepo({
      packageName: "nonexistent-pkg",
      ecosystem: "npm",
    });

    expect(result).toBeNull();
  });

  test("returns null when no GitHub URL in metadata", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            info: {
              project_urls: {
                Documentation: "https://docs.example.com",
              },
              home_page: "https://example.com",
            },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const result = await resolveGitHubRepo({
      packageName: "internal-pkg",
      ecosystem: "python",
    });

    expect(result).toBeNull();
  });
});

// ─── extractBreakingChanges ──────────────────────────────────────────────────

describe("extractBreakingChanges", () => {
  test("extracts BREAKING CHANGE: marker", () => {
    const result = extractBreakingChanges([
      { body: "Some content\nBREAKING CHANGE: removed deprecated API\nMigrate to newMethod()" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("BREAKING CHANGE:");
    expect(result[0]).toContain("removed deprecated API");
  });

  test("extracts BREAKING CHANGES: marker (plural)", () => {
    const result = extractBreakingChanges([
      { body: "Update\nBREAKING CHANGES:\n- Removed X\n- Changed Y" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("BREAKING CHANGES:");
  });

  test("extracts ## Breaking heading", () => {
    const result = extractBreakingChanges([
      { body: "# Release v2.0\n## Breaking\n- Changed API surface\n- Removed legacy code" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Breaking");
    expect(result[0]).toContain("Changed API surface");
  });

  test("extracts **Breaking** marker", () => {
    const result = extractBreakingChanges([
      { body: "Changes:\n**Breaking**: Dropped Node 14 support\nPlease upgrade." },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("**Breaking**");
  });

  test("returns empty array when no breaking markers", () => {
    const result = extractBreakingChanges([
      { body: "Bug fixes:\n- Fixed null pointer\n- Improved performance" },
    ]);

    expect(result).toHaveLength(0);
  });

  test("deduplicates identical snippets", () => {
    const result = extractBreakingChanges([
      { body: "BREAKING CHANGE: removed X" },
      { body: "BREAKING CHANGE: removed X" },
    ]);

    expect(result).toHaveLength(1);
  });

  test("limits snippet length to 200 chars", () => {
    const longBody = "BREAKING CHANGE: " + "x".repeat(300);
    const result = extractBreakingChanges([{ body: longBody }]);

    expect(result).toHaveLength(1);
    expect(result[0]!.length).toBeLessThanOrEqual(200);
  });
});

// ─── fetchChangelog ──────────────────────────────────────────────────────────

describe("fetchChangelog", () => {
  test("returns release notes from GitHub Releases (tier 1)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/expressjs/express.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const octokit = createMockOctokit({
      listReleases: async () => ({
        data: [
          {
            tag_name: "v4.18.2",
            body: "## Changes\n- Fixed routing bug",
            draft: false,
          },
          {
            tag_name: "v4.18.1",
            body: "## Changes\n- Security patch",
            draft: false,
          },
          {
            tag_name: "v4.18.0",
            body: "## Changes\nBREAKING CHANGE: new middleware API",
            draft: false,
          },
          {
            tag_name: "v4.17.3",
            body: "Old release",
            draft: false,
          },
        ],
      }),
    });

    const result = await fetchChangelog({
      packageName: "express",
      ecosystem: "npm",
      oldVersion: "4.17.3",
      newVersion: "4.18.2",
      octokit,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("releases");
    expect(result!.releaseNotes.length).toBeGreaterThanOrEqual(1);
    expect(result!.compareUrl).toContain("github.com");
    expect(result!.breakingChanges.length).toBeGreaterThanOrEqual(1);
  });

  test("falls back to CHANGELOG.md (tier 2) when no releases found", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/owner/repo.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const changelogContent = Buffer.from(
      "# Changelog\n\n## 2.0.0\n- Major rewrite\n\n## 1.1.0\n- Added feature\n\n## 1.0.0\n- Initial release",
    ).toString("base64");

    const octokit = createMockOctokit({
      listReleases: async () => ({ data: [] }),
      getContent: async () => ({
        data: {
          type: "file",
          content: changelogContent,
          encoding: "base64",
        },
      }),
    });

    const result = await fetchChangelog({
      packageName: "some-pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("changelog-file");
    expect(result!.releaseNotes.length).toBeGreaterThanOrEqual(1);
  });

  test("falls back to compare URL only (tier 3) when nothing available", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/owner/repo.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const octokit = createMockOctokit({
      listReleases: async () => ({ data: [] }),
      getContent: async () => { throw new Error("Not found"); },
    });

    const result = await fetchChangelog({
      packageName: "some-pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("compare-url-only");
    expect(result!.compareUrl).toBe("https://github.com/owner/repo/compare/v1.0.0...v2.0.0");
    expect(result!.releaseNotes).toHaveLength(0);
  });

  test("returns null when repo resolution fails", async () => {
    // fetch returns 404 for registry lookup
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    ) as any;

    const octokit = createMockOctokit();

    const result = await fetchChangelog({
      packageName: "nonexistent-pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).toBeNull();
  });

  test("truncates oversized release bodies to 500 chars", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/owner/repo.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const longBody = "x".repeat(2000);
    const octokit = createMockOctokit({
      listReleases: async () => ({
        data: [
          { tag_name: "v2.0.0", body: longBody, draft: false },
        ],
      }),
    });

    const result = await fetchChangelog({
      packageName: "pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).not.toBeNull();
    expect(result!.releaseNotes[0]!.body.length).toBeLessThanOrEqual(503); // 500 + "..."
  });

  test("caps total changelog to 1500 chars", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/owner/repo.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const releases = Array.from({ length: 10 }, (_, i) => ({
      tag_name: `v1.0.${i + 1}`,
      body: "A".repeat(400),
      draft: false,
    }));

    const octokit = createMockOctokit({
      listReleases: async () => ({ data: releases }),
    });

    const result = await fetchChangelog({
      packageName: "pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "1.0.10",
      octokit,
    });

    expect(result).not.toBeNull();
    const totalChars = result!.releaseNotes.reduce((sum, n) => sum + n.body.length, 0);
    expect(totalChars).toBeLessThanOrEqual(1500);
  });

  test("skips draft releases", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            repository: { url: "git+https://github.com/owner/repo.git" },
          }),
          { status: 200 },
        ),
      ),
    ) as any;

    const octokit = createMockOctokit({
      listReleases: async () => ({
        data: [
          { tag_name: "v2.0.0", body: "Release notes", draft: true },
          { tag_name: "v1.1.0", body: "Patch notes", draft: false },
        ],
      }),
    });

    const result = await fetchChangelog({
      packageName: "pkg",
      ecosystem: "npm",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      octokit,
    });

    expect(result).not.toBeNull();
    // Only the non-draft release (v1.1.0) should be included
    expect(result!.releaseNotes.some((n) => n.tag === "v2.0.0")).toBe(false);
    expect(result!.releaseNotes.some((n) => n.tag === "v1.1.0")).toBe(true);
  });
});
