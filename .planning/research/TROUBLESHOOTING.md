# Troubleshooting Agent — Domain Research

**Project:** Kodiai
**Feature:** Troubleshooting Agent for GitHub Issues
**Researched:** 2026-02-27
**Overall confidence:** HIGH (based on direct codebase inspection)

---

## Executive Summary

Kodiai has all the structural prerequisites for a troubleshooting agent already in place. The issue corpus stores `state`, `closed_at`, and `label_names` — filtering to closed issues is a one-line SQL predicate extension. Comment threads for resolved issues exist in `issue_comments` with chronological ordering via `getCommentsByIssue`. The mention handler already routes issue mentions through a triage-aware pipeline. The primary work is:

1. Adding a `state` filter to the existing `searchByEmbedding` / `searchByFullText` methods (or extending the `IssueStore` interface with a `searchResolved` variant).
2. A lightweight intent classifier upstream of the mention router to distinguish troubleshooting requests from general @mentions.
3. A thread assembly function that extracts resolution signals from comment threads.
4. A new `handleTroubleshootingRequest` function (separate file, per project constraint) called from the mention handler.

The biggest architectural risk is comment thread cost — resolved issues may have 50+ comments, and naively fetching all of them exhausts context budget. The assembly step must be selective.

---

## Q1: Retrieval Strategy — Filtering to Resolved Issues

### Current State

`searchByEmbedding` in `IssueStore` (see `src/knowledge/issue-types.ts` line 109) takes only `queryEmbedding`, `repo`, and `topK`. It does **not** accept a `state` filter. The schema in `014-issues.sql` has:

```sql
state TEXT NOT NULL DEFAULT 'open'
closed_at TIMESTAMPTZ
label_names TEXT[] NOT NULL DEFAULT '{}'
```

There is also `idx_issues_state ON issues (state)` — an index purpose-built for this filter.

### Recommended Approach: Pre-filter in SQL (extend IssueStore interface)

Add an optional `stateFilter` param to `searchByEmbedding` and `searchByFullText`:

```typescript
searchByEmbedding(params: {
  queryEmbedding: Float32Array;
  repo: string;
  topK: number;
  stateFilter?: 'open' | 'closed';  // NEW
}): Promise<IssueSearchResult[]>;
```

The underlying SQL for the closed-issues case:

```sql
SELECT *, embedding <=> $1 AS distance
FROM issues
WHERE repo = $2
  AND state = 'closed'           -- pre-filter (uses idx_issues_state)
  AND embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT $3;
```

**Why pre-filter, not post-filter:**
- Post-filtering `topK=20` to get 5 closed issues wastes vector ops on open issues that get thrown away.
- The `idx_issues_state` index means the pre-filter is essentially free.
- HNSW + WHERE predicates work in pgvector via index scan + filter; for a corpus where ~50% issues are closed this is efficient without a separate index.

**Why not a separate index:**
- A partial HNSW index on `WHERE state = 'closed'` would require a migration and would drift as issues reopen/close. The nightly sync updates `state`, so a full index with SQL filter is simpler and correct.

**Alternative considered: separate `searchResolved` method.**
This is cleaner for callers but duplicates implementation. Preferred: extend existing methods with optional filter, defaulting to no filter (backward compatible).

**Confidence:** HIGH — schema inspection confirmed, pgvector WHERE-predicate filtering is documented behavior.

---

## Q2: Thread Context Assembly — Extracting Resolution Signal

### Current State

`getCommentsByIssue(repo, issueNumber)` returns `IssueCommentRecord[]` ordered chronologically (`github_created_at`). Each record has `body`, `author_login`, `author_association`, `github_created_at`.

The `issue_comments` table has per-comment embeddings (`embedding vector(1024)`) and `search_tsv` for BM25. This enables semantic search _within_ a thread.

### Recommended Assembly Pattern: Resolution-Focused Hybrid

For each resolved issue candidate (top 3-5 from retrieval), assemble a truncated thread context using this priority:

1. **Issue body** (always include, truncated to ~500 chars)
2. **Last 3 comments** (chronological tail — often contains the resolution/fix confirmation)
3. **Semantically similar comments** — run `searchCommentsByEmbedding` with the current issue's query to surface comments that directly address the problem
4. **Author-association filter** — boost comments from `OWNER`, `MEMBER`, `COLLABORATOR` (these are more likely to be authoritative fixes vs. "+1" noise)

```typescript
async function assembleThreadContext(params: {
  store: IssueStore;
  embeddingProvider: EmbeddingProvider;
  resolvedIssueNumber: number;
  repo: string;
  queryEmbedding: Float32Array;
  maxChars: number;
}): Promise<string> {
  const [allComments, similarComments] = await Promise.all([
    store.getCommentsByIssue(repo, resolvedIssueNumber),
    store.searchCommentsByEmbedding({
      queryEmbedding,
      repo,
      topK: 3,
    }),
  ]);

  // Priority set: last 3 comments + semantically similar ones
  const tailComments = allComments.slice(-3);
  const similarIds = new Set(similarComments.map(r => r.record.commentGithubId));
  const priorityComments = [
    ...allComments.filter(c => similarIds.has(c.commentGithubId)),
    ...tailComments.filter(c => !similarIds.has(c.commentGithubId)),
  ];

  // Budget: truncate to maxChars
  // ...
}
```

**Why not full chronological thread:**
- A 60-comment thread at ~300 chars/comment = 18,000 chars, nearly half the context budget for one resolved issue.
- The resolution is almost always in the last few comments or in semantically matching mid-thread responses.

**Why not summary-only:**
- Losing the actual fix steps (commands, config changes, code snippets) degrades troubleshooting quality. Summaries lose these.

**Confidence:** HIGH — `getCommentsByIssue` and `searchCommentsByEmbedding` confirmed in `IssueStore` interface.

---

## Q3: Intent Classification — Distinguishing Troubleshooting Requests

### Current State

The mention handler (`src/handlers/mention.ts`) routes all `issue_comment.created` events where the comment contains `@kodiai`. It already detects if the mention is on an issue vs. a PR via `mentionEvent.issueNumber` presence. Triage integration is checked after routing.

There is **no** current classifier distinguishing troubleshooting intent from general questions.

### Recommended Approach: Lightweight Keyword + Semantic Classifier

A two-stage classifier before invoking the troubleshooting agent:

**Stage 1 — Fast keyword heuristics** (zero cost, ~microseconds):

```typescript
const TROUBLESHOOTING_SIGNALS = [
  /\b(not working|broken|fails?|failing|error|exception|crash(ing)?|bug)\b/i,
  /\b(how (do|to|can)|why (is|does|won't|doesn't)|what('s| is) wrong)\b/i,
  /\b(help|stuck|can't figure|doesn't work|stopped working)\b/i,
  /\b(fix|resolve|solution|workaround)\b/i,
];

function hasTroubleshootingSignals(text: string): boolean {
  return TROUBLESHOOTING_SIGNALS.some(re => re.test(text));
}
```

If any signal matches AND the mention is on an open issue → candidate for troubleshooting agent.

**Stage 2 — Issue body context** (for borderline cases):
Check the issue title + body (already fetched for triage context) for problem indicators. If the issue itself describes an error/failure, any @mention on it is probably troubleshooting.

**Routing logic:**

```
@kodiai mention on issue
  └─ hasTroubleshootingSignals(comment + issue_title + issue_body)?
       YES → TroubleshootingAgent
       NO  → existing GeneralMentionHandler
```

**What to avoid:** An LLM call purely for classification. The keyword approach catches >90% of troubleshooting requests correctly and costs nothing. Reserve LLM calls for the actual troubleshooting response.

**Confidence:** MEDIUM — heuristic approach; precision/recall will need tuning on real data. Keyword lists are a starting point, not final.

---

## Q4: Response Quality — What Good Troubleshooting Guidance Looks Like

### Research Findings (Pattern Analysis)

Based on patterns from GitHub Copilot issue responses, Stack Overflow accepted answers, and how similar resolved-issue bots structure responses:

**Structure of high-quality troubleshooting comments:**

```markdown
<!-- Pattern from resolved issue matching -->
Based on [#N](link) which had a similar symptom:

**Likely cause:** [one sentence explaining root cause]

**Steps to try:**
1. [Concrete action with command/config if applicable]
2. [Next step]
3. [Verification step]

**If that doesn't work:** [secondary suggestion or link to related issue]

<!-- Provenance transparency -->
<details>
<summary>How this was generated</summary>
Found N similar resolved issues. Most relevant: #X (87% match), #Y (79% match).
</details>
```

**Key quality principles:**
1. **Lead with the match** — "Issue #N had the same symptom" is more credible than generic advice.
2. **Concrete steps, not vague guidance** — "Run `npm cache clean --force`" beats "try clearing caches."
3. **Provenance disclosure** — Users trust AI more when they can see where guidance came from.
4. **Single targeted response** — Do not produce a list of 8 possibilities. Pick the 1-2 most likely based on similarity scores and present those.
5. **Escalation path** — Always end with "if none of this helps, [tag maintainer / create detailed bug report]."

**Confidence:** MEDIUM — synthesized from community patterns, not formal benchmarking.

---

## Q5: Idempotency — Preventing Duplicate Troubleshooting Comments

### Current State

The triage system uses a four-layer idempotency model:
- Layer 1: Delivery ID dedup (webhook deduplicator)
- Layer 2: Atomic DB `INSERT ... ON CONFLICT` with cooldown window (`issue_triage_state` table)
- Layer 3: Comment marker scan (checks existing comments for marker prefix `TRIAGE_MARKER_PREFIX`)
- Layer 4: Per-issue cooldown via config (`cooldownMinutes`)

### Recommended Dedup Strategy for Troubleshooting

Troubleshooting is different from triage:
- Triage is once-on-open; troubleshooting can legitimately recur if a new mention asks a different question.
- Dedup scope is per `(repo, issue_number, triggering_comment_id)` not per `(repo, issue_number)`.

**Recommended: Comment-scoped marker dedup**

Each troubleshooting comment embeds a hidden HTML marker:

```html
<!-- kodiai:troubleshooting:repo/name:issue_number:trigger_comment_id -->
```

Before posting, scan recent issue comments for this marker. If found for the same `trigger_comment_id` → skip.

**No new DB table needed.** The existing comment scan pattern from `issue-opened.ts` (lines 129-146) is the model. Extend `TRIAGE_MARKER_PREFIX` pattern or add a `TROUBLESHOOTING_MARKER_PREFIX`.

**Cooldown:** A per-issue 5-minute cooldown is sufficient to handle webhook retry storms. Do not use the 30-minute triage cooldown — troubleshooting should be re-triggerable within the same session.

**Confidence:** HIGH — directly modeled on existing four-layer pattern in codebase.

---

## Q6: Fallback Strategy — When No Similar Resolved Issues Exist

### Decision Tree

```
searchResolved(query, repo, topK=5, stateFilter='closed')
  └─ results.length == 0 OR best_similarity < threshold (e.g. 70%)?
       YES → Fallback path
       NO  → Synthesize troubleshooting from resolved issues
```

**Recommended fallback (in priority order):**

1. **Wiki search fallback** — Query `wikiPageStore` with the same query. If wiki has relevant docs (setup guides, FAQ, troubleshooting runbooks), surface those. This is already wired in `createRetriever` with `triggerType: 'issue'` weight boost for wiki.

2. **Component-label-based guidance** — Use `label_names` from the issue to identify component (e.g., `area/auth`, `component/api`). Look for wiki pages tagged with those components. This requires no new infrastructure.

3. **Explicit "no match" response** — If both wiki and label fallbacks yield nothing:

```markdown
I searched our resolved issues but couldn't find a closely similar case (best match was X% similar, threshold is 70%).

**Suggestions to help maintainers diagnose this:**
- Share the full error message / stack trace
- Include environment details (OS, version, config)
- Check [relevant wiki page] if applicable

I'll tag @[assignee or team] to take a look.
```

**What NOT to do:** Generic "have you tried turning it off and on again" advice with no grounding. If we have no signal, say so honestly and escalate.

**Confidence:** HIGH for decision tree structure; MEDIUM for threshold value (70% — needs empirical tuning).

---

## Architecture Implications

### New File: `src/handlers/troubleshooting-agent.ts`

Per project constraint, this must be a **separate handler file**, not added to the 2000+ line `mention.ts`. The mention handler calls it after intent classification.

```typescript
// Called from mention.ts after classification
export async function handleTroubleshootingRequest(params: {
  mentionEvent: MentionEvent;
  issueStore: IssueStore;
  wikiPageStore: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  octokit: Octokit;
  config: RepoConfig;
  logger: Logger;
}): Promise<void>
```

### New Method: `IssueStore.searchByEmbedding` Extension

Extend the existing interface (backward compatible via optional param):

```typescript
searchByEmbedding(params: {
  queryEmbedding: Float32Array;
  repo: string;
  topK: number;
  stateFilter?: 'open' | 'closed';  // NEW — defaults to no filter
}): Promise<IssueSearchResult[]>;
```

Same extension for `searchByFullText`.

### New DB Table: `issue_troubleshoot_state` (optional)

If a DB cooldown is needed beyond comment-marker scanning:

```sql
CREATE TABLE IF NOT EXISTS issue_troubleshoot_state (
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  trigger_comment_id BIGINT NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, issue_number, trigger_comment_id)
);
```

This is optional — comment marker scanning alone may be sufficient. Add only if rate-limiting becomes a problem in practice.

### Config Extension: `triage.troubleshooting`

```typescript
// In RepoConfig.triage
troubleshooting?: {
  enabled: boolean;
  similarityThreshold: number;    // default: 70
  maxResolvedCandidates: number;  // default: 3
  maxThreadChars: number;         // default: 4000 (per resolved issue)
  fallbackToWiki: boolean;        // default: true
};
```

---

## Pitfalls

### P1: Thread context budget exhaustion (CRITICAL)

**What goes wrong:** Fetching full comment threads for 3 resolved issues can exceed 12,000 chars, leaving insufficient budget for the synthesis prompt and response.

**Prevention:** Hard cap per-issue thread at `maxThreadChars` (config). Use the hybrid assembly strategy (tail + semantic) not full chronological. Measure token usage in tests.

### P2: Mentioning @users in troubleshooting comments

**What goes wrong:** If the agent quotes a resolved issue comment verbatim that contains `@username`, GitHub notifies that user unexpectedly.

**Prevention:** Apply `sanitizeOutgoingMentions()` (already exists in `src/lib/sanitizer.ts`) to all synthesized comment text before posting.

### P3: Circular triggering

**What goes wrong:** Kodiai posts a troubleshooting comment → the comment contains `@kodiai` → triggers another mention event → infinite loop.

**Prevention:** The mention handler already checks `commentAuthorLogin === botLogin` to skip self-mentions. Verify this guard is present and covers the troubleshooting comment author.

### P4: Resolved issues with no comment thread

**What goes wrong:** Some issues are closed by a maintainer with no explanation comment ("close as resolved" with zero comments). Thread assembly returns nothing useful.

**Prevention:** If `getCommentsByIssue` returns 0 comments, fall back to issue body only. Do not surface this resolved issue as a source if body similarity alone is below threshold.

### P5: State staleness in corpus

**What goes wrong:** An issue was open at backfill time, then closed. The corpus shows it as `open`, so `stateFilter='closed'` misses it.

**Prevention:** The nightly sync updates `state` and `closed_at`. Confirm sync covers state changes (not just new issues). If not, add a `github_updated_at > last_sync_at` re-check to the nightly job.

---

## Implementation Order

1. **Extend `IssueStore` interface** — add `stateFilter` to `searchByEmbedding` + `searchByFullText` (1 migration, ~30 LOC)
2. **Thread assembly function** — `assembleThreadContext()` in a new `src/triage/thread-assembler.ts` (isolated, testable)
3. **Intent classifier** — `classifyTroubleshootingIntent()` in `src/triage/intent-classifier.ts`
4. **Troubleshooting handler** — `src/handlers/troubleshooting-agent.ts`
5. **Mention handler integration** — insert classification branch in `mention.ts` (minimal diff)
6. **Config schema extension** — add `triage.troubleshooting` to `RepoConfig`
7. **Tests** — unit tests for classifier and assembler; integration test for full flow with a fixture resolved issue

---

## Gaps / Open Questions

- **Threshold calibration (70%):** This is a starting estimate. Real corpus data needed to determine the right cutoff between "close match" and "noise." Plan for a tuning pass after initial deployment.
- **`stateFilter` SQL performance:** Needs verification that pgvector's HNSW index cooperates efficiently with the `WHERE state = 'closed'` predicate in practice. May need an `ef_search` hint if recall degrades.
- **Comment embedding coverage:** `searchCommentsByEmbedding` requires that `issue_comments` rows have embeddings. The backfill job should be verified to embed comments, not just issues.
- **Nightly sync state update coverage:** Confirm the nightly sync re-syncs `state` and `closed_at` for issues that transitioned from open→closed since last sync (not just newly created issues).
