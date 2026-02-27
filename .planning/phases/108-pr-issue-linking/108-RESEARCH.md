# Phase 108: PR-Issue Linking - Research

**Researched:** 2026-02-27
**Domain:** GitHub PR-issue reference parsing, semantic search, review prompt enrichment
**Confidence:** HIGH

## Summary

Phase 108 adds PR-to-issue linking via two mechanisms: (1) explicit reference parsing from PR body and commit messages using GitHub-standard keywords (`fixes`, `closes`, `resolves`, `relates-to`), and (2) semantic search against the existing issue corpus when no explicit references are found. Linked issue context (title, status, description summary) is then injected into the review prompt so Claude produces context-aware reviews.

The codebase already has all foundational pieces: `IssueStore` with `searchByEmbedding()` and `getByNumber()` (from Phase 106), an `EmbeddingProvider` for generating query vectors, `buildReviewPrompt()` accepting extensible context parameters, and commit message fetching (`fetchCommitMessages()`). The implementation is primarily wiring new modules into the existing review pipeline.

**Primary recommendation:** Build three focused modules -- `issue-reference-parser.ts` (regex extraction), `issue-linker.ts` (orchestration of parsing + semantic fallback + issue fetching), and a `buildReviewPrompt` extension for linked issue context -- then wire into `review.ts` at the existing retrieval context injection point.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Embedded in the review comment (not a separate bot comment)
- Each issue shown as compact: #42 (open) -- "Login fails on mobile" (title + status + link)
- Two separate sections: "Referenced Issues" for explicit refs, "Possibly Related" for semantic matches
- If no linked issues found (no explicit refs, no semantic matches above threshold), omit the section entirely -- zero noise
- Surface top 3 candidates maximum for semantic matches
- Conservative / high threshold (80%+ similarity) -- fewer suggestions, higher confidence
- Skip semantic search entirely if explicit refs are found -- trust the author's references
- Search query built from PR title + body + diff summary for richer context matching
- Inject linked issue context as: title + status + description summary
- Explicit refs framed as "this PR addresses these issues" (primary context)
- Semantic matches framed as "possibly related" (secondary context)
- Reviewer should include a coverage assessment: whether linked issues appear addressed, partially addressed, or unrelated to the changes
- Closed issues still included in prompt -- useful for understanding prior work, follow-ups, regressions
- Recognize GitHub standard keywords: fixes, closes, resolves (all case-insensitive)
- Also recognize: relates-to (non-closing reference, case-insensitive)
- Extract references from PR body + commit messages
- Support cross-repo references within the same org (org/repo#N patterns)
- Case-insensitive matching for all patterns

### Claude's Discretion
- Exact regex patterns for reference extraction
- Description summary truncation length
- How diff summary is generated for semantic search input
- Handling of references to issues that don't exist or can't be fetched (404s)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PRLINK-01 | PR body and commit messages are parsed for explicit issue references (fixes, closes, relates-to patterns) | `issue-reference-parser.ts` module with regex patterns; existing `fetchCommitMessages()` in review.ts provides commit text |
| PRLINK-02 | When no explicit references are found, semantic search finds related issues from the corpus | `IssueStore.searchByEmbedding()` already exists; new `issue-linker.ts` orchestrates the fallback path with 0.80 cosine distance threshold |
| PRLINK-03 | Linked issue context is included in PR review prompts for richer review feedback | New `linkedIssues` parameter on `buildReviewPrompt()`; prompt section with coverage assessment instruction |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Built-in RegExp | N/A | Issue reference pattern matching | Standard JS regex; no external library needed for GitHub keyword patterns |
| IssueStore (internal) | N/A | `getByNumber()` for fetching issue details by reference, `searchByEmbedding()` for semantic search | Already implemented in Phase 106 |
| EmbeddingProvider (internal) | N/A | Generate query embedding from PR title+body+diff for semantic search | Already wired via `embeddingProvider.generate()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @octokit/webhooks-types | existing | PR event types already imported in review.ts | Already in use |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom regex | `github-markdown-links` npm | Overkill; GitHub issue ref patterns are well-defined and simple |
| Vector search only | Full-text + vector hybrid | Hybrid would be better quality but CONTEXT.md says skip semantic when explicit refs found; vector-only is fine for fallback |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   └── issue-reference-parser.ts     # Pure regex extraction (no I/O)
│   └── issue-reference-parser.test.ts
├── knowledge/
│   └── issue-linker.ts               # Orchestration: parse refs → fetch issues → semantic fallback
│   └── issue-linker.test.ts
├── execution/
│   └── review-prompt.ts              # Extended with linkedIssues parameter
├── handlers/
│   └── review.ts                     # Wiring: call linker, pass results to prompt builder
```

### Pattern 1: Pure Parser Module
**What:** `issue-reference-parser.ts` as a pure function with zero I/O dependencies
**When to use:** Always for the parsing layer
**Why:** Follows existing patterns like `pr-intent-parser.ts` -- pure extraction, fully unit-testable

```typescript
export type IssueReference = {
  issueNumber: number;
  keyword: "fixes" | "closes" | "resolves" | "relates-to";
  isClosing: boolean;
  /** For cross-repo refs: "org/repo". Null for same-repo. */
  crossRepo: string | null;
  source: "body" | "commit";
};

export function parseIssueReferences(params: {
  prBody: string;
  commitMessages: string[];
}): IssueReference[];
```

### Pattern 2: Orchestrator with Fallback
**What:** `issue-linker.ts` orchestrates: parse → fetch → (if no refs) semantic search
**When to use:** Called from review.ts handler
**Why:** Follows fail-open pattern used throughout codebase (try/catch with logger.warn)

```typescript
export type LinkedIssue = {
  issueNumber: number;
  repo: string;
  title: string;
  state: string;
  descriptionSummary: string;
  linkType: "referenced" | "semantic";
  keyword?: string;
  similarity?: number;
};

export type LinkResult = {
  referencedIssues: LinkedIssue[];
  semanticMatches: LinkedIssue[];
};

export async function linkPRToIssues(params: {
  prBody: string;
  prTitle: string;
  commitMessages: string[];
  diffSummary: string;
  repo: string;
  owner: string;
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  logger: Logger;
  semanticThreshold?: number; // default 0.80
  maxSemanticResults?: number; // default 3
}): Promise<LinkResult>;
```

### Pattern 3: Review Prompt Extension
**What:** Add `linkedIssues` parameter to `buildReviewPrompt()`, render as a new section
**When to use:** When linked issues exist
**Why:** Follows existing pattern of optional context parameters (e.g., `reviewPrecedents`, `wikiKnowledge`, `clusterPatterns`)

### Anti-Patterns to Avoid
- **Fetching issues via Octokit in the parser:** Keep parser pure (regex only). Issue fetching goes in the linker.
- **Blocking review on issue fetch failures:** Must be fail-open. If IssueStore is down or issues can't be fetched, review proceeds without linked issues.
- **Running semantic search when explicit refs exist:** CONTEXT.md explicitly says skip semantic when refs found.
- **Adding a separate bot comment for linked issues:** Must be embedded in the review prompt, not a separate comment.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Issue corpus search | Custom SQL queries | `IssueStore.searchByEmbedding()` and `getByNumber()` | Already implemented with proper pgvector HNSW indexes |
| Text embedding | Custom embedding call | `embeddingProvider.generate()` | Already handles Voyage AI, fail-open, caching |
| PR commit messages | Custom git log parsing | `fetchCommitMessages()` in review.ts | Already paginated, handles edge cases |

**Key insight:** Phase 106 already built the issue corpus infrastructure. This phase is primarily wiring and orchestration, not infrastructure.

## Common Pitfalls

### Pitfall 1: Cosine Distance vs Similarity Confusion
**What goes wrong:** Mixing up cosine distance (0 = identical) with cosine similarity (1 = identical)
**Why it happens:** `IssueStore.searchByEmbedding()` returns `distance` (lower = more similar), but CONTEXT.md says "80%+ similarity"
**How to avoid:** Convert: similarity = 1 - distance. So 80% similarity = 0.20 max distance threshold.
**Warning signs:** Getting zero results or too many results

### Pitfall 2: Cross-Repo Reference Handling
**What goes wrong:** Trying to fetch issues from other repos without the right Octokit scope
**Why it happens:** `org/repo#N` patterns reference issues in different repositories
**How to avoid:** For Phase 108, use `IssueStore.getByNumber()` which is scoped to the local corpus. Cross-repo issues may not be in the corpus. Handle gracefully with a skip + log.
**Warning signs:** 404 errors on issue fetch

### Pitfall 3: Regex Greediness with Markdown
**What goes wrong:** Regex matches issue references inside code blocks, URLs, or escaped text
**Why it happens:** PR bodies contain markdown with code blocks that may reference issue numbers
**How to avoid:** Strip code blocks (triple-backtick sections) before parsing. Be careful with inline code too.
**Warning signs:** False positive issue references

### Pitfall 4: Empty Diff Summary for Semantic Search
**What goes wrong:** Building a semantic search query with only title+body when diff is huge or not yet analyzed
**Why it happens:** `diffAnalysis` runs in review.ts but linker may be called before it completes
**How to avoid:** Make diff summary an optional input. Fall back to title+body if not available.
**Warning signs:** Low-quality semantic matches

### Pitfall 5: Description Summary Truncation
**What goes wrong:** Issue bodies can be extremely long (10K+ chars with logs, stack traces)
**Why it happens:** GitHub issues have no body length limit
**How to avoid:** Truncate description summary to ~500 chars for the review prompt context. Focus on the first paragraph or "problem summary" section.
**Warning signs:** Prompt token budget blown by a single verbose issue body

## Code Examples

### Reference Parsing Regex
```typescript
// GitHub standard closing keywords + relates-to
// Matches: "fixes #42", "Closes org/repo#123", "relates-to #7"
const ISSUE_REF_REGEX = /(?:^|\s)(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|relates?[- ]to)\s+(?:([a-z0-9_.-]+\/[a-z0-9_.-]+)#(\d+)|#(\d+))/gi;

function parseReferences(text: string): IssueReference[] {
  const refs: IssueReference[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(ISSUE_REF_REGEX)) {
    const crossRepo = match[1] ?? null;
    const number = parseInt(match[2] ?? match[3] ?? "0", 10);
    if (number === 0) continue;

    const key = `${crossRepo ?? ""}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const keyword = match[0].trim().split(/\s+/)[0]!.toLowerCase();
    const isClosing = !keyword.startsWith("relate");

    refs.push({ issueNumber: number, keyword, isClosing, crossRepo });
  }
  return refs;
}
```

### Semantic Search Fallback
```typescript
async function findSemanticMatches(params: {
  query: string;
  repo: string;
  issueStore: IssueStore;
  embeddingProvider: EmbeddingProvider;
  threshold: number;
  maxResults: number;
}): Promise<IssueSearchResult[]> {
  const embedResult = await params.embeddingProvider.generate(params.query, "query");
  if (!embedResult?.embedding) return []; // fail-open

  const results = await params.issueStore.searchByEmbedding({
    queryEmbedding: embedResult.embedding,
    repo: params.repo,
    topK: params.maxResults * 2, // fetch extra, filter by threshold
  });

  // Filter by distance threshold (distance = 1 - similarity)
  // 80% similarity = 0.20 max distance
  const maxDistance = 1 - params.threshold;
  return results
    .filter(r => r.distance <= maxDistance)
    .slice(0, params.maxResults);
}
```

### Review Prompt Linked Issues Section
```typescript
function buildLinkedIssuesSection(linkedIssues: LinkResult): string {
  const lines: string[] = [];

  if (linkedIssues.referencedIssues.length > 0) {
    lines.push("## Referenced Issues");
    lines.push("This PR addresses these issues:");
    for (const issue of linkedIssues.referencedIssues) {
      lines.push(`- #${issue.issueNumber} (${issue.state}) -- "${issue.title}"`);
      if (issue.descriptionSummary) {
        lines.push(`  Summary: ${issue.descriptionSummary}`);
      }
    }
  }

  if (linkedIssues.semanticMatches.length > 0) {
    lines.push("## Possibly Related Issues");
    for (const issue of linkedIssues.semanticMatches) {
      lines.push(`- #${issue.issueNumber} (${issue.state}) -- "${issue.title}" (${Math.round((1 - (issue.similarity ?? 0)) * 100)}% match)`);
      if (issue.descriptionSummary) {
        lines.push(`  Summary: ${issue.descriptionSummary}`);
      }
    }
  }

  if (lines.length > 0) {
    lines.push("");
    lines.push("Assess whether the PR changes adequately address the referenced issues. Note any issues that appear only partially addressed or unrelated to the actual changes.");
  }

  return lines.join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual issue linking | GitHub auto-linking from keywords | GitHub native | Our regex mirrors GitHub's own keyword recognition |
| Keyword-only linking | Keyword + semantic fallback | This phase | Catches PRs where author forgot to add refs |

## Open Questions

1. **IssueStore availability in review handler**
   - What we know: `IssueStore` is created in the knowledge layer but may not be injected into review handler yet
   - What's unclear: The exact dependency injection path from `index.ts` to `review.ts`
   - Recommendation: Check `index.ts` for store wiring; likely needs to add `issueStore` to the handler dependencies

2. **Diff summary generation for semantic search**
   - What we know: `diffAnalysis` contains file-level analysis but no pre-built "summary" string
   - What's unclear: Best way to build a concise text summary from diff analysis
   - Recommendation: Concatenate PR title + first 500 chars of PR body + changed file paths as the semantic query. Keep it simple.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/knowledge/issue-store.ts`, `src/knowledge/issue-types.ts` -- IssueStore API
- Codebase analysis: `src/handlers/review.ts` -- review pipeline, prompt building, retrieval injection points
- Codebase analysis: `src/execution/review-prompt.ts` -- `buildReviewPrompt()` parameter interface
- Codebase analysis: `src/lib/pr-intent-parser.ts` -- existing pure-parser pattern
- Codebase analysis: `src/knowledge/cross-corpus-rrf.ts` -- SourceType and UnifiedRetrievalChunk types

### Secondary (MEDIUM confidence)
- GitHub docs: Closing references keyword list (fixes, closes, resolves + variants)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all infrastructure exists, no new dependencies
- Architecture: HIGH - follows established codebase patterns exactly
- Pitfalls: HIGH - based on direct codebase analysis

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain, no external dependencies)
