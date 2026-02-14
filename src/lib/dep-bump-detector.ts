/**
 * Dependency Bump Detection Pipeline
 *
 * Three-stage pipeline for identifying, parsing, and classifying dependency bump PRs
 * from Dependabot, Renovate, and similar automated dependency update tools.
 *
 * Stage 1: detectDepBump — determines if a PR is a dependency bump (two-signal requirement)
 * Stage 2: extractDepBumpDetails — extracts package name, versions, and ecosystem
 * Stage 3: classifyDepBump — classifies version bump as major/minor/patch
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DepBumpSource = "dependabot" | "renovate" | "unknown";

export type DepBumpDetection = {
  source: DepBumpSource;
  signals: string[];
};

export type DepBumpDetails = {
  packageName: string | null;
  oldVersion: string | null;
  newVersion: string | null;
  ecosystem: string | null;
  isGroup: boolean;
};

export type DepBumpClassification = {
  bumpType: "major" | "minor" | "patch" | "unknown";
  isBreaking: boolean;
};

/** Composite context combining all three pipeline stages */
export type DepBumpContext = {
  detection: DepBumpDetection;
  details: DepBumpDetails;
  classification: DepBumpClassification;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Matches Dependabot titles: "Bump X from Y to Z" or "chore(deps): bump X from Y to Z" */
const DEPENDABOT_TITLE_RE =
  /^(?:chore\([^)]*\):\s*)?bump\s+(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+)/i;

/** Matches Renovate titles: "Update dependency X to vY" or "chore(deps): update dependency X to vY" */
const RENOVATE_TITLE_RE =
  /^(?:chore\([^)]*\):\s*)?update\s+(?:dependency\s+)?(\S+)\s+to\s+v?(\S+)/i;

/** Matches Renovate range titles: "Update dependency X from Y to vZ" */
const RENOVATE_RANGE_TITLE_RE =
  /^(?:chore\([^)]*\):\s*)?update\s+(?:dependency\s+)?(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+)/i;

/** Matches group/monorepo bump titles */
const GROUP_TITLE_RE = /\b(?:group|monorepo)\b/i;

/** Branch prefixes indicating dependency bot branches */
const DEP_BRANCH_PREFIXES = ["dependabot/", "renovate/"] as const;

/** Known dependency bot login names */
const DEP_BOT_LOGINS = new Set(["dependabot[bot]", "renovate[bot]"]);

/** Labels that signal a dependency-related PR */
const DEP_LABELS = new Set(["dependencies", "renovate", "security"]);

/** Title patterns for detection (not extraction — just matching) */
const DEPENDABOT_DETECT_RE = /^(?:chore\([^)]*\):\s*)?bump\s+\S+\s+(?:from\s+|the\s+)/i;
const RENOVATE_DETECT_RE = /^(?:chore\([^)]*\):\s*)?update\s+(?:dependency\s+)?\S+\s+/i;

/** Maps Dependabot branch ecosystem segments to normalized ecosystem names */
const DEPENDABOT_ECOSYSTEM_MAP: Record<string, string> = {
  npm_and_yarn: "npm",
  pip: "python",
  go_modules: "go",
  cargo: "rust",
  composer: "php",
  maven: "java",
  gradle: "java",
  nuget: "dotnet",
  bundler: "ruby",
  github_actions: "github-actions",
  docker: "docker",
  terraform: "terraform",
};

/** Maps manifest file names to ecosystem (fallback when branch segment unavailable) */
const MANIFEST_ECOSYSTEM_MAP: Record<string, string> = {
  "package.json": "npm",
  "package-lock.json": "npm",
  "yarn.lock": "npm",
  "pnpm-lock.yaml": "npm",
  "go.mod": "go",
  "go.sum": "go",
  "Cargo.toml": "rust",
  "Cargo.lock": "rust",
  "requirements.txt": "python",
  "Pipfile": "python",
  "Pipfile.lock": "python",
  "pyproject.toml": "python",
  "Gemfile": "ruby",
  "Gemfile.lock": "ruby",
  "pom.xml": "java",
  "build.gradle": "java",
  "composer.json": "php",
};

// ─── Stage 1: Detection ──────────────────────────────────────────────────────

/**
 * Determines if a PR is a dependency bump using a two-signal requirement.
 *
 * Signals checked: title pattern, branch prefix, sender login, labels.
 * At least 2 signals must match to avoid false positives on human PRs.
 *
 * @returns Detection result with source and matched signals, or null if not a dep bump.
 */
export function detectDepBump(params: {
  prTitle: string;
  prLabels: string[];
  headBranch: string;
  senderLogin: string;
}): DepBumpDetection | null {
  const { prTitle, prLabels, headBranch, senderLogin } = params;
  const signals: string[] = [];

  // Signal: title matches Dependabot or Renovate pattern
  if (DEPENDABOT_DETECT_RE.test(prTitle) || RENOVATE_DETECT_RE.test(prTitle)) {
    signals.push("title");
  }

  // Signal: branch starts with a dependency bot prefix
  const branchLower = headBranch.toLowerCase();
  if (DEP_BRANCH_PREFIXES.some((prefix) => branchLower.startsWith(prefix))) {
    signals.push("branch");
  }

  // Signal: sender is a known bot
  const senderLower = senderLogin.toLowerCase();
  if (DEP_BOT_LOGINS.has(senderLower)) {
    signals.push("sender");
  }

  // Signal: labels contain a dependency-related label
  const labelsLower = prLabels.map((l) => l.toLowerCase());
  if (labelsLower.some((l) => DEP_LABELS.has(l))) {
    signals.push("label");
  }

  // Require at least 2 signals
  if (signals.length < 2) return null;

  // Determine source from signals
  const source = determineSource(senderLower, branchLower, prTitle);

  return { source, signals };
}

function determineSource(
  senderLower: string,
  branchLower: string,
  prTitle: string,
): DepBumpSource {
  if (senderLower === "dependabot[bot]" || branchLower.startsWith("dependabot/")) {
    return "dependabot";
  }
  if (senderLower === "renovate[bot]" || branchLower.startsWith("renovate/")) {
    return "renovate";
  }
  if (DEPENDABOT_DETECT_RE.test(prTitle)) return "dependabot";
  if (RENOVATE_DETECT_RE.test(prTitle)) return "renovate";
  return "unknown";
}

// ─── Stage 2: Extraction ─────────────────────────────────────────────────────

/**
 * Extracts package name, old version, new version, and ecosystem from a detected dep bump PR.
 *
 * Extraction strategy:
 * 1. Parse title with regex for package name and versions
 * 2. Detect ecosystem from Dependabot branch segment or manifest file fallback
 * 3. For group bumps: mark isGroup, extract ecosystem only
 *
 * @returns Extracted details (all fields nullable for graceful degradation).
 */
export function extractDepBumpDetails(params: {
  detection: DepBumpDetection;
  prTitle: string;
  prBody: string | null;
  changedFiles: string[];
  headBranch: string;
}): DepBumpDetails {
  const { prTitle, changedFiles, headBranch } = params;

  // Check for group bump first
  if (GROUP_TITLE_RE.test(prTitle)) {
    return {
      packageName: null,
      oldVersion: null,
      newVersion: null,
      ecosystem: resolveEcosystem(headBranch, changedFiles),
      isGroup: true,
    };
  }

  // Try to extract versions from title
  const titleResult = parseTitleVersions(prTitle);

  return {
    packageName: titleResult.packageName,
    oldVersion: titleResult.oldVersion,
    newVersion: titleResult.newVersion,
    ecosystem: resolveEcosystem(headBranch, changedFiles),
    isGroup: false,
  };
}

function parseTitleVersions(title: string): {
  packageName: string | null;
  oldVersion: string | null;
  newVersion: string | null;
} {
  // Try Dependabot format: "Bump X from Y to Z"
  const depMatch = title.match(DEPENDABOT_TITLE_RE);
  if (depMatch) {
    return {
      packageName: depMatch[1] ?? null,
      oldVersion: depMatch[2] ?? null,
      newVersion: depMatch[3] ?? null,
    };
  }

  // Try Renovate range format: "Update dependency X from Y to Z"
  const renRangeMatch = title.match(RENOVATE_RANGE_TITLE_RE);
  if (renRangeMatch) {
    return {
      packageName: renRangeMatch[1] ?? null,
      oldVersion: renRangeMatch[2] ?? null,
      newVersion: renRangeMatch[3] ?? null,
    };
  }

  // Try Renovate format: "Update dependency X to vY"
  const renMatch = title.match(RENOVATE_TITLE_RE);
  if (renMatch) {
    return {
      packageName: renMatch[1] ?? null,
      oldVersion: null,
      newVersion: renMatch[2] ?? null,
    };
  }

  return { packageName: null, oldVersion: null, newVersion: null };
}

function resolveEcosystem(headBranch: string, changedFiles: string[]): string | null {
  // Try Dependabot branch: dependabot/{ecosystem}/...
  const branchLower = headBranch.toLowerCase();
  if (branchLower.startsWith("dependabot/")) {
    const parts = headBranch.split("/");
    if (parts.length >= 2) {
      const segment = parts[1]!;
      const ecosystem = DEPENDABOT_ECOSYSTEM_MAP[segment];
      if (ecosystem) return ecosystem;
    }
  }

  // Try Renovate branch — no ecosystem info in branch, fall through to manifest

  // Fallback: check changed manifest files
  for (const file of changedFiles) {
    const basename = file.split("/").pop() ?? file;
    const ecosystem = MANIFEST_ECOSYSTEM_MAP[basename];
    if (ecosystem) return ecosystem;
  }

  return null;
}

// ─── Stage 3: Classification ─────────────────────────────────────────────────

type SemverParts = { major: number; minor: number; patch: number };

/**
 * Parses a version string into semver parts.
 *
 * - Strips leading 'v' (case-insensitive)
 * - Strips pre-release/build metadata (split at `-` or `+`, take first part)
 * - Splits on `.`, parses first 3 parts as integers
 *
 * @returns Parsed parts or null if unparseable.
 */
export function parseSemver(version: string): SemverParts | null {
  const cleaned = version.replace(/^v/i, "").trim();
  if (!cleaned) return null;

  const base = cleaned.split(/[-+]/)[0] ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return null;

  const major = parseInt(parts[0]!, 10);
  const minor = parseInt(parts[1]!, 10);
  const patch = parts[2] !== undefined ? parseInt(parts[2]!, 10) : 0;

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;
  return { major, minor, patch };
}

/**
 * Classifies a version bump as major, minor, patch, or unknown.
 *
 * - `isBreaking` is true only when `bumpType === "major"`
 * - Returns unknown if either version is null or unparseable, or if both parse to the same base
 *
 * @returns Classification result.
 */
export function classifyDepBump(params: {
  oldVersion: string | null;
  newVersion: string | null;
}): DepBumpClassification {
  const { oldVersion, newVersion } = params;

  if (!oldVersion || !newVersion) {
    return { bumpType: "unknown", isBreaking: false };
  }

  const oldParts = parseSemver(oldVersion);
  const newParts = parseSemver(newVersion);

  if (!oldParts || !newParts) {
    return { bumpType: "unknown", isBreaking: false };
  }

  if (newParts.major !== oldParts.major) {
    return { bumpType: "major", isBreaking: true };
  }
  if (newParts.minor !== oldParts.minor) {
    return { bumpType: "minor", isBreaking: false };
  }
  if (newParts.patch !== oldParts.patch) {
    return { bumpType: "patch", isBreaking: false };
  }

  // Same base version (e.g., only pre-release differs)
  return { bumpType: "unknown", isBreaking: false };
}
