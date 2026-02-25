/**
 * [depends] PR Title Detection Module
 *
 * Detects Kodi-convention dependency bump PRs by title pattern.
 * These follow a different convention from Dependabot/Renovate:
 *   - Bracketed prefix: [depends], [Windows], [android], [ios], [osx], [linux]
 *   - Path prefix: target/depends:, tools/depends:
 *   - Verbs: Bump, Refresh, Update, Upgrade
 *
 * Mutually exclusive with dep-bump-detector.ts:
 *   detectDependsBump() runs first; if matched, detectDepBump() is skipped.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DependsBumpPackage = {
  name: string;
  newVersion: string | null; // null for group bumps like "Bump font libraries"
  oldVersion: string | null; // null when title only has new version
};

export type DependsBumpInfo = {
  packages: DependsBumpPackage[];
  platform: string | null; // "windows", "android", "ios", "osx", "linux", or null for generic [depends]
  isGroup: boolean; // true when title has no individual package version
  rawTitle: string;
};

export type DependsBumpContext = {
  info: DependsBumpInfo;
  // Enrichment fields populated by later pipeline stages:
  changelog?: Record<string, unknown> | null;
  hashVerification?: Record<string, unknown> | null;
  impactAssessment?: Record<string, unknown> | null;
  transitiveCheck?: Record<string, unknown> | null;
  retrievalContext?: Record<string, unknown> | null;
  hasSourceChanges?: boolean; // true if PR touches code beyond build configs
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Matches bracketed prefix: [depends], [Windows], [android], [ios], [osx], [linux] (with optional nested brackets) */
const DEPENDS_TITLE_RE =
  /^\[(?:depends|windows|android|ios|osx|linux)[^\]]*\]/i;

/** Matches path-style prefix: target/depends: or tools/depends: */
const TARGET_DEPENDS_PREFIX_RE = /^(?:target\/depends|tools\/depends):\s/i;

/** Platform keywords that map to a non-null platform value */
const PLATFORM_KEYWORDS = new Set([
  "windows",
  "android",
  "ios",
  "osx",
  "linux",
]);

/** Recognized action verbs after the prefix */
const ACTION_VERB_RE = /^(bump|refresh|update|upgrade)\s+/i;

/** Version pattern: optional v-prefix, then digits/dots/hex (covers semver, commit hashes, unusual formats) */
const VERSION_RE = /^v?([0-9a-f][0-9a-f.]*)/i;

// ─── Detection + Extraction ───────────────────────────────────────────────────

/**
 * Detects if a PR title matches Kodi-convention [depends] bump patterns.
 *
 * @returns DependsBumpInfo if matched, null if not (enabling Dependabot fallback).
 */
export function detectDependsBump(prTitle: string): DependsBumpInfo | null {
  let actionPart: string;
  let platform: string | null = null;

  const bracketMatch = prTitle.match(DEPENDS_TITLE_RE);
  if (bracketMatch) {
    // Extract platform from first bracket content
    const firstBracket = prTitle.match(/^\[([^\]]+)\]/i);
    if (firstBracket) {
      const bracketContent = firstBracket[1]!.toLowerCase();
      if (PLATFORM_KEYWORDS.has(bracketContent)) {
        platform = bracketContent;
      }
    }

    // Strip ALL bracket groups from the beginning to get the action part
    actionPart = prTitle.replace(/^(?:\[[^\]]*\]\s*)+/, "").trim();
  } else if (TARGET_DEPENDS_PREFIX_RE.test(prTitle)) {
    // Strip "target/depends: " or "tools/depends: " prefix
    actionPart = prTitle.replace(TARGET_DEPENDS_PREFIX_RE, "").trim();
  } else {
    return null;
  }

  // Must have an action verb
  const verbMatch = actionPart.match(ACTION_VERB_RE);
  if (!verbMatch) {
    return null;
  }

  // Strip the verb to get the packages part
  const packagesPart = actionPart.slice(verbMatch[0].length).trim();

  // Split on " / " for multi-package support
  const segments = packagesPart.split(/\s+\/\s+/);
  const packages: DependsBumpPackage[] = [];

  for (const segment of segments) {
    const parsed = parsePackageSegment(segment.trim());
    if (parsed) {
      packages.push(parsed);
    }
  }

  if (packages.length === 0) {
    return null;
  }

  // Determine if this is a group bump: no package has a version AND name looks like a category
  const isGroup = packages.every((p) => p.newVersion === null);

  return {
    packages,
    platform,
    isGroup,
    rawTitle: prTitle,
  };
}

/**
 * Parses a single package segment like "zlib 1.3.2" or "openssl to 3.0.19" or "font libraries".
 */
function parsePackageSegment(segment: string): DependsBumpPackage | null {
  if (!segment) return null;

  // Try pattern: "name to version" (with optional v-prefix)
  const toMatch = segment.match(/^(.+?)\s+to\s+(v?[0-9a-f][0-9a-f.]*)\s*$/i);
  if (toMatch) {
    const name = toMatch[1]!.trim();
    const version = stripVPrefix(toMatch[2]!.trim());
    return { name, newVersion: version, oldVersion: null };
  }

  // Try pattern: "name version" (version at end, no "to")
  const spaceVersionMatch = segment.match(
    /^(.+?)\s+(v?[0-9][0-9a-f.]*)\s*$/i,
  );
  if (spaceVersionMatch) {
    const name = spaceVersionMatch[1]!.trim();
    const version = stripVPrefix(spaceVersionMatch[2]!.trim());
    return { name, newVersion: version, oldVersion: null };
  }

  // No version found -- treat entire segment as package name (group bump)
  return { name: segment.trim(), newVersion: null, oldVersion: null };
}

/** Strips leading 'v' or 'V' from a version string */
function stripVPrefix(version: string): string {
  return version.replace(/^v/i, "");
}
