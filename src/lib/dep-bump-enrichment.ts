/**
 * Dependency Bump Enrichment Module
 *
 * Provides security advisory lookup, changelog fetching, package-to-repo resolution,
 * and breaking change detection for dependency bump PRs.
 *
 * All functions follow the fail-open pattern: return null on any error.
 * Group bumps (isGroup: true) should be skipped by the caller -- no enrichment
 * is attempted for group bumps since there is no single package to query.
 *
 * @module dep-bump-enrichment
 */

import type { Octokit } from "@octokit/rest";
import { parseSemver } from "./dep-bump-detector.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdvisoryInfo = {
  ghsaId: string;
  cveId: string | null;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  summary: string;
  vulnerableVersionRange: string;
  firstPatchedVersion: string | null;
  affectsOld: boolean;
  affectsNew: boolean;
  url: string;
};

export type SecurityContext = {
  advisories: AdvisoryInfo[];
  isSecurityBump: boolean;
};

export type RepoCoords = { owner: string; repo: string };

export type ChangelogContext = {
  releaseNotes: Array<{ tag: string; body: string }>;
  breakingChanges: string[];
  compareUrl: string | null;
  source: "releases" | "changelog-file" | "compare-url-only";
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maps Phase 53 ecosystem names to GitHub Advisory API ecosystem names */
const ECOSYSTEM_TO_ADVISORY: Record<string, string> = {
  npm: "npm",
  python: "pip",
  go: "go",
  rust: "rust",
  ruby: "rubygems",
  java: "maven",
  php: "composer",
  dotnet: "nuget",
  "github-actions": "actions",
};

/** Registry URL builders for package-to-repo resolution */
const REGISTRY_URLS: Record<string, (pkg: string) => string> = {
  npm: (pkg) => `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`,
  python: (pkg) => `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`,
  ruby: (pkg) => `https://rubygems.org/api/v1/gems/${encodeURIComponent(pkg)}.json`,
};

/** Breaking change markers in release notes (ordered most-specific first) */
const BREAKING_MARKERS = [
  /BREAKING CHANGES?:/i,
  /^#+\s*Breaking/im,
  /\*\*Breaking\*\*/i,
  /\bINCOMPATIBLE\b/i,
];

const MAX_RELEASE_BODY_CHARS = 500;
const MAX_CHANGELOG_CHARS = 1500;
const MAX_SNIPPET_CHARS = 200;

// ─── Security Advisory Lookup ─────────────────────────────────────────────────

/**
 * Fetches security advisories for a package, querying both old and new versions.
 *
 * Advisory data is informational -- it indicates that advisories exist for the
 * package, NOT that the specific usage pattern is vulnerable.
 *
 * @returns SecurityContext with advisories and isSecurityBump flag, or null on error.
 */
export async function fetchSecurityAdvisories(params: {
  packageName: string;
  ecosystem: string;
  oldVersion: string | null;
  newVersion: string | null;
  octokit: Octokit;
  timeoutMs?: number;
}): Promise<SecurityContext | null> {
  const { packageName, ecosystem, oldVersion, newVersion, octokit, timeoutMs = 4000 } = params;

  const advisoryEcosystem = ECOSYSTEM_TO_ADVISORY[ecosystem];
  if (!advisoryEcosystem) return null;

  try {
    const [oldResult, newResult] = await Promise.allSettled([
      oldVersion
        ? queryAdvisories(octokit, packageName, advisoryEcosystem, oldVersion)
        : Promise.resolve([]),
      newVersion
        ? queryAdvisories(octokit, packageName, advisoryEcosystem, newVersion)
        : Promise.resolve([]),
    ]);

    // If both calls failed, return null (fail-open)
    if (oldResult.status === "rejected" && newResult.status === "rejected") {
      return null;
    }

    const oldAdvisories = oldResult.status === "fulfilled" ? oldResult.value : [];
    const newAdvisories = newResult.status === "fulfilled" ? newResult.value : [];

    // Merge and deduplicate advisories, marking which version each affects
    const newGhsaIds = new Set(newAdvisories.map((a) => a.ghsaId));
    const oldGhsaIds = new Set(oldAdvisories.map((a) => a.ghsaId));

    const allAdvisories = new Map<string, AdvisoryInfo>();

    for (const adv of oldAdvisories) {
      allAdvisories.set(adv.ghsaId, {
        ...adv,
        affectsOld: true,
        affectsNew: newGhsaIds.has(adv.ghsaId),
      });
    }

    for (const adv of newAdvisories) {
      if (!allAdvisories.has(adv.ghsaId)) {
        allAdvisories.set(adv.ghsaId, {
          ...adv,
          affectsOld: oldGhsaIds.has(adv.ghsaId),
          affectsNew: true,
        });
      }
    }

    const advisories = Array.from(allAdvisories.values());

    // Security-motivated: old version has advisory(s) that new version does NOT
    const isSecurityBump = oldAdvisories.length > 0 && oldAdvisories.some((a) => !newGhsaIds.has(a.ghsaId));

    return { advisories, isSecurityBump };
  } catch {
    return null;
  }
}

async function queryAdvisories(
  octokit: Octokit,
  packageName: string,
  ecosystem: string,
  version: string,
): Promise<AdvisoryInfo[]> {
  const { data } = await (octokit.rest.securityAdvisories as any).listGlobalAdvisories({
    ecosystem: ecosystem as any,
    affects: `${packageName}@${version}`,
    per_page: 10,
  });

  return (data as any[])
    .filter((adv: any) => adv.type === "reviewed")
    .map((adv: any) => {
      const vuln = adv.vulnerabilities?.find(
        (v: any) => v.package?.name === packageName && v.package?.ecosystem === ecosystem,
      );
      return {
        ghsaId: adv.ghsa_id,
        cveId: adv.cve_id ?? null,
        severity: (adv.severity as AdvisoryInfo["severity"]) ?? "unknown",
        summary: adv.summary ?? "",
        vulnerableVersionRange: vuln?.vulnerable_version_range ?? "",
        firstPatchedVersion: vuln?.first_patched_version?.identifier ?? null,
        affectsOld: false,
        affectsNew: false,
        url: adv.html_url ?? `https://github.com/advisories/${adv.ghsa_id}`,
      };
    });
}

// ─── Package-to-Repo Resolution ──────────────────────────────────────────────

/**
 * Resolves a package name + ecosystem to a GitHub owner/repo.
 *
 * Supported ecosystems: npm, python, ruby.
 * Other ecosystems return null (no resolution available in V1).
 *
 * @returns RepoCoords or null if resolution fails.
 */
export async function resolveGitHubRepo(params: {
  packageName: string;
  ecosystem: string;
}): Promise<RepoCoords | null> {
  const { packageName, ecosystem } = params;

  const urlFn = REGISTRY_URLS[ecosystem];
  if (!urlFn) return null;

  try {
    const resp = await fetch(urlFn(packageName), {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    return extractGitHubCoords(data, ecosystem);
  } catch {
    return null;
  }
}

function extractGitHubCoords(data: any, ecosystem: string): RepoCoords | null {
  let url: string | null = null;

  if (ecosystem === "npm") {
    url = data?.repository?.url ?? null;
  } else if (ecosystem === "python") {
    const projectUrls = data?.info?.project_urls ?? {};
    // Try Source, Repository, Homepage in order
    url = projectUrls.Source ?? projectUrls.Repository ?? projectUrls.Homepage ?? data?.info?.home_page ?? null;
  } else if (ecosystem === "ruby") {
    url = data?.source_code_uri ?? null;
  }

  if (!url || typeof url !== "string") return null;

  const match = url.match(/github\.com\/([^/]+)\/([^/.#?\s]+)/);
  if (!match) return null;

  return { owner: match[1]!, repo: match[2]! };
}

// ─── Breaking Change Detection ───────────────────────────────────────────────

/**
 * Extracts breaking change snippets from release note bodies.
 *
 * Scans for markers like "BREAKING CHANGE:", "## Breaking", "**Breaking**",
 * and extracts the marker line + up to 2 following lines (max 200 chars per snippet).
 *
 * @returns Deduplicated breaking change snippets.
 */
export function extractBreakingChanges(
  releaseNotes: Array<{ body: string }>,
): string[] {
  const breaking = new Set<string>();

  for (const note of releaseNotes) {
    // Use only the first matching marker per note to avoid duplicates
    // from overlapping patterns (e.g. "## Breaking" matches both heading and word patterns)
    for (const marker of BREAKING_MARKERS) {
      const match = note.body.match(marker);
      if (match) {
        const idx = note.body.indexOf(match[0]);
        let snippet = note.body
          .slice(idx, idx + MAX_SNIPPET_CHARS)
          .split("\n")
          .slice(0, 3)
          .join("\n")
          .trim();
        if (snippet.length > MAX_SNIPPET_CHARS) {
          snippet = snippet.slice(0, MAX_SNIPPET_CHARS);
        }
        breaking.add(snippet);
        break; // Only take first marker match per note
      }
    }
  }

  return Array.from(breaking);
}

// ─── Changelog Fetching ──────────────────────────────────────────────────────

/**
 * Fetches changelog/release notes for a package between two versions.
 *
 * Three-tier fallback:
 * 1. GitHub Releases API (tag-matched between versions)
 * 2. CHANGELOG.md file from repo (section between version headings)
 * 3. Compare URL only (github.com/owner/repo/compare/vOLD...vNEW)
 *
 * @returns ChangelogContext or null if repo resolution fails.
 */
export async function fetchChangelog(params: {
  packageName: string;
  ecosystem: string;
  oldVersion: string | null;
  newVersion: string | null;
  octokit: Octokit;
  timeoutMs?: number;
}): Promise<ChangelogContext | null> {
  const { packageName, ecosystem, oldVersion, newVersion, octokit } = params;

  try {
    // Step 1: Resolve package to GitHub repo
    const repo = await resolveGitHubRepo({ packageName, ecosystem });
    if (!repo) return null;

    const compareUrl =
      oldVersion && newVersion
        ? `https://github.com/${repo.owner}/${repo.repo}/compare/v${oldVersion}...v${newVersion}`
        : null;

    // Step 2 (Tier 1): Try GitHub Releases
    if (oldVersion && newVersion) {
      const releases = await fetchReleasesBetween(octokit, repo, oldVersion, newVersion);
      if (releases.length > 0) {
        const truncated = truncateReleaseNotes(releases);
        return {
          releaseNotes: truncated,
          breakingChanges: extractBreakingChanges(truncated),
          compareUrl,
          source: "releases",
        };
      }
    }

    // Step 3 (Tier 2): Try CHANGELOG.md
    if (oldVersion && newVersion) {
      const changelogNotes = await fetchChangelogFile(octokit, repo, oldVersion, newVersion);
      if (changelogNotes && changelogNotes.length > 0) {
        const truncated = truncateReleaseNotes(changelogNotes);
        return {
          releaseNotes: truncated,
          breakingChanges: extractBreakingChanges(truncated),
          compareUrl,
          source: "changelog-file",
        };
      }
    }

    // Step 4 (Tier 3): Compare URL only
    return {
      releaseNotes: [],
      breakingChanges: [],
      compareUrl,
      source: "compare-url-only",
    };
  } catch {
    return null;
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function semverGreaterThan(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

async function fetchReleasesBetween(
  octokit: Octokit,
  repo: RepoCoords,
  oldVersion: string,
  newVersion: string,
): Promise<Array<{ tag: string; body: string }>> {
  const oldSemver = parseSemver(oldVersion);
  const newSemver = parseSemver(newVersion);
  if (!oldSemver || !newSemver) return [];

  const releases: Array<{ tag: string; body: string }> = [];

  for (let page = 1; page <= 2; page++) {
    const { data } = await (octokit.rest.repos as any).listReleases({
      owner: repo.owner,
      repo: repo.repo,
      per_page: 30,
      page,
    });

    if (!data || data.length === 0) break;

    for (const release of data as any[]) {
      if (release.draft || !release.tag_name) continue;

      const tagVersion = release.tag_name.replace(/^v/i, "");
      const tagSemver = parseSemver(tagVersion);
      if (!tagSemver) continue;

      // Include releases where old < tag <= new
      if (
        semverGreaterThan(tagSemver, oldSemver) &&
        !semverGreaterThan(tagSemver, newSemver)
      ) {
        releases.push({
          tag: release.tag_name,
          body: release.body ?? "",
        });
      }
    }
  }

  return releases;
}

async function fetchChangelogFile(
  octokit: Octokit,
  repo: RepoCoords,
  oldVersion: string,
  newVersion: string,
): Promise<Array<{ tag: string; body: string }> | null> {
  try {
    const { data } = await (octokit.rest.repos as any).getContent({
      owner: repo.owner,
      repo: repo.repo,
      path: "CHANGELOG.md",
    });

    if (!data || data.type !== "file" || !data.content) return null;

    const content =
      data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf-8")
        : data.content;

    return parseChangelogSections(content, oldVersion, newVersion);
  } catch {
    return null;
  }
}

function parseChangelogSections(
  content: string,
  oldVersion: string,
  newVersion: string,
): Array<{ tag: string; body: string }> {
  // Split on version heading patterns: ## [version], # version, ## version
  const headingPattern = /^#{1,3}\s+\[?v?(\d+\.\d+\.\d+)\]?/gim;
  const sections: Array<{ version: string; start: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(content)) !== null) {
    sections.push({ version: match[1]!, start: match.index });
  }

  const oldSemver = parseSemver(oldVersion);
  const newSemver = parseSemver(newVersion);
  if (!oldSemver || !newSemver) return [];

  const results: Array<{ tag: string; body: string }> = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const sectionSemver = parseSemver(section.version);
    if (!sectionSemver) continue;

    // Include sections where old < version <= new
    if (
      semverGreaterThan(sectionSemver, oldSemver) &&
      !semverGreaterThan(sectionSemver, newSemver)
    ) {
      const end = i + 1 < sections.length ? sections[i + 1]!.start : content.length;
      const body = content.slice(section.start, end).trim();
      results.push({ tag: `v${section.version}`, body });
    }
  }

  return results;
}

function truncateReleaseNotes(
  notes: Array<{ tag: string; body: string }>,
): Array<{ tag: string; body: string }> {
  let totalChars = 0;
  const result: Array<{ tag: string; body: string }> = [];

  for (const note of notes) {
    if (totalChars >= MAX_CHANGELOG_CHARS) break;

    let body = note.body;
    if (body.length > MAX_RELEASE_BODY_CHARS) {
      body = body.slice(0, MAX_RELEASE_BODY_CHARS) + "...";
    }

    const remaining = MAX_CHANGELOG_CHARS - totalChars;
    if (body.length > remaining) {
      body = body.slice(0, remaining);
    }

    totalChars += body.length;
    result.push({ tag: note.tag, body });
  }

  return result;
}
