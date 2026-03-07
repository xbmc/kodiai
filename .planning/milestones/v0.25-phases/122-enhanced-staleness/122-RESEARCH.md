# Phase 122: Enhanced Staleness - Research

**Researched:** 2026-03-04
**Domain:** GitHub PR scanning, diff evidence capture, heuristic scoring improvements
**Confidence:** HIGH

## Summary

Phase 122 replaces the current commit-based staleness detection (`fetchChangedFiles()` scanning individual commits) with merged-PR-based scanning that captures full patch hunks as evidence. The existing `wiki-staleness-detector.ts` has a two-tier pipeline (heuristic token overlap + LLM evaluation) with a scheduler, run state persistence, and Slack reporting. The core change is: (1) swap commit fetching for PR fetching via `octokit.rest.pulls.list()` + `octokit.rest.pulls.listFiles()`, (2) store patch hunks in a new database table keyed by PR number, (3) add domain stopwords and section-heading weighting to `heuristicScore()` to reduce false positives, and (4) extract linked issue references from PR descriptions using the existing `parseIssueReferences()` utility.

The codebase already has all the building blocks: authenticated Octokit via `GitHubApp.getInstallationOctokit()`, the `pulls.list()` and `pulls.listFiles()` patterns used in `dep-bump-merge-history.ts` and `expertise-scorer.ts`, the `parseIssueReferences()` pure function from Phase 108, the scheduler start/stop pattern, and the run state persistence table. No new external libraries are needed.

**Primary recommendation:** Enhance the existing `wiki-staleness-detector.ts` inline by replacing `fetchChangedFiles()` with a new `fetchMergedPRs()` function, adding a migration 022 for the `wiki_pr_evidence` table, filtering `heuristicScore()` with a stopword set, and adding section-heading weighting to the scoring.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Store full patch hunks from each PR's changed files -- not summaries, not file-level metadata
- Persist diff evidence in a new database table keyed by PR number
- Only store diffs for files that match wiki pages via the heuristic -- a PR touching 200 files but only 3 relate to wiki content stores only those 3 diffs
- Include PR metadata alongside diffs: PR number, title, description, author, merge date -- enables Phase 123 to cite "PR #12345: Rename PlayerCoreFactory" in update suggestions
- Extract and store linked issue references from PR descriptions (fixes #123, closes #456) for additional context
- Switch from individual commit scanning to merged PR scanning -- PRs are coherent units of change with richer metadata
- Separate backfill script for initial 90-day PR population; regular scheduled scans cover incremental windows from last run
- Curated domain stopword list -- hardcoded tokens like 'player', 'video', 'kodi', 'addon' that match too broadly and trigger false positives
- Section-heading weighting per success criteria STALE-04
- Regular scan window stays at 7 days (incremental from last run)
- 90-day coverage handled by the one-time backfill script
- Existing weekly scheduler cadence preserved

### Claude's Discretion
- Whether to replace the existing staleness detector inline or build a new parallel pipeline
- Domain stopword list contents and scoring adjustments
- Section-heading weighting algorithm
- Database schema design for PR evidence table
- API rate limiting strategy for 90-day backfill

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STALE-01 | Recent merged PRs (last 90 days) scanned to identify code areas with significant changes | Replace `fetchChangedFiles()` with `fetchMergedPRs()` using `octokit.rest.pulls.list({ state: "closed" })` filtered by `merged_at`; backfill script for 90-day history |
| STALE-02 | Changed code areas matched to related wiki pages via retrieval pipeline | Enhanced `heuristicPass()` with stopword filtering matches PR-changed files to wiki page chunks; existing token-overlap approach enhanced, not replaced |
| STALE-03 | Diff content from PRs/commits preserved and fed to staleness analysis (not discarded) | New `wiki_pr_evidence` table stores patch hunks per file per PR; `evaluateWithLlm()` enhanced to include actual diff content in prompt |
| STALE-04 | Improved staleness precision with domain stopwords and section-heading weighting to reduce false positives | Stopword set filters common tokens from `heuristicScore()`; section headings in wiki chunks receive higher weight multiplier |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | (existing) | GitHub API calls for PR listing and file diffs | Already used throughout codebase for all GitHub operations |
| postgres (via Sql) | (existing) | PR evidence table storage | Project uses postgres.js via `src/db/client.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | (existing) | Structured logging | All module logging |
| parseIssueReferences | (existing, src/lib/issue-reference-parser.ts) | Extract issue refs from PR bodies | Extracting linked issues for PR evidence metadata |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pulls.listFiles()` for patches | `repos.getCommit()` per commit | PRs are coherent units; commit-level is noisier and uses more API calls |
| Inline enhancement | Parallel pipeline | Inline reuses scheduler, run state, Slack reporting; parallel means duplication -- recommend inline |

**Installation:** No new packages needed. All dependencies already in the project.

## Architecture Patterns

### Recommended Approach: Inline Enhancement

Replace `fetchChangedFiles()` (lines 73-118) with a new `fetchMergedPRs()` function. This reuses:
- The existing scheduler start/stop pattern
- Run state persistence (extend `wiki_staleness_run_state` to store last PR cursor instead of commit SHA)
- Slack report delivery
- LLM evaluation pipeline (enhanced with diff content)

Rationale for inline over parallel: the staleness detector is a single file (597 lines) with clean separation between fetch, heuristic, LLM, and reporting stages. Replacing the fetch stage is surgical. A parallel pipeline would duplicate the scheduler, run state, and reporting logic.

### Pattern 1: PR Fetching with Merged Filter
**What:** Fetch merged PRs using `pulls.list()` with `state: "closed"`, then filter by `merged_at` timestamp
**When to use:** Regular scheduled scans and backfill
**Example:**
```typescript
// Source: existing pattern in src/contributor/expertise-scorer.ts lines 206-216
const resp = await octokit.rest.pulls.list({
  owner,
  repo,
  state: "closed",
  sort: "updated",
  direction: "desc",
  per_page: 100,
  page,
});
// Filter to merged-only within window
const merged = resp.data.filter(
  (pr) => pr.merged_at && new Date(pr.merged_at) >= since
);
```

### Pattern 2: PR File Listing with Patch Extraction
**What:** `pulls.listFiles()` returns `filename`, `status`, `additions`, `deletions`, `changes`, and `patch` (the unified diff hunk)
**When to use:** After identifying relevant PRs, fetch file-level diffs
**Example:**
```typescript
// Source: existing pattern in src/handlers/dep-bump-merge-history.ts lines 95-106
const resp = await octokit.rest.pulls.listFiles({
  owner,
  repo,
  pull_number: pr.number,
  per_page: 100,
});
// Each file has: filename, status, additions, deletions, changes, patch
for (const file of resp.data) {
  // file.patch contains the unified diff hunk (may be undefined for binary/too-large files)
  if (file.patch) {
    // Store patch for files that match wiki pages
  }
}
```

### Pattern 3: Selective Diff Storage (Heuristic-First)
**What:** Run heuristic scoring on file paths BEFORE fetching diffs, then only store patches for files that match wiki pages
**When to use:** Every scan -- prevents storing thousands of irrelevant diffs
**Flow:**
1. Fetch merged PRs in window
2. Collect all changed file paths across PRs
3. Run `heuristicScore()` against wiki page chunks
4. For PRs with matching files, store only the matching files' patches
5. This means `pulls.listFiles()` data is fetched once per PR but only matching patches are persisted

### Pattern 4: Domain Stopword Filtering
**What:** Filter out tokens that are too common in the Kodi codebase to be meaningful for matching
**When to use:** In `heuristicScore()` before checking overlap
**Example:**
```typescript
const DOMAIN_STOPWORDS = new Set([
  'player', 'video', 'audio', 'kodi', 'addon', 'addons',
  'plugin', 'core', 'utils', 'common', 'test', 'tests',
  'interface', 'service', 'manager', 'handler', 'factory',
  'component', 'module', 'helper', 'base', 'abstract',
]);

// In heuristicScore(): skip tokens in stopword set
for (const token of pathTokens) {
  if (DOMAIN_STOPWORDS.has(token)) continue;
  if (chunkTokens.has(token)) score++;
}
```

### Pattern 5: Section-Heading Weighting
**What:** Tokens appearing in section headings (## Header) get a higher weight multiplier in heuristic scoring
**When to use:** When building chunk tokens in `heuristicScore()`
**Example:**
```typescript
// Extract section headings from wiki chunk text
// Headings use MediaWiki "== Heading ==" or "=== Subheading ===" syntax
const HEADING_REGEX = /^={2,4}\s*(.+?)\s*={2,4}$/gm;
const HEADING_WEIGHT = 3; // tokens in headings count 3x

for (const text of chunkTexts) {
  // Regular tokens
  for (const t of text.toLowerCase().split(/\W+/)) {
    if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) chunkTokens.add(t);
  }
  // Heading tokens with weight
  for (const match of text.matchAll(HEADING_REGEX)) {
    for (const t of match[1].toLowerCase().split(/\W+/)) {
      if (t.length > 3) headingTokens.add(t);
    }
  }
}
// Score: heading match = HEADING_WEIGHT, regular match = 1
```

### Anti-Patterns to Avoid
- **Fetching all diffs then filtering:** Do NOT call `pulls.listFiles()` for every PR before heuristic filtering. The 90-day backfill could touch hundreds of PRs; only fetch file details for PRs whose file paths overlap wiki content.
- **Storing full PR bodies as evidence:** Store patch hunks only, not entire PR descriptions. PR metadata (title, description, author) goes in separate columns.
- **Single API call for 90-day backfill:** The xbmc/xbmc repo has many merged PRs. Paginate with per_page=100 and respect rate limits.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Issue reference parsing | Custom regex parser | `parseIssueReferences()` from `src/lib/issue-reference-parser.ts` | Already handles all GitHub closing keywords, cross-repo refs, code block stripping, deduplication |
| GitHub API auth | Manual token management | `GitHubApp.getInstallationOctokit()` + `getRepoInstallationContext()` | Handles token refresh, installation resolution |
| Rate limiting | Custom retry logic | Octokit's built-in retry + `per_page: 100` pagination | Octokit handles 403/429 retries automatically |
| Run state persistence | File-based state | Existing `wiki_staleness_run_state` table + `loadRunState()`/`saveRunState()` | Already handles upsert, status tracking, error recording |

**Key insight:** This phase is primarily a data source swap (commits -> PRs) and scoring refinement (stopwords + heading weights). All infrastructure already exists.

## Common Pitfalls

### Pitfall 1: `pulls.listFiles()` Patch Truncation
**What goes wrong:** GitHub API truncates the `patch` field for files with very large diffs (over ~300 lines). Binary files have no patch at all.
**Why it happens:** GitHub API limitation -- large diffs are not included in the REST response.
**How to avoid:** Check for `file.patch` being undefined/null before storing. Log when patches are truncated. For Phase 122's purposes, truncated patches are still useful -- partial diffs are better than no diffs.
**Warning signs:** `file.patch` is undefined despite `file.changes > 0`.

### Pitfall 2: Rate Limiting on 90-Day Backfill
**What goes wrong:** The xbmc/xbmc repo may have 200+ merged PRs in 90 days. Fetching `pulls.list()` + `pulls.listFiles()` for each can hit GitHub's secondary rate limit (~80 req/min for content).
**Why it happens:** Sequential API calls without delays.
**How to avoid:** Add a small delay (200-500ms) between `listFiles()` calls in the backfill script. The regular 7-day scan has far fewer PRs so doesn't need throttling.
**Warning signs:** 403 responses with "secondary rate limit" message.

### Pitfall 3: Over-Broad Token Matching
**What goes wrong:** Current `heuristicScore()` matches tokens like "player", "video", "kodi" that appear in nearly every wiki page AND nearly every code path. This creates false positives where every PR matches every page.
**Why it happens:** The Kodi codebase and wiki share a specialized domain vocabulary.
**How to avoid:** Apply the domain stopword set BEFORE checking overlap. Start with a conservative list and log which tokens cause the most matches for tuning.
**Warning signs:** Candidate count near wiki page count (e.g., 200+ candidates from 250 pages means the filter is too broad).

### Pitfall 4: Duplicate PR Evidence Rows
**What goes wrong:** If the backfill script and regular scan overlap in time window, the same PR could be inserted twice.
**Why it happens:** No unique constraint, or running backfill while regular scanner is also running.
**How to avoid:** Add a UNIQUE constraint on `(pr_number, file_path)` in the migration. Use `ON CONFLICT DO UPDATE` for upserts.
**Warning signs:** Duplicate PR numbers in the evidence table after running both backfill and regular scan.

### Pitfall 5: Memory Pressure from Large Patch Storage
**What goes wrong:** Storing many large patches in memory before batch insert can cause OOM.
**Why it happens:** Building up an array of all patches across all PRs before writing.
**How to avoid:** Insert evidence rows per-PR (not batch all PRs then insert). Each PR's matching patches are inserted immediately after heuristic filtering.
**Warning signs:** Process memory growing unboundedly during backfill.

## Code Examples

### Database Migration (022-wiki-pr-evidence.sql)
```sql
-- Migration 022: Wiki PR evidence for staleness detection
-- Stores diff patches from merged PRs matched to wiki pages.

CREATE TABLE wiki_pr_evidence (
  id              SERIAL PRIMARY KEY,
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT NOT NULL,
  pr_description  TEXT,
  pr_author       TEXT NOT NULL,
  merged_at       TIMESTAMPTZ NOT NULL,

  -- File-level diff
  file_path       TEXT NOT NULL,
  patch           TEXT NOT NULL,

  -- Linked issue references (JSON array of {issueNumber, keyword, crossRepo})
  issue_references JSONB DEFAULT '[]'::jsonb,

  -- Which wiki page this evidence relates to (populated during heuristic matching)
  matched_page_id    INTEGER,
  matched_page_title TEXT,
  heuristic_score    INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (pr_number, file_path)
);

-- Fast lookup by page for Phase 123 update generation
CREATE INDEX idx_wiki_pr_evidence_page_id ON wiki_pr_evidence (matched_page_id);
-- Fast lookup by merge date for windowed scans
CREATE INDEX idx_wiki_pr_evidence_merged_at ON wiki_pr_evidence (merged_at DESC);
-- Fast lookup by PR number for dedup checks
CREATE INDEX idx_wiki_pr_evidence_pr_number ON wiki_pr_evidence (pr_number);
```

### PR Fetching Function
```typescript
type MergedPR = {
  number: number;
  title: string;
  body: string | null;
  author: string;
  mergedAt: Date;
  files: Array<{ filename: string; patch?: string; additions: number; deletions: number }>;
};

async function fetchMergedPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: Date,
  logger: Logger,
): Promise<MergedPR[]> {
  const results: MergedPR[] = [];

  for (let page = 1; page <= 10; page++) {
    const resp = await octokit.rest.pulls.list({
      owner, repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 100,
      page,
    });

    if (resp.data.length === 0) break;

    const merged = resp.data.filter(
      (pr) => pr.merged_at && new Date(pr.merged_at) >= since
    );

    // If oldest PR on this page was updated before our window, stop paginating
    const oldestUpdated = resp.data[resp.data.length - 1]?.updated_at;
    if (oldestUpdated && new Date(oldestUpdated) < since) {
      results.push(...await enrichPRsWithFiles(octokit, owner, repo, merged, logger));
      break;
    }

    results.push(...await enrichPRsWithFiles(octokit, owner, repo, merged, logger));
  }

  return results;
}
```

### Enhanced Heuristic Score with Stopwords and Heading Weights
```typescript
const DOMAIN_STOPWORDS = new Set([
  'player', 'video', 'audio', 'kodi', 'addon', 'addons',
  'plugin', 'core', 'utils', 'common', 'test', 'tests',
  'interface', 'service', 'manager', 'handler', 'factory',
]);

const HEADING_REGEX = /^={2,4}\s*(.+?)\s*={2,4}$/gm;
const HEADING_WEIGHT = 3;

export function heuristicScore(chunkTexts: string[], changedFilePaths: string[]): number {
  const regularTokens = new Set<string>();
  const headingTokens = new Set<string>();

  for (const text of chunkTexts) {
    // Regular tokens (excluding stopwords)
    for (const t of text.toLowerCase().split(/\W+/)) {
      if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) regularTokens.add(t);
    }
    // Heading tokens (higher weight, still exclude stopwords)
    for (const match of text.matchAll(HEADING_REGEX)) {
      for (const t of match[1].toLowerCase().split(/\W+/)) {
        if (t.length > 3 && !DOMAIN_STOPWORDS.has(t)) headingTokens.add(t);
      }
    }
  }

  let score = 0;
  for (const filePath of changedFilePaths) {
    const pathTokens = filePath.toLowerCase().split(/[/._-]+/).filter((t) => t.length > 3);
    for (const token of pathTokens) {
      if (DOMAIN_STOPWORDS.has(token)) continue;
      if (headingTokens.has(token)) score += HEADING_WEIGHT;
      else if (regularTokens.has(token)) score += 1;
    }
  }
  return score;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Commit-based scanning (`repos.listCommits` + `repos.getCommit`) | PR-based scanning (`pulls.list` + `pulls.listFiles`) | Phase 122 | PRs provide coherent change units with title, description, linked issues; richer metadata for Phase 123 citations |
| File path only (no diff content) | Patch hunks preserved in DB | Phase 122 | Phase 123 can ground update suggestions in actual code changes, not hallucinate |
| No stopwords in heuristic | Domain stopword filtering | Phase 122 | Reduces false positives from ubiquitous Kodi-domain tokens |
| Equal token weighting | Section-heading weighting | Phase 122 | Wiki section headings are stronger signals of topic relevance than body text |

## Open Questions

1. **Exact stopword list contents**
   - What we know: Tokens like 'player', 'video', 'kodi', 'addon' are too common. User decision says "hardcoded" and "curated."
   - What's unclear: Full list needs empirical tuning based on actual match data.
   - Recommendation: Start with the ~15 tokens listed in the pattern above. Log token match counts during first run to identify additional candidates. Claude's discretion per CONTEXT.md.

2. **MediaWiki heading syntax in wiki chunks**
   - What we know: Kodi wiki uses MediaWiki syntax (`== Heading ==`, `=== Subheading ===`). Wiki chunks stored in `wiki_pages.chunk_text` may or may not preserve this markup.
   - What's unclear: Whether chunk text has been converted to plain text during ingestion or retains MediaWiki markup.
   - Recommendation: Check a sample of `chunk_text` values during implementation to confirm heading syntax. If headings are stripped during ingestion, heading weighting would need to be applied at ingestion time or the chunks inspected differently.

3. **PR evidence table: one row per (PR, file) vs one row per (PR, file, page)**
   - What we know: User says "store diffs for files that match wiki pages via the heuristic." A single file could match multiple wiki pages.
   - What's unclear: Whether to duplicate the patch for each matched page or store once and use a junction table.
   - Recommendation: Store one row per (PR, file) with `matched_page_id` as nullable. If a file matches multiple pages, store multiple rows (patch is repeated but schema stays simple). The `UNIQUE (pr_number, file_path)` constraint would need to become `UNIQUE (pr_number, file_path, matched_page_id)` in that case. Alternatively, keep single row per (PR, file) and let Phase 123 do the page matching at query time. Claude's discretion per CONTEXT.md.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/knowledge/wiki-staleness-detector.ts` -- current implementation (597 lines)
- Existing codebase: `src/knowledge/wiki-staleness-types.ts` -- current type definitions
- Existing codebase: `src/handlers/dep-bump-merge-history.ts` -- `pulls.listFiles()` pattern with `filename` extraction
- Existing codebase: `src/contributor/expertise-scorer.ts` -- `pulls.list({ state: "closed" })` pagination pattern
- Existing codebase: `src/lib/issue-reference-parser.ts` -- `parseIssueReferences()` for extracting issue refs from PR bodies
- Existing codebase: `src/db/migrations/012-wiki-staleness-run-state.sql` -- run state table schema
- Existing codebase: `src/db/migrations/020-wiki-page-popularity.sql` -- migration pattern reference

### Secondary (MEDIUM confidence)
- GitHub REST API docs (from training data): `pulls.listFiles()` response includes `patch` field with unified diff content. Verified that the codebase accesses `filename` from this response; `patch` is a sibling field on the same response object. HIGH confidence this field exists.
- GitHub REST API: `pulls.list()` with `state: "closed"` returns `merged_at` field for filtering merged PRs. Verified via `expertise-scorer.ts` line 216 which checks `pr.merged_at`.

### Tertiary (LOW confidence)
- Patch truncation behavior: Training data suggests GitHub truncates `patch` field for files exceeding ~300 lines of diff. Not verified against current API docs. Impact is low -- partial diffs still provide value.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- existing patterns in codebase for all operations (PR listing, file fetching, evidence storage, issue parsing)
- Pitfalls: HIGH -- based on direct codebase analysis and known GitHub API behaviors

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, no fast-moving dependencies)
