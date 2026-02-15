# Phase 31: Incremental Re-review with Retrieval Context - Research

**Researched:** 2026-02-12
**Domain:** Incremental diff-based re-review, prior finding deduplication, semantic retrieval for prompt context, fail-open degradation
**Confidence:** HIGH

## Summary

Phase 31 builds on Phase 30's durable run identity (SHA-keyed run state) and learning memory store (sqlite-vec embeddings) to deliver three interrelated capabilities: (1) incremental re-review that only analyzes changed hunks when a PR receives new commits, (2) duplicate comment suppression that avoids repeating findings for unchanged code while keeping unresolved prior findings visible, and (3) bounded semantic retrieval of similar prior findings to enrich the review prompt with relevant learning context.

The existing codebase already has the infrastructure needed. The `run_state` table records `(base_sha, head_sha)` for each review run, enabling the system to determine the "last reviewed" SHA. The `findings` table records every finding with `(file_path, start_line, end_line, title, severity, review_id, comment_id)`, providing the data needed to detect duplicates. The `learning_memory_vec` vec0 virtual table with repo partition keys provides KNN vector search with distance thresholds. The `IsolationLayer` in `src/learning/isolation.ts` already implements bounded retrieval with provenance. The core challenge is wiring these existing capabilities into the review pipeline and adding the `pull_request.synchronize` event handling.

The incremental review mechanism hinges on three git operations already available in the workspace: `git diff OLD_HEAD...NEW_HEAD --name-only` to find files changed between the old and new head commits, `git diff origin/BASE...HEAD` to get the full PR diff (as today), and then filtering the review prompt to only include hunks from files that changed since the last reviewed head SHA. For duplicate suppression, the knowledge store's `findings` table provides a fingerprint-based lookup of prior findings by file path and title hash. For retrieval context, the existing `EmbeddingProvider.generate()` with `inputType: "query"` produces query embeddings, and `IsolationLayer.retrieveWithIsolation()` returns bounded, threshold-filtered results ready for prompt injection.

**Primary recommendation:** Register for `pull_request.synchronize` events, use the `before` payload field as the previous head SHA to compute incremental diffs, query prior findings from the knowledge store to suppress duplicates, and inject bounded retrieval results into the review prompt -- all with fail-open semantics so any failure degrades to a full review rather than blocking publication.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun:sqlite` | builtin | Query run_state and findings tables for prior review context | Already used; provides the SHA history and finding records needed for incremental behavior |
| `sqlite-vec` | `0.1.6` | KNN vector search for similar prior findings | Already loaded by Phase 30; provides bounded retrieval with partition key isolation |
| `voyageai` | `0.1.0` | Generate query embeddings for retrieval | Already initialized by Phase 30; use `inputType: "query"` for retrieval queries |
| `@octokit/webhooks-types` | existing | Type-safe access to `PullRequestSynchronizeEvent` payload with `before`/`after` fields | Already a dependency; provides typed `before: string` and `after: string` for SHA tracking |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `picomatch` | existing | Path matching for skipPaths on incremental file list | Already used in review handler; reuse for filtering incremental changed files |
| `pino` | existing | Structured logging for incremental vs full review decisions | Already used; extend with `reviewMode: "incremental" \| "full"` log field |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `git diff OLD_HEAD...NEW_HEAD --name-only` in workspace | GitHub Compare API (`/repos/{owner}/{repo}/compare/{base}...{head}`) | Git workspace diff is free, instant, and already available. GitHub API adds latency, rate limit consumption, and has a 300-file limit. Use workspace git. |
| Fingerprint-based finding dedup (title hash + file path) | Full text similarity matching for dedup | Fingerprint is deterministic and fast; text similarity adds latency and complexity. Fingerprint is sufficient for same-bot findings. |
| Query embeddings via Voyage AI | Re-use existing document embeddings as queries | Voyage AI docs recommend `inputType: "query"` for retrieval queries and `inputType: "document"` for stored documents. Using the correct input type improves retrieval quality. |

**Installation:**
No new dependencies. All libraries already installed from Phase 30.

## Architecture Patterns

### Recommended Project Structure
```
src/
  handlers/
    review.ts                    # MODIFIED: add synchronize event, incremental diff logic, retrieval context injection
  execution/
    review-prompt.ts             # MODIFIED: accept retrieval context and prior findings for prompt enrichment
    config.ts                    # MODIFIED: add triggers.onSynchronize, retrieval config section
    diff-analysis.ts             # UNCHANGED (already handles full PR diff)
  knowledge/
    types.ts                     # MODIFIED: add queries for prior findings by PR and head SHA
    store.ts                     # MODIFIED: add getPriorReviewFindings, getLastReviewedHeadSha queries
  learning/
    isolation.ts                 # UNCHANGED (already provides bounded retrieval with provenance)
    types.ts                     # POSSIBLY MODIFIED: add RetrievalContextForPrompt type
    embedding-provider.ts        # UNCHANGED (already supports inputType: "query")
    memory-store.ts              # UNCHANGED
  lib/
    incremental-diff.ts          # NEW: compute files changed between two head SHAs, hunk filtering
    finding-dedup.ts             # NEW: fingerprint matching for prior finding deduplication
```

### Pattern 1: Incremental Diff Computation via Previous Head SHA
**What:** On `pull_request.synchronize` events, the payload includes `before` (old head SHA) and `after` (new head SHA). The system looks up the last *completed* review run for this PR in `run_state`, extracts its `head_sha`, and uses `git diff LAST_REVIEWED_HEAD...CURRENT_HEAD --name-only` to find files that changed since the last review. Only these files are sent for review. If no prior completed review exists, fall back to a full review.
**When to use:** Every `synchronize` event after the initial review on `opened`.

```typescript
// Source: codebase analysis + git documentation
interface IncrementalDiffResult {
  mode: "incremental" | "full";
  changedFilesSinceLastReview: string[];  // only for incremental mode
  allChangedFiles: string[];              // full PR diff file list (always computed)
  lastReviewedHeadSha: string | null;
  reason: string;                          // why incremental or full
}

async function computeIncrementalDiff(params: {
  workspaceDir: string;
  baseRef: string;
  currentHeadSha: string;
  repo: string;
  prNumber: number;
  knowledgeStore: KnowledgeStore;
  logger: Logger;
}): Promise<IncrementalDiffResult> {
  // Step 1: Get last completed review's head SHA from run_state
  const lastHeadSha = params.knowledgeStore.getLastReviewedHeadSha({
    repo: params.repo,
    prNumber: params.prNumber,
  });

  if (!lastHeadSha) {
    return {
      mode: "full",
      changedFilesSinceLastReview: [],
      allChangedFiles: [],  // filled by caller
      lastReviewedHeadSha: null,
      reason: "no-prior-review",
    };
  }

  // Step 2: Check if the old head SHA is reachable in this workspace
  const isReachable = await $`git -C ${params.workspaceDir} cat-file -t ${lastHeadSha}`
    .quiet()
    .nothrow();

  if (isReachable.exitCode !== 0) {
    // Force-push may have made old SHA unreachable
    return {
      mode: "full",
      changedFilesSinceLastReview: [],
      allChangedFiles: [],
      lastReviewedHeadSha: lastHeadSha,
      reason: "prior-sha-unreachable",
    };
  }

  // Step 3: Compute files changed between last reviewed head and current head
  const diffResult = await $`git -C ${params.workspaceDir} diff ${lastHeadSha}...HEAD --name-only`
    .quiet()
    .nothrow();

  if (diffResult.exitCode !== 0) {
    return {
      mode: "full",
      changedFilesSinceLastReview: [],
      allChangedFiles: [],
      lastReviewedHeadSha: lastHeadSha,
      reason: "diff-computation-failed",
    };
  }

  const changedFiles = diffResult.stdout.toString().trim().split("\n").filter(Boolean);

  return {
    mode: "incremental",
    changedFilesSinceLastReview: changedFiles,
    allChangedFiles: [],  // filled by caller
    lastReviewedHeadSha: lastHeadSha,
    reason: `incremental-from-${lastHeadSha.slice(0, 7)}`,
  };
}
```

### Pattern 2: Prior Finding Deduplication via Fingerprint Matching
**What:** Before publishing new findings, compare each against prior findings from the most recent completed review of the same PR. Findings that match on (file_path + title_fingerprint) and whose code lines have NOT changed are suppressed as duplicates. Findings on changed lines are treated as new (the code changed, so the finding may differ). Unresolved prior findings on unchanged code are injected into the prompt as context.
**When to use:** Only in incremental mode (synchronize events).

```typescript
// Source: codebase analysis - uses existing fingerprintFindingTitle function
interface PriorFindingContext {
  // Findings from prior review that are on unchanged code (still relevant)
  unresolvedOnUnchangedCode: PriorFinding[];
  // Fingerprints to suppress (avoid re-commenting on same unchanged issue)
  suppressionFingerprints: Set<string>;
}

interface PriorFinding {
  filePath: string;
  title: string;
  titleFingerprint: string;
  severity: string;
  category: string;
  startLine: number | null;
  endLine: number | null;
  commentId: number | null;
}

function buildPriorFindingContext(params: {
  priorFindings: PriorFinding[];
  changedFilesSinceLastReview: string[];
}): PriorFindingContext {
  const changedFilesSet = new Set(params.changedFilesSinceLastReview);

  const unresolvedOnUnchangedCode: PriorFinding[] = [];
  const suppressionFingerprints = new Set<string>();

  for (const finding of params.priorFindings) {
    // If the file has changed, the finding may no longer apply -- don't suppress
    if (changedFilesSet.has(finding.filePath)) {
      continue;
    }

    // File is unchanged -- this finding is still relevant
    unresolvedOnUnchangedCode.push(finding);
    // Key: filePath + titleFingerprint
    suppressionFingerprints.add(`${finding.filePath}:${finding.titleFingerprint}`);
  }

  return { unresolvedOnUnchangedCode, suppressionFingerprints };
}
```

### Pattern 3: Bounded Retrieval Context Injection into Review Prompt
**What:** Before building the review prompt, generate a query embedding from the PR title + changed files summary, retrieve top-K similar prior findings via the isolation layer, format them as a "Similar Prior Findings" section, and inject into the prompt. If retrieval fails (embedding error, sqlite-vec error, etc.), the review proceeds without retrieval context.
**When to use:** On every review run (both full and incremental).

```typescript
// Source: existing isolation.ts and embedding-provider.ts patterns
interface RetrievalContextForPrompt {
  findings: Array<{
    findingText: string;
    severity: string;
    category: string;
    filePath: string;
    outcome: string;
    distance: number;
    sourceRepo: string;
  }>;
  provenance: {
    repoSources: string[];
    sharedPoolUsed: boolean;
  };
}

async function buildRetrievalContext(params: {
  embeddingProvider: EmbeddingProvider;
  isolationLayer: IsolationLayer;
  queryText: string;
  repo: string;
  owner: string;
  sharingEnabled: boolean;
  topK: number;
  distanceThreshold: number;
  logger: Logger;
}): Promise<RetrievalContextForPrompt | null> {
  try {
    // Generate query embedding
    const embedResult = await params.embeddingProvider.generate(
      params.queryText,
      "query",
    );
    if (!embedResult) {
      params.logger.debug("Retrieval skipped: embedding generation returned null (fail-open)");
      return null;
    }

    // Retrieve similar findings
    const retrieval = params.isolationLayer.retrieveWithIsolation({
      queryEmbedding: embedResult.embedding,
      repo: params.repo,
      owner: params.owner,
      sharingEnabled: params.sharingEnabled,
      topK: params.topK,
      distanceThreshold: params.distanceThreshold,
      logger: params.logger,
    });

    if (retrieval.results.length === 0) {
      return null;
    }

    return {
      findings: retrieval.results.map((r) => ({
        findingText: r.record.findingText,
        severity: r.record.severity,
        category: r.record.category,
        filePath: r.record.filePath,
        outcome: r.record.outcome,
        distance: r.distance,
        sourceRepo: r.sourceRepo,
      })),
      provenance: {
        repoSources: retrieval.provenance.repoSources,
        sharedPoolUsed: retrieval.provenance.sharedPoolUsed,
      },
    };
  } catch (err) {
    params.logger.warn(
      { err },
      "Retrieval context generation failed (fail-open, proceeding without retrieval)",
    );
    return null;
  }
}
```

### Pattern 4: Fail-Open Degradation Chain
**What:** Every step in the incremental + retrieval pipeline has a well-defined fallback:
1. If `getLastReviewedHeadSha` fails --> full review (not incremental)
2. If `git diff OLD_HEAD...HEAD` fails --> full review
3. If prior finding query fails --> no deduplication (review all hunks)
4. If embedding generation fails --> no retrieval context
5. If vec0 KNN query fails --> no retrieval context
6. Review ALWAYS publishes regardless of any failure above.

**When to use:** Every code path in Phase 31.

### Anti-Patterns to Avoid
- **Blocking review on retrieval failure:** Never make review publication depend on successful retrieval. Retrieval is additive context, not a gate.
- **Using `synchronize` event's `before` field as the "last reviewed" SHA:** The `before` field is the head SHA before this specific push, not the last SHA Kodiai reviewed. Multiple pushes may have occurred since the last review. Always query `run_state` for the last completed review's `head_sha`.
- **Re-reviewing all files on incremental mode:** Only pass changed files to the review prompt. Unchanged files should not appear in the diff context section.
- **Suppressing findings on changed files:** If a file has changed, the prior finding may no longer apply or may have evolved. Do not suppress -- let the reviewer re-evaluate.
- **Injecting too many prior findings into prompt:** Hard-cap at 5-10 retrieved findings with a total character budget (e.g., 2000 chars). More context is not always better; it can degrade review quality.
- **Coupling incremental detection to the event type:** The `synchronize` event is the trigger, but the incremental logic should also work for `review_requested` re-reviews if there's a prior completed run. Design the logic to be event-agnostic and state-driven.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search for prior findings | Custom cosine similarity over arrays | `sqlite-vec` vec0 KNN query via `IsolationLayer.retrieveWithIsolation()` | Already built in Phase 30; handles partition keys, distance filtering, provenance |
| SHA-based review history lookup | Manual file-based tracking or GitHub API commit scanning | SQLite `run_state` table query for `head_sha WHERE status='completed'` | Already built in Phase 30; durable, fast, handles force-push supersession |
| Finding fingerprinting for dedup | Custom hash function | Existing `fingerprintFindingTitle()` in review.ts | Already built; uses FNV-1a hash on normalized title text |
| Diff between two SHAs | GitHub Compare API | `git diff` in workspace | Workspace already cloned with history; git diff is free, instant, no rate limits |
| Query embedding generation | Raw fetch to Voyage API | `embeddingProvider.generate(text, "query")` | Already built in Phase 30; handles retries, timeouts, fail-open |

**Key insight:** Phase 30 already built ALL the infrastructure components. Phase 31's job is purely wiring and orchestration: connecting existing state queries, retrieval, and diff computation into the review pipeline flow.

## Common Pitfalls

### Pitfall 1: Confusing `before` Payload Field with Last Reviewed SHA
**What goes wrong:** Using the synchronize event's `before` field to compute the incremental diff produces incorrect results when multiple commits were pushed between reviews.
**Why it happens:** The `before` field is the head SHA immediately before this push, not the head SHA of the last Kodiai review. If the user pushed commits A, B, C without Kodiai reviewing, `before` is C but Kodiai last reviewed at A.
**How to avoid:** Always query `run_state` for the last completed review's `head_sha`. The `before` field is only useful as a debugging signal.
**Warning signs:** Incremental reviews show findings on code that was already reviewed in a prior push.

### Pitfall 2: Shallow Clone Missing Previous Head SHA
**What goes wrong:** `git diff OLD_HEAD...HEAD` fails because the old head SHA is not in the workspace's git history (shallow clone with `--depth 50`).
**Why it happens:** The workspace is cloned with limited history. If the last reviewed head is more than 50 commits back, it won't be available.
**How to avoid:** Attempt `git fetch --deepen=100` if `git cat-file -t OLD_SHA` fails. If still unreachable, fall back to full review. This matches the existing `collectDiffContext` deepening pattern in review.ts.
**Warning signs:** Incremental mode falls back to full unexpectedly; logs show "prior-sha-unreachable".

### Pitfall 3: Stale Prior Findings from Superseded Runs
**What goes wrong:** Prior finding deduplication references findings from a superseded (force-pushed) review, which may reference code that no longer exists.
**Why it happens:** Querying findings without filtering by run state status includes findings from superseded runs.
**How to avoid:** Only query findings from reviews linked to the most recent *completed* (not superseded) run for this PR. Join `findings` -> `reviews` -> `run_state` and filter `run_state.status = 'completed'`.
**Warning signs:** Dedup suppresses valid new findings; prior findings reference files or lines that don't exist.

### Pitfall 4: Retrieval Context Polluting Review Quality
**What goes wrong:** Too many or irrelevant retrieved findings in the prompt cause the reviewer to fixate on patterns from other PRs instead of analyzing the current code.
**Why it happens:** Distance threshold too lenient, or top-K too high.
**How to avoid:** Use conservative defaults: top-K = 5, distance threshold = 0.3 (cosine distance). Cap total retrieval context at 2000 characters. Log retrieval provenance for tuning.
**Warning signs:** Review comments parrot prior findings instead of analyzing current code; review quality degrades compared to non-retrieval runs.

### Pitfall 5: Race Condition Between Synchronize Events
**What goes wrong:** Two rapid pushes fire two synchronize events. Both compute incremental diff against the same "last reviewed" SHA. Both try to claim a run, one succeeds, one is correctly deduplicated. But the first one's review may be incomplete when the second push's diff arrives.
**Why it happens:** GitHub fires synchronize events asynchronously for each push.
**How to avoid:** The existing `checkAndClaimRun` in Phase 30 already handles this -- the second push creates a new run key (different head_sha) and supersedes the first. The first run, if still processing, should check for supersession before publishing. However, for v0.5, it's acceptable for both to complete if they reach publication before supersession is detected.
**Warning signs:** Two review comments appear on the same PR for rapid sequential pushes; one may have stale context.

### Pitfall 6: Incremental Review Misses File Renames
**What goes wrong:** A file was renamed between the last reviewed head and the current head. The old file path has prior findings, the new file path is treated as entirely new. No dedup occurs.
**Why it happens:** `git diff --name-only` shows the new filename; prior findings are keyed by old filename.
**How to avoid:** Use `git diff --name-status` to detect `R` (renamed) entries. Map old filenames to new filenames for finding dedup. For v0.5, this is a nice-to-have; documenting as known limitation is acceptable.
**Warning signs:** Prior findings on renamed files reappear as new findings after rename.

## Code Examples

Verified patterns from the existing codebase:

### Querying Last Reviewed Head SHA from run_state
```sql
-- Find the head_sha of the most recent completed review for this PR
SELECT head_sha
FROM run_state
WHERE repo = $repo
  AND pr_number = $prNumber
  AND status = 'completed'
ORDER BY created_at DESC
LIMIT 1
```

### Querying Prior Findings for a PR
```sql
-- Get findings from the most recent completed review of this PR
SELECT
  f.file_path,
  f.title,
  f.severity,
  f.category,
  f.start_line,
  f.end_line,
  f.comment_id,
  f.suppressed
FROM findings f
INNER JOIN reviews r ON r.id = f.review_id
INNER JOIN run_state rs ON rs.repo = r.repo
  AND rs.pr_number = r.pr_number
  AND rs.head_sha = r.head_sha
  AND rs.status = 'completed'
WHERE r.repo = $repo
  AND r.pr_number = $prNumber
  AND f.suppressed = 0
ORDER BY rs.created_at DESC
LIMIT 100
```

### Review Prompt Enrichment with Retrieval Context
```typescript
// Injected into buildReviewPrompt as a new section
function buildRetrievalContextSection(
  context: RetrievalContextForPrompt,
  maxChars: number = 2000,
): string {
  if (context.findings.length === 0) return "";

  const lines: string[] = [
    "## Similar Prior Findings (Learning Context)",
    "",
    "The following are similar findings from prior reviews. Use them as context",
    "to inform your analysis, but evaluate each issue independently on current code.",
    "Do NOT copy prior findings -- only reference them if the same pattern exists in current changes.",
    "",
  ];

  let charCount = lines.join("\n").length;

  for (const finding of context.findings) {
    const entry = `- [${finding.severity}/${finding.category}] ${finding.findingText} (file: ${finding.filePath}, outcome: ${finding.outcome})`;
    if (charCount + entry.length > maxChars) break;
    lines.push(entry);
    charCount += entry.length + 1;
  }

  return lines.join("\n");
}
```

### Incremental Review Mode Prompt Section
```typescript
// Injected into buildReviewPrompt when in incremental mode
function buildIncrementalReviewSection(params: {
  lastReviewedHeadSha: string;
  changedFilesSinceLastReview: string[];
  unresolvedPriorFindings: PriorFinding[];
}): string {
  const lines: string[] = [
    "## Incremental Review Mode",
    "",
    `This is an incremental re-review. The last review covered commit ${params.lastReviewedHeadSha.slice(0, 7)}.`,
    `Focus ONLY on changes in these ${params.changedFilesSinceLastReview.length} files:`,
  ];

  for (const file of params.changedFilesSinceLastReview.slice(0, 50)) {
    lines.push(`- ${file}`);
  }

  if (params.unresolvedPriorFindings.length > 0) {
    lines.push(
      "",
      "### Unresolved Prior Findings (Context Only)",
      "",
      "These findings from the prior review are on unchanged code and remain relevant.",
      "Do NOT re-comment on them. They are shown for context only.",
      "",
    );

    for (const finding of params.unresolvedPriorFindings.slice(0, 10)) {
      lines.push(
        `- [${finding.severity}] ${finding.title} (${finding.filePath})`
      );
    }
  }

  return lines.join("\n");
}
```

### Registering Synchronize Event Handler
```typescript
// Source: existing pattern in review.ts for event registration
// Add PullRequestSynchronizeEvent to the import
import type {
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReviewRequestedEvent,
  PullRequestSynchronizeEvent,
} from "@octokit/webhooks-types";

// Type union update
const payload = event.payload as unknown as
  | PullRequestOpenedEvent
  | PullRequestReadyForReviewEvent
  | PullRequestReviewRequestedEvent
  | PullRequestSynchronizeEvent;

// New registration at the bottom of createReviewHandler
eventRouter.register("pull_request.synchronize", handleReview);
```

### Config Extension for Synchronize Trigger and Retrieval
```typescript
// In reviewTriggersSchema (config.ts)
const reviewTriggersSchema = z.object({
  onOpened: z.boolean().default(true),
  onReadyForReview: z.boolean().default(true),
  onReviewRequested: z.boolean().default(true),
  onSynchronize: z.boolean().default(false),  // NEW: opt-in for incremental re-review
}).default({
  onOpened: true,
  onReadyForReview: true,
  onReviewRequested: true,
  onSynchronize: false,
});

// In knowledgeSchema (config.ts)
const retrievalSchema = z.object({
  enabled: z.boolean().default(true),
  topK: z.number().min(1).max(20).default(5),
  distanceThreshold: z.number().min(0).max(2).default(0.3),
  maxContextChars: z.number().min(0).max(5000).default(2000),
}).default({
  enabled: true,
  topK: 5,
  distanceThreshold: 0.3,
  maxContextChars: 2000,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Full re-review on every push | Incremental diff between last reviewed head and current head | Phase 31 (new) | Reduces review scope to only changed hunks, saving tokens and reducing noise |
| No prior finding awareness | Fingerprint-based dedup of prior findings on unchanged code | Phase 31 (new) | Eliminates duplicate comments when code hasn't changed |
| No learning context in prompts | Bounded KNN retrieval of similar prior findings | Phase 31 (new) | Enriches review with relevant patterns from past reviews |
| GitHub API marker scan as sole idempotency | SHA-keyed run state + marker scan as defense-in-depth | Phase 30 (built) | Fast, durable idempotency that enables incremental SHA tracking |

**Deprecated/outdated:**
- None. Phase 31 builds on Phase 30 without replacing any existing patterns.

## Open Questions

1. **Optimal `onSynchronize` Default Value**
   - What we know: `pull_request.synchronize` fires on every push to a PR branch. This could be frequent for active PRs and would trigger a review on every single commit push.
   - What's unclear: Whether the default should be `false` (opt-in) or `true` (opt-out). If true, every push to a PR triggers a review, which could be expensive.
   - Recommendation: Default to `false` for v0.5. Users opt in via `.kodiai.yml`. This is the conservative choice. Can change to `true` in a future version once incremental mode is proven to be cheap enough.

2. **Distance Threshold Tuning for Retrieval**
   - What we know: sqlite-vec uses L2 distance by default. For normalized embeddings (which Voyage AI produces), cosine distance is approximated by L2 distance on unit vectors.
   - What's unclear: The optimal distance threshold for "relevant" vs "noise" prior findings. This requires empirical tuning.
   - Recommendation: Start with 0.3 as the default threshold. Make it configurable via `knowledge.retrieval.distanceThreshold`. Log distances for all retrieved findings so they can be analyzed for tuning.

3. **Finding Dedup Accuracy Across Code Changes**
   - What we know: Fingerprinting uses FNV-1a hash on normalized title text. Two findings with the same title on the same file path will match, even if line numbers differ.
   - What's unclear: Whether title-only fingerprinting is sufficient, or whether we need line-range overlap detection for accurate dedup.
   - Recommendation: For v0.5, use file path + title fingerprint matching. This is conservative (may suppress when it shouldn't) but simple. If the file changed since last review, always treat findings as new (no dedup). This avoids false suppression at the cost of occasional re-comments.

4. **Incremental Review on `review_requested` Events**
   - What we know: Users can trigger re-reviews by requesting kodiai as a reviewer. Currently this runs a full review.
   - What's unclear: Whether `review_requested` should also attempt incremental mode if a prior completed review exists.
   - Recommendation: Yes, `review_requested` should also try incremental mode. The logic is the same: check for last completed review's head SHA, compute diff. This makes the feature event-agnostic and state-driven, which is cleaner.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/handlers/review.ts` -- review handler flow, event registration, finding extraction, memory write pipeline
- Codebase: `src/knowledge/store.ts` -- run_state table, findings table, review recording, SHA-keyed idempotency
- Codebase: `src/knowledge/types.ts` -- RunStateCheck, FindingRecord, ReviewRecord types
- Codebase: `src/learning/isolation.ts` -- IsolationLayer.retrieveWithIsolation with provenance
- Codebase: `src/learning/memory-store.ts` -- vec0 KNN retrieval with repo partition key
- Codebase: `src/learning/embedding-provider.ts` -- Voyage AI client with inputType support
- Codebase: `src/execution/review-prompt.ts` -- review prompt construction, section building
- Codebase: `src/execution/config.ts` -- review triggers schema, knowledge config
- Codebase: `src/handlers/review-idempotency.ts` -- review output key and marker system
- Codebase: `src/execution/diff-analysis.ts` -- diff parsing, hunk counting
- Codebase: `node_modules/@octokit/webhooks-types/schema.d.ts` -- `PullRequestSynchronizeEvent` with `before: string; after: string`
- Phase 30 research: `.planning/phases/30-state-memory-and-isolation-foundation/30-RESEARCH.md`
- Phase 30 verification: `.planning/phases/30-state-memory-and-isolation-foundation/30-VERIFICATION.md`
- [GitHub REST API - Pull Request Review Comments](https://docs.github.com/en/rest/pulls/comments) -- comment fields: commit_id, path, line, original_commit_id
- [GitHub REST API - Compare Two Commits](https://docs.github.com/en/rest/commits/commits#compare-two-commits) -- files array with status, patch, additions, deletions
- [GitHub Webhook Events - pull_request](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request) -- synchronize action with before/after fields
- [Git diff documentation](https://git-scm.com/docs/git-diff) -- `git diff <commit1>...<commit2> --name-only`, `--name-status` for rename detection

### Secondary (MEDIUM confidence)
- [GitHub Community Discussion - What is pull_request synchronize](https://github.com/orgs/community/discussions/24567) -- confirms `before` is the commit before the push, not the last reviewed commit
- [Frontside Blog - GitHub Actions pull_request deep dive](https://frontside.com/blog/2020-05-26-github-actions-pull_request/) -- synchronize event payload structure with before/after fields

### Tertiary (LOW confidence)
- [CodeRabbit AI PR Reviewer](https://github.com/coderabbitai/ai-pr-reviewer) -- general approach to incremental review (tracks changed files between commits), but implementation details not publicly documented

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified in Phase 30
- Architecture: HIGH -- patterns directly extend existing codebase structures with no new dependencies
- Pitfalls: HIGH -- identified from codebase analysis (shallow clone limits, run state queries, dedup edge cases) and verified against GitHub API docs
- Incremental diff: HIGH -- git diff between SHAs is well-understood; `PullRequestSynchronizeEvent` type verified in `@octokit/webhooks-types`
- Retrieval context: MEDIUM-HIGH -- existing IsolationLayer is verified; optimal thresholds need empirical tuning
- Finding dedup: MEDIUM -- fingerprint approach is simple and deterministic but may need refinement for edge cases (renames, line shifts)

**Research date:** 2026-02-12
**Valid until:** 2026-03-12 (stable domain; main risk is threshold tuning needing adjustment after real-world usage)
