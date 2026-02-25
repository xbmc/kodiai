/**
 * [depends] Dependency Bump Enrichment Module
 *
 * Provides VERSION file diff parsing, upstream changelog fetching,
 * hash verification, and patch detection for Kodi-convention [depends]
 * dependency bump PRs.
 *
 * All functions follow the fail-open pattern: catch errors, return
 * degradation results, never throw.
 *
 * @module depends-bump-enrichment
 */

import type { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import { extractBreakingChanges } from "./dep-bump-enrichment.ts";
import { parseSemver } from "./dep-bump-detector.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VersionFileDiff = {
  oldVersion: string | null;
  newVersion: string | null;
  oldSha512: string | null;
  newSha512: string | null;
  oldArchive: string | null;
  newArchive: string | null;
  oldBaseUrl: string | null;
  newBaseUrl: string | null;
};

export type VersionFileData = {
  libName: string | null;
  version: string | null;
  archive: string | null; // expanded (variables resolved)
  sha512: string | null;
  baseUrl: string | null; // expanded
};

export type HashVerificationResult = {
  status: "verified" | "mismatch" | "unavailable" | "skipped";
  detail: string;
  expectedHash?: string;
  actualHash?: string;
};

export type DependsChangelogContext = {
  source: string; // "github-releases", "diff-analysis", "unavailable"
  highlights: string[]; // Kodi-relevant entries only
  breakingChanges: string[];
  url: string | null; // link to full changelog
  degradationNote: string | null; // set when changelog unavailable
};

export type PatchChange = {
  file: string;
  action: "added" | "removed" | "modified";
};

// ─── Library-to-Repo Map ────────────────────────────────────────────────────

/** Best-effort map of Kodi dependency names to upstream GitHub repos */
export const KODI_LIB_REPO_MAP: Record<string, { owner: string; repo: string }> = {
  zlib: { owner: "madler", repo: "zlib" },
  openssl: { owner: "openssl", repo: "openssl" },
  ffmpeg: { owner: "FFmpeg", repo: "FFmpeg" },
  harfbuzz: { owner: "harfbuzz", repo: "harfbuzz" },
  freetype: { owner: "freetype", repo: "freetype" },
  freetype2: { owner: "freetype", repo: "freetype" },
  curl: { owner: "curl", repo: "curl" },
  libpng: { owner: "pnggroup", repo: "libpng" },
  libjpeg: { owner: "libjpeg-turbo", repo: "libjpeg-turbo" },
  gnutls: { owner: "gnutls", repo: "gnutls" },
  sqlite: { owner: "nicenightcc", repo: "sqlite" },
  taglib: { owner: "taglib", repo: "taglib" },
  tinyxml2: { owner: "leethomason", repo: "tinyxml2" },
  libxml2: { owner: "GNOME", repo: "libxml2" },
  libxslt: { owner: "GNOME", repo: "libxslt" },
  libudfread: { owner: "nicenightcc", repo: "libudfread" },
  libaacs: { owner: "nicenightcc", repo: "libaacs" },
  libbluray: { owner: "nicenightcc", repo: "libbluray" },
  libass: { owner: "libass", repo: "libass" },
  libcdio: { owner: "rocky", repo: "libcdio" },
  libmicrohttpd: { owner: "nicenightcc", repo: "libmicrohttpd" },
  python3: { owner: "python", repo: "cpython" },
  dav1d: { owner: "nicenightcc", repo: "dav1d" },
  libwebp: { owner: "nicenightcc", repo: "libwebp" },
  spdlog: { owner: "gabime", repo: "spdlog" },
  fmt: { owner: "fmtlib", repo: "fmt" },
  flatbuffers: { owner: "google", repo: "flatbuffers" },
  crossguid: { owner: "nicenightcc", repo: "crossguid" },
  rapidjson: { owner: "Tencent", repo: "rapidjson" },
  pcre2: { owner: "PCRE2Project", repo: "pcre2" },
};

/** Lowercase lookup index built once at module load */
const REPO_MAP_LOWER: Record<string, { owner: string; repo: string }> = {};
for (const [key, value] of Object.entries(KODI_LIB_REPO_MAP)) {
  REPO_MAP_LOWER[key.toLowerCase()] = value;
}

// ─── VERSION File Diff Parsing ──────────────────────────────────────────────

/**
 * Parse a unified diff of a VERSION file to extract old/new values.
 *
 * Looks for `-`/`+` prefixed lines containing VERSION=, SHA512=, ARCHIVE=, BASE_URL=.
 */
export function parseVersionFileDiff(patch: string): VersionFileDiff {
  const result: VersionFileDiff = {
    oldVersion: null,
    newVersion: null,
    oldSha512: null,
    newSha512: null,
    oldArchive: null,
    newArchive: null,
    oldBaseUrl: null,
    newBaseUrl: null,
  };

  for (const line of patch.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;

    const isOld = line.startsWith("-");
    const isNew = line.startsWith("+");
    if (!isOld && !isNew) continue;

    const stripped = line.slice(1).trim();
    const eqIdx = stripped.indexOf("=");
    if (eqIdx === -1) continue;

    const key = stripped.slice(0, eqIdx).trim();
    const value = stripped.slice(eqIdx + 1).trim();

    if (key === "VERSION") {
      if (isOld) result.oldVersion = value;
      else result.newVersion = value;
    } else if (key === "SHA512") {
      if (isOld) result.oldSha512 = value;
      else result.newSha512 = value;
    } else if (key === "ARCHIVE") {
      if (isOld) result.oldArchive = value;
      else result.newArchive = value;
    } else if (key === "BASE_URL") {
      if (isOld) result.oldBaseUrl = value;
      else result.newBaseUrl = value;
    }
  }

  return result;
}

// ─── VERSION File Content Parsing ───────────────────────────────────────────

/**
 * Parse a full VERSION file content, resolving $(VAR) variable references.
 *
 * Variables are defined before use in Kodi VERSION files, so a single
 * pass collecting raw values followed by expansion is sufficient.
 */
export function parseVersionFileContent(content: string): VersionFileData {
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }

  // Expand $(VAR) references in a value
  function expand(raw: string | undefined): string | null {
    if (!raw) return null;
    return raw.replace(/\$\((\w+)\)/g, (_match, varName) => vars[varName] ?? `$(${varName})`);
  }

  return {
    libName: vars.LIBNAME ?? null,
    version: vars.VERSION ?? null,
    archive: expand(vars.ARCHIVE),
    sha512: vars.SHA512 ?? null,
    baseUrl: expand(vars.BASE_URL),
  };
}

// ─── Upstream Repo Resolution ───────────────────────────────────────────────

/**
 * Case-insensitive lookup of a Kodi library name in KODI_LIB_REPO_MAP.
 *
 * @returns RepoCoords or null for unknown libraries.
 */
export function resolveUpstreamRepo(libraryName: string): { owner: string; repo: string } | null {
  return REPO_MAP_LOWER[libraryName.toLowerCase()] ?? null;
}

// ─── Changelog Fetching ─────────────────────────────────────────────────────

type GitHubReleaseResponse = {
  draft: boolean;
  tag_name: string;
  body: string | null;
};

function semverGreaterThan(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

/**
 * Fetch upstream changelog for a [depends] dependency bump.
 *
 * Uses resolveUpstreamRepo() to find the GitHub repo, then queries
 * GitHub Releases API. Falls back to diff-analysis or unavailable.
 *
 * All failures are caught and produce degradation notes -- never throws.
 */
export async function fetchDependsChangelog(params: {
  libraryName: string;
  oldVersion: string;
  newVersion: string;
  octokit: Octokit;
  timeoutMs?: number;
  versionFileDiff?: VersionFileDiff | null;
}): Promise<DependsChangelogContext> {
  const {
    libraryName,
    oldVersion,
    newVersion,
    octokit,
    timeoutMs: _timeoutMs = 4000,
    versionFileDiff = null,
  } = params;

  const repo = resolveUpstreamRepo(libraryName);
  const upstreamUrl = repo
    ? `https://github.com/${repo.owner}/${repo.repo}`
    : null;

  if (!repo) {
    return buildFallbackResult(versionFileDiff, upstreamUrl);
  }

  try {
    const { data } = await octokit.rest.repos.listReleases({
      owner: repo.owner,
      repo: repo.repo,
      per_page: 20,
    });

    const releases = data as GitHubReleaseResponse[];

    // Filter releases between old and new version (old < tag <= new)
    const oldSemver = parseSemver(oldVersion);
    const newSemver = parseSemver(newVersion);

    if (!oldSemver || !newSemver || releases.length === 0) {
      return buildFallbackResult(versionFileDiff, upstreamUrl);
    }

    const matched: Array<{ tag: string; body: string }> = [];
    for (const release of releases) {
      if (release.draft || !release.tag_name) continue;

      const tagVersion = release.tag_name.replace(/^v/i, "");
      const tagSemver = parseSemver(tagVersion);
      if (!tagSemver) continue;

      if (
        semverGreaterThan(tagSemver, oldSemver) &&
        !semverGreaterThan(tagSemver, newSemver)
      ) {
        matched.push({
          tag: release.tag_name,
          body: release.body ?? "",
        });
      }
    }

    if (matched.length === 0) {
      return buildFallbackResult(versionFileDiff, upstreamUrl);
    }

    // Extract Kodi-relevant highlights from release bodies
    const highlights: string[] = [];
    for (const release of matched) {
      if (release.body) {
        highlights.push(`**${release.tag}:** ${truncateBody(release.body)}`);
      }
    }

    const breakingChanges = extractBreakingChanges(matched);

    return {
      source: "github-releases",
      highlights,
      breakingChanges,
      url: `${upstreamUrl}/releases`,
      degradationNote: null,
    };
  } catch {
    return buildFallbackResult(versionFileDiff, upstreamUrl);
  }
}

/**
 * Build fallback result when GitHub releases are unavailable.
 * If versionFileDiff is provided, synthesize highlights from diff data.
 */
function buildFallbackResult(
  versionFileDiff: VersionFileDiff | null | undefined,
  upstreamUrl: string | null,
): DependsChangelogContext {
  const urlDisplay = upstreamUrl ?? "upstream repository";

  if (versionFileDiff) {
    const highlights: string[] = [];

    if (versionFileDiff.oldVersion && versionFileDiff.newVersion) {
      highlights.push(`Version: ${versionFileDiff.oldVersion} \u2192 ${versionFileDiff.newVersion}`);
    }

    if (
      versionFileDiff.oldSha512 &&
      versionFileDiff.newSha512 &&
      versionFileDiff.oldSha512 !== versionFileDiff.newSha512
    ) {
      highlights.push("SHA512 hash changed");
    }

    if (
      versionFileDiff.oldBaseUrl &&
      versionFileDiff.newBaseUrl &&
      versionFileDiff.oldBaseUrl !== versionFileDiff.newBaseUrl
    ) {
      highlights.push(`Archive URL changed: ${versionFileDiff.oldBaseUrl} \u2192 ${versionFileDiff.newBaseUrl}`);
    }

    if (
      versionFileDiff.oldArchive &&
      versionFileDiff.newArchive &&
      versionFileDiff.oldArchive !== versionFileDiff.newArchive
    ) {
      highlights.push(`Archive format changed: ${versionFileDiff.oldArchive} \u2192 ${versionFileDiff.newArchive}`);
    }

    if (highlights.length > 0) {
      return {
        source: "diff-analysis",
        highlights,
        breakingChanges: [],
        url: upstreamUrl,
        degradationNote: `Changelog unavailable \u2014 analysis derived from PR diff. Check [upstream](${urlDisplay}) for full release notes.`,
      };
    }
  }

  return {
    source: "unavailable",
    highlights: [],
    breakingChanges: [],
    url: upstreamUrl,
    degradationNote: `Changelog unavailable -- check [upstream](${urlDisplay}) manually`,
  };
}

function truncateBody(body: string, maxLen = 300): string {
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + "...";
}

// ─── Hash Verification ──────────────────────────────────────────────────────

/**
 * Verify a SHA512 hash against an upstream tarball.
 *
 * Fetches the URL with timeout, computes SHA512, and compares.
 * Returns one of four statuses: verified, mismatch, unavailable, skipped.
 */
export async function verifyHash(params: {
  url: string;
  expectedSha512: string | null;
  timeoutMs?: number;
}): Promise<HashVerificationResult> {
  const { url, expectedSha512, timeoutMs = 5000 } = params;

  if (!expectedSha512) {
    return { status: "skipped", detail: "No hash to verify" };
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        status: "unavailable",
        detail: `Could not fetch upstream tarball (HTTP ${response.status})`,
      };
    }

    const buffer = await response.arrayBuffer();
    const actualHash = createHash("sha512")
      .update(Buffer.from(buffer))
      .digest("hex");

    if (actualHash === expectedSha512) {
      return {
        status: "verified",
        detail: "SHA512 matches upstream tarball",
        expectedHash: expectedSha512,
        actualHash,
      };
    }

    return {
      status: "mismatch",
      detail: `SHA512 mismatch: expected ${expectedSha512.slice(0, 16)}... got ${actualHash.slice(0, 16)}...`,
      expectedHash: expectedSha512,
      actualHash,
    };
  } catch {
    return {
      status: "unavailable",
      detail: "Could not fetch upstream tarball for hash verification",
    };
  }
}

// ─── Patch Change Detection ─────────────────────────────────────────────────

/**
 * Detect patch file additions/removals from PR changed files.
 *
 * Filters for *.patch or *.diff files within tools/depends/ paths.
 */
export function detectPatchChanges(
  files: Array<{ filename: string; status: string }>,
): PatchChange[] {
  const patchPattern = /\.(patch|diff)$/i;

  return files
    .filter((f) => patchPattern.test(f.filename))
    .map((f) => ({
      file: f.filename,
      action: mapStatus(f.status),
    }));
}

function mapStatus(status: string): "added" | "removed" | "modified" {
  if (status === "added") return "added";
  if (status === "removed") return "removed";
  return "modified";
}
