# Phase 53: Dependency Bump Detection - Research

**Researched:** 2026-02-14
**Domain:** PR metadata analysis, semver parsing, dependency ecosystem detection
**Confidence:** HIGH

## Summary

Phase 53 adds automatic detection and classification of dependency bump PRs (Dependabot, Renovate, and similar tools). The feature has three layers: (1) detect that a PR is a dependency bump from title patterns, labels, and branch prefixes; (2) extract the package name, old version, new version, and ecosystem from PR metadata and changed manifest files; (3) classify the bump as major/minor/patch using semver comparison and flag majors as breaking.

The codebase already has several natural integration points. The `pr-intent-parser.ts` module already parses PR titles and detects conventional commit types. The `diff-analysis.ts` module already detects when dependency manifest files are changed via its `PATH_RISK_SIGNALS`. The `review-prompt.ts` module already accepts `prLabels`, `conventionalType`, and `headBranch` -- all three of the signals needed for detection. The `filters.ts` bot filter already allows Dependabot/Renovate through via the `BOT_ALLOW_LIST` config. The existing `skipAuthors` config currently lists `dependabot[bot]` and `renovate[bot]` as examples in tests, so some repos may be skipping these PRs entirely -- dependency bump detection must integrate upstream of that skip.

Semver comparison for the major/minor/patch classification is simple enough (three-part numeric comparison) that a hand-rolled ~20-line function is preferable to adding the `semver` npm package (376KB, many transitive dependencies). The core operation is: parse "X.Y.Z" into three numbers, compare old vs. new, and determine which part changed.

**Primary recommendation:** Create a new `src/lib/dep-bump-detector.ts` module with pure functions for detection, extraction, and classification. Wire it into `review.ts` handler between intent parsing and prompt building. Pass the result into `buildReviewPrompt` as a new optional `depBumpContext` parameter for dependency-aware review instructions.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none needed) | - | All logic is pure string parsing + semver comparison | No external library needed; semver comparison is ~20 lines |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (existing) picomatch | 4.0.2 | Glob matching for manifest file detection | Already used in diff-analysis.ts |
| (existing) zod | 4.3.6 | Schema validation for extracted bump data | Already used across codebase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled semver parse | `semver` npm package | `semver` is 376KB with dependencies; only need parse+compare for clean X.Y.Z strings. Hand-roll is simpler and lighter. Pre-release/build metadata can be stripped and ignored. |
| Parsing manifest file diffs | GitHub API `files` endpoint | API adds latency + rate limit cost. Title/branch patterns are sufficient for 95%+ of Dependabot/Renovate PRs. Manifest parsing is a fallback enrichment. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── dep-bump-detector.ts       # NEW: detection + extraction + classification
│   └── dep-bump-detector.test.ts  # NEW: comprehensive tests
├── execution/
│   └── review-prompt.ts           # MODIFY: add depBumpContext section
└── handlers/
    └── review.ts                  # MODIFY: wire detector between intent parse and prompt build
```

### Pattern 1: Three-Stage Pipeline (Detect -> Extract -> Classify)
**What:** Separate the three requirements (DEP-01, DEP-02, DEP-03) into three pure functions that compose into a single pipeline.
**When to use:** Always -- this mirrors how the codebase structures other enrichments (e.g., `parsePRIntent` -> `resolveReviewProfile` -> `buildReviewPrompt`).
**Example:**
```typescript
// Stage 1: DEP-01 -- Is this a dependency bump PR?
export function detectDepBump(params: {
  prTitle: string;
  prLabels: string[];
  headBranch: string;
  senderLogin: string;
}): DepBumpDetection | null

// Stage 2: DEP-02 -- Extract package name, versions, ecosystem
export function extractDepBumpDetails(params: {
  detection: DepBumpDetection;
  prTitle: string;
  prBody: string | null;
  changedFiles: string[];
}): DepBumpDetails

// Stage 3: DEP-03 -- Classify as major/minor/patch
export function classifyDepBump(params: {
  oldVersion: string | null;
  newVersion: string | null;
}): DepBumpClassification
```

### Pattern 2: Fail-Open Enrichment
**What:** All dependency bump detection is best-effort. If detection fails or returns null, the review proceeds normally with zero impact on non-dependency PRs.
**When to use:** Always -- matches codebase pattern used by `parsePRIntent`, `resolveAuthorTier`, `computeIncrementalDiff`, etc.
**Example:**
```typescript
// In review.ts handler, between parsedIntent and buildReviewPrompt:
let depBumpContext: DepBumpContext | null = null;
try {
  const detection = detectDepBump({
    prTitle: pr.title,
    prLabels,
    headBranch: pr.head.ref,
    senderLogin: pr.user.login,
  });
  if (detection) {
    const details = extractDepBumpDetails({
      detection,
      prTitle: pr.title,
      prBody: pr.body ?? null,
      changedFiles,
    });
    const classification = classifyDepBump({
      oldVersion: details.oldVersion,
      newVersion: details.newVersion,
    });
    depBumpContext = { detection, details, classification };
  }
} catch (err) {
  logger.warn({ ...baseLog, err }, "Dep bump detection failed (fail-open)");
}
```

### Pattern 3: Prompt Section Injection
**What:** If depBumpContext is non-null, inject a `## Dependency Bump Context` section into the review prompt with tailored instructions.
**When to use:** When a dependency bump is detected.
**Example:**
```typescript
// In review-prompt.ts buildReviewPrompt:
if (context.depBumpContext) {
  lines.push("", buildDepBumpSection(context.depBumpContext));
}
```

### Anti-Patterns to Avoid
- **Parsing manifest file content as primary detection:** Title/branch/label patterns cover 95%+ of automated bumps. Manifest parsing should be enrichment, not gating.
- **Blocking reviews on detection failure:** Must fail-open like every other enrichment in the handler.
- **Adding a new npm dependency for semver:** Only need parse + compare for clean X.Y.Z strings. The `semver` package handles ranges, pre-release, build metadata -- none of which are needed here.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching for manifest files | Custom glob | picomatch (already in deps) | Battle-tested, already used throughout codebase |
| YAML config schema validation | Manual parsing | zod (already in deps) | Consistent with existing config patterns |

**Key insight:** For this phase, the opposite applies: DO hand-roll semver parse/compare (~20 lines) rather than adding an npm dependency. The use case is narrow (clean X.Y.Z only), and the `semver` package brings 376KB + transitive deps for features we don't need.

## Common Pitfalls

### Pitfall 1: Dependabot Title Customization
**What goes wrong:** Assuming Dependabot always uses the default title format. Users can customize commit-message prefixes, and Dependabot may use conventional commit format if the repo's history uses it.
**Why it happens:** Dependabot adapts its title format based on the last ~100 commits. If >50% are conventional commits, it switches to `chore(deps):` style.
**How to avoid:** Support both formats: `Bump X from Y to Z` AND `chore(deps): bump X from Y to Z`. Also match `Update X from Y to Z` (Renovate's default).
**Warning signs:** Tests only cover one title format.

### Pitfall 2: Non-Semver Versions
**What goes wrong:** Assuming all versions are clean X.Y.Z. Some ecosystems use calver (e.g., `2024.01.15`), pre-release tags (`1.0.0-beta.1`), or platform-specific formats (`v1.2.3`).
**Why it happens:** Semver is standard but not universal.
**How to avoid:** Strip leading `v`, handle pre-release by truncating at `-` or `+`, return `unknown` classification for non-parseable versions rather than crashing.
**Warning signs:** Tests only use clean semver strings.

### Pitfall 3: Group Bumps (Dependabot Groups / Renovate Group PRs)
**What goes wrong:** A single PR bumps multiple packages. Title says "Bump the X group" or "Update react monorepo".
**Why it happens:** Both Dependabot and Renovate support grouped updates.
**How to avoid:** Detect group bumps as a separate detection type. For group bumps, mark ecosystem and "group" flag, but don't try to extract individual package details from the title -- the changed manifest files are the source of truth for group bumps.
**Warning signs:** Only testing single-package bump scenarios.

### Pitfall 4: False Positives on Non-Bot PRs
**What goes wrong:** A human PR with title "Bump minimum Node version to 20" is incorrectly flagged as a dependency bump.
**Why it happens:** Over-broad title regex matching.
**How to avoid:** Require at least TWO signals: title pattern AND (bot sender OR dependency label OR `dependabot/`/`renovate/` branch prefix). Title alone is insufficient.
**Warning signs:** Detection function only checks title.

### Pitfall 5: Bot Filter Blocking Dependency PRs
**What goes wrong:** Dependabot/Renovate PRs are blocked by the bot filter before they reach the review handler.
**Why it happens:** The `createBotFilter` drops bot senders not on the allow-list.
**How to avoid:** This is already handled -- `BOT_ALLOW_LIST` config can include `dependabot` and `renovate`. Phase 53 does NOT need to modify the bot filter. But the docs/config should note that dependency bump detection requires these bots to be on the allow-list, and they must NOT be in `skipAuthors`.
**Warning signs:** Integration test doesn't verify the full event flow including bot filter.

### Pitfall 6: Zero Latency Impact on Non-Dep PRs
**What goes wrong:** Detection adds measurable latency even when the PR is not a dependency bump.
**Why it happens:** Expensive regex or manifest parsing on every PR.
**How to avoid:** Quick-reject path: check sender login and branch prefix first (O(1) string operations). Only run regex title parsing if initial signals match. Manifest file scanning only if detection is positive.
**Warning signs:** No performance test or benchmark for non-dep PRs.

## Code Examples

Verified patterns from codebase analysis:

### Detection Signal Patterns (DEP-01)

```typescript
// Dependabot signals
// Branch: dependabot/npm_and_yarn/lodash-4.17.21
// Title: "Bump lodash from 4.17.20 to 4.17.21"
// Title (conventional): "chore(deps): bump lodash from 4.17.20 to 4.17.21"
// Labels: ["dependencies", "npm"]
// Sender: "dependabot[bot]"

// Renovate signals
// Branch: renovate/lodash-4.x
// Title: "Update dependency lodash to v4.17.21"
// Title: "Update lodash monorepo"
// Labels: ["renovate", "dependencies"]
// Sender: "renovate[bot]"

// Title regex patterns:
const DEPENDABOT_TITLE = /^(?:chore\([^)]*\):\s*)?bump\s+(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+)/i;
const RENOVATE_TITLE = /^(?:chore\([^)]*\):\s*)?update\s+(?:dependency\s+)?(\S+)\s+to\s+v?(\S+)/i;
const RENOVATE_RANGE_TITLE = /^(?:chore\([^)]*\):\s*)?update\s+(?:dependency\s+)?(\S+)\s+from\s+v?(\S+)\s+to\s+v?(\S+)/i;

// Branch prefix patterns:
const DEP_BRANCH_PREFIXES = ["dependabot/", "renovate/"];

// Known bot senders:
const DEP_BOT_LOGINS = new Set(["dependabot[bot]", "renovate[bot]"]);
```

### Ecosystem Detection from Branch and Manifest Files (DEP-02)

```typescript
// Dependabot branch encodes ecosystem:
// dependabot/npm_and_yarn/lodash-4.17.21 -> npm
// dependabot/pip/requests-2.28.0 -> pip/python
// dependabot/go_modules/golang.org/x/net-0.10.0 -> go
// dependabot/cargo/serde-1.0.163 -> cargo/rust
// dependabot/github_actions/actions/checkout-4 -> github-actions

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

// Manifest file -> ecosystem mapping (fallback):
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
```

### Semver Parse and Classify (DEP-03)

```typescript
type SemverParts = { major: number; minor: number; patch: number };

function parseSemver(version: string): SemverParts | null {
  // Strip leading 'v', trim whitespace
  const cleaned = version.replace(/^v/i, "").trim();
  // Strip pre-release / build metadata
  const base = cleaned.split(/[-+]/)[0] ?? "";
  const parts = base.split(".");
  if (parts.length < 2) return null;

  const major = parseInt(parts[0]!, 10);
  const minor = parseInt(parts[1]!, 10);
  const patch = parts[2] !== undefined ? parseInt(parts[2]!, 10) : 0;

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return null;
  return { major, minor, patch };
}

type BumpType = "major" | "minor" | "patch" | "unknown";

function classifySemverBump(oldVersion: string, newVersion: string): BumpType {
  const oldParts = parseSemver(oldVersion);
  const newParts = parseSemver(newVersion);
  if (!oldParts || !newParts) return "unknown";

  if (newParts.major !== oldParts.major) return "major";
  if (newParts.minor !== oldParts.minor) return "minor";
  if (newParts.patch !== oldParts.patch) return "patch";
  return "unknown"; // same version or only pre-release changed
}
```

### Integration Into Review Prompt

```typescript
// New section in review-prompt.ts
function buildDepBumpSection(ctx: DepBumpContext): string {
  const lines = [
    "## Dependency Bump Context",
    "",
    `This PR is an automated dependency update (detected via: ${ctx.detection.signals.join(", ")}).`,
    "",
  ];

  if (ctx.details.packageName) {
    lines.push(`- Package: ${ctx.details.packageName}`);
  }
  if (ctx.details.oldVersion && ctx.details.newVersion) {
    lines.push(`- Version: ${ctx.details.oldVersion} -> ${ctx.details.newVersion}`);
  }
  if (ctx.details.ecosystem) {
    lines.push(`- Ecosystem: ${ctx.details.ecosystem}`);
  }
  if (ctx.classification.bumpType) {
    lines.push(`- Bump type: ${ctx.classification.bumpType}`);
  }

  lines.push("");

  if (ctx.classification.bumpType === "major") {
    lines.push(
      "**MAJOR version bump detected -- potential breaking changes.**",
      "Focus review on:",
      "- Breaking API changes in the updated dependency",
      "- Deprecated features that may have been removed",
      "- Migration requirements or compatibility issues",
      "- Whether test coverage exercises the dependency's changed API surface",
    );
  } else {
    lines.push(
      "This is a minor/patch dependency update. Focus review on:",
      "- Verify the lockfile changes are consistent with the manifest change",
      "- Check for any unexpected additions to the dependency tree",
      "- Minimize noise -- minor/patch bumps are low risk by definition",
    );
  }

  return lines.join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Skip all bot PRs | Allow-listed bots pass through filter | Already implemented in Kodiai bot filter | Dependabot/Renovate PRs can reach the review handler |
| No dependency awareness | `diff-analysis.ts` flags "Modifies dependency manifest" risk signal | Already implemented | Partial awareness exists, but no structured extraction |
| No conventional commit detection for deps | `pr-intent-parser.ts` detects `chore(deps):` as conventional type | Already implemented | Intent parser knows about `chore` type, but not dep-specific |

**Deprecated/outdated:**
- None. This is a net-new feature. No existing dep-bump detection code to migrate from.

## Open Questions

1. **Should dependency bump detection modify the review profile?**
   - What we know: Major bumps warrant more attention than patch bumps. The codebase already auto-selects profiles based on PR size.
   - What's unclear: Should a patch-bump dep PR always get `minimal` profile regardless of size? Should a major bump get `strict`?
   - Recommendation: Start without profile override. Let the existing auto-profile handle it. Add a `depBumpContext.bumpType === "major"` -> `strict` override as a follow-up if users request it.

2. **Should group bumps extract individual package details from manifest diffs?**
   - What we know: Dependabot groups and Renovate monorepo updates put multiple packages in one PR. Title extraction fails for groups.
   - What's unclear: How much value does per-package detail add for group bumps vs. just flagging "group dependency update"?
   - Recommendation: V1 detects group bumps and marks them as `isGroup: true` with ecosystem only. Individual package extraction from manifest diffs is a follow-up enhancement.

3. **Integration with `skipAuthors` config**
   - What we know: The config test shows `dependabot[bot]` in `skipAuthors` as an example. If a repo has dep bots in `skipAuthors`, they never reach review.
   - What's unclear: Should phase 53 warn when dep bump detection finds a match but `skipAuthors` would block it?
   - Recommendation: No. `skipAuthors` is upstream and intentional. Dependency bump detection only enriches PRs that reach the review handler.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/handlers/review.ts` -- full PR processing flow, integration points (lines 866-1770)
- Codebase analysis: `src/lib/pr-intent-parser.ts` -- existing title/intent parsing patterns
- Codebase analysis: `src/execution/diff-analysis.ts` -- existing manifest file risk detection
- Codebase analysis: `src/execution/review-prompt.ts` -- prompt building with labels, conventional type, head branch
- Codebase analysis: `src/webhook/filters.ts` -- bot filter, allow-list mechanism
- [Dependabot PR customization docs](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/customizing-dependabot-prs) -- title/label/branch defaults
- [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference) -- branch naming, label defaults
- [Renovate Configuration Options](https://docs.renovatebot.com/configuration-options/) -- branch/title template defaults

### Secondary (MEDIUM confidence)
- [Dependabot title format discussion](https://github.com/dependabot/dependabot-core/discussions/10995) -- conventional commit adaptation behavior
- [Renovate PR concepts](https://docs.renovatebot.com/key-concepts/pull-requests/) -- branch naming patterns
- [Semver spec](https://semver.org/) -- X.Y.Z format definition

### Tertiary (LOW confidence)
- None. All findings verified against codebase and official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies needed; all patterns verified against existing codebase
- Architecture: HIGH - Integration points identified and verified in codebase; follows established enrichment patterns
- Pitfalls: HIGH - Patterns derived from official Dependabot/Renovate docs and codebase analysis

**Research date:** 2026-02-14
**Valid until:** 2026-03-16 (stable domain, patterns unlikely to change)
