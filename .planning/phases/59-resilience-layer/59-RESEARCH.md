# Phase 59: Resilience Layer - Research

**Researched:** 2026-02-15
**Domain:** Checkpoint accumulation, partial result publishing, retry with scope reduction, chronic timeout handling
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Partial review presentation
- Same format as normal review, with a disclaimer at the top (e.g., "Partial review -- timed out after analyzing X of Y files")
- Minimum quality bar: at least 1 finding -- if we found anything actionable, publish it
- Show coverage ratio in disclaimer (e.g., "Analyzed 4 of 12 files"), don't list individual skipped files
- Inline comments from analyzed files are still posted as usual alongside the summary comment

#### Retry notification & output
- Silent retry -- no "retrying..." message posted; just publish the result when done
- If original timeout produced a partial review and retry succeeds, replace the partial review comment with the retry result (edit, not new comment)
- Retry result is labeled -- includes a note like "Reviewed top N files by risk" so authors know coverage is limited
- If retry also times out, apply the same partial-review logic -- publish whatever we got (at least 1 finding threshold)

#### Chronic timeout feedback
- When a repo+author hits 3+ timeouts in the last 7 days, retry is skipped
- Explain in the partial review disclaimer why retry was skipped: "Retry skipped -- this repo has timed out frequently"
- Suggest actionable guidance: recommend splitting large PRs to stay within timeout budget
- Timeout count tracked per repo+author (not penalizing the whole repo for one author's patterns)

#### Scope reduction strategy
- Primary risk signal: file change size (larger diffs = higher priority)
- Retry skips already-analyzed files from the partial review -- focus retry budget on unreviewed files
- Scope reduction is adaptive, not fixed 50%: if original got through 80%, retry the remaining 20%; if it got through 10%, retry top 50% of remaining
- Final output merges partial + retry findings into a single coherent review comment covering all analyzed files

### Claude's Discretion
- Exact checkpoint accumulation data structure
- Buffer-and-flush implementation details
- How to merge partial + retry inline comments cleanly
- Telemetry schema for checkpoint and retry metadata
- Exact adaptive scope reduction formula

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

## Summary

Phase 59 adds timeout resilience to Kodiai's review pipeline by: (1) accumulating checkpoint state during execution so partial results can be published on timeout, (2) retrying timed-out reviews with reduced file scope focused on unreviewed files, and (3) skipping retry for chronically timing-out repo+author pairs.

The core architectural challenge is that the current executor architecture is all-or-nothing. The Claude Agent SDK's `query()` function streams messages, and the LLM publishes inline comments via MCP tools during execution. On timeout, the `AbortController` fires, the executor catch block returns `isTimeout: true`, and the review handler posts an error comment. There is no mechanism today to accumulate what was reviewed, what findings were generated, or which files were covered. The `onPublish` callback tracks only a boolean (whether anything was published), not an inventory of what was published.

The research from `.planning/research/PITFALLS.md` (Pitfall 3) strongly recommends the **buffer-and-flush** approach over incremental publishing: accumulate all findings in a staging area, then publish them as a single batch when the timeout fires (or when execution succeeds). This preserves the existing single-publish-point architecture. The research from `.planning/research/ARCHITECTURE.md` (Q4) recommends a new MCP tool (`save_review_checkpoint`) that Claude invokes during execution to report progress. This checkpoint data goes to a knowledge store table, which the review handler reads on timeout to publish partial results and on retry to know which files were already reviewed.

The retry mechanism re-enters the pipeline through the existing job queue (`.planning/research/ARCHITECTURE.md` Q5), not a separate process. The retry uses the same workspace, config, and enrichment pipeline but with a reduced-scope prompt that focuses on unreviewed files. The retry is capped at exactly 1 attempt. Chronic timeout detection queries the telemetry `executions` table for recent timeout conclusions per repo+author.

**Primary recommendation:** Implement a checkpoint MCP tool + knowledge store table for accumulation, buffer-and-flush partial publishing in the review handler's timeout path, job-queue-based retry with adaptive scope reduction, and chronic timeout detection from existing telemetry data.

## Standard Stack

### Core
| Library/Tech | Version | Purpose | Why Standard (in this repo) |
|---|---:|---|---|
| TypeScript (ESM) | peer `^5` | Implementation language | Repo standard |
| Bun (`bun:sqlite`) | (runtime) | Knowledge store for checkpoint data, telemetry for timeout tracking | Already used |
| `@anthropic-ai/claude-agent-sdk` | `^0.2.37` | MCP tool for checkpoint accumulation | Already used for inline-review, comment, CI status tools |

### Supporting
| Library | Version | Purpose | When to Use |
|---|---:|---|---|
| `pino` | `^10.3.0` | Logging | Checkpoint, retry, and chronic timeout logging |
| `zod` | (existing) | Config schema extension | Retry config validation |
| `p-queue` | (existing) | Job queue for retry enqueue | Already the queue implementation |

### No New Dependencies

All checkpoint and retry logic uses existing primitives: SQLite tables for state, MCP tools for accumulation, the job queue for retry, and Octokit for comment create/update. The buffer-and-flush pattern is an orchestration pattern, not a library.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| MCP checkpoint tool (Claude reports progress) | Streaming interception (parse SDK messages for progress) | Streaming interception couples checkpoint logic to SDK message format; MCP tool follows the existing pattern and lets Claude explicitly decide when to checkpoint |
| Knowledge store table for checkpoints | In-memory state in executor | In-memory state is lost on process crash; knowledge store survives restarts and is readable by the retry flow |
| Job queue retry (same queue) | Separate retry process | Separate process bypasses per-installation concurrency control; same queue respects `PQueue({ concurrency: 1 })` |
| Comment edit to replace partial with retry | Delete + create new comment | Edit preserves the comment URL and position in the PR timeline; delete + create produces two timeline entries |

## Architecture Patterns

### Current Timeout Flow (Pre-Phase 59)
```
executor.execute() --AbortController timeout--> catch block
  --> returns { conclusion: "error", isTimeout: true, published: false }
    --> review handler posts error comment: "Kodiai timed out"
    --> telemetry records conclusion: "timeout"
```

**Problem:** No accumulated state. The LLM may have reviewed 80% of files and generated findings via MCP inline comment tool calls, but on timeout: `published` is false (only set on the happy path), no record of which files were analyzed, and the error comment says "timed out" with no partial value.

### Recommended Timeout Flow (Phase 59)
```
executor.execute() with checkpoint MCP tool available
  --> Claude reviews files, calls save_review_checkpoint() periodically
  --> Checkpoint data stored in knowledge store (filesReviewed, findingsSummary)
  --> On timeout: AbortController fires, executor catch block returns { isTimeout: true }
  --> Review handler reads checkpoint from knowledge store
  --> If checkpoint has >= 1 finding:
    --> Buffer-and-flush: publish partial results as PR comment with disclaimer
    --> Record published commentId for potential retry replacement
  --> If retry is eligible (not chronic, retry count < 1):
    --> Enqueue retry job with checkpoint data (files already reviewed)
    --> Retry builds reduced-scope prompt (unreviewed files only)
    --> On retry success: edit the partial review comment with merged results
    --> On retry timeout: apply same partial-review logic to retry checkpoint
```

### Recommended Project Structure (extensions)
```
src/
├── execution/
│   ├── mcp/
│   │   └── checkpoint-server.ts         # NEW: MCP tool for save_review_checkpoint
│   │   └── checkpoint-server.test.ts    # NEW
│   │   └── index.ts                     # MODIFIED: wire checkpoint server
│   └── executor.ts                      # MODIFIED: pass knowledgeStore to MCP builder
├── handlers/
│   └── review.ts                        # MODIFIED: checkpoint read, partial publish, retry logic
├── knowledge/
│   ├── store.ts                         # MODIFIED: review_checkpoints table + CRUD
│   └── types.ts                         # MODIFIED: CheckpointRecord type + store methods
├── telemetry/
│   └── store.ts                         # MODIFIED: query for chronic timeout detection
│   └── types.ts                         # MODIFIED: timeout count query method
└── lib/
    ├── partial-review-formatter.ts      # NEW: format partial review comment with disclaimer
    ├── partial-review-formatter.test.ts # NEW
    ├── retry-scope-reducer.ts           # NEW: compute reduced scope from checkpoint + risk scores
    └── retry-scope-reducer.test.ts      # NEW
```

### Pattern 1: Checkpoint MCP Tool (Accumulation)
**What:** A new MCP tool `save_review_checkpoint` that Claude invokes during review execution to report progress. The tool writes to the `review_checkpoints` table in the knowledge store.
**When to use:** During long review executions. Claude is instructed to call this after reviewing a batch of files.
**Why:** Follows the exact same pattern as `inline-review-server.ts` and `comment-server.ts`. The `onPublish` callback and `getOctokit` injection patterns are already established. This is the architecture decision from `.planning/research/ARCHITECTURE.md` Q4.

```typescript
// src/execution/mcp/checkpoint-server.ts
export function createCheckpointServer(
  knowledgeStore: KnowledgeStore,
  reviewOutputKey: string,
  repo: string,
  prNumber: number,
  totalFiles: number,
  logger?: Logger,
) {
  return createSdkMcpServer({
    name: "review_checkpoint",
    version: "0.1.0",
    tools: [
      tool(
        "save_review_checkpoint",
        "Save partial review progress. Call after reviewing each batch of files. " +
          "If the session times out, saved progress will be published as a partial review.",
        {
          filesReviewed: z.array(z.string())
            .describe("File paths that have been fully reviewed so far"),
          findingCount: z.number()
            .describe("Total number of findings generated so far"),
          summaryDraft: z.string()
            .describe("Draft summary of findings so far (will be used as partial review body)"),
        },
        async ({ filesReviewed, findingCount, summaryDraft }) => {
          knowledgeStore.saveCheckpoint({
            reviewOutputKey,
            repo,
            prNumber,
            filesReviewed,
            findingCount,
            summaryDraft,
            totalFiles,
          });
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                saved: true,
                filesReviewed: filesReviewed.length,
                totalFiles,
              }),
            }],
          };
        },
      ),
    ],
  });
}
```

### Pattern 2: Buffer-and-Flush Partial Publishing
**What:** On timeout, the review handler reads the checkpoint, extracts already-published inline comments from GitHub, and publishes a cohesive partial review comment. No comments are published incrementally during execution -- the LLM publishes inline comments normally via the existing `create_inline_comment` MCP tool, and the summary + disclaimer are added by the handler after timeout.
**When to use:** When `result.isTimeout === true` and checkpoint data exists with `findingCount >= 1`.
**Why:** This is the `STATE.md` constraint: "Checkpoint publishing must use buffer-and-flush on abort, not streaming." The inline comments posted by Claude during execution are the "buffer"; the summary comment with disclaimer is the "flush."

**Key insight on buffer-and-flush:** The LLM already publishes inline comments during execution via MCP tools. These inline comments survive timeout (they are GitHub API calls that complete before the abort fires). The "buffer" is these already-posted inline comments. The "flush" is the summary comment with a partial-review disclaimer that the handler posts after timeout. The checkpoint MCP tool tracks progress (which files were reviewed) so the handler knows the coverage ratio for the disclaimer.

### Pattern 3: Job Queue Retry with Reduced Scope
**What:** After publishing a partial review, enqueue a retry job via the existing `jobQueue.enqueue()`. The retry reads the checkpoint to know which files were already reviewed, builds a reduced-scope prompt with only unreviewed files, and uses a halved timeout budget.
**When to use:** When the first attempt timed out and the repo+author is not in the chronic timeout list.
**Why:** Re-entering via the job queue respects per-installation concurrency. The `.planning/research/ARCHITECTURE.md` Q5 decision explicitly recommends this approach.

### Pattern 4: Chronic Timeout Detection from Telemetry
**What:** Query the `executions` table for recent timeouts: `SELECT COUNT(*) FROM executions WHERE repo = ? AND conclusion IN ('timeout', 'timeout_partial') AND created_at > datetime('now', '-7 days')`. Filter by author by correlating with the PR event data.
**When to use:** Before deciding whether to retry.
**Why:** The telemetry store already records `conclusion: "timeout"` and `conclusion: "timeout_partial"` for every execution. No new table needed. However, the current schema does not store `pr_author`. The simplest approach is to add a nullable `pr_author` column to the `executions` table (additive migration).

### Pattern 5: Comment Edit for Retry Replacement
**What:** When the partial review is published, record the comment ID. When retry succeeds, use `octokit.rest.issues.updateComment()` to replace the partial review body with the merged final review.
**When to use:** When retry produces a result that supersedes the partial review.
**Why:** User decision: "replace the partial review comment with the retry result (edit, not new comment)." The `upsertReviewDetailsComment` function in `review.ts` already implements this find-and-update pattern.

### Anti-Patterns to Avoid
- **Publishing partial results incrementally (streaming):** STATE.md explicitly forbids this. Buffer-and-flush only.
- **Retrying more than once:** Hard cap at 1 retry. No exponential backoff.
- **Retrying in the same job execution:** Must re-enqueue via job queue to respect concurrency.
- **Deleting inline comments on retry:** Inline comments from the partial review are valid findings. The retry covers DIFFERENT files. Merge, don't replace inline comments.
- **Tracking chronic timeouts in a new table:** The `executions` table already has the data. Query it directly.
- **Making checkpoint a required step:** Checkpoint is best-effort. If Claude never calls the checkpoint tool, the system degrades gracefully to the current timeout behavior (error comment).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| MCP server creation | Custom HTTP server | `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk` | Exact pattern used by all existing MCP servers |
| Comment create/update | Custom GitHub API wrapper | `octokit.rest.issues.createComment/updateComment` | Already used throughout `review.ts` |
| Job queue retry | Separate process / setTimeout retry | `jobQueue.enqueue()` via `p-queue` | Respects per-installation concurrency |
| Schema migration | Migration runner | `CREATE TABLE IF NOT EXISTS` + `ensureTableColumn` pattern | Repo standard from `knowledge/store.ts` |
| Risk-based file sorting | New scoring algorithm | `computeFileRiskScores()` from `file-risk-scorer.ts` | Already computes per-file risk scores with `linesChanged` as a weight factor |
| Timeout classification | New error type | `classifyError()` from `lib/errors.ts` | Already handles `timeout` and `timeout_partial` categories |

**Key insight:** The review handler already has ALL the post-execution infrastructure: finding extraction, suppression matching, Review Details formatting, comment upsert. Phase 59 adds a new CODE PATH for the timeout case that reuses this infrastructure, not new infrastructure.

## Common Pitfalls

### Pitfall 1: Orphaned Inline Comments Without Summary Context (CRITICAL)
**What goes wrong:** Claude posts inline comments during execution via `create_inline_comment` MCP tool. On timeout, those inline comments exist on the PR but there is no summary comment explaining they are from a partial review. Users see random inline comments with no framing.
**Why it happens:** The current architecture has Claude post inline comments one-by-one during execution. On timeout, the execution is aborted mid-flight. The inline comments are already posted (GitHub API calls completed) but the summary comment was never generated.
**How to avoid:** The buffer-and-flush approach means the handler ALWAYS posts a summary comment on timeout -- either a partial review disclaimer (if checkpoint data shows findings) or the existing error comment. The inline comments that Claude already posted are the "buffer" part. The summary with disclaimer is the "flush" part. Together they form a coherent partial review.
**Warning signs:** Inline review comments on a PR with no summary comment from the bot.

### Pitfall 2: Retry Creates Duplicate Inline Comments
**What goes wrong:** The partial review has inline comments on files A, B, C. The retry reviews files D, E, F but Claude re-reviews A (already covered) and posts duplicate comments.
**Why it happens:** The retry prompt does not exclude already-reviewed files, or Claude ignores the exclusion instruction.
**How to avoid:** The retry prompt must explicitly list which files to review (the unreviewed set from checkpoint data). The retry also uses a different `reviewOutputKey` (appending `-retry-1`) so its inline comments are distinguishable. The `extractFindingsFromReviewComments` function already filters by `reviewOutputKey` marker, so findings from the original and retry are tracked separately for merging.
**Warning signs:** Same file path appears in both partial and retry findings with identical content.

### Pitfall 3: Checkpoint MCP Tool Never Called
**What goes wrong:** Claude does not call `save_review_checkpoint` during execution, so on timeout there is no checkpoint data. The system falls back to the current behavior (error comment only).
**Why it happens:** The LLM may not follow the instruction to checkpoint, especially on small/fast reviews that complete before timeout.
**How to avoid:** This is acceptable degradation -- the checkpoint is best-effort. The handler checks `knowledgeStore.getCheckpoint(reviewOutputKey)`: if null, post the standard error comment. If present, publish partial results. Additionally, the `onPublish` boolean in the executor tells us if ANY inline comments were posted. Even without checkpoint data, if `published === true`, we know some findings exist and can extract them via `extractFindingsFromReviewComments()`.
**Warning signs:** Checkpoint retrieval returns null on timeout. Monitor via telemetry.

### Pitfall 4: Retry Timeout Produces No Value
**What goes wrong:** The retry also times out, and the retry had no checkpoint data, so the user gets only the original partial review with no improvement.
**Why it happens:** The reduced scope is still too large for the timeout budget, or the LLM spends time on context rather than review.
**How to avoid:** The user decision is clear: "If retry also times out, apply the same partial-review logic -- publish whatever we got." The retry uses a halved timeout budget. If the retry also produces findings (via checkpoint or via already-posted inline comments), merge them with the partial review and update the comment. If the retry produces nothing, keep the original partial review as-is.
**Warning signs:** Retry conclusion is "timeout" AND retry checkpoint has 0 findings.

### Pitfall 5: Chronic Timeout Detection Missing Author Dimension
**What goes wrong:** The user decided timeout tracking should be per repo+author. The current `executions` table does not store the PR author, only `repo` and `pr_number`.
**Why it happens:** The telemetry schema was designed for cost/performance tracking, not per-author behavior analysis.
**How to avoid:** Add a nullable `pr_author` column to the `executions` table via additive migration (`ALTER TABLE executions ADD COLUMN pr_author TEXT`). Populate it in the review handler's telemetry write. For chronic timeout detection, query: `SELECT COUNT(*) FROM executions WHERE repo = ? AND pr_author = ? AND conclusion IN ('timeout', 'timeout_partial') AND created_at > datetime('now', '-7 days')`.
**Warning signs:** Chronic timeout threshold reached for repo but individual authors are not distinguished.

### Pitfall 6: Idempotency Conflict Between Partial Review and Retry
**What goes wrong:** The partial review publishes inline comments with the original `reviewOutputKey` marker. The retry uses a different key (`-retry-1`). The `ensureReviewOutputNotPublished` check sees the original marker and blocks retry publication.
**Why it happens:** The idempotency system prevents duplicate publications. It does not distinguish partial from complete reviews.
**How to avoid:** Use distinct review output keys: original gets `reviewOutputKey`, retry gets `${reviewOutputKey}-retry-1`. The merge step uses `extractFindingsFromReviewComments` with BOTH keys to collect all findings. The final merged comment is posted via `updateComment` on the partial review's comment ID.
**Warning signs:** Retry inline comments fail with "already published" idempotency check.

## Code Examples

### Checkpoint Data Structure (Knowledge Store)
```typescript
// In knowledge/types.ts
export type CheckpointRecord = {
  reviewOutputKey: string;
  repo: string;
  prNumber: number;
  filesReviewed: string[];   // file paths completed
  findingCount: number;
  summaryDraft: string;      // partial summary text
  totalFiles: number;        // total files in the PR
  createdAt?: string;
};

// In knowledge/types.ts -- KnowledgeStore extension
export type KnowledgeStore = {
  // ...existing methods...
  saveCheckpoint(data: CheckpointRecord): void;
  getCheckpoint(reviewOutputKey: string): CheckpointRecord | null;
  deleteCheckpoint(reviewOutputKey: string): void;
};
```

### Knowledge Store Schema (review_checkpoints table)
```sql
CREATE TABLE IF NOT EXISTS review_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  review_output_key TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  checkpoint_data TEXT NOT NULL,  -- JSON blob: { filesReviewed, findingCount, summaryDraft, totalFiles }
  UNIQUE(review_output_key)      -- one checkpoint per review attempt, upsert on subsequent calls
);
```

### Partial Review Formatter
```typescript
// src/lib/partial-review-formatter.ts
export type PartialReviewParams = {
  summaryDraft: string;
  filesReviewed: number;
  totalFiles: number;
  timedOutAfterSeconds: number;
  isRetrySkipped?: boolean;
  retrySkipReason?: string;
  isRetryResult?: boolean;
  retryFilesReviewed?: number;
};

export function formatPartialReviewComment(params: PartialReviewParams): string {
  const {
    summaryDraft,
    filesReviewed,
    totalFiles,
    timedOutAfterSeconds,
    isRetrySkipped,
    retrySkipReason,
    isRetryResult,
    retryFilesReviewed,
  } = params;

  const lines: string[] = [];

  // Disclaimer header
  if (isRetryResult) {
    const totalReviewed = filesReviewed + (retryFilesReviewed ?? 0);
    lines.push(
      `> **Partial review** -- Analyzed ${totalReviewed} of ${totalFiles} files. ` +
      `Reviewed top ${retryFilesReviewed} files by risk in retry.`,
    );
  } else {
    lines.push(
      `> **Partial review** -- timed out after analyzing ` +
      `${filesReviewed} of ${totalFiles} files (${timedOutAfterSeconds}s).`,
    );
  }

  if (isRetrySkipped && retrySkipReason) {
    lines.push(`>`);
    lines.push(`> ${retrySkipReason}`);
    lines.push(`> Consider splitting large PRs to stay within the review timeout budget.`);
  }

  lines.push("");
  lines.push(summaryDraft);

  return lines.join("\n");
}
```

### Adaptive Scope Reduction
```typescript
// src/lib/retry-scope-reducer.ts
import type { FileRiskScore } from "./file-risk-scorer.ts";

export type RetryScopeParams = {
  allFiles: FileRiskScore[];
  filesAlreadyReviewed: string[];
  totalFiles: number;
};

export type RetryScopeResult = {
  filesToReview: FileRiskScore[];
  scopeRatio: number;  // fraction of remaining files to review (0-1)
};

/**
 * Compute the retry scope: which files to review on retry.
 *
 * - Excludes files already reviewed (from checkpoint)
 * - Sorts remaining files by risk score (descending) -- primary signal: linesChanged
 * - Adaptive scope: if original got through 80%, retry remaining 20%;
 *   if original got through 10%, retry top 50% of remaining
 *
 * Formula: scopeRatio = min(1.0, 0.5 + (reviewedFraction * 0.5))
 *   - At 0% reviewed: scope = 50% of remaining
 *   - At 50% reviewed: scope = 75% of remaining
 *   - At 80% reviewed: scope = 90% of remaining
 *   - At 100% reviewed: scope = 100% (edge case, no retry needed)
 */
export function computeRetryScope(params: RetryScopeParams): RetryScopeResult {
  const { allFiles, filesAlreadyReviewed, totalFiles } = params;
  const reviewedSet = new Set(filesAlreadyReviewed);

  // Filter out already-reviewed files
  const remaining = allFiles
    .filter((f) => !reviewedSet.has(f.filePath))
    .sort((a, b) => b.score - a.score); // highest risk first

  if (remaining.length === 0) {
    return { filesToReview: [], scopeRatio: 0 };
  }

  const reviewedFraction = filesAlreadyReviewed.length / totalFiles;
  const scopeRatio = Math.min(1.0, 0.5 + reviewedFraction * 0.5);
  const targetCount = Math.max(1, Math.ceil(remaining.length * scopeRatio));

  return {
    filesToReview: remaining.slice(0, targetCount),
    scopeRatio,
  };
}
```

### Chronic Timeout Detection
```typescript
// In telemetry/store.ts -- new method
function countRecentTimeouts(repo: string, author: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM executions
       WHERE repo = ? AND pr_author = ?
       AND conclusion IN ('timeout', 'timeout_partial')
       AND created_at > datetime('now', '-7 days')`,
    )
    .get(repo, author) as { cnt: number } | null;
  return row?.cnt ?? 0;
}
```

### Review Handler Timeout Path (Sketch)
```typescript
// In review.ts, after executor.execute() returns
if (result.isTimeout) {
  // Step 1: Read checkpoint data
  const checkpoint = knowledgeStore?.getCheckpoint?.(reviewOutputKey) ?? null;
  const hasPublishedInlines = result.published ?? false;

  // Step 2: Determine if we have partial results to publish
  const hasPartialResults = (checkpoint?.findingCount ?? 0) >= 1 || hasPublishedInlines;

  if (hasPartialResults) {
    // Step 3: Publish partial review with disclaimer
    const partialBody = formatPartialReviewComment({
      summaryDraft: checkpoint?.summaryDraft ?? "Review timed out with findings posted above.",
      filesReviewed: checkpoint?.filesReviewed.length ?? 0,
      totalFiles: changedFiles.length,
      timedOutAfterSeconds: timeoutEstimate?.dynamicTimeoutSeconds ?? config.timeoutSeconds,
    });

    const octokit = await githubApp.getInstallationOctokit(event.installationId);
    const partialComment = await octokit.rest.issues.createComment({
      owner: apiOwner,
      repo: apiRepo,
      issue_number: pr.number,
      body: sanitizeOutgoingMentions(partialBody, [githubApp.getAppSlug(), "claude"]),
    });
    const partialCommentId = partialComment.data.id;

    // Step 4: Check chronic timeout threshold
    const recentTimeouts = telemetryStore.countRecentTimeouts?.(
      `${apiOwner}/${apiRepo}`,
      pr.user.login,
    ) ?? 0;
    const isChronicTimeout = recentTimeouts >= 3;

    // Step 5: Retry if eligible
    if (!isChronicTimeout) {
      // Enqueue retry job
      await jobQueue.enqueue(event.installationId, async () => {
        // ... retry logic with reduced scope ...
      }, {
        deliveryId: `${event.id}-retry-1`,
        eventName: event.name,
        action: `${action}-retry`,
        jobType: "pull-request-review-retry",
        prNumber: pr.number,
      });
    }
  } else {
    // No partial results -- post standard timeout error comment
    const errorBody = formatErrorComment("timeout", `Timed out after ...`);
    // ...existing error comment logic...
  }
}
```

### Prompt Extension for Checkpoint
```typescript
// Added to the review prompt when checkpoint tool is available:
const checkpointInstruction = `
IMPORTANT: This is a large review. Call the save_review_checkpoint tool after
reviewing every 3-5 files. Include:
- filesReviewed: list of file paths you have fully analyzed
- findingCount: total findings generated so far
- summaryDraft: a brief summary of findings so far

This ensures your work is preserved if the session times out.
`;
```

## State of the Art

| Old Approach | Current Approach (Phase 59) | When Changed | Impact |
|---|---|---|---|
| All-or-nothing review: timeout = total loss | Checkpoint accumulation + partial review publishing | Phase 59 | Users get value even from timed-out reviews |
| No retry on timeout | Single retry with reduced scope focused on unreviewed files | Phase 59 | Second chance to complete the review |
| Same error for all timeouts | Chronic timeout detection skips retry + provides actionable guidance | Phase 59 | Avoid wasting resources on repos that consistently timeout |
| Binary `published: boolean` in executor | Checkpoint data with file-level progress tracking | Phase 59 | Handler knows exactly what was reviewed for partial publishing |
| Error comment: "Kodiai timed out" | Partial review: "Analyzed 4 of 12 files" with findings | Phase 59 | Partial value instead of zero value |

## Open Questions

1. **Should the checkpoint MCP tool be available on all reviews or only high-timeout-risk ones?**
   - What we know: Adding an MCP tool increases the tool surface for the LLM, potentially adding one extra turn of tool use overhead. For small PRs that complete in 30s, the checkpoint tool is wasteful.
   - What's unclear: Whether the overhead of offering the checkpoint tool is meaningful.
   - Recommendation: Only provide the checkpoint MCP tool when `timeoutEstimate.riskLevel` is `"medium"` or `"high"`. For `"low"` risk reviews, omit the tool entirely. This also means the checkpoint instruction is only added to the prompt for medium/high risk.

2. **How to handle the case where inline comments were posted but no checkpoint was saved?**
   - What we know: `result.published === true` means Claude called `create_inline_comment` at least once. But without checkpoint data, we don't know which files were covered.
   - What's unclear: Whether we can reconstruct coverage from the published inline comments.
   - Recommendation: Use `extractFindingsFromReviewComments()` to list the published inline comments and derive `filesReviewed` from their file paths. This is less detailed than checkpoint data but sufficient for the disclaimer ("Analyzed N files") and for the retry scope reduction.

3. **Should the retry use the same executor prompt or a specialized retry prompt?**
   - What we know: The retry reviews a different set of files (unreviewed ones). The existing review prompt includes all changed files.
   - What's unclear: Whether the retry prompt should include findings from the partial review as context.
   - Recommendation: Build a specialized retry prompt that: (a) lists only the unreviewed files as `changedFiles`, (b) includes a note that this is a continuation of a partial review, (c) does NOT include the checkpoint findings as context (to avoid biasing the LLM). The retry is a fresh analysis of a subset of files.

4. **Where to store the partial review comment ID for later replacement by retry?**
   - What we know: The review handler posts a partial review comment and needs the retry to edit that same comment.
   - What's unclear: Whether to pass the comment ID through the job queue or store it in the knowledge store.
   - Recommendation: Store it in the checkpoint table. Add a `partial_comment_id` column to `review_checkpoints`. The retry reads it from the checkpoint. This avoids threading state through the job queue closure.

5. **How to merge inline comments from partial + retry into a unified finding set?**
   - What we know: The partial review's inline comments have the original `reviewOutputKey` marker. The retry's inline comments have a different key (`-retry-1`).
   - What's unclear: How `extractFindingsFromReviewComments` should handle multiple markers.
   - Recommendation: The retry handler calls `extractFindingsFromReviewComments` twice -- once for each key -- then concatenates and deduplicates (by filePath + title fingerprint). The merged finding set is used for the Review Details summary and the knowledge store records.

## Sources

### Primary (HIGH confidence)
- `src/execution/executor.ts` -- AbortController timeout mechanism (lines 39-47), `onPublish` callback (line 75), catch block for timeout (lines 208-233)
- `src/execution/types.ts` -- `ExecutionResult.isTimeout`, `ExecutionResult.published` fields
- `src/execution/mcp/index.ts` -- MCP server builder pattern, tool wiring
- `src/execution/mcp/inline-review-server.ts` -- Existing MCP tool pattern with `createSdkMcpServer`, idempotency check
- `src/handlers/review.ts` -- Timeout handling (lines 2724-2763), finding extraction (lines 543-617), Review Details publication (lines 2338-2425), `createReviewHandler` DI (lines 855-895)
- `src/lib/errors.ts` -- `classifyError()` with `timeout` and `timeout_partial` categories
- `src/lib/file-risk-scorer.ts` -- `computeFileRiskScores()` with `linesChanged` weight (0.3)
- `src/knowledge/store.ts` -- `CREATE TABLE IF NOT EXISTS` pattern, `ensureTableColumn` for additive migration
- `src/knowledge/types.ts` -- `KnowledgeStore` interface
- `src/telemetry/store.ts` -- `executions` table schema with `conclusion` column
- `src/telemetry/types.ts` -- `TelemetryStore` interface
- `src/jobs/types.ts` -- `JobQueue.enqueue()` with context metadata
- `.planning/STATE.md` -- "Checkpoint publishing must use buffer-and-flush on abort, not streaming", "Timeout retry capped at 1 max"

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` Q4 -- MCP checkpoint tool architecture decision
- `.planning/research/ARCHITECTURE.md` Q5 -- Job queue retry mechanism decision
- `.planning/research/PITFALLS.md` Pitfall 3 -- Orphaned partial comments analysis and buffer-and-flush recommendation
- `.planning/research/PITFALLS.md` Pitfall 4 -- Infinite retry loop prevention and budget cap
- `.planning/research/STACK.md` Section 3 -- Checkpoint publishing pattern using existing Octokit API
- `.planning/research/FEATURES.md` -- Checkpoint and retry feature descriptions

### Tertiary (LOW confidence)
- The exact adaptive scope reduction formula (`0.5 + reviewedFraction * 0.5`) is a reasonable starting point but may need tuning. With 0% reviewed the retry gets 50% of remaining files, which matches the success criteria's "top 50% by risk score" phrasing.
- Whether Claude will reliably call the checkpoint MCP tool needs empirical validation. If checkpoint usage is low, consider making the prompt instruction more forceful or adding a timer-based automatic checkpoint in the handler.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries and patterns
- Architecture: HIGH -- checkpoint MCP tool, buffer-and-flush, and job queue retry are all documented decisions from prior research
- Checkpoint accumulation: HIGH -- follows exact MCP server pattern used for inline-review and comment tools
- Partial review publishing: HIGH -- uses existing `createComment`/`updateComment` Octokit patterns
- Retry mechanism: HIGH -- job queue re-entry pattern documented in ARCHITECTURE.md Q5
- Chronic timeout detection: HIGH -- telemetry executions table already records timeout conclusions; additive column for author
- Scope reduction formula: MEDIUM -- adaptive formula is reasonable but needs production tuning
- Pitfalls: HIGH -- extensively documented in PITFALLS.md (Pitfall 3, 4)

**Research date:** 2026-02-15
**Valid until:** 2026-03-17
