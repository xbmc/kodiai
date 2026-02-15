# Phase 42: Commit Message Keywords & PR Intent - Research

**Researched:** 2026-02-14
**Domain:** PR metadata parsing -- bracket tags, conventional commits, breaking change detection, commit message scanning
**Confidence:** HIGH (all integration points verified against codebase; no external libraries needed; all data sources confirmed in webhook payload and GitHub API)

## Summary

Phase 42 is a pure parsing and detection phase. It extracts structured intent signals from three PR metadata sources: PR title (bracket tags + conventional commit prefixes), PR body (breaking change keywords), and commit messages (keyword scanning). The output is a typed `ParsedPRIntent` object consumed by downstream phases (43+) to influence review behavior.

The codebase already has the exact integration points needed. The review handler (`handlers/review.ts`) accesses `pr.title` and `pr.body` at lines 1289-1290 and passes them to `buildReviewPrompt`. The PR webhook payload provides `pr.commits` (commit count as a number) and `commits_url` for API-based commit fetching. The `formatReviewDetailsSummary` function (line 101 of review.ts) is the extension point for transparency output. No new dependencies are needed -- this is pure TypeScript regex parsing with Zod for type safety.

The critical design challenge is the keyword format divergence from the ARCHITECTURE.md's `[kodiai:...]` prefix pattern. The CONTEXT.md decisions specify bare bracket tags (`[WIP]`, `[security-review]`, `[no-review]`, `[style-ok]`), NOT the `[kodiai:]`-prefixed format. This research follows the CONTEXT.md decisions as the locked specification.

**Primary recommendation:** Implement a single `parsePRIntent()` pure function in `src/lib/pr-intent-parser.ts` that accepts title, body, and optional commit messages array. Return a typed `ParsedPRIntent` object with all detected signals, recognized/unrecognized tags, source locations, and conventional commit type. Wire into review handler immediately after `loadRepoConfig()`, before trigger evaluation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Keyword format & detection rules
- **Case sensitivity:** Case-insensitive matching for all bracket tags (`[WIP]`, `[wip]`, `[Wip]` all match)
- **Position in title:** Bracket tags can appear anywhere in the PR title ("Fix bug [WIP]" and "[WIP] Fix bug" both work)
- **Conventional commit support:** Yes -- parse conventional commit prefixes (`feat:`, `fix:`, `docs:`) from PR title and extract type
- **Breaking change detection:** Flexible matching for variations ("breaking change", "breaking changes", "this breaks", "breaking API")

#### Signal hierarchy & conflict resolution
- **[no-review] behavior:** Hard block -- bot skips review entirely when this tag appears in PR title
- **WIP vs "ready for review" conflict:** Claude's discretion -- determine priority based on GitHub draft status and common PR workflows
- **Multiple profile keywords:** Most strict wins -- when `[strict-review]` and `[minimal-review]` both appear, choose stricter profile
- **Conventional commit type impact:** Affects review focus -- `feat:` triggers breaking change checks, `fix:` checks test coverage, `docs:` lighter review

#### Commit message parsing scope
- **Parse all commits:** Scan every commit message in the PR for keywords
- **Commit title only:** Parse first line of commit message only -- skip multi-line body parsing for footers
- **Signal aggregation:** Union strategy -- if ANY commit contains a keyword, the whole PR is flagged with that signal
- **Large PR handling:** Sample strategically for 50+ commits -- parse first 10, last 10, and every 5th commit in between

#### Transparency & user visibility
- **Display location:** Show parsed keywords in both review summary (brief) and Review Details appendix (full breakdown)
- **Detail level:** Moderate -- show what was found and where (e.g., "[WIP] in title, breaking change in commit abc123")
- **Parsing failure handling:** Log in Review Details -- show "Keyword parsing: No keywords detected" in appendix if parsing fails
- **Unrecognized keywords:** Yes, show unrecognized -- "Found [WIP], [security-review]; ignored [foobar]" helps users learn valid keywords

### Claude's Discretion

- **WIP vs "ready for review" conflict resolution:** Determine priority based on GitHub draft status and common PR workflows

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.

</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5 | Implementation language | Existing codebase language |
| Zod | ^4.3.6 | Schema validation for parsed output types | Already used for all config schemas in `execution/config.ts` |
| Bun test | built-in | Unit testing | Already used for all test files (`bun:test`) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@octokit/rest` | ^22.0.1 | GitHub API for fetching commit messages | Only when commit message parsing is needed (requires API call) |
| `picomatch` | ^4.0.2 | Glob matching (if needed for path-based keyword context) | Already in codebase, not directly needed for this phase |

### Alternatives Considered

No external parsing libraries needed. The parsing requirements are simple enough for native TypeScript regex:

| Instead of | Could Use | Why Not |
|------------|-----------|---------|
| Native regex | `conventional-commits-parser` npm | Over-engineered for our needs; we only extract the type prefix, not the full conventional commit structure. The npm package handles scope, breaking change footers, and multi-line parsing -- all out of scope per CONTEXT.md decisions. Zero new dependencies is preferred. |
| Native regex | `@conventional-commits/parser` | Same reason. Also, this package parses individual commit messages, not PR titles that may loosely follow the convention. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   ├── pr-intent-parser.ts        # NEW: Pure parsing function
│   └── pr-intent-parser.test.ts   # NEW: Unit tests
├── handlers/
│   └── review.ts                  # MODIFIED: Wire parser into pipeline
└── (existing files unchanged)
```

### Pattern 1: Pure Function Parser with Typed Output

**What:** A single exported function that accepts PR metadata strings and returns a fully typed result. Zero side effects, zero API calls (commit fetching is the caller's responsibility).

**When to use:** All keyword parsing -- the function is called by the review handler after loading repo config.

**Why:** Follows the established "Pure Function Enrichment" pattern (ARCHITECTURE.md Pattern 1). Every new v0.8 module is a pure function. Trivially testable without mocking.

**Example:**
```typescript
// Source: Codebase pattern from ARCHITECTURE.md

export type BracketTag = {
  tag: string;           // e.g., "WIP", "no-review", "security-review"
  recognized: boolean;   // true if it maps to a known behavior
  source: "title" | "body" | "commit";
  commitSha?: string;    // if source is "commit", which commit
};

export type ConventionalCommitType = {
  type: string;          // e.g., "feat", "fix", "docs"
  isBreaking: boolean;   // feat!: or fix!: prefix
  source: "title" | "commit";
};

export type ParsedPRIntent = {
  bracketTags: BracketTag[];
  conventionalType: ConventionalCommitType | null;
  breakingChangeDetected: boolean;
  breakingChangeSources: Array<{ source: "title" | "body" | "commit"; excerpt: string; commitSha?: string }>;
  noReview: boolean;        // convenience: [no-review] detected
  isWIP: boolean;           // convenience: [WIP] or [Draft] detected
  profileOverride: "strict" | "balanced" | "minimal" | null;
  focusAreas: string[];     // e.g., ["security"] from [security-review]
  styleOk: boolean;         // convenience: [style-ok] detected
  recognized: string[];     // all recognized tag names
  unrecognized: string[];   // all unrecognized tag names
};

export function parsePRIntent(
  title: string,
  body: string | null,
  commitMessages?: Array<{ sha: string; message: string }>,
): ParsedPRIntent;
```

### Pattern 2: Fail-Open Integration in Review Handler

**What:** The parser is called inside a try/catch block. On failure, the review continues with an empty/default `ParsedPRIntent`. The failure is logged and included in Review Details.

**When to use:** Always -- this is the established pattern for all enrichments in the review handler.

**Why:** Follows ARCHITECTURE.md Pattern 2 (Fail-Open Enrichment). No v0.8 feature should crash the review pipeline.

**Example:**
```typescript
// Source: Established pattern in handlers/review.ts (see incremental diff, retrieval context, enforcement)

let parsedIntent: ParsedPRIntent = DEFAULT_EMPTY_INTENT;
try {
  // Fetch commit messages only if needed (pr.commits > 0)
  const commitMessages = await fetchCommitMessages(octokit, apiOwner, apiRepo, pr.number, pr.commits);
  parsedIntent = parsePRIntent(pr.title, pr.body ?? null, commitMessages);
  logger.info(
    { ...baseLog, gate: "keyword-parse", recognized: parsedIntent.recognized, unrecognized: parsedIntent.unrecognized },
    "PR intent keywords parsed",
  );
} catch (err) {
  logger.warn({ ...baseLog, err }, "PR intent parsing failed (fail-open, proceeding without keywords)");
}

// Hard block: [no-review] skips review entirely
if (parsedIntent.noReview) {
  logger.info({ ...baseLog, gate: "keyword-skip", gateResult: "skipped" }, "Review skipped via [no-review] keyword");
  // Post acknowledgment comment (KEY-06 transparency)
  return;
}
```

### Pattern 3: Section Builder for Review Details

**What:** A standalone function that renders the parsed intent into a markdown section for the Review Details appendix.

**When to use:** Every review -- even when no keywords are found ("Keyword parsing: No keywords detected").

**Why:** Follows ARCHITECTURE.md Pattern 3 (Section Builder Composition). Each prompt/output concern is an independently testable function.

**Example:**
```typescript
export function buildKeywordParsingSection(intent: ParsedPRIntent): string {
  const lines: string[] = [];

  if (intent.recognized.length === 0 && intent.unrecognized.length === 0 && !intent.conventionalType && !intent.breakingChangeDetected) {
    return "- Keyword parsing: No keywords detected";
  }

  if (intent.recognized.length > 0) {
    lines.push(`- Keywords detected: ${intent.recognized.map(t => `[${t}]`).join(", ")}`);
  }
  if (intent.unrecognized.length > 0) {
    lines.push(`- Unrecognized tags: ${intent.unrecognized.map(t => `[${t}]`).join(", ")}`);
  }
  if (intent.conventionalType) {
    lines.push(`- Conventional commit: ${intent.conventionalType.type}${intent.conventionalType.isBreaking ? "!" : ""}`);
  }
  if (intent.breakingChangeDetected) {
    const sources = intent.breakingChangeSources.map(s => s.source).join(", ");
    lines.push(`- Breaking change detected (in ${sources})`);
  }

  return lines.join("\n");
}
```

### Pattern 4: Commit Message Fetching (API Caller Responsibility)

**What:** Commit message fetching is separated from parsing. A helper function fetches commits via octokit, with strategic sampling for large PRs (50+ commits). The parser accepts the fetched messages as an optional parameter.

**When to use:** In the review handler, between loadRepoConfig and parsePRIntent.

**Why:** Separation of concerns. The parser remains pure and testable. The fetcher handles pagination, sampling, and API errors independently.

**Example:**
```typescript
export async function fetchCommitMessages(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  commitCount: number,
): Promise<Array<{ sha: string; message: string }>> {
  // GitHub API limit: max 250 commits per PR via this endpoint
  // CONTEXT.md decision: for 50+ commits, sample strategically
  if (commitCount === 0) return [];

  const perPage = Math.min(commitCount, 100);
  const { data } = await octokit.rest.pulls.listCommits({
    owner,
    repo,
    pull_number: prNumber,
    per_page: perPage,
  });

  let commits = data.map(c => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split("\n")[0], // First line only (CONTEXT.md decision)
  }));

  // Strategic sampling for 50+ commits (CONTEXT.md decision)
  if (commits.length > 50) {
    commits = sampleCommits(commits);
  }

  return commits;
}

function sampleCommits<T>(commits: T[]): T[] {
  // First 10, last 10, every 5th in between
  const first10 = commits.slice(0, 10);
  const last10 = commits.slice(-10);
  const middle = commits.slice(10, -10).filter((_, i) => i % 5 === 0);

  // Deduplicate (last10 and first10 may overlap for small arrays)
  const seen = new Set<number>();
  const result: T[] = [];
  for (const [group, items] of [[0, first10], [1, middle], [2, last10]] as const) {
    for (let i = 0; i < (items as T[]).length; i++) {
      const globalIdx = group === 0 ? i : group === 1 ? 10 + i * 5 : commits.length - 10 + i;
      if (!seen.has(globalIdx)) {
        seen.add(globalIdx);
        result.push((items as T[])[i]);
      }
    }
  }
  return result;
}
```

### Anti-Patterns to Avoid

- **Parsing inside the LLM prompt:** Do NOT rely on Claude to parse bracket tags. This must be deterministic regex, not LLM inference. The existing `buildPrIntentScopingSection` uses LLM-inferred intent from title/labels/branch -- Phase 42 adds deterministic structured parsing alongside it, not replacing it.

- **Parsing PR body for bracket tags meant for the title:** The CONTEXT.md says bracket tags in title. Body is only scanned for breaking change keywords. Do not extract `[WIP]` from the body -- it could be in a code example or documentation.

- **Case-sensitive matching:** The CONTEXT.md explicitly requires case-insensitive matching. Use `.toLowerCase()` before comparison, not case-sensitive regex.

- **Ignoring code blocks in PR body:** Breaking change scanning in the body must strip fenced code blocks and inline code before matching. A PR body containing `` `breaking change` `` in a code example should not trigger detection.

- **Over-engineering the conventional commit parser:** Only extract the type prefix from the title. Do NOT parse scope, body, or footers. The CONTEXT.md says "commit title only" for commits and conventional commit support for the PR title. Keep it simple.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full conventional commit parsing | Multi-line footer parser, scope extractor, header/body/footer separation | Simple regex: `/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(!)?(\(.+\))?:/i` | The spec is complex (scope, body, footer, BREAKING CHANGE footer). We only need the type prefix. Full parsing is out of scope per CONTEXT.md. |
| Levenshtein distance for typo detection | Custom edit distance function | No external lib needed -- a simple Levenshtein in ~15 lines is fine for comparing against a small set of known tags | The known tag set is small (~10 tags). A simple implementation works. Do not add a `fastest-levenshtein` dependency for this. |
| Markdown code block stripping | Full markdown AST parser | Simple regex to strip fenced blocks and inline code | We only need to remove code blocks before keyword scanning, not parse full markdown. Regex is sufficient: `/```[\s\S]*?```/g` and `` /`[^`]+`/g `` |

**Key insight:** This phase is pure string manipulation. No external libraries, no AST parsing, no NLP. Resist the temptation to add complexity. The entire parser should be under 200 lines.

## Common Pitfalls

### Pitfall 1: Bracket Tags in Code Blocks Cause False Positives (PITFALLS.md P13)

**What goes wrong:** PR body contains `[no-review]` inside a code block or inline code. The parser matches it as an active keyword, causing the review to be silently skipped.

**Why it happens:** Naive regex `\[([^\]]+)\]` matches bracket content anywhere, including inside `` ` `` delimiters and ``` fenced blocks.

**How to avoid:** Pre-strip fenced code blocks (```` ```...``` ````), inline code (`` `...` ``), and blockquotes (`> ...`) from the body before scanning. For the title, this is not needed -- PR titles do not contain markdown formatting.

**Warning signs:** `[no-review]` triggers on PRs where the author mentioned it in documentation context.

### Pitfall 2: Silent Keyword Failures Destroy User Trust (PITFALLS.md P5)

**What goes wrong:** User adds `[strict-reveiw]` (typo). Nothing happens. User has no idea the keyword was not recognized. They assume the feature is broken.

**Why it happens:** The parser silently ignores unrecognized tags with no feedback.

**How to avoid:** Track unrecognized bracket tags. Display them in Review Details: "Unrecognized tags: [strict-reveiw]". Optionally, suggest corrections for close matches (Levenshtein distance 1-2 from known tags).

**Warning signs:** Users file issues saying "keywords don't work."

### Pitfall 3: [no-review] Must Be Checked Before Workspace Creation (Performance)

**What goes wrong:** The review handler creates a workspace (git clone, ~5-10 seconds), loads config, THEN checks `[no-review]`. The clone was wasted.

**Why it happens:** The ARCHITECTURE.md places keyword parsing after `loadRepoConfig()`, which requires a workspace. But `[no-review]` should skip as early as possible.

**How to avoid:** Split keyword parsing into two phases: (1) Title-only fast check for `[no-review]` BEFORE workspace creation (the title is available from the webhook payload). (2) Full parsing (body + commits) AFTER workspace creation and config loading. This avoids cloning repos for PRs that will be skipped.

**Warning signs:** Telemetry shows workspace creation for PRs that are immediately skipped.

### Pitfall 4: Commit Message Fetching Adds Latency and Rate Limit Pressure

**What goes wrong:** Fetching commit messages requires an API call to `pulls.listCommits`. For a PR with 100 commits, this is 1 API call (per_page: 100). For 250+ commits, this requires multiple paginated calls. Each call adds latency and consumes rate limit budget.

**Why it happens:** Commit messages are not included in the webhook payload. They must be fetched separately.

**How to avoid:** Use the `pr.commits` count from the webhook payload to decide whether to fetch. For PRs with 0-1 commits, the title usually mirrors the commit message -- consider skipping the API call entirely. For 50+ commits, use strategic sampling (CONTEXT.md decision). Cap total API calls at 3 pages (300 commits).

**Warning signs:** Increased API rate limit usage. Telemetry shows keyword parsing adding >2 seconds to review latency.

### Pitfall 5: WIP Detection Must Respect GitHub Draft Status

**What goes wrong:** PR title contains `[WIP]` but the PR is not a draft. The parser flags it as WIP. But the review handler already skips draft PRs (line 704-711 of review.ts). The `[WIP]` tag should not re-create the draft skip behavior -- it should signal a different behavior (e.g., lighter review, or summary-only mode).

**Why it happens:** `[WIP]` in title and `pr.draft === true` are correlated but not identical. Some projects use `[WIP]` for non-draft PRs that are "in progress but want early feedback."

**How to avoid (Claude's discretion area):** Recommended resolution:
- If `pr.draft === true`: Already skipped at line 704. `[WIP]` tag is redundant.
- If `pr.draft === false` AND `[WIP]` in title: Treat as "early feedback mode" -- flag `isWIP: true` in parsed intent but do NOT skip review. Downstream phases can use this to soften review behavior (e.g., reduce maxComments, skip style findings).
- Rationale: Users who mark a PR as non-draft but add `[WIP]` to the title want some review, just lighter. If they wanted no review, they would use `[no-review]` or keep the PR as a draft.

### Pitfall 6: Multiple Profile Tags With "Most Strict Wins" Requires Strict Ordering

**What goes wrong:** Tags `[minimal-review]` and `[strict-review]` both appear. Per CONTEXT.md, "most strict wins." But what is the ordering? If implemented incorrectly, `balanced` could win over `strict`.

**Why it happens:** The profile strictness ordering must be explicitly defined and tested.

**How to avoid:** Define explicit ordering: `strict > balanced > minimal`. When multiple profile tags are found, select the one with the highest strictness rank. Test with all 6 pairwise combinations.

## Code Examples

### Bracket Tag Extraction (Case-Insensitive, Any Position)

```typescript
// Source: Derived from codebase patterns + CONTEXT.md decisions

const BRACKET_TAG_REGEX = /\[([^\]]+)\]/g;

const RECOGNIZED_TAGS = new Set([
  "wip", "draft",                               // Status
  "no-review",                                    // Skip
  "strict-review", "balanced-review", "minimal-review",  // Profile
  "security-review",                              // Focus area
  "style-ok",                                     // Suppression
]);

function extractBracketTags(text: string, source: "title" | "body" | "commit", commitSha?: string): BracketTag[] {
  const tags: BracketTag[] = [];
  for (const match of text.matchAll(BRACKET_TAG_REGEX)) {
    const rawTag = match[1].trim();
    const normalizedTag = rawTag.toLowerCase();
    tags.push({
      tag: normalizedTag,
      recognized: RECOGNIZED_TAGS.has(normalizedTag),
      source,
      commitSha,
    });
  }
  return tags;
}
```

### Conventional Commit Type Extraction (PR Title)

```typescript
// Source: Conventional Commits spec v1.0.0 (https://www.conventionalcommits.org/en/v1.0.0/)

const CONVENTIONAL_COMMIT_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(!)?(\([^)]+\))?\s*:/i;

function extractConventionalType(title: string): ConventionalCommitType | null {
  const match = title.match(CONVENTIONAL_COMMIT_REGEX);
  if (!match) return null;
  return {
    type: match[1].toLowerCase(),
    isBreaking: match[2] === "!",
    source: "title",
  };
}
```

### Breaking Change Detection (Body, Case-Insensitive, Outside Code Blocks)

```typescript
// Source: CONTEXT.md decisions -- flexible matching for variations

const BREAKING_CHANGE_PATTERNS = [
  /\bbreaking\s+change\b/i,
  /\bbreaking\s+changes\b/i,
  /\bthis\s+breaks\b/i,
  /\bbreaking\s+api\b/i,
  /\bBREAKING[- ]CHANGE\b/,  // Conventional Commits footer format (uppercase required by spec)
];

function stripCodeBlocks(text: string): string {
  // Remove fenced code blocks
  let stripped = text.replace(/```[\s\S]*?```/g, "");
  // Remove inline code
  stripped = stripped.replace(/`[^`]+`/g, "");
  // Remove blockquotes
  stripped = stripped.replace(/^>.*$/gm, "");
  return stripped;
}

function detectBreakingChange(
  title: string,
  body: string | null,
  commitMessages?: Array<{ sha: string; message: string }>,
): Array<{ source: "title" | "body" | "commit"; excerpt: string; commitSha?: string }> {
  const results: Array<{ source: "title" | "body" | "commit"; excerpt: string; commitSha?: string }> = [];

  // Check title (conventional commit ! marker)
  if (CONVENTIONAL_COMMIT_REGEX.test(title) && title.match(CONVENTIONAL_COMMIT_REGEX)?.[2] === "!") {
    results.push({ source: "title", excerpt: title.slice(0, 80) });
  }

  // Check title for keyword patterns
  for (const pattern of BREAKING_CHANGE_PATTERNS) {
    if (pattern.test(title)) {
      results.push({ source: "title", excerpt: title.slice(0, 80) });
      break;
    }
  }

  // Check body (with code block stripping)
  if (body) {
    const cleanBody = stripCodeBlocks(body);
    for (const pattern of BREAKING_CHANGE_PATTERNS) {
      const match = cleanBody.match(pattern);
      if (match) {
        const idx = match.index ?? 0;
        const excerpt = cleanBody.slice(Math.max(0, idx - 20), idx + match[0].length + 20).trim();
        results.push({ source: "body", excerpt });
        break;
      }
    }
  }

  // Check commit messages
  if (commitMessages) {
    for (const commit of commitMessages) {
      for (const pattern of BREAKING_CHANGE_PATTERNS) {
        if (pattern.test(commit.message)) {
          results.push({ source: "commit", excerpt: commit.message.slice(0, 80), commitSha: commit.sha });
          break;
        }
      }
    }
  }

  return results;
}
```

### Profile Strictness Ordering

```typescript
// Source: CONTEXT.md decision -- "most strict wins"

const PROFILE_STRICTNESS: Record<string, number> = {
  strict: 3,
  balanced: 2,
  minimal: 1,
};

function resolveProfileOverride(tags: BracketTag[]): "strict" | "balanced" | "minimal" | null {
  const profileTags = tags
    .filter(t => t.recognized && t.tag.endsWith("-review") && t.tag !== "security-review" && t.tag !== "no-review")
    .map(t => t.tag.replace("-review", ""))
    .filter(t => t in PROFILE_STRICTNESS);

  if (profileTags.length === 0) return null;

  // Most strict wins
  return profileTags.sort((a, b) => PROFILE_STRICTNESS[b] - PROFILE_STRICTNESS[a])[0] as "strict" | "balanced" | "minimal";
}
```

### Strategic Commit Sampling (50+ Commits)

```typescript
// Source: CONTEXT.md decision -- "first 10, last 10, every 5th in between"

function sampleCommitMessages(
  commits: Array<{ sha: string; message: string }>,
): Array<{ sha: string; message: string }> {
  if (commits.length <= 50) return commits;

  const indices = new Set<number>();

  // First 10
  for (let i = 0; i < Math.min(10, commits.length); i++) {
    indices.add(i);
  }

  // Last 10
  for (let i = Math.max(0, commits.length - 10); i < commits.length; i++) {
    indices.add(i);
  }

  // Every 5th in between
  for (let i = 10; i < commits.length - 10; i += 5) {
    indices.add(i);
  }

  return [...indices].sort((a, b) => a - b).map(i => commits[i]);
}
```

## Codebase Integration Points

### Review Handler Pipeline (Exact Insertion Points)

Based on `handlers/review.ts` analysis:

```
[Line ~684]    const pr = payload.pull_request;
               >>> pr.title available here
               >>> pr.body available here
               >>> pr.commits (number) available here (commit count)
               >>> pr.draft available here

[Line ~704]    Draft PR skip (existing)
               >>> AFTER this: Insert [no-review] fast check on title only
               >>> This avoids workspace creation for [no-review] PRs
               >>> Only needs pr.title, no workspace required

[Line ~922]    workspace creation + git clone
[Line ~943]    loadRepoConfig()
               >>> AFTER this: Insert full parsePRIntent() call
               >>> Includes commit message fetching (needs octokit, post-workspace)
               >>> Includes body parsing (needs workspace for config awareness)

[Line ~997]    isReviewTriggerEnabled() check
               >>> parsePRIntent result already available here
               >>> [no-review] already handled above

[Line ~1241]   resolvedSeverityMinLevel / resolvedMaxComments
[Line ~1246]   Profile preset resolution
               >>> AFTER this: Apply keyword profile overrides (most strict wins)
               >>> Apply [style-ok] -> add "style" to ignoredAreas
               >>> Apply [security-review] -> add "security" to focusAreas

[Line ~1285]   buildReviewPrompt()
               >>> Pass parsedIntent to enable prompt-level keyword context
               >>> conventionalType informs review focus instructions

[Line ~1578]   formatReviewDetailsSummary()
               >>> MODIFY: Add parsedIntent parameter
               >>> Add keyword parsing section to Review Details output
```

### Review Details Appendix Extension

The `formatReviewDetailsSummary` function (line 101 of review.ts) currently accepts:
- `reviewOutputKey`, `filesReviewed`, `linesAdded`, `linesRemoved`, `findingCounts`, `largePRTriage`, `feedbackSuppressionCount`

Add new parameter: `keywordParsing?: ParsedPRIntent`

Insert the keyword section after the findings line and before the large PR triage section.

### Data Available Without API Calls

From the webhook payload `pull_request` object:
- `pr.title` -- string, always available
- `pr.body` -- string | null, always available
- `pr.draft` -- boolean, always available
- `pr.commits` -- number (commit count), always available
- `pr.labels` -- array of label objects, always available

### Data Requiring API Calls

- **Commit messages:** Requires `octokit.rest.pulls.listCommits({ owner, repo, pull_number, per_page })`. Returns up to 250 commits. Each commit has `commit.message` (full message) from which we extract the first line per CONTEXT.md decision.

### Existing Integration with PR Intent

The `buildPrIntentScopingSection` function (line 192 of review-prompt.ts) already uses `prTitle`, `prLabels`, and `headBranch` to build LLM-inferred intent context. Phase 42's parsed intent is complementary -- it provides deterministic structured signals that the LLM does not need to infer.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LLM-inferred PR intent from title | Deterministic parsed intent + LLM inference | Phase 42 | Keywords are parsed reliably; LLM intent scoping continues for non-keyword context |
| No skip mechanism beyond draft PRs and config disable | `[no-review]` title tag skips review | Phase 42 | Users can skip per-PR without config changes |
| Profile set globally in config | Profile overridable per-PR via bracket tags | Phase 42 | Per-PR flexibility without config file changes |

**Deprecated/outdated:**
- None. The `[kodiai:...]` prefix format from ARCHITECTURE.md is superseded by CONTEXT.md's bare bracket tag format. The ARCHITECTURE.md was written before the discuss-phase session that locked the bare tag format.

## Open Questions

1. **Commit message API call timing**
   - What we know: Commit messages require an API call. The octokit instance is created at various points in the review handler.
   - What's unclear: Whether the API call should use the same octokit instance as idempotency check (line 1012) or create a new one. The review handler already has `const idempotencyOctokit = await githubApp.getInstallationOctokit(event.installationId)` which could be reused.
   - Recommendation: Reuse the existing octokit instance. Create it once, use for both idempotency and commit fetching. Restructure the handler to create octokit earlier.

2. **[no-review] acknowledgment format**
   - What we know: CONTEXT.md says `[no-review]` is a "hard block -- bot skips review entirely." PITFALLS.md P5 says "Never suppress reviews silently."
   - What's unclear: Should the acknowledgment be a full issue comment, a reaction, or just a log entry?
   - Recommendation: Post a minimal issue comment: "Review skipped per `[no-review]` in PR title." This provides an audit trail and confirms the keyword was recognized. Use `octokit.rest.issues.createComment`.

3. **Keyword parsing for re-review (synchronize) events**
   - What we know: Keywords are in the PR title/body. On `synchronize` events, the title may have changed since the original `opened` event.
   - What's unclear: Should keywords be re-parsed on every event, or should the first parse be cached?
   - Recommendation: Re-parse on every event. The title/body are re-read from the payload, which always contains the current state. This handles cases where a user adds `[no-review]` to the title mid-PR. No caching needed.

4. **Interaction between [style-ok] and existing suppressions config**
   - What we know: Config already has `review.ignoredAreas` and `review.suppressions`. `[style-ok]` would add "style" to ignoredAreas.
   - What's unclear: Should `[style-ok]` be additive (add "style" to existing ignoredAreas) or should it override?
   - Recommendation: Additive. `[style-ok]` adds "style" to the `resolvedIgnoredAreas` array if not already present. This is consistent with the CONTEXT.md union strategy for signal aggregation.

## Sources

### Primary (HIGH confidence)
- Kodiai codebase: `src/handlers/review.ts` (review handler pipeline, lines 677-2078, profile presets at 450-474, formatReviewDetailsSummary at 101-186)
- Kodiai codebase: `src/execution/config.ts` (Zod config schema, profile enum, review triggers, all 639 lines)
- Kodiai codebase: `src/execution/review-prompt.ts` (buildPrIntentScopingSection at 192-223, buildReviewPrompt signature at 840-887)
- Kodiai codebase: `src/webhook/types.ts` (WebhookEvent type)
- Kodiai codebase: `src/handlers/review-idempotency.ts` (pagination pattern, scanForMarkerInPagedBodies)
- Kodiai codebase: `src/lib/sanitizer.ts` (sanitization pipeline, code block stripping patterns)
- Kodiai codebase: `@octokit/webhooks-types` schema.d.ts (PullRequest type: commits, additions, deletions, changed_files at line 2996-2999; commits_url at line 2949)
- `.planning/research/ARCHITECTURE.md` (v0.8 integration map, component boundaries, patterns)
- `.planning/research/PITFALLS.md` (P5: keyword silent failures, P10: keyword vs config precedence, P13: false matches in code blocks)
- `.planning/research/FEATURES.md` (commit keyword detection feature landscape, competitor analysis)

### Secondary (MEDIUM confidence)
- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) -- type/scope/description structure, BREAKING CHANGE footer format, `!` prefix for breaking changes
- [GitHub REST API: List commits on a PR](https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request) -- max 250 commits, per_page up to 100, pagination via Link header
- [GitHub Webhooks: pull_request event](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request) -- payload includes pull_request.commits (count), pull_request.title, pull_request.body, pull_request.draft

### Tertiary (LOW confidence)
- None. All findings verified against codebase or official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure TypeScript, all patterns established in codebase
- Architecture: HIGH -- integration points verified at exact line numbers, data sources confirmed in webhook types
- Pitfalls: HIGH -- five pitfalls identified with concrete prevention strategies, all sourced from existing PITFALLS.md analysis and codebase verification

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable -- no moving parts, pure parsing logic)
