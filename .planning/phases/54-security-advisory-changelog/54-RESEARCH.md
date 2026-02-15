# Phase 54: Security Advisory & Changelog Analysis - Research

**Researched:** 2026-02-14
**Domain:** GitHub Advisory Database API, GitHub Releases API, npm registry metadata, changelog parsing, prompt engineering for security context
**Confidence:** HIGH

## Summary

Phase 54 extends the Phase 53 dependency bump detection pipeline with two new enrichment layers: (1) security advisory lookups via the GitHub Global Advisories REST API to surface CVEs affecting old or new versions, and (2) changelog/release notes fetching via GitHub Releases API to provide breaking change context. Both enrichments follow the established fail-open pattern and inject results into the `DepBumpContext` type that is already passed through to the review prompt.

The GitHub Global Advisories REST API (`GET /advisories`) is the primary choice for security data. It supports the `affects` parameter (`package@version` format) and `ecosystem` filter, is accessible via the already-installed `@octokit/rest` v22 (`octokit.rest.securityAdvisories.listGlobalAdvisories()`), and requires no additional dependencies. The OSV API (`POST https://api.osv.dev/v1/query`) serves as a fallback -- it is free, requires no authentication, and aggregates GitHub Advisory data plus other sources.

For changelog data, the approach is a three-tier fallback cascade: (1) `octokit.rest.repos.listReleases()` for GitHub Releases with body content, (2) `octokit.rest.repos.getContent()` for CHANGELOG.md files in the repo, and (3) a GitHub compare URL (`github.com/owner/repo/compare/vOLD...vNEW`) as a guaranteed-available link. Resolving an npm/pip/etc package name to a GitHub `owner/repo` is done by fetching the package registry metadata (e.g., `https://registry.npmjs.org/{pkg}/latest` has a `repository.url` field pointing to GitHub). This resolution step will fail for ~30-50% of packages (private registries, non-GitHub hosts, missing metadata), which is why the fallback cascade is essential.

**Primary recommendation:** Create a new `src/lib/dep-bump-enrichment.ts` module with two async functions (`fetchAdvisories` and `fetchChangelog`) that take the `DepBumpDetails` plus an octokit instance and return enrichment data. Extend `DepBumpContext` with optional `advisories` and `changelog` fields. Wire enrichment into `review.ts` after detection but with a timeout guard (5s max). Extend `buildDepBumpSection` in `review-prompt.ts` to render advisory and changelog data with a character budget.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/rest` | 22.x (already installed) | GitHub Advisory API + Releases API | Already the standard for all GitHub API calls in the codebase |
| Native `fetch` (Bun built-in) | - | npm registry metadata, OSV API fallback | Already used in codebase; no additional dependency needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` (already installed) | 4.x | Schema validation for API responses | Validate advisory/release payloads before use |
| `pino` (already installed) | 10.x | Structured logging | Log enrichment outcomes, failures, timings |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| GitHub Advisory REST API | OSV API (osv.dev) | OSV aggregates more sources but returns raw OSV format needing transformation. GitHub Advisory API returns data directly usable with octokit. Use OSV as fallback only. |
| GitHub Advisory REST API | GitHub GraphQL `securityVulnerabilities` query | GraphQL would allow more precise version range filtering but the codebase uses zero GraphQL currently. Adding `@octokit/graphql` is unnecessary complexity when REST `affects=pkg@version` works. |
| npm registry fetch for repo resolution | `package-json` npm package | The fetch is a single GET to `registry.npmjs.org/{pkg}/latest`; no need for a library. |
| Parsing CHANGELOG.md files | `changelog-parser` npm | Only need to extract text between version headings; a simple regex split is sufficient. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── dep-bump-detector.ts          # EXISTING (Phase 53)
│   ├── dep-bump-enrichment.ts        # NEW: advisory + changelog fetching
│   └── dep-bump-enrichment.test.ts   # NEW: tests with mocked API responses
├── execution/
│   └── review-prompt.ts              # MODIFY: extend buildDepBumpSection
└── handlers/
    └── review.ts                     # MODIFY: wire enrichment after detection
```

### Pattern 1: Enrichment Module (Async, Fail-Open, Timeout-Bounded)
**What:** A new module that takes `DepBumpDetails` + octokit and returns enrichment data. Each enrichment function has its own try/catch and timeout. The caller aggregates whatever succeeds.
**When to use:** Always for Phase 54.
**Example:**
```typescript
// src/lib/dep-bump-enrichment.ts

export type AdvisoryInfo = {
  ghsaId: string;
  cveId: string | null;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  summary: string;
  vulnerableVersionRange: string;
  firstPatchedVersion: string | null;
  affectsOld: boolean;   // true if oldVersion is in vulnerable range
  affectsNew: boolean;   // true if newVersion is in vulnerable range (rare but possible)
  url: string;
};

export type SecurityContext = {
  advisories: AdvisoryInfo[];
  isSecurityBump: boolean;  // true if old version has advisory AND new version patches it
};

export type ChangelogContext = {
  releaseNotes: Array<{ tag: string; body: string }>;  // between old and new
  breakingChanges: string[];   // extracted BREAKING CHANGE markers
  compareUrl: string | null;   // github.com/owner/repo/compare/vOLD...vNEW
  source: "releases" | "changelog-file" | "compare-url-only";
};

export async function fetchSecurityAdvisories(params: {
  packageName: string;
  ecosystem: string;
  oldVersion: string | null;
  newVersion: string | null;
  octokit: Octokit;
  timeoutMs?: number;
}): Promise<SecurityContext | null>

export async function fetchChangelog(params: {
  packageName: string;
  ecosystem: string;
  oldVersion: string | null;
  newVersion: string | null;
  octokit: Octokit;
  timeoutMs?: number;
}): Promise<ChangelogContext | null>
```

### Pattern 2: Extend DepBumpContext (Non-Breaking)
**What:** Add optional fields to the existing `DepBumpContext` type so enrichment data flows through the same pipeline.
**When to use:** Always.
**Example:**
```typescript
// Extended DepBumpContext (in dep-bump-detector.ts or dep-bump-enrichment.ts)
export type DepBumpContext = {
  detection: DepBumpDetection;
  details: DepBumpDetails;
  classification: DepBumpClassification;
  // Phase 54 additions (optional, null when enrichment skipped/failed)
  security?: SecurityContext | null;
  changelog?: ChangelogContext | null;
};
```

### Pattern 3: Package-to-Repo Resolution
**What:** Resolve a package name + ecosystem to a GitHub `owner/repo` by querying the package registry.
**When to use:** Before fetching releases/changelog (need to know which GitHub repo to query).
**Example:**
```typescript
// Ecosystem-specific registry URL resolution
const REGISTRY_URLS: Record<string, (pkg: string) => string> = {
  npm: (pkg) => `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`,
  python: (pkg) => `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`,
  ruby: (pkg) => `https://rubygems.org/api/v1/gems/${encodeURIComponent(pkg)}.json`,
  // go, rust, java, etc. have different patterns
};

type RepoCoords = { owner: string; repo: string };

async function resolveGitHubRepo(
  packageName: string,
  ecosystem: string,
): Promise<RepoCoords | null> {
  const urlFn = REGISTRY_URLS[ecosystem];
  if (!urlFn) return null;

  const resp = await fetch(urlFn(packageName), { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) return null;

  const data = await resp.json();
  // npm: data.repository.url -> "git+https://github.com/owner/repo.git"
  // pypi: data.info.project_urls.Source or data.info.home_page
  // rubygems: data.source_code_uri
  return extractGitHubCoords(data, ecosystem);
}

function extractGitHubCoords(data: unknown, ecosystem: string): RepoCoords | null {
  // Extract GitHub URL from registry metadata, parse owner/repo
  const url = extractRepoUrl(data, ecosystem);
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/.\s]+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}
```

### Pattern 4: Bounded Prompt Injection (Character Budget)
**What:** Security and changelog content injected into the LLM prompt is bounded to prevent prompt bloat. Advisory section gets max ~500 chars, changelog section gets max ~1500 chars.
**When to use:** Always for CLOG-03.
**Example:**
```typescript
const MAX_ADVISORY_SECTION_CHARS = 500;
const MAX_CHANGELOG_SECTION_CHARS = 1500;
const MAX_TOTAL_ENRICHMENT_CHARS = 2000;

function buildSecuritySection(security: SecurityContext): string {
  const lines: string[] = [];
  if (security.isSecurityBump) {
    lines.push("### Security-Motivated Bump");
    lines.push("The old version has known vulnerabilities that the new version patches.");
  } else {
    lines.push("### Security Advisories (informational)");
  }
  for (const adv of security.advisories.slice(0, 3)) { // max 3 advisories
    lines.push(`- **${adv.ghsaId}** (${adv.severity}): ${adv.summary}`);
    if (adv.firstPatchedVersion) {
      lines.push(`  Patched in: ${adv.firstPatchedVersion}`);
    }
  }
  return truncateToCharBudget(lines.join("\n"), MAX_ADVISORY_SECTION_CHARS);
}
```

### Pattern 5: Parallel Enrichment with Aggregate Timeout
**What:** Run advisory fetch and changelog fetch in parallel with `Promise.allSettled`, wrapped in an outer timeout.
**When to use:** Always in the review handler.
**Example:**
```typescript
// In review.ts, after dep bump detection
if (depBumpContext && depBumpContext.details.packageName && !depBumpContext.details.isGroup) {
  const enrichmentOctokit = await githubApp.getInstallationOctokit(event.installationId);
  try {
    const [secResult, clogResult] = await Promise.allSettled([
      fetchSecurityAdvisories({
        packageName: depBumpContext.details.packageName,
        ecosystem: depBumpContext.details.ecosystem ?? "npm",
        oldVersion: depBumpContext.details.oldVersion,
        newVersion: depBumpContext.details.newVersion,
        octokit: enrichmentOctokit,
        timeoutMs: 4000,
      }),
      fetchChangelog({
        packageName: depBumpContext.details.packageName,
        ecosystem: depBumpContext.details.ecosystem ?? "npm",
        oldVersion: depBumpContext.details.oldVersion,
        newVersion: depBumpContext.details.newVersion,
        octokit: enrichmentOctokit,
        timeoutMs: 4000,
      }),
    ]);
    depBumpContext.security = secResult.status === "fulfilled" ? secResult.value : null;
    depBumpContext.changelog = clogResult.status === "fulfilled" ? clogResult.value : null;
  } catch (err) {
    logger.warn({ ...baseLog, err }, "Dep bump enrichment failed (fail-open)");
  }
}
```

### Anti-Patterns to Avoid
- **Blocking the review on enrichment failure:** Enrichment is optional. If advisory or changelog fetch fails, the review must proceed with the base dep bump context from Phase 53.
- **Fetching changelogs for group bumps:** Group bumps have no single package to resolve. Skip enrichment for `isGroup: true`.
- **Unbounded changelog injection:** Release notes can be arbitrarily long. Always truncate to a character budget.
- **Treating advisories as "vulnerabilities detected":** Frame as "advisories exist" not "your code is vulnerable." The advisory may not affect the specific usage pattern.
- **Sequential API calls:** Advisory and changelog fetches are independent. Always run in parallel.
- **Querying advisories without ecosystem filter:** Without ecosystem, `affects=lodash@4.17.20` could match multiple ecosystems. Always include ecosystem.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub Advisory lookup | Custom CVE database scraper | `octokit.rest.securityAdvisories.listGlobalAdvisories()` | Official API, maintained by GitHub, already available in octokit |
| GitHub Releases fetching | Custom git tag scraper | `octokit.rest.repos.listReleases()` + `octokit.rest.repos.getReleaseByTag()` | Official API, paginated, handles all edge cases |
| Package-to-repo resolution for npm | npm registry client library | Native `fetch` to `registry.npmjs.org/{pkg}/latest` | Single GET request, no library needed |
| Semver range matching (advisory vulnerable ranges) | Custom range parser | Simple string comparison against `firstPatchedVersion` | Advisory API returns `firstPatchedVersion` -- compare against old/new version using existing `parseSemver` |
| HTTP request timeouts | Custom timeout wrappers | `AbortSignal.timeout(ms)` (built into Bun/Node) | Standard API, no library needed |

**Key insight:** All APIs needed are either already available through `@octokit/rest` or accessible via simple `fetch` calls. Zero new dependencies required.

## Common Pitfalls

### Pitfall 1: Ecosystem Name Mismatch
**What goes wrong:** The ecosystem names in `dep-bump-detector.ts` (Phase 53) don't match GitHub Advisory API ecosystem names exactly.
**Why it happens:** Phase 53 normalizes ecosystems to short names (`"npm"`, `"python"`, `"go"`) but the Advisory API uses specific values (`"npm"`, `"pip"`, `"go"`).
**How to avoid:** Create an explicit mapping from Phase 53 ecosystem names to Advisory API ecosystem names. The Advisory API accepts: `rubygems`, `npm`, `pip`, `maven`, `nuget`, `composer`, `go`, `rust`, `erlang`, `actions`, `pub`, `swift`, `other`.
**Warning signs:** Queries returning zero results for Python packages because ecosystem was sent as `"python"` instead of `"pip"`.
**Mapping needed:**
```typescript
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
```

### Pitfall 2: Rate Limiting on GitHub API
**What goes wrong:** Advisory and release API calls count against the installation's rate limit (5000 req/hour for GitHub Apps).
**Why it happens:** Each dep bump PR triggers 2-4 additional API calls (advisory query, repo resolution, release list, possibly changelog file fetch).
**How to avoid:** Accept the cost -- 2-4 extra calls per dep bump PR is negligible. But add rate limit header logging so we can monitor. Do NOT add caching in V1 (premature optimization).
**Warning signs:** 403 responses with `X-RateLimit-Remaining: 0` in logs.

### Pitfall 3: Changelog Data Quality (30-50% Failure Rate)
**What goes wrong:** Many packages have no GitHub Releases, no CHANGELOG.md, or the CHANGELOG.md format is unparseable.
**Why it happens:** Not all maintainers publish GitHub Releases. Many use different changelog formats or don't maintain changelogs at all.
**How to avoid:** Design the three-tier fallback cascade: (1) GitHub Releases, (2) CHANGELOG.md file, (3) compare URL only. Always generate the compare URL as a guaranteed fallback. Frame the compare URL as "View full diff" link for the reviewer.
**Warning signs:** Tests only cover the happy path where Releases exist.

### Pitfall 4: Advisory False Positives
**What goes wrong:** An advisory exists for the package ecosystem but the specific version range doesn't actually affect the old/new versions in this bump.
**Why it happens:** The `affects=pkg@version` parameter returns advisories where the version is in the vulnerable range, but version range matching on the API side can be imprecise for some ecosystems.
**How to avoid:** After fetching advisories, validate that `vulnerableVersionRange` actually contains the queried version using the `firstPatchedVersion` field. Frame advisory data as informational ("advisories exist for this package") not definitive ("your code is vulnerable").
**Warning signs:** Security-motivated bump classification triggers on packages where the advisory doesn't actually affect the old version.

### Pitfall 5: Release Tag Format Variability
**What goes wrong:** Trying to fetch a release by tag `v1.2.3` when the repo uses `1.2.3`, or vice versa.
**Why it happens:** No universal convention. Some repos use `v` prefix, some don't, some use `package@version` (monorepo style).
**How to avoid:** Try `getReleaseByTag` with `v{version}` first, then `{version}` as fallback. For monorepos, also try `{packageName}@{version}` and `{packageName}/v{version}`.
**Warning signs:** Tests only cover `v`-prefixed tags.

### Pitfall 6: Oversized Release Bodies
**What goes wrong:** A single release body can be 10KB+ of markdown (especially for major releases with migration guides).
**Why it happens:** Maintainers put extensive documentation in release notes.
**How to avoid:** Truncate individual release bodies to ~500 chars. Limit total changelog injection to ~1500 chars. Extract only breaking change sections when possible.
**Warning signs:** Review prompts suddenly hitting token limits for dep bump PRs with major version changes.

## Code Examples

### Fetching GitHub Advisories
```typescript
// Using octokit.rest.securityAdvisories.listGlobalAdvisories()
async function queryAdvisories(
  octokit: Octokit,
  packageName: string,
  ecosystem: string, // must be advisory API ecosystem name
  version: string,
): Promise<AdvisoryInfo[]> {
  const { data } = await octokit.rest.securityAdvisories.listGlobalAdvisories({
    ecosystem: ecosystem as any,
    affects: `${packageName}@${version}`,
    per_page: 10,
  });

  return data
    .filter((adv) => adv.type === "reviewed")
    .map((adv) => {
      const vuln = adv.vulnerabilities?.find(
        (v) => v.package?.name === packageName && v.package?.ecosystem === ecosystem,
      );
      return {
        ghsaId: adv.ghsa_id,
        cveId: adv.cve_id ?? null,
        severity: (adv.severity as AdvisoryInfo["severity"]) ?? "unknown",
        summary: adv.summary ?? "",
        vulnerableVersionRange: vuln?.vulnerable_version_range ?? "",
        firstPatchedVersion: vuln?.first_patched_version?.identifier ?? null,
        url: adv.html_url ?? `https://github.com/advisories/${adv.ghsa_id}`,
      };
    });
}
```

### Determining Security-Motivated Bump
```typescript
function isSecurityMotivated(
  advisoriesForOld: AdvisoryInfo[],
  advisoriesForNew: AdvisoryInfo[],
): boolean {
  // Security-motivated: old version has advisory AND new version does NOT
  // (meaning the bump patches the vulnerability)
  if (advisoriesForOld.length === 0) return false;

  // If new version still has the same advisories, it's not a security fix
  const oldGhsaIds = new Set(advisoriesForOld.map((a) => a.ghsaId));
  const newGhsaIds = new Set(advisoriesForNew.map((a) => a.ghsaId));

  // At least one advisory in old is NOT in new = old vuln was patched
  return advisoriesForOld.some((a) => !newGhsaIds.has(a.ghsaId));
}
```

### Fetching Releases Between Versions
```typescript
async function fetchReleasesBetween(
  octokit: Octokit,
  owner: string,
  repo: string,
  oldVersion: string,
  newVersion: string,
): Promise<Array<{ tag: string; body: string }>> {
  // List releases (most recent first, paginated)
  const releases: Array<{ tag: string; body: string }> = [];
  const oldSemver = parseSemver(oldVersion);
  const newSemver = parseSemver(newVersion);
  if (!oldSemver || !newSemver) return [];

  // Fetch up to 2 pages (60 releases) -- should cover most version ranges
  for (let page = 1; page <= 2; page++) {
    const { data } = await octokit.rest.repos.listReleases({
      owner,
      repo,
      per_page: 30,
      page,
    });
    if (data.length === 0) break;

    for (const release of data) {
      if (release.draft || !release.tag_name) continue;
      const tagVersion = release.tag_name.replace(/^v/i, "");
      const tagSemver = parseSemver(tagVersion);
      if (!tagSemver) continue;

      // Include releases where old < tag <= new
      if (isGreaterThan(tagSemver, oldSemver) && !isGreaterThan(tagSemver, newSemver)) {
        releases.push({
          tag: release.tag_name,
          body: release.body ?? "",
        });
      }
    }
  }

  return releases;
}
```

### Resolving npm Package to GitHub Repo
```typescript
async function resolveNpmRepo(packageName: string): Promise<RepoCoords | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) return null;

  const data = await resp.json() as { repository?: { url?: string } };
  const repoUrl = data?.repository?.url;
  if (!repoUrl) return null;

  // "git+https://github.com/owner/repo.git" -> { owner, repo }
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}
```

### Breaking Change Detection from Changelog
```typescript
const BREAKING_MARKERS = [
  /BREAKING CHANGE[S]?:/i,
  /\b(?:BREAKING|INCOMPATIBLE)\b/i,
  /^#+\s*Breaking/im,
  /\*\*Breaking\*\*/i,
];

function extractBreakingChanges(releaseNotes: Array<{ body: string }>): string[] {
  const breaking: string[] = [];
  for (const note of releaseNotes) {
    for (const marker of BREAKING_MARKERS) {
      const match = note.body.match(marker);
      if (match) {
        // Extract the line containing the marker + next 2 lines for context
        const idx = note.body.indexOf(match[0]);
        const snippet = note.body.slice(idx, idx + 200).split("\n").slice(0, 3).join("\n");
        breaking.push(snippet.trim());
      }
    }
  }
  return breaking;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No security awareness for dep bumps | Phase 54 adds advisory lookup | New (this phase) | Reviewers see CVE/advisory context inline |
| No changelog context for dep bumps | Phase 54 adds changelog fetching | New (this phase) | Reviewers see what changed between versions |
| Phase 53 dep bump section is static | Phase 54 enriches with dynamic API data | New (this phase) | Prompt includes security + changelog data |
| GitHub Advisory API `affects` param | Supports `package@version` format | Available since 2023 | Simplifies version-specific advisory lookup |

**Deprecated/outdated:**
- None. All APIs used are current and stable.

## Open Questions

1. **Should enrichment run for group bumps?**
   - What we know: Group bumps have `isGroup: true` and no single `packageName`. Cannot query advisories or changelog for a group.
   - What's unclear: Should we attempt enrichment for the first/primary package in a group? Or skip entirely?
   - Recommendation: Skip enrichment for group bumps in V1. The compare URL (if available) is the only useful output, but we don't have a single package to resolve.

2. **Advisory query: old version, new version, or both?**
   - What we know: SEC-01 says "query for known CVEs affecting old or new versions." SEC-03 says "distinguish security-motivated bumps."
   - What's unclear: Querying both old and new versions doubles the API calls.
   - Recommendation: Query both. Two API calls (one for old, one for new) are acceptable. Security-motivated = old has advisories that new does not.

3. **Should we cache advisory/changelog results?**
   - What we know: The same package version pair might appear in multiple PRs across different repos.
   - What's unclear: How often does the same package+version pair appear across installations?
   - Recommendation: No caching in V1. Dep bump PRs are infrequent per installation. Premature optimization.

4. **How to handle monorepo-style packages (e.g., `@angular/core`)?**
   - What we know: Scoped npm packages resolve fine via `registry.npmjs.org/@scope/package/latest`. GitHub releases may use `package@version` tag format.
   - What's unclear: Do all scoped packages have the repository field pointing to the monorepo?
   - Recommendation: Handle scoped packages in repo resolution. For release tag lookup, try multiple tag formats (`v{version}`, `{version}`, `{packageName}@{version}`).

5. **PyPI / RubyGems / other ecosystem repo resolution**
   - What we know: npm repo resolution is straightforward (registry has `repository.url`). PyPI has `project_urls` dict. RubyGems has `source_code_uri`.
   - What's unclear: What percentage of each ecosystem's packages have GitHub repo metadata?
   - Recommendation: Implement npm + pypi + rubygems resolution in V1. Other ecosystems fall back to advisory-only (no changelog) since repo resolution is harder.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/lib/dep-bump-detector.ts` -- Phase 53 types, pipeline, ecosystem maps
- Codebase analysis: `src/execution/review-prompt.ts` -- `buildDepBumpSection`, `buildReviewPrompt` context type
- Codebase analysis: `src/handlers/review.ts` -- dep bump wiring, octokit availability, fail-open pattern
- Codebase analysis: `src/auth/github-app.ts` -- `@octokit/rest` usage, installation auth pattern
- [GitHub Global Advisories REST API](https://docs.github.com/en/rest/security-advisories/global-advisories) -- `GET /advisories` with `affects` and `ecosystem` params
- [GitHub Releases REST API](https://docs.github.com/en/rest/releases/releases) -- `listReleases`, `getReleaseByTag`, `generateReleaseNotes`
- [Octokit REST.js v22 API reference](https://octokit.github.io/rest.js/v22/) -- `securityAdvisories.listGlobalAdvisories()`, `repos.listReleases()`

### Secondary (MEDIUM confidence)
- [OSV API documentation](https://google.github.io/osv.dev/api/) -- POST /v1/query for vulnerability lookup by package+version
- [npm registry API](https://registry.npmjs.org) -- `/{package}/latest` returns `repository.url` field
- [PyPI JSON API](https://docs.pypi.org/api/json/) -- `https://pypi.org/pypi/{package}/json` returns `info.project_urls`

### Tertiary (LOW confidence)
- Changelog data quality estimate (30-50% failure rate) -- from project state known concerns; not independently verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs verified against official docs; `@octokit/rest` v22 confirmed to have `securityAdvisories` methods
- Architecture: HIGH - Follows established codebase patterns (fail-open enrichment, `DepBumpContext` extension, prompt section injection)
- Pitfalls: HIGH - Ecosystem mapping, rate limits, tag format variability, and changelog quality issues are well-documented and verified
- Advisory API: HIGH - `affects=pkg@version` parameter verified in official GitHub docs
- Changelog resolution: MEDIUM - npm registry approach verified; other ecosystems less certain

**Research date:** 2026-02-14
**Valid until:** 2026-03-16 (stable APIs, patterns unlikely to change)
