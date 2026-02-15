# Phase 45: Author Experience Adaptation - Research

**Researched:** 2026-02-14
**Domain:** GitHub webhook author classification, prompt-based tone adaptation, SQLite caching
**Confidence:** HIGH

## Summary

Phase 45 adapts review tone based on PR author experience level. The core mechanism is straightforward: extract `author_association` from the webhook payload (already present in `@octokit/webhooks-types` as `AuthorAssociation`), optionally enrich via GitHub Search API PR count, cache the classification in SQLite with 24-hour TTL, and inject a tone directive section into the review prompt.

The `author_association` field is available on the `pull_request` object in all PR webhook events (opened, synchronize, ready_for_review, review_requested). It contains one of: `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `MEMBER`, `NONE`, `OWNER`. The mapping to tiers is deterministic and requires no ML or heuristics.

The prompt injection point is clear: `buildReviewPrompt()` in `src/execution/review-prompt.ts` already accepts `prAuthor` and has a `buildToneGuidelinesSection()` helper. A new `buildAuthorExperienceSection()` function will emit tier-specific tone directives that complement (not replace) the existing tone guidelines.

**Primary recommendation:** Implement as a classification module (`src/lib/author-classifier.ts`) + prompt section builder + SQLite cache table in the existing knowledge store, with fail-open semantics throughout.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@octokit/webhooks-types` | ^7.6.1 | `AuthorAssociation` type for `author_association` field | Already in devDependencies; provides typed webhook payload |
| `@octokit/rest` | ^22.0.1 | GitHub Search API for optional PR count enrichment | Already in dependencies; `octokit.rest.search.issuesAndPullRequests` |
| `bun:sqlite` | builtin | Author classification cache with 24-hour TTL | Already used by knowledge store and learning memory store |
| `zod` | ^4.3.6 | Schema validation for classification config | Already used throughout for config schemas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | ^10.3.0 | Structured logging for classification decisions | Already in dependencies; follow existing patterns |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite cache | In-memory Map with setTimeout | Loses state on restart; SQLite already used for similar patterns |
| GitHub Search API enrichment | GraphQL contributor stats | GraphQL needs additional auth scope; Search API is sufficient and already available |
| Per-request classification | Webhook-time eager caching | Adds latency to webhook handling; lazy evaluation in review handler is better |

**Installation:**
```bash
# No new dependencies required -- all libraries are already in package.json
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── author-classifier.ts        # Classification logic + tier mapping
│   └── author-classifier.test.ts   # Unit tests
├── execution/
│   └── review-prompt.ts            # Add buildAuthorExperienceSection()
├── handlers/
│   └── review.ts                   # Extract author_association, pass to classifier
└── knowledge/
    └── store.ts                    # Add author_cache table + read/write methods
```

### Pattern 1: Three-Tier Author Classification
**What:** Map `author_association` + optional PR count into three tiers: `first-time`, `regular`, `core`
**When to use:** Every PR review event, before building the review prompt

**Mapping rules:**
```typescript
// Source: GitHub docs on author_association values
// https://docs.github.com/en/graphql/reference/enums#commentauthorassociation

type AuthorTier = "first-time" | "regular" | "core";

type AuthorClassification = {
  tier: AuthorTier;
  authorAssociation: string;
  prCount: number | null;  // null = Search API not called or failed
  cachedAt: string | null;  // ISO timestamp if from cache
};

function classifyAuthor(params: {
  authorAssociation: string;
  prCount?: number | null;
}): AuthorTier {
  const { authorAssociation, prCount } = params;

  // Core: MEMBER or OWNER always classify as core
  if (authorAssociation === "MEMBER" || authorAssociation === "OWNER") {
    return "core";
  }

  // First-time: FIRST_TIMER or FIRST_TIME_CONTRIBUTOR are definitively first-time
  if (authorAssociation === "FIRST_TIMER" || authorAssociation === "FIRST_TIME_CONTRIBUTOR") {
    return "first-time";
  }

  // For COLLABORATOR, CONTRIBUTOR, NONE, MANNEQUIN: use PR count if available
  if (prCount !== null && prCount !== undefined) {
    if (prCount <= 1) return "first-time";
    if (prCount >= 10) return "core";
    return "regular";
  }

  // No PR count available: COLLABORATOR/CONTRIBUTOR -> regular, NONE -> first-time
  if (authorAssociation === "COLLABORATOR" || authorAssociation === "CONTRIBUTOR") {
    return "regular";
  }

  // NONE or MANNEQUIN without PR count -> first-time (conservative)
  return "first-time";
}
```

### Pattern 2: SQLite Cache with 24-Hour TTL
**What:** Cache classification results in a new `author_cache` table in the existing knowledge store DB
**When to use:** Before making any GitHub Search API call; after classification is computed

```typescript
// Cache table schema (added to knowledge store initialization)
// Follows same pattern as existing tables in createKnowledgeStore()
`CREATE TABLE IF NOT EXISTS author_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  author_login TEXT NOT NULL,
  tier TEXT NOT NULL,
  author_association TEXT NOT NULL,
  pr_count INTEGER,
  cached_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(repo, author_login)
)`

// Read: check TTL
`SELECT tier, author_association, pr_count, cached_at
 FROM author_cache
 WHERE repo = $repo AND author_login = $authorLogin
   AND cached_at >= datetime('now', '-24 hours')`

// Write: upsert on conflict
`INSERT INTO author_cache (repo, author_login, tier, author_association, pr_count)
 VALUES ($repo, $authorLogin, $tier, $authorAssociation, $prCount)
 ON CONFLICT(repo, author_login) DO UPDATE SET
   tier = excluded.tier,
   author_association = excluded.author_association,
   pr_count = excluded.pr_count,
   cached_at = datetime('now')`
```

### Pattern 3: Prompt Tone Injection
**What:** Add a `## Author Experience Context` section to the review prompt with tier-specific tone directives
**When to use:** During `buildReviewPrompt()`, after the existing tone guidelines section

```typescript
// Placed AFTER buildToneGuidelinesSection() in the prompt assembly
// This supplements existing tone guidelines rather than replacing them

function buildAuthorExperienceSection(params: {
  tier: AuthorTier;
  authorLogin: string;
}): string {
  const { tier, authorLogin } = params;

  if (tier === "first-time") {
    return [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) appears to be a first-time or new contributor to this repository.`,
      "",
      "Adapt your review tone accordingly:",
      "- Use encouraging, welcoming language",
      "- Explain WHY each finding matters, not just WHAT is wrong",
      "- Link to relevant documentation or examples when suggesting fixes",
      "- Frame suggestions as learning opportunities rather than corrections",
      "- Acknowledge what was done well before noting issues",
      "- Use phrases like \"A common pattern here is...\" instead of \"You should...\"",
      "- For MINOR findings, prefer a brief explanation over terse labels",
    ].join("\n");
  }

  if (tier === "core") {
    return [
      "## Author Experience Context",
      "",
      `The PR author (${authorLogin}) is a core contributor (MEMBER/OWNER) of this repository.`,
      "",
      "Adapt your review tone accordingly:",
      "- Be concise and assume familiarity with the codebase",
      "- Skip explanations of well-known patterns; focus on the specific issue",
      "- Use terse finding descriptions (issue + consequence only)",
      "- Omit links to basic documentation",
      "- For MINOR findings, a one-liner is sufficient",
    ].join("\n");
  }

  // "regular" tier: no special tone adjustments needed -- use default tone guidelines
  return "";
}
```

### Pattern 4: GitHub Search API Enrichment (Optional)
**What:** Use `octokit.rest.search.issuesAndPullRequests` to count merged PRs by the author in the repo
**When to use:** When `author_association` is ambiguous (NONE, COLLABORATOR, CONTRIBUTOR) and cache miss

```typescript
// Rate-limit friendly: single API call, only on cache miss for ambiguous associations
const { data } = await octokit.rest.search.issuesAndPullRequests({
  q: `repo:${owner}/${repo} type:pr author:${authorLogin} is:merged`,
  per_page: 1,  // We only need total_count
});
const prCount = data.total_count;
```

### Anti-Patterns to Avoid
- **Tone replacement:** Do NOT replace `buildToneGuidelinesSection()`. The author experience section supplements it. Both sections must be present.
- **Blocking on Search API:** Do NOT make the Search API call synchronous and required. It must be optional enrichment with fail-open.
- **Over-classification:** Do NOT create more than three tiers. More granularity adds complexity without measurable benefit to tone adaptation.
- **Caching in memory:** Do NOT use an in-memory cache. The bot restarts regularly; SQLite persistence is necessary and already established.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite cache table | Separate database file | Add table to existing knowledge store DB | Single DB file reduces operational complexity; WAL mode already configured |
| TTL expiration | Manual timestamp comparison in JS | SQLite `datetime('now', '-24 hours')` in WHERE clause | Atomic, timezone-safe, no JS Date parsing needed |
| Author association types | String enum validation | `AuthorAssociation` type from `@octokit/webhooks-types` | Already typed; no need for redundant validation |
| PR count API | GraphQL query or scraping | `octokit.rest.search.issuesAndPullRequests` | Standard REST endpoint, no extra auth scopes |

**Key insight:** This feature is fundamentally a prompt engineering task with a thin data layer. The classification logic is deterministic mapping, not ML. Keep it simple.

## Common Pitfalls

### Pitfall 1: `author_association` Returns NONE for External Contributors
**What goes wrong:** External contributors who open PRs from forks get `NONE` even if they have many merged PRs. Treating all `NONE` as first-time is wrong.
**Why it happens:** GitHub's `author_association` only reflects org/repo membership, not contribution history.
**How to avoid:** For `NONE` associations, use the Search API enrichment to check merged PR count before classifying.
**Warning signs:** Core open-source contributors getting "welcoming newcomer" tone.

### Pitfall 2: Search API Rate Limiting
**What goes wrong:** GitHub Search API has a stricter rate limit (30 requests/minute for authenticated apps) than the REST API.
**Why it happens:** Search is expensive server-side; GitHub throttles it more aggressively.
**How to avoid:** Cache results with 24-hour TTL. Only call Search API on cache miss for ambiguous associations. Never call for MEMBER/OWNER (already classified as core) or FIRST_TIMER/FIRST_TIME_CONTRIBUTOR (already classified as first-time).
**Warning signs:** HTTP 403 responses with `X-RateLimit-Remaining: 0`.

### Pitfall 3: Fail-Open Semantics Must Be Consistent
**What goes wrong:** Some error paths fail-closed (blocking the review) while others fail-open, creating inconsistent behavior.
**Why it happens:** Multiple try-catch blocks with different error handling strategies.
**How to avoid:** Define a single fail-open pattern: if classification fails at any point, return `{ tier: "regular" }` as the default. Regular tier applies no special tone modification, making it identical to the current behavior.
**Warning signs:** Reviews failing or being delayed due to classification errors.

### Pitfall 4: Prompt Section Ordering Matters
**What goes wrong:** Placing the author experience section too early or too late in the prompt reduces its effectiveness.
**Why it happens:** LLM attention patterns favor content near the beginning and end of prompts (primacy/recency effect).
**How to avoid:** Place the author experience section immediately after `buildToneGuidelinesSection()` so the two tone-related sections are adjacent. This groups related instructions and keeps them in the middle of the prompt where they modify the established tone rules.
**Warning signs:** LLM ignoring tone directives in reviews.

### Pitfall 5: Cache Purge for Stale Entries
**What goes wrong:** The `author_cache` table grows unbounded as new authors are classified.
**Why it happens:** 24-hour TTL only applies to reads; stale entries remain in the table.
**How to avoid:** Add a `purgeStaleAuthorCache()` method that deletes entries older than 7 days. Call it alongside the existing `purgeOldRuns()` in the maintenance cycle.
**Warning signs:** Database file growing unexpectedly.

### Pitfall 6: MANNEQUIN Association
**What goes wrong:** `MANNEQUIN` is a special association for placeholder users created during repository imports. Classification logic may not handle it.
**Why it happens:** It is a rare but valid `author_association` value.
**How to avoid:** Treat `MANNEQUIN` the same as `NONE` -- classify based on PR count if available, otherwise default to first-time.
**Warning signs:** Errors or unexpected classification for imported PRs.

## Code Examples

### Example 1: Extracting author_association from Webhook Payload
```typescript
// Source: @octokit/webhooks-types schema.d.ts (verified in codebase)
// The pull_request object in PR events has author_association directly

// In src/handlers/review.ts, inside handleReview():
const payload = event.payload as unknown as PullRequestOpenedEvent;
const pr = payload.pull_request;

// author_association is typed as AuthorAssociation
const authorAssociation: string = pr.author_association;
// Values: COLLABORATOR | CONTRIBUTOR | FIRST_TIMER | FIRST_TIME_CONTRIBUTOR
//         | MANNEQUIN | MEMBER | NONE | OWNER
```

### Example 2: Cache Table Integration in Knowledge Store
```typescript
// Source: Follows existing pattern in src/knowledge/store.ts

// Add to createKnowledgeStore() after existing table creation:
db.run(`
  CREATE TABLE IF NOT EXISTS author_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    author_login TEXT NOT NULL,
    tier TEXT NOT NULL,
    author_association TEXT NOT NULL,
    pr_count INTEGER,
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(repo, author_login)
  )
`);

// Prepared statements:
const getAuthorCacheStmt = db.query(`
  SELECT tier, author_association, pr_count, cached_at
  FROM author_cache
  WHERE repo = $repo
    AND author_login = $authorLogin
    AND cached_at >= datetime('now', '-24 hours')
`);

const upsertAuthorCacheStmt = db.query(`
  INSERT INTO author_cache (repo, author_login, tier, author_association, pr_count)
  VALUES ($repo, $authorLogin, $tier, $authorAssociation, $prCount)
  ON CONFLICT(repo, author_login) DO UPDATE SET
    tier = excluded.tier,
    author_association = excluded.author_association,
    pr_count = excluded.pr_count,
    cached_at = datetime('now')
`);

const purgeStaleAuthorCacheStmt = db.query(`
  DELETE FROM author_cache WHERE cached_at < datetime('now', '-7 days')
`);
```

### Example 3: Passing Classification to Review Prompt Builder
```typescript
// In src/handlers/review.ts, after classification is resolved:
const reviewPrompt = buildReviewPrompt({
  // ... existing params ...
  prAuthor: pr.user.login,
  authorTier: classification.tier,  // NEW field
});

// In src/execution/review-prompt.ts, buildReviewPrompt():
// Add to context type:
//   authorTier?: "first-time" | "regular" | "core";

// In prompt assembly, after buildToneGuidelinesSection():
if (context.authorTier && context.authorTier !== "regular") {
  const authorExpSection = buildAuthorExperienceSection({
    tier: context.authorTier,
    authorLogin: context.prAuthor,
  });
  if (authorExpSection) lines.push("", authorExpSection);
}
```

### Example 4: Search API Enrichment with Fail-Open
```typescript
// In src/lib/author-classifier.ts
async function fetchPRCount(params: {
  octokit: Awaited<ReturnType<GitHubApp["getInstallationOctokit"]>>;
  owner: string;
  repo: string;
  authorLogin: string;
  logger: Logger;
}): Promise<number | null> {
  try {
    const { data } = await params.octokit.rest.search.issuesAndPullRequests({
      q: `repo:${params.owner}/${params.repo} type:pr author:${params.authorLogin} is:merged`,
      per_page: 1,
    });
    return data.total_count;
  } catch (err) {
    params.logger.warn(
      { err, authorLogin: params.authorLogin },
      "Author PR count lookup failed (fail-open, proceeding without enrichment)",
    );
    return null;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No author awareness | All authors get identical tone | Current state | Core contributors get unnecessary explanations; newcomers get terse feedback |
| Hardcoded tone in system prompt | Dynamic tone via prompt section injection | Phase 45 | Tone adapts per-author without config changes |

**Deprecated/outdated:**
- N/A: This is a new feature with no legacy approaches to deprecate.

## Open Questions

1. **Should the author tier be included in the Review Details comment?**
   - What we know: The `formatReviewDetailsSummary()` function already includes profile, keyword parsing, and prioritization metadata.
   - What's unclear: Whether exposing classification as "first-time / regular / core" in the PR comment is helpful or could be seen as labeling.
   - Recommendation: Include it as a transparency metric (e.g., `- Author tier: first-time`). This aids debugging and sets expectations for the review tone.

2. **Should classification be repo-scoped or org-scoped?**
   - What we know: The cache key is `(repo, author_login)`. An author might be a core contributor in one repo but first-time in another within the same org.
   - What's unclear: Whether org-level classification would be more accurate for monorepo orgs.
   - Recommendation: Keep repo-scoped. Different repos within an org can have very different contributor pools. Org-scoped would require additional API calls and complexity.

3. **Should `review.skipAuthors` interact with author classification?**
   - What we know: `skipAuthors` already skips review entirely for listed authors. Classification happens after `skipAuthors` check.
   - What's unclear: Whether there should be a way to force a tier for specific authors via config.
   - Recommendation: No config override needed for v1. The automatic classification is sufficient. If needed later, add a `review.authorTierOverrides` map in a future phase.

## Sources

### Primary (HIGH confidence)
- `@octokit/webhooks-types` schema.d.ts (line 109-117): `AuthorAssociation` type verified in `node_modules/@octokit/webhooks-types/schema.d.ts`. Values: COLLABORATOR, CONTRIBUTOR, FIRST_TIMER, FIRST_TIME_CONTRIBUTOR, MANNEQUIN, MEMBER, NONE, OWNER.
- `@octokit/webhooks-types` schema.d.ts (line 2978): `author_association` field confirmed on pull_request object in webhook payloads.
- `src/knowledge/store.ts`: Existing SQLite table creation pattern with WAL mode, prepared statements, and transactions.
- `src/execution/review-prompt.ts`: `buildReviewPrompt()` function signature and prompt assembly flow verified.
- `src/handlers/review.ts`: Review handler flow verified -- `pr.user.login` available, prompt built before execution.
- `src/execution/config.ts`: RepoConfig schema with existing review section and zod validation pattern.

### Secondary (MEDIUM confidence)
- GitHub REST API documentation for Search API: `octokit.rest.search.issuesAndPullRequests` supports `repo:`, `type:pr`, `author:`, `is:merged` qualifiers. Rate limit: 30 requests/minute for authenticated GitHub Apps.
- GitHub webhook documentation: `author_association` is documented as always present on PR webhook payloads. NONE is the default for unknown associations (not FIRST_TIME_CONTRIBUTOR).

### Tertiary (LOW confidence)
- None. All findings verified against codebase or official types.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all libraries already in use
- Architecture: HIGH - Pattern follows established knowledge store + prompt builder patterns in codebase
- Pitfalls: HIGH - author_association values verified against actual TypeScript types in node_modules; cache pattern matches existing store.ts

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable domain; webhook types change rarely)
