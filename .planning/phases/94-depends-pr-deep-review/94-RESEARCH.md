# Phase 94: [depends] PR Deep Review - Research

**Researched:** 2026-02-25
**Domain:** PR detection routing, upstream changelog fetching, C/C++ dependency impact analysis, structured review comment generation
**Confidence:** HIGH

## Summary

Phase 94 adds a specialized deep-review pipeline for Kodi-convention dependency bump PRs. The existing codebase already has a robust Dependabot/Renovate detection pipeline (`src/lib/dep-bump-detector.ts`) with three stages and enrichment (`src/lib/dep-bump-enrichment.ts`). The new `[depends]` detector must run **before** the existing Dependabot detector to ensure mutual exclusivity, matching title patterns like `[depends] Bump zlib 1.3.2`, `[Windows] Refresh fstrcmp 0.7`, `[depends][target] Bump font libraries`, and `[Depends] Bump mariadb-c-connector 3.4.8`.

The key differences from the existing Dependabot pipeline: (1) detection is title-only (no two-signal requirement -- these are human-authored PRs from known contributors, not bots), (2) enrichment must handle C/C++ libraries that lack npm/PyPI registries (upstream GitHub repos resolved from PR body URLs or well-known mappings), (3) impact assessment traces `#include` directives and cmake `Find*.cmake` modules rather than lockfile diffs, and (4) the review comment is a structured deep-review posted directly by Kodiai (not prompt context for Claude -- this replaces the standard code review for pure dependency bumps).

**Primary recommendation:** Build a `detectDependsBump()` function as a new first-priority detector in the review handler. When matched, skip the standard review pipeline entirely and instead run a deterministic deep-review pipeline that fetches upstream changelogs, analyzes impact via `#include`/cmake tracing, verifies hashes, and posts a structured comment. The standard code review should only fire if the PR also touches source files beyond `tools/depends/`, `cmake/modules/`, and `project/BuildDependencies/`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Title-only detection -- no file path analysis
- Broad matching: `[depends] Bump X Y.Z`, `[Platform] Refresh X Y.Z`, plus variations like "Update X to Y.Z", "Upgrade X"
- [depends] detector runs first in the pipeline; if matched, Dependabot path is skipped entirely
- Standard code review is conditional: only post it if the PR contains code changes beyond the dependency bump itself (e.g., source file modifications, not just cmake/build config)
- Technical and concise tone -- assumes experienced C/C++ maintainers
- TL;DR verdict first (safe/risky/needs-attention), then expand into sections: version diff, changelog highlights, impact assessment, inline suggestions
- Inline suggestions woven into relevant sections rather than a separate action-item checklist
- Top-level summary comment on the PR, plus inline review comments on specific files where findings are relevant (e.g., hash mismatches on cmake files)
- Fetch from GitHub releases API first, fall back to scraping project websites / NEWS files
- Filter to Kodi-relevant entries only: breaking changes, API changes, security fixes, build system changes -- skip internal refactors
- When changelog unavailable: note it, fall back to analyzing the PR diff for clues, and provide upstream project URL for manual review
- Version detection: parse from PR title first (e.g., "Bump zlib 1.3.1 -> 1.3.2"), fall back to diff analysis of cmake/build config if title doesn't contain both versions
- Find direct consumers via #include directives and cmake target_link_libraries, then trace one level of transitive includes
- Hash/URL verification: fetch upstream release, compute hash, compare to PR values -- flag mismatches, confirm matches, note when verification isn't possible
- Surface relevant retrieval context: query learning memories and wiki for past reviews/issues about this dependency (leveraging Phase 93's language-aware retrieval)

### Claude's Discretion
- Transitive dependency checking depth -- determine feasibility based on Kodi's cmake-based dependency structure during research
- Exact degradation messaging and formatting
- How to handle multi-dependency bumps in a single PR

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEPS-01 | Kodiai detects `[depends]` prefix and dependency-bump patterns in PR titles automatically | New `detectDependsBump()` function with regex patterns matching real xbmc/xbmc PR titles; runs before `detectDepBump()` in review handler |
| DEPS-02 | Detection is mutually exclusive with existing Dependabot/Renovate pipeline -- a PR triggers one path, not both | Sequential detection: `detectDependsBump()` first; if matched, skip `detectDepBump()` entirely; existing two-signal Dependabot detector unchanged |
| DEPS-03 | Kodiai fetches upstream changelog / release notes for the new dependency version | Adapted `fetchChangelog()` with C/C++ library support: GitHub Releases API, then CHANGELOG/NEWS file, then compare URL; repo resolution via PR body URLs or known lib-to-repo map |
| DEPS-04 | Kodiai analyzes what changed between old and new version -- breaking changes, deprecations, new APIs | Parse VERSION file diffs for old/new versions; filter changelog entries to Kodi-relevant categories; reuse `extractBreakingChanges()` with expanded markers |
| DEPS-05 | Kodiai assesses impact on the Kodi codebase -- which files consume this dependency and how | cmake `Find*.cmake` modules map library names to targets; `#include` grep finds consumers; one-level transitive trace via included headers |
| DEPS-06 | Kodiai verifies hash/URL changes, checks for removed/added patches, and validates build config changes | Parse VERSION file diffs for SHA512/URL changes; fetch upstream tarball hash; compare; detect patch add/remove from PR diff |
| DEPS-07 | Kodiai checks if the bump introduces new transitive dependencies or version conflicts | Parse cmake `Find*.cmake` for `find_dependency()` calls; compare old/new cmake config for new `DEPENDS` entries; flag when detected |
| DEPS-08 | Kodiai surfaces a structured review comment with version diff summary, changelog highlights relevant to Kodi, impact assessment, and action items | Deterministic comment builder producing structured markdown with TL;DR verdict, version diff, changelog, impact, hash verification, and inline comments |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Octokit | existing | GitHub API (releases, file content, PR comments, review comments) | Already used throughout codebase |
| node:crypto | built-in | SHA512 hash computation for tarball verification | Bun-native, zero deps |
| Bun shell (`$`) | built-in | `git grep` for `#include` tracing in workspace | Already used in `usage-analyzer.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| existing `parseSemver()` | n/a | Version parsing from title/VERSION files | Reuse from `dep-bump-detector.ts` |
| existing `fetchChangelog()` patterns | n/a | Release notes fetching | Adapt for C/C++ libs without registry resolution |
| existing `createRetriever()` | n/a | Past dependency context from learning memories/wiki | Surface historical context about this dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SHA512 verification via fetch+hash | Trust PR values only | Verification catches supply-chain issues but adds latency; fetch with timeout is worth it |
| `git grep` for `#include` tracing | AST parsing | `git grep` is fast and sufficient for `#include` patterns; AST parsing is overkill for this use case |

**Installation:** No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── depends-bump-detector.ts      # NEW: [depends] title detection + extraction
│   ├── depends-bump-enrichment.ts    # NEW: Changelog, hash verification, impact analysis
│   ├── depends-review-builder.ts     # NEW: Structured comment builder
│   ├── dep-bump-detector.ts          # EXISTING: Dependabot/Renovate detection (unchanged)
│   ├── dep-bump-enrichment.ts        # EXISTING: npm/PyPI enrichment (unchanged)
│   └── usage-analyzer.ts             # EXISTING: workspace grep (reusable pattern)
├── handlers/
│   └── review.ts                     # MODIFIED: Insert depends detection before Dependabot detection
└── execution/
    └── review-prompt.ts              # MODIFIED: Add depends deep-review comment template
```

### Pattern 1: Sequential Mutual-Exclusion Detection
**What:** `detectDependsBump()` runs before `detectDepBump()`. If the first matches, the second is skipped entirely.
**When to use:** When two detection paths must be strictly mutually exclusive.
**Example:**
```typescript
// In review handler, before existing dep bump detection:
let dependsBumpContext: DependsBumpContext | null = null;
try {
  dependsBumpContext = detectDependsBump({ prTitle: pr.title });
} catch (err) {
  logger.warn({ err }, "Depends bump detection failed (fail-open)");
}

// Only run Dependabot detection if depends detection did NOT match
if (!dependsBumpContext) {
  // existing detectDepBump() code unchanged
}
```

### Pattern 2: Kodi VERSION File Parsing
**What:** Extract version, URL, hash from `*-VERSION` files in `tools/depends/target/` diffs.
**When to use:** When PR title lacks old version or when verifying hash/URL changes.
**Example:**
```typescript
// VERSION files follow this format (from real xbmc/xbmc data):
// LIBNAME=zlib
// VERSION=1.3.2
// ARCHIVE=$(LIBNAME)-$(VERSION).tar.xz
// SHA512=cf3d49fbabddc57cca...

type VersionFileData = {
  libName: string;
  version: string;
  archivePattern: string;
  sha512: string;
};

function parseVersionFile(content: string): VersionFileData | null {
  const lines = content.split('\n');
  const vars: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^(\w+)=(.+)$/);
    if (match) vars[match[1]!] = match[2]!;
  }
  // Expand $(VAR) references
  // ...
}
```

### Pattern 3: VERSION File Diff Extraction
**What:** Parse unified diff of VERSION files to extract old and new values.
**When to use:** When the PR diff contains changes to `*-VERSION` files.
**Example:**
```typescript
// From the zlib PR diff:
// -VERSION=1.3.1
// +VERSION=1.3.2
// -SHA512=1e8e70b362d64a233...
// +SHA512=cf3d49fbabddc57cca...

function extractVersionDiff(patch: string): {
  oldVersion: string | null;
  newVersion: string | null;
  oldHash: string | null;
  newHash: string | null;
} {
  // Parse unified diff lines for - and + prefixed VERSION= and SHA512= lines
}
```

### Pattern 4: Direct Comment Posting (Not Claude Execution)
**What:** The deep review comment is built deterministically and posted via Octokit, NOT by invoking Claude.
**When to use:** For the dependency deep-review pipeline where the comment structure is fully deterministic.
**Why:** The review content (version diff, changelog, hash verification) is factual data that doesn't need LLM reasoning. Deterministic posting is faster, cheaper, and more reliable.
**Important:** If the PR also contains source code changes beyond build config, the standard Claude review runs IN ADDITION to the deterministic deep-review comment.

### Pattern 5: Upstream Repo Resolution for C/C++ Libraries
**What:** Map Kodi dependency names to upstream GitHub repos without a package registry.
**When to use:** When fetching changelogs for C/C++ libraries.
**Example:**
```typescript
// Three-tier resolution:
// 1. Extract GitHub URL from PR body (common in xbmc/xbmc PRs)
// 2. Known library-to-repo map (maintained in code):
const KODI_LIB_REPO_MAP: Record<string, { owner: string; repo: string }> = {
  zlib: { owner: "madler", repo: "zlib" },
  openssl: { owner: "openssl", repo: "openssl" },
  ffmpeg: { owner: "FFmpeg", repo: "FFmpeg" },
  harfbuzz: { owner: "harfbuzz", repo: "harfbuzz" },
  freetype: { owner: "freetype", repo: "freetype" },
  // ... ~50 entries covering tools/depends/target/*
};
// 3. GitHub search API fallback (rate-limited, use sparingly)
```

### Anti-Patterns to Avoid
- **Running Claude for deterministic data:** The deep-review comment contains factual data (version diffs, hashes, changelogs). Don't invoke the LLM for this -- deterministic template is faster and more reliable.
- **Modifying existing Dependabot detection:** The `detectDepBump()` function and its two-signal requirement are battle-tested. Don't change it. Add the new detector BEFORE it in the pipeline.
- **Deep file path analysis for detection:** User decision: title-only detection. Don't scan changed files to decide if this is a `[depends]` PR.
- **Blocking on changelog fetch failure:** Fail gracefully with a note. The review should always post, even if changelog is unavailable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Semver parsing | Custom parser | Existing `parseSemver()` from `dep-bump-detector.ts` | Already handles v-prefix, pre-release, edge cases |
| GitHub Releases API | Raw fetch | `octokit.rest.repos.listReleases()` | Pagination, auth, rate limiting handled |
| SHA512 computation | Custom hash | `node:crypto` `createHash('sha512')` | Standard, well-tested |
| Workspace file search | Custom file walker | `git grep` via Bun shell `$` | Already proven in `usage-analyzer.ts`, fast on large repos |
| Structured markdown output | String concatenation | Template builder pattern (like `buildDepBumpSection()`) | Existing pattern in `review-prompt.ts`, maintainable |

**Key insight:** Most of the infrastructure exists. The existing `dep-bump-enrichment.ts` handles changelog fetching for npm/PyPI libraries. The new code needs to handle C/C++ libraries (no registry) and produce a different output format (structured PR comment vs. prompt context).

## Common Pitfalls

### Pitfall 1: Title Pattern Overlap with Dependabot
**What goes wrong:** A Dependabot PR with "Update dependency X" title could match the `[depends]` detector if patterns are too broad.
**Why it happens:** Both "Update" and "Bump" appear in both Kodi convention and Dependabot titles.
**How to avoid:** The `[depends]` detector requires a bracketed prefix like `[depends]`, `[Windows]`, `[depends][target]`, `[Depends]`. Dependabot titles never have bracketed prefixes. The pattern `^\[` anchor prevents overlap.
**Warning signs:** A Dependabot PR triggers the deep review instead of the standard dep bump pipeline.

### Pitfall 2: VERSION File Variable Expansion
**What goes wrong:** VERSION files use Makefile-style variable expansion: `ARCHIVE=$(LIBNAME)-$(VERSION).tar.xz`. Naive parsing misses the expanded values.
**Why it happens:** These aren't simple key-value files; they reference other variables.
**How to avoid:** Implement single-pass variable expansion (variables are defined before use in these files). Expand `$(VAR)` references after collecting all raw values.
**Warning signs:** Archive URL or hash comparison fails because the template wasn't expanded.

### Pitfall 3: Windows vs Linux Dependency Paths
**What goes wrong:** Windows dependency bumps (`[Windows] Refresh fstrcmp 0.7`) change files in `project/BuildDependencies/scripts/` (list files with package filenames), while Linux dependency bumps change files in `tools/depends/target/`. The impact analysis and hash verification differ by platform.
**Why it happens:** Kodi uses two separate build systems for dependencies: autotools/cmake for Linux/macOS/Android (in `tools/depends/`) and pre-built binaries for Windows (in `project/BuildDependencies/`).
**How to avoid:** Detect which platform path the PR modifies and adjust analysis accordingly. Windows bumps use `.list` files with package archive names (no hashes); Linux bumps use VERSION files with SHA512 hashes.
**Warning signs:** Hash verification claims "no hash found" for a legitimate dependency bump.

### Pitfall 4: Multi-Dependency Bumps
**What goes wrong:** PRs like `[depends] Bump openssl to 3.0.19 / python3 to 3.14.3` contain multiple dependencies. Single-package logic misses the second dependency.
**Why it happens:** Kodi maintainers sometimes bundle related dependency updates.
**How to avoid:** Parse title for multiple `name version` pairs separated by `/` or `,`. Run enrichment for each dependency independently. Structure the review comment with sections per dependency.
**Warning signs:** Review comment only mentions the first dependency in a multi-bump PR.

### Pitfall 5: Changelog Fetch Rate Limits
**What goes wrong:** Fetching releases from upstream GitHub repos (e.g., `madler/zlib`, `openssl/openssl`) uses the GitHub API, which shares rate limits with the Kodi installation token.
**Why it happens:** The installation token's rate limit is shared across all API calls for that installation.
**How to avoid:** Use the same octokit instance (installation token) for upstream repo reads. Set aggressive timeouts (3-4 seconds). Cache results if the same dependency is bumped in multiple PRs. Degrade gracefully on rate limit with a note.
**Warning signs:** Changelog section says "unavailable" when the upstream repo has releases.

### Pitfall 6: Stale Library-to-Repo Map
**What goes wrong:** The hardcoded map of Kodi library names to upstream GitHub repos becomes outdated as Kodi adds new dependencies.
**Why it happens:** New dependencies are added to `tools/depends/target/` without updating Kodiai's map.
**How to avoid:** Make the map a best-effort lookup, not a hard requirement. Fall back to PR body URL extraction and GitHub search. Log when a library isn't in the map so it can be added later.
**Warning signs:** "Upstream repo unknown" for a well-known library that was recently added to Kodi.

## Code Examples

### Title Detection Regex Patterns
```typescript
// From real xbmc/xbmc PR titles (verified via GitHub API search):
//
// "[depends] Bump zlib 1.3.2"
// "[depends] Bump TagLib to 2.2"
// "[depends][target] Bump libcdio to 2.3.0"
// "[depends] Bump openssl to 3.0.19 / python3 to 3.14.3"
// "[Depends] Bump mariadb-c-connector 3.4.8"
// "[Windows] Refresh fstrcmp 0.7"
// "[Windows] Refresh tinyxml 2.6.2"
// "[Windows] Bump libaacs to 0.11.1"
// "[Windows] Bump Detours to 9764ceb"
// "[Windows] Bump Python to 3.14.3 / OpenSSL to 3.0.19"
// "[depends][target] Bump font libraries"
// "target/depends: Update libxkbcommon to v1.13.1"
// "[Depends] Update Harfbuzz to v12.3.0"
// "[Windows] Bump dnssd to 2881.60.4"

// Detection pattern: requires bracketed prefix OR "target/depends:" prefix
const DEPENDS_TITLE_RE = /^\[(?:depends|windows|android|ios|osx|linux)[^\]]*\]/i;
const TARGET_DEPENDS_PREFIX_RE = /^(?:target\/depends|tools\/depends):\s/i;

// Extraction pattern: library name + optional version
const DEPENDS_EXTRACT_RE =
  /(?:bump|refresh|update|upgrade)\s+(.+?)(?:\s+(?:to\s+)?v?([\d][\w.-]*))?$/i;
```

### VERSION File Diff Parsing
```typescript
// Parse unified diff to extract old/new VERSION and SHA512 values
function parseVersionFileDiff(patch: string): {
  oldVersion: string | null;
  newVersion: string | null;
  oldSha512: string | null;
  newSha512: string | null;
  oldArchive: string | null;
  newArchive: string | null;
} {
  const result = {
    oldVersion: null as string | null,
    newVersion: null as string | null,
    oldSha512: null as string | null,
    newSha512: null as string | null,
    oldArchive: null as string | null,
    newArchive: null as string | null,
  };

  for (const line of patch.split('\n')) {
    const stripped = line.slice(1).trim(); // Remove +/- prefix
    if (line.startsWith('-') && !line.startsWith('---')) {
      if (stripped.startsWith('VERSION=')) result.oldVersion = stripped.split('=')[1]!;
      if (stripped.startsWith('SHA512=')) result.oldSha512 = stripped.split('=')[1]!;
      if (stripped.startsWith('ARCHIVE=')) result.oldArchive = stripped.split('=')[1]!;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (stripped.startsWith('VERSION=')) result.newVersion = stripped.split('=')[1]!;
      if (stripped.startsWith('SHA512=')) result.newSha512 = stripped.split('=')[1]!;
      if (stripped.startsWith('ARCHIVE=')) result.newArchive = stripped.split('=')[1]!;
    }
  }
  return result;
}
```

### Impact Assessment via Include Tracing
```typescript
// Find files that #include headers from a given library
// Uses git grep for speed (already proven in usage-analyzer.ts)
async function findDependencyConsumers(params: {
  workspaceDir: string;
  libraryName: string;
  timeBudgetMs?: number;
}): Promise<{ filePath: string; line: number; includeDirective: string }[]> {
  const { workspaceDir, libraryName, timeBudgetMs = 3000 } = params;

  // Common header patterns for C/C++ libraries:
  // #include <zlib.h>
  // #include <openssl/ssl.h>
  // #include "libxml/parser.h"
  const patterns = [
    `#include.*<${libraryName}[/.]`,  // <zlib.h> or <openssl/...>
    `#include.*"${libraryName}[/.]`,  // "libxml/..."
  ];

  // Use git grep with timeout
  // ...
}
```

### Structured Review Comment Template
```typescript
// Deep review comment structure:
function buildDependsReviewComment(ctx: DependsReviewContext): string {
  const lines: string[] = [];

  // TL;DR verdict first
  lines.push(`## ${ctx.verdict.emoji} ${ctx.verdict.label}`);
  lines.push('');
  lines.push(ctx.verdict.summary);

  // Version diff
  lines.push('', '### Version Diff');
  lines.push(`| | Old | New |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Version | ${ctx.oldVersion ?? '?'} | ${ctx.newVersion} |`);
  if (ctx.hashVerification) {
    lines.push(`| SHA512 | ${ctx.hashVerification.status} |`);
  }

  // Changelog highlights (filtered to Kodi-relevant)
  if (ctx.changelog) {
    lines.push('', '### Changelog Highlights');
    // ...
  }

  // Impact assessment
  lines.push('', '### Impact Assessment');
  lines.push(`**Consumers:** ${ctx.consumers.length} file(s) include this library`);
  // ...

  return lines.join('\n');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dependabot-only detection (2-signal) | Phase 94: `[depends]` first, then Dependabot fallback | Phase 94 | Kodi-convention PRs get deep specialized review |
| npm/PyPI registry resolution for repos | Direct library-to-repo map + PR body URL extraction | Phase 94 | C/C++ libraries without registries are now supported |
| LLM-generated review for dep bumps | Deterministic structured comment for pure dep bumps | Phase 94 | Faster, cheaper, more consistent review output |
| Prompt context injection for dep info | Standalone deep-review comment as PR comment | Phase 94 | Self-contained review without full Claude invocation |

## Transitive Dependency Analysis (Claude's Discretion)

**Research finding:** Kodi's cmake-based build system does expose transitive dependencies, but in a limited way:

1. **cmake `Find*.cmake` modules** in `cmake/modules/` declare dependencies via `find_dependency()` or `find_package()` calls. For example, `FindHarfBuzz.cmake` depends on `FindFreeType.cmake`. These relationships can be parsed statically.

2. **`tools/depends/target/*/Makefile`** files declare build-time dependencies via the `DEPS` variable, but these are build-order dependencies, not runtime linkage dependencies.

3. **Practical depth:** One level of transitive dependency checking is feasible and useful. For example, when bumping `freetype`, the reviewer should note that `harfbuzz` depends on `freetype` (circular dependency in Kodi's case -- hence `freetype2-noharfbuzz`). Going deeper than one level provides diminishing returns for the review.

**Recommendation:** Implement one-level transitive checking by parsing cmake `Find*.cmake` modules for dependency declarations. Flag when a bumped library is a dependency of another library in Kodi's build. This is the pragmatic balance between usefulness and complexity.

## Multi-Dependency Bump Handling (Claude's Discretion)

**Research finding:** Multi-dependency bumps are common in xbmc/xbmc:
- `[depends] Bump openssl to 3.0.19 / python3 to 3.14.3` (slash-separated)
- `[depends][target] Bump font libraries` (group bump, no individual names in title)
- `[Windows] Bump Python to 3.14.3 / OpenSSL to 3.0.19` (same pattern, Windows)

**Recommendation:**
1. Parse slash-separated names from title: split on `/`, extract `name version` pairs.
2. For group bumps without individual names in title (like "Bump font libraries"), extract library names from changed file paths (e.g., `tools/depends/target/freetype2/FREETYPE2-VERSION` reveals "freetype2").
3. Run enrichment for each dependency independently.
4. Structure the review comment with per-dependency sections under a shared TL;DR verdict.

## Graceful Degradation (Claude's Discretion)

**Recommendation for degradation messaging:**

| Failure | Degradation | Message |
|---------|-------------|---------|
| Changelog fetch fails | Skip changelog section | "> Changelog unavailable -- check [upstream releases](URL) manually" |
| Hash verification fails | Note instead of error | "> Hash verification could not be completed (upstream tarball unavailable)" |
| Impact analysis times out | Partial results | "> Impact analysis timed out -- results may be incomplete" |
| Upstream repo unknown | Skip enrichment | "> Upstream repository not identified -- manual review of changes recommended" |
| All enrichment fails | Minimal review | Post version diff and changed files only, with note encouraging manual review |

## Open Questions

1. **Windows `.list` file hash verification**
   - What we know: Windows dependency list files (e.g., `0_package.target-x64.list`) contain package archive names like `fstrcmp-0.7-x64-v143-20260216.7z` but no hashes.
   - What's unclear: Whether Windows dependency bumps can be hash-verified at all (pre-built binaries on Kodi mirrors).
   - Recommendation: Skip hash verification for Windows bumps. Note in the review that Windows dependencies use pre-built binaries without hash verification.

2. **Upstream tarball mirror vs. direct download**
   - What we know: Kodi uses its own mirrors for dependency tarballs. PR descriptions often mention "needs to be uploaded to mirrors."
   - What's unclear: Whether the hash in the VERSION file corresponds to the upstream tarball or the mirrored copy (should be identical).
   - Recommendation: Verify against upstream source URL. If upstream hash matches, report "verified." If not available, note it.

## Sources

### Primary (HIGH confidence)
- `src/lib/dep-bump-detector.ts` - Existing three-stage Dependabot/Renovate detection pipeline
- `src/lib/dep-bump-enrichment.ts` - Existing changelog/security advisory enrichment
- `src/handlers/review.ts` (lines 1727-1890) - Existing dep bump detection and enrichment integration in review handler
- `src/handlers/dep-bump-merge-history.ts` - Existing dep bump merge history recording
- `src/execution/review-prompt.ts` (lines 1198-1320) - Existing dep bump prompt section builder
- `src/lib/usage-analyzer.ts` - Existing workspace grep pattern for impact analysis
- GitHub API: `repos/xbmc/xbmc/pulls` - Real PR titles, bodies, files, labels verified via `gh api`

### Secondary (MEDIUM confidence)
- [xbmc/xbmc tools/depends](https://github.com/xbmc/xbmc/tree/master/tools/depends) - Kodi dependency management structure
- [xbmc/xbmc cmake/modules](https://github.com/xbmc/xbmc/tree/master/cmake/modules) - CMake Find modules for dependency linking
- Real PR data: PR #27900 (zlib 1.3.2), PR #27870 (fstrcmp 0.7), PR #27818 (openssl+python3), PR #27854 (font libraries)

### Tertiary (LOW confidence)
- Upstream library-to-repo mapping -- manually compiled from known projects; may be incomplete for less common Kodi dependencies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All infrastructure exists in the codebase, no new dependencies needed
- Architecture: HIGH - Clear insertion point in review handler, existing patterns to follow
- Pitfalls: HIGH - Real PR data from xbmc/xbmc validates title patterns and file structures
- Impact analysis: MEDIUM - `#include` grep is proven but cmake `Find*.cmake` parsing is new territory
- Library-to-repo map: MEDIUM - Covers major libraries but will need ongoing maintenance

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable domain, Kodi conventions change slowly)
