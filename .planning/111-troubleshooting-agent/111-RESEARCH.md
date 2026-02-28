# Phase 111: Troubleshooting Agent - Research

**Researched:** 2026-02-27
**Domain:** Intent classification, LLM synthesis, comment dedup, webhook handler wiring
**Confidence:** HIGH

## Summary

Phase 111 builds the troubleshooting agent that activates when `@kodiai` is mentioned on an open issue with troubleshooting intent. It has two logical units: (1) intent classification with config gating and comment-scoped dedup, and (2) LLM-based synthesis of troubleshooting guidance from resolved issues retrieved by Phase 110's `retrieveTroubleshootingContext()`.

The codebase already has all the infrastructure needed. The mention handler (`src/handlers/mention.ts`, ~2000 lines) processes `issue_comment.created` webhooks and already routes to triage validation for issue mentions. The troubleshooting handler should be a **separate file** (following the `issue-opened.ts` precedent set by project constraint: "must be a separate handler, not added to the 2000+ line mention handler"). It registers on `issue_comment.created` via the event router, which supports multiple handlers per event key via `Promise.allSettled`. The new handler intercepts troubleshooting-intent mentions before/independently of the general mention handler.

For LLM synthesis, the project uses Vercel AI SDK's `generateText()` wrapped in `generateWithFallback()` from `src/llm/generate.ts` for non-agentic tasks. This is the right tool -- troubleshooting synthesis is a stateless text generation task (no MCP tools, no workspace needed), similar to `cluster.label` and `staleness.evidence` task types. A new `troubleshooting.synthesis` task type should be added to the taxonomy.

**Primary recommendation:** Create `src/handlers/troubleshooting-agent.ts` as a separate handler file with keyword-based intent classification, comment-scoped marker dedup, and `generateWithFallback()` synthesis. Wire it in `src/index.ts` alongside the existing handlers. Register under `issue_comment.created` -- the event router runs all handlers via `Promise.allSettled`, so it coexists with the existing mention handler.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TSHOOT-04 | `@kodiai` mention on open issue with troubleshooting intent synthesizes guidance from resolved issues | New handler file uses `retrieveTroubleshootingContext()` + `generateWithFallback()` to produce synthesized response |
| TSHOOT-05 | Troubleshooting responses cite source resolved issues with provenance disclosure | Format citations as `#N Title (XX% match)` table; add provenance footer `> This guidance was synthesized from similar resolved issues` |
| TSHOOT-06 | Lightweight keyword heuristic intent classification (no LLM call) | Pure function `classifyTroubleshootingIntent()` checking mention text + issue title/body against keyword patterns |
| TSHOOT-07 | Gated behind `triage.troubleshooting.enabled` config flag (default: false) | Config schema already exists in `triageSchema` with `troubleshooting.enabled: false` default |
| TSHOOT-08 | Comment-scoped marker dedup keyed by trigger comment ID | HTML marker `<!-- kodiai:troubleshoot:{repo}:{issueNumber}:comment-{commentId} -->` scanned via `listComments()` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ai (Vercel AI SDK) | existing | `generateText()` for synthesis | Already used for all non-agentic LLM tasks; `generateWithFallback()` wrapper handles retry/cost |
| postgres.js | existing | DB queries for triage state | Single `sql` tagged-template pool shared by all stores |
| @octokit/webhooks-types | existing | Webhook payload types | Already used in mention-types.ts for `IssueCommentCreatedEvent` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | existing | Structured logging | All handler logging |
| zod | existing | Config validation | Already validates `triage.troubleshooting` schema |

No new dependencies required. Everything needed is already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  handlers/
    troubleshooting-agent.ts        # NEW: handler + intent classifier + comment formatter
    troubleshooting-agent.test.ts   # NEW: tests
  knowledge/
    troubleshooting-retrieval.ts    # EXISTING (Phase 110): retrieval function
  llm/
    task-types.ts                   # MODIFY: add troubleshooting.synthesis task type
  index.ts                         # MODIFY: wire new handler
```

### Pattern 1: Separate Handler File (following issue-opened.ts)
**What:** Each distinct handler concern gets its own file with a `createXxxHandler()` factory function that receives deps and registers with the event router.
**When to use:** Always for new webhook-triggered features.
**Example:**
```typescript
// Source: src/handlers/issue-opened.ts (existing pattern)
export function createTroubleshootingHandler(deps: {
  eventRouter: EventRouter;
  jobQueue: JobQueue;
  githubApp: GitHubApp;
  workspaceManager: WorkspaceManager;
  issueStore: IssueStore;
  wikiPageStore?: WikiPageStore;
  embeddingProvider: EmbeddingProvider;
  taskRouter: TaskRouter;
  costTracker?: CostTracker;
  sql: Sql;
  logger: Logger;
}): void {
  // Register on issue_comment.created (same event key as mention handler)
  deps.eventRouter.register("issue_comment.created", handleTroubleshootingMention);
}
```

### Pattern 2: Event Router Multi-Handler Dispatch
**What:** The event router (`src/webhook/router.ts`) supports multiple handlers per event key. When `issue_comment.created` fires, both the mention handler and the troubleshooting handler receive it. Each independently decides whether to act. `Promise.allSettled` isolates failures.
**When to use:** When a new handler needs to react to an existing webhook event.
**Key insight:** The troubleshooting handler must bail early if the mention is not troubleshooting-intent, so it does NOT interfere with normal mention handling. Both handlers run concurrently but only one should post a response.

### Pattern 3: generateWithFallback for Non-Agentic Synthesis
**What:** Use `generateWithFallback()` from `src/llm/generate.ts` for stateless text generation with automatic model fallback and cost tracking.
**When to use:** Any non-agentic LLM call (no MCP tools, no workspace).
**Example:**
```typescript
// Source: existing pattern in wiki-staleness-detector.ts
const resolved = taskRouter.resolve("troubleshooting.synthesis");
const result = await generateWithFallback({
  taskType: "troubleshooting.synthesis",
  resolved,
  prompt: buildTroubleshootingSynthesisPrompt(matches, userQuery),
  system: "You are a troubleshooting assistant...",
  costTracker,
  repo: `${owner}/${repoName}`,
  deliveryId: event.id,
  logger,
});
```

### Pattern 4: Comment-Scoped Marker Dedup
**What:** Embed an HTML comment marker in posted comments for idempotency. Unlike issue-opened's per-issue marker (`kodiai:triage:{repo}:{issueNumber}`), troubleshooting uses per-comment markers to allow re-triggering on new mentions.
**When to use:** When the same issue may receive multiple troubleshooting requests (one per `@kodiai` mention).
**Example:**
```typescript
const TROUBLESHOOT_MARKER_PREFIX = "kodiai:troubleshoot";

function buildTroubleshootMarker(repo: string, issueNumber: number, commentId: number): string {
  return `<!-- ${TROUBLESHOOT_MARKER_PREFIX}:${repo}:${issueNumber}:comment-${commentId} -->`;
}

// Check for existing marker before posting
const alreadyHandled = comments.some(
  (c) => c.body?.includes(`comment-${triggerCommentId}`) && c.body?.includes(TROUBLESHOOT_MARKER_PREFIX)
);
```

### Pattern 5: Keyword Heuristic Intent Classification
**What:** Pure function that classifies troubleshooting intent from mention text + issue title/body using keyword matching. No LLM call (TSHOOT-06).
**When to use:** As the gating check before running retrieval + synthesis.
**Example keywords:**
```typescript
const TROUBLESHOOT_KEYWORDS = [
  // Direct troubleshooting verbs
  "troubleshoot", "debug", "diagnose",
  // Help-seeking patterns
  "help", "fix", "solve", "resolve",
  // Problem description patterns
  "not working", "doesn't work", "broken", "failing",
  "crash", "error", "issue", "problem",
  // Question patterns about problems
  "how to fix", "how do i fix", "any ideas",
  "what could cause", "why is", "why does",
  // Workaround seeking
  "workaround", "work around", "alternative",
];
```

### Anti-Patterns to Avoid
- **Adding to mention.ts:** The mention handler is already ~2000 lines. Project constraint requires separate handler files.
- **Using Agent SDK for synthesis:** Troubleshooting synthesis is stateless text generation. Agent SDK is for agentic tasks with MCP tools.
- **Per-issue dedup (not per-comment):** TSHOOT-08 requires comment-scoped markers so users can trigger troubleshooting multiple times on the same issue with different `@kodiai` mentions.
- **Posting when no matches found:** `retrieveTroubleshootingContext()` returns null when nothing found. The handler should silently bail (no comment, no side effects) -- same as wiki fallback's "silent no-match" design.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM text generation | Custom Anthropic API call | `generateWithFallback()` from `src/llm/generate.ts` | Built-in fallback, cost tracking, model routing |
| Troubleshooting retrieval | Custom issue search | `retrieveTroubleshootingContext()` from Phase 110 | Already handles hybrid search, thread assembly, wiki fallback |
| Config schema | Custom parsing | Existing `triageSchema` in `src/execution/config.ts` | Already has `triage.troubleshooting.enabled/similarityThreshold/maxResults/totalBudgetChars` |
| Octokit authentication | Direct JWT/token handling | `githubApp.getInstallationOctokit()` | Standard auth pattern used by all handlers |
| Comment posting | Custom HTTP calls | `octokit.rest.issues.createComment()` | Standard Octokit pattern, all handlers use it |
| Bot self-mention filtering | Custom checks | Existing `botFilter` + author check pattern | Copy from mention handler's self-mention defense |

## Common Pitfalls

### Pitfall 1: Dual-Handler Comment Collision
**What goes wrong:** Both the mention handler and the troubleshooting handler post responses to the same `@kodiai` mention.
**Why it happens:** Both handlers register on `issue_comment.created` and both detect the `@kodiai` mention.
**How to avoid:** The troubleshooting handler must only act when ALL of these are true: (1) troubleshooting intent detected, (2) `triage.troubleshooting.enabled`, (3) issue is open (not a PR). When the troubleshooting handler acts, the mention handler still runs but its response is additive (it handles the general question). However, to avoid duplicate responses, the troubleshooting handler should post first and include a signal. Alternatively, make the troubleshooting handler act INSTEAD of the mention handler for troubleshooting-intent mentions by having the mention handler check for the troubleshoot marker before responding. **Recommendation:** The simplest approach is to let the mention handler run normally (it provides general assistance) and have the troubleshooting handler post a separate, clearly-labeled troubleshooting guidance comment. The user gets both: general assistance + structured troubleshooting guidance. Alternatively, the troubleshooting handler can be wired INTO the mention handler flow (as a pre-check that short-circuits to a direct response) -- this is cleaner but adds to mention.ts's complexity.
**Warning signs:** Users see two comments from kodiai for the same mention.

### Pitfall 2: Intent Classification False Positives
**What goes wrong:** Normal questions like "help me understand this code" trigger troubleshooting synthesis.
**Why it happens:** Keywords like "help", "fix", "error" are too broad.
**How to avoid:** Use compound heuristics: require keyword match in BOTH mention text AND issue title/body. The issue must also be open (not a PR). Consider requiring the issue to have problem-indicating labels or template types. Score-based classification (multiple weak signals > single strong signal) is more robust than any-keyword-match.
**Warning signs:** Troubleshooting responses appear on issues that aren't actually seeking troubleshooting help.

### Pitfall 3: Missing Config Gate Check Ordering
**What goes wrong:** Retrieval or synthesis runs before checking if troubleshooting is enabled.
**Why it happens:** Checking config requires loading `.kodiai.yml` from a workspace clone.
**How to avoid:** Follow the issue-opened handler pattern: clone workspace first, load config, check `triage.troubleshooting.enabled`, bail early if disabled. This is O(1 shallow clone) overhead even for disabled repos.
**Warning signs:** Unnecessary API calls and LLM costs for repos that haven't opted in.

### Pitfall 4: Forgetting to Sanitize Outgoing Mentions
**What goes wrong:** The synthesized guidance text includes `@kodiai` or `@username` mentions that trigger notification loops.
**Why it happens:** LLM output may include mentions from resolved issue text.
**How to avoid:** Apply `sanitizeOutgoingMentions()` from `src/lib/sanitizer.ts` before posting the comment, same as the mention handler does.
**Warning signs:** Infinite comment loops, unexpected notification spam.

### Pitfall 5: Running Synthesis When No Matches Found
**What goes wrong:** LLM synthesis runs with empty context, producing hallucinated guidance.
**Why it happens:** Not checking `retrieveTroubleshootingContext()` return value.
**How to avoid:** If retrieval returns null (no matches), bail silently. Only run synthesis when matches.length > 0 or wikiResults.length > 0.

## Code Examples

### Intent Classifier
```typescript
// Keyword heuristic for troubleshooting intent (TSHOOT-06)
export function classifyTroubleshootingIntent(params: {
  mentionText: string;       // The @kodiai comment body (after stripping mention)
  issueTitle: string;
  issueBody: string | null;
}): boolean {
  const { mentionText, issueTitle, issueBody } = params;
  const combined = `${mentionText} ${issueTitle} ${issueBody ?? ""}`.toLowerCase();

  // Problem indicators in issue context (title/body)
  const PROBLEM_KEYWORDS = [
    "crash", "error", "bug", "broken", "fail", "not working",
    "doesn't work", "does not work", "won't", "will not",
    "exception", "segfault", "hang", "freeze",
  ];

  // Help-seeking in mention text
  const HELP_KEYWORDS = [
    "troubleshoot", "debug", "diagnose", "help",
    "how to fix", "any ideas", "suggestions",
    "workaround", "similar issue", "same problem",
    "has anyone", "known issue",
  ];

  const mentionLower = mentionText.toLowerCase();
  const contextLower = `${issueTitle} ${issueBody ?? ""}`.toLowerCase();

  const hasProblemInContext = PROBLEM_KEYWORDS.some(k => contextLower.includes(k));
  const hasHelpInMention = HELP_KEYWORDS.some(k => mentionLower.includes(k));

  // Require at least one signal from each
  return hasProblemInContext && hasHelpInMention;
}
```

### Synthesis Prompt Builder
```typescript
// Build the prompt for LLM synthesis of troubleshooting guidance
function buildTroubleshootingSynthesisPrompt(
  result: TroubleshootingResult,
  queryTitle: string,
  queryBody: string | null,
): string {
  const lines: string[] = [];

  lines.push("You are a troubleshooting assistant for a software project.");
  lines.push("A user has reported a problem. Below are similar resolved issues and/or wiki pages.");
  lines.push("Synthesize actionable troubleshooting guidance based on these sources.");
  lines.push("");
  lines.push("## Current Issue");
  lines.push(`Title: ${queryTitle}`);
  if (queryBody) {
    lines.push(`Description: ${queryBody.slice(0, 1000)}`);
  }
  lines.push("");

  if (result.matches.length > 0) {
    lines.push("## Similar Resolved Issues");
    for (const match of result.matches) {
      lines.push(`### Issue #${match.issueNumber}: ${match.title} (${Math.round(match.similarity * 100)}% match)`);
      lines.push(match.body.slice(0, 500));
      if (match.tailComments.length > 0) {
        lines.push("\nResolution comments:");
        for (const comment of match.tailComments) {
          lines.push(`- ${comment.slice(0, 300)}`);
        }
      }
      if (match.semanticComments.length > 0) {
        lines.push("\nRelevant discussion:");
        for (const comment of match.semanticComments) {
          lines.push(`- ${comment.slice(0, 300)}`);
        }
      }
      lines.push("");
    }
  }

  if (result.wikiResults.length > 0) {
    lines.push("## Related Wiki Pages");
    for (const wiki of result.wikiResults) {
      lines.push(`### ${wiki.title}`);
      lines.push(wiki.content.slice(0, 500));
      lines.push("");
    }
  }

  lines.push("## Instructions");
  lines.push("1. Synthesize a concise troubleshooting guide (3-8 bullet points).");
  lines.push("2. Focus on actionable steps the user can try.");
  lines.push("3. Reference specific resolved issues by number when citing solutions.");
  lines.push("4. If wiki pages provide relevant procedures, mention them.");
  lines.push("5. Do NOT invent solutions not grounded in the provided sources.");
  lines.push("6. Keep the response under 500 words.");

  return lines.join("\n");
}
```

### Comment Formatter with Citations (TSHOOT-05)
```typescript
function formatTroubleshootingComment(params: {
  synthesizedGuidance: string;
  result: TroubleshootingResult;
  marker: string;
}): string {
  const { synthesizedGuidance, result, marker } = params;
  const lines: string[] = [];

  lines.push("## Troubleshooting Guidance");
  lines.push("");
  lines.push(synthesizedGuidance);
  lines.push("");

  // Citation table (TSHOOT-05)
  if (result.matches.length > 0) {
    lines.push("<details>");
    lines.push("<summary>Sources</summary>");
    lines.push("");
    lines.push("| Issue | Title | Match |");
    lines.push("|-------|-------|-------|");
    for (const match of result.matches) {
      lines.push(`| #${match.issueNumber} | ${match.title} | ${Math.round(match.similarity * 100)}% |`);
    }
    if (result.wikiResults.length > 0) {
      lines.push("");
      for (const wiki of result.wikiResults) {
        lines.push(`- [Wiki: ${wiki.title}](${wiki.url ?? ""})`);
      }
    }
    lines.push("");
    lines.push("</details>");
  }

  lines.push("");
  lines.push("> This guidance was synthesized from similar resolved issues. It may not directly apply to your situation.");
  lines.push("");
  lines.push(marker);

  return lines.join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mention handler monolith | Separate handler files per concern | v0.22 (issue-opened.ts) | New features get own files |
| Direct Anthropic API calls | Vercel AI SDK + TaskRouter | v0.20 | Unified cost tracking, fallback, multi-provider |
| Per-issue dedup markers | Per-trigger dedup markers | Phase 111 (new) | Same issue can receive multiple troubleshooting responses |

## Handler Wiring Analysis

The troubleshooting handler needs to be wired in `src/index.ts`. Key analysis:

**Registration point:** After the existing `createIssueOpenedHandler()` call (line ~481), add:
```typescript
if (issueStore && embeddingProvider) {
  createTroubleshootingHandler({
    eventRouter,
    jobQueue,
    githubApp,
    workspaceManager,
    issueStore,
    wikiPageStore,
    embeddingProvider,
    taskRouter,  // For model routing
    costTracker, // For cost tracking
    sql,
    logger,
  });
}
```

**Dependencies available at wiring point:** All required deps (`issueStore`, `embeddingProvider`, `wikiPageStore`, `taskRouter`, `costTracker`, `sql`) are already initialized before the handler registration block.

**Event key:** `issue_comment.created` -- same as mention handler. The event router dispatches to ALL registered handlers for a key via `Promise.allSettled`, so both handlers receive the event independently.

## Dual-Handler Coordination Strategy

The critical design question: how do the troubleshooting handler and the mention handler coexist?

**Option A: Independent parallel handlers (recommended)**
- Both register on `issue_comment.created`
- Troubleshooting handler bails early if not troubleshooting intent
- When troubleshooting handler DOES act, the mention handler ALSO runs
- Result: user gets troubleshooting guidance + general mention response
- Risk: two comments from kodiai on the same mention
- Mitigation: acceptable if troubleshooting comment is clearly labeled with `## Troubleshooting Guidance` header

**Option B: Troubleshooting as mention handler pre-check**
- Troubleshooting logic added as a new code path inside `mention.ts`
- If troubleshooting intent detected + config enabled, short-circuit to troubleshooting response
- No dual-comment problem
- Risk: adds complexity to already-large mention handler

**Option C: Troubleshooting handler posts, mention handler detects marker and skips**
- Troubleshooting handler runs first (via job queue ordering or explicit coordination)
- Posts response with marker
- Mention handler checks for troubleshoot marker before responding
- Clean single-response, but adds coupling between handlers

**Recommendation: Option A** is simplest and most maintainable. The troubleshooting comment is clearly distinct from the mention response. If dual-comment UX is unacceptable, fall back to Option C with the mention handler scanning for the troubleshoot marker before posting its own response.

## Open Questions

1. **Dual-comment UX decision**
   - What we know: Both handlers will fire for troubleshooting mentions
   - What's unclear: Is getting two comments (troubleshooting + general) acceptable UX?
   - Recommendation: Start with Option A (independent handlers), iterate if feedback says two comments is noisy

2. **Intent classification threshold tuning**
   - What we know: Keyword heuristics need both problem-in-context and help-in-mention
   - What's unclear: Exact keyword list and scoring weights for best precision/recall
   - Recommendation: Start conservative (high precision, low recall), expand keywords based on real usage

3. **Wiki result URL field**
   - What we know: `WikiKnowledgeMatch` has fields but URL availability depends on wiki store
   - What's unclear: Whether wiki results have navigable URLs for citation links
   - Recommendation: Check `WikiKnowledgeMatch` type; fall back to title-only citation if no URL

## Sources

### Primary (HIGH confidence)
- `src/handlers/mention.ts` - Full mention handling flow, routing, comment posting patterns
- `src/handlers/issue-opened.ts` - Separate handler file pattern, dedup, config gating
- `src/handlers/mention-types.ts` - MentionEvent normalization, `containsMention()`, `stripMention()`
- `src/knowledge/troubleshooting-retrieval.ts` - Phase 110 retrieval function, types
- `src/triage/triage-comment.ts` - Marker dedup pattern (`TRIAGE_MARKER_PREFIX`, `buildTriageMarker`)
- `src/llm/generate.ts` - `generateWithFallback()` for non-agentic synthesis
- `src/llm/task-types.ts` - Task type taxonomy, agentic vs non-agentic classification
- `src/execution/config.ts` - `triageSchema` with `troubleshooting` config block
- `src/webhook/router.ts` - Multi-handler dispatch via `Promise.allSettled`
- `src/index.ts` - Handler wiring, dependency availability

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project, no new dependencies
- Architecture: HIGH - clear handler pattern established by issue-opened.ts, retrieval foundation from Phase 110
- Intent classification: MEDIUM - keyword heuristics are simple but tuning requires real-world data
- Dual-handler coordination: MEDIUM - Option A is straightforward but UX implications need validation

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable internal patterns, no external dependencies)
