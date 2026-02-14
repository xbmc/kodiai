# Phase 50: Publish-Path Mention Sanitization Completion - Research

**Researched:** 2026-02-14
**Domain:** Outbound GitHub comment/mention publishing, defense-in-depth sanitization
**Confidence:** HIGH

## Summary

Phase 50 closes the last remaining `DEGRADED` flow in the v0.8 milestone audit: outgoing mention sanitization is not guaranteed across every publish path. Currently, `sanitizeOutgoingMentions()` is called in 4 places within `src/handlers/mention.ts` (the `postMentionReply` helper, the `postMentionError` helper, the fallback reply, and the outer catch block), but three MCP server publish tools (`comment-server.ts`, `inline-review-server.ts`, `review-comment-thread-server.ts`) and several direct review handler publish paths (`review.ts`) do not pass outgoing content through mention sanitization at all.

The risk is low in practice because (1) the review handler generates bot-authored content unlikely to contain `@appSlug` mentions, and (2) the MCP tools are invoked by the LLM which is instructed not to mention itself. However, the audit correctly identifies this as a defense-in-depth gap: any path that publishes a GitHub comment or review should sanitize outgoing mentions to prevent self-trigger loops.

The recommended approach is to introduce a thin shared `publishComment` / `publishReply` helper module that wraps the Octokit calls with `sanitizeOutgoingMentions()` applied to the body, then route all publish paths through it.

**Primary recommendation:** Create a shared `src/lib/publish.ts` module with sanitized wrappers for each Octokit publish call type, then refactor all outbound paths (MCP servers, mention handler, review handler) to use these wrappers instead of calling Octokit directly.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sanitizeOutgoingMentions` | (internal) | Strip `@handle` from bot replies | Already exists in `src/lib/sanitizer.ts`, battle-tested with 10 unit tests |
| `@octokit/rest` | (existing) | GitHub API calls | Already the project's GitHub client |
| `bun:test` | (existing) | Test runner | Already used project-wide |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `wrapInDetails` | (internal) | Collapsible `<details>` wrapper | Already used in mention handler, may be combined with sanitization in the shared helper |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared publish helper module | Middleware/interceptor on Octokit instance | Would require wrapping every Octokit instance at creation time; more invasive and harder to test. The helper approach is simpler and more explicit. |
| Refactoring MCP servers to accept a publish function | Passing sanitized handles into each MCP server constructor | Adds constructor parameters but avoids the MCP servers importing from a shared module. Either works; constructor injection is slightly more testable. |

**Installation:** No new packages needed. This is pure refactoring of existing internal code.

## Architecture Patterns

### Current Publish Path Inventory

Every location that publishes content to GitHub via Octokit:

```
MENTION HANDLER (src/handlers/mention.ts) -- SANITIZED
  postMentionReply()          L228 -- sanitizeOutgoingMentions applied
  postMentionError()          L257 -- sanitizeOutgoingMentions applied
  fallback reply              L1186 -- sanitizeOutgoingMentions applied
  outer catch error reply     L1231 -- sanitizeOutgoingMentions applied
  cost warning comment        L842-848 -- NOT sanitized (static template, low risk)

REVIEW HANDLER (src/handlers/review.ts) -- NOT SANITIZED
  [no-review] skip comment    L848 -- static string, no user/LLM content
  cost warning comment        L2020 -- static template, no user/LLM content
  error comment (result)      L2280 -- formatErrorComment output, contains error.message
  error comment (catch)       L2381 -- formatErrorComment output, contains error.message
  auto-approval review        L2335 -- idempotency marker only
  upsertReviewDetailsComment  L260-295 -- bot-generated review details
  appendReviewDetailsToSummary L297-332 -- appends to existing summary

MCP COMMENT SERVER (src/execution/mcp/comment-server.ts) -- NOT SANITIZED
  update_comment tool         L474 -- LLM-authored body
  create_comment tool         L540 -- LLM-authored body
  create_review (approval)    L522 -- LLM-authored body

MCP INLINE REVIEW SERVER (src/execution/mcp/inline-review-server.ts) -- NOT SANITIZED
  create_inline_comment tool  L154 -- LLM-authored body

MCP REVIEW COMMENT THREAD SERVER (src/execution/mcp/review-comment-thread-server.ts) -- NOT SANITIZED
  reply_to_pr_review_comment  L53 -- LLM-authored body
```

### Risk Assessment

| Path | Risk | Reason |
|------|------|--------|
| MCP comment-server `create_comment` | MEDIUM | LLM generates body; could echo user content containing `@appSlug` |
| MCP comment-server `update_comment` | MEDIUM | Same as above |
| MCP review-comment-thread-server `reply_to_pr_review_comment` | MEDIUM | LLM reply may quote user mentioning `@appSlug` |
| MCP inline-review-server `create_inline_comment` | LOW | Review findings are bot-generated, unlikely to contain mentions |
| Review handler error comments | LOW | `formatErrorComment` uses error messages, unlikely to contain mentions |
| Review handler skip/cost/approval | VERY LOW | Static templates or idempotency markers |
| Review handler review details | VERY LOW | Bot-generated metrics content |

### Recommended Project Structure

```
src/
├── lib/
│   ├── sanitizer.ts          # Existing -- sanitizeOutgoingMentions stays here
│   └── publish.ts            # NEW -- shared sanitized publish helpers
├── execution/
│   └── mcp/
│       ├── comment-server.ts           # Refactored to use sanitized publish
│       ├── inline-review-server.ts     # Refactored to use sanitized publish
│       └── review-comment-thread-server.ts  # Refactored to use sanitized publish
└── handlers/
    ├── mention.ts             # Refactored to use shared publish helpers
    └── review.ts              # Refactored to use shared publish helpers
```

### Pattern 1: Sanitized Publish Helper
**What:** A module that wraps Octokit publish calls with `sanitizeOutgoingMentions()`.
**When to use:** Every time the bot publishes a comment, review, or reply to GitHub.
**Example:**
```typescript
// src/lib/publish.ts
import { sanitizeOutgoingMentions } from "./sanitizer.ts";

export function sanitizePublishBody(body: string, handles: string[]): string {
  return sanitizeOutgoingMentions(body, handles);
}
```

### Pattern 2: Constructor Injection for MCP Servers
**What:** Pass `botHandles: string[]` into each MCP server factory, apply sanitization inside the tool handlers before calling Octokit.
**When to use:** For MCP servers that need to sanitize LLM-authored output before publishing.
**Example:**
```typescript
// In comment-server.ts
export function createCommentServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  botHandles: string[],  // NEW parameter
  // ... existing params
) {
  function sanitizeBody(body: string): string {
    return sanitizeOutgoingMentions(body, botHandles);
  }

  // Then in each tool handler:
  //   body: sanitizeBody(originalBody),
}
```

### Anti-Patterns to Avoid
- **Sanitizing at the Octokit wrapper level:** Wrapping the entire Octokit instance would be opaque and could sanitize content that should not be modified (e.g., reading operations, or bodies that are already sanitized).
- **Double sanitization:** If the mention handler already sanitizes and then the MCP server also sanitizes, that is fine (idempotent), but should be documented to avoid confusion. The mention handler's `postMentionReply`/`postMentionError` helpers may become redundant once MCP servers sanitize internally.
- **Passing handles through the LLM prompt:** Telling the LLM not to include `@mentions` is not a substitute for code-level defense-in-depth.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mention stripping regex | Custom regex per call site | `sanitizeOutgoingMentions` from `sanitizer.ts` | Already handles case-insensitivity, word boundaries, regex escaping, multiple handles |
| GitHub API error handling in publish | Per-call-site try/catch | `postOrUpdateErrorComment` from `errors.ts` for error comments | Already handles the never-throw guarantee |

**Key insight:** The `sanitizeOutgoingMentions` function is already well-tested (10 unit tests covering case-insensitivity, word boundaries, multiple handles, regex escaping). The work here is purely about routing, not about building new sanitization logic.

## Common Pitfalls

### Pitfall 1: Breaking MCP Server Signatures
**What goes wrong:** Adding a `botHandles` parameter to MCP server constructors changes the signature, which breaks callers.
**Why it happens:** The `buildMcpServers` factory in `src/execution/mcp/index.ts` must be updated simultaneously.
**How to avoid:** Update `buildMcpServers` to accept `botHandles` in its deps and pass through to each server constructor. Update all callers of `buildMcpServers` (executor.ts, and any tests).
**Warning signs:** TypeScript compilation errors in `executor.ts` or MCP server tests.

### Pitfall 2: Not Knowing the Bot Handles at MCP Server Construction Time
**What goes wrong:** The MCP servers are constructed in `executor.ts` which does not currently know the app slug / bot handles.
**Why it happens:** The mention handler resolves `possibleHandles` = `[appSlug, "claude"]` inside the job callback. The review handler does not compute handles at all.
**How to avoid:** Pass `appSlug` through the `ExecutionContext` or through `buildMcpServers` deps. The handles list is `[appSlug, "claude"]` which is deterministic from the GitHubApp instance.
**Warning signs:** `appSlug` not available where MCP servers are constructed.

### Pitfall 3: Circular Import Risk
**What goes wrong:** Phase 46 decision explicitly states "sanitizeOutgoingMentions remains self-contained in sanitizer.ts to avoid circular imports."
**Why it happens:** If the publish helper imports from handler modules or vice versa in unexpected ways.
**How to avoid:** Keep the publish helper in `src/lib/publish.ts` which only imports from `src/lib/sanitizer.ts`. MCP servers import from `src/lib/publish.ts` or `src/lib/sanitizer.ts` directly. No circular dependency risk.
**Warning signs:** Import cycle errors at build time.

### Pitfall 4: Test Mocking Breakage
**What goes wrong:** Existing tests mock Octokit methods directly. If publish calls now go through a wrapper, mocks may need updating.
**Why it happens:** Tests in `mention.test.ts` and `review.test.ts` mock `octokit.rest.issues.createComment` etc. If those calls now happen inside a shared helper, the mock still works because the Octokit instance is the same.
**How to avoid:** The shared helper should accept an Octokit instance (or `getOctokit` function) just like the MCP servers do. Mocking the Octokit instance still works.
**Warning signs:** Tests failing because mocked API calls are not being intercepted.

### Pitfall 5: Mention Handler Double-Sanitization
**What goes wrong:** The mention handler already sanitizes in `postMentionReply` and `postMentionError`. If MCP servers also sanitize, and the mention handler uses MCP servers for some paths, content gets double-sanitized.
**Why it happens:** The mention handler has BOTH direct Octokit calls (in `postMentionReply`/`postMentionError`) AND delegates to executor which uses MCP servers.
**How to avoid:** This is actually safe because `sanitizeOutgoingMentions` is idempotent (running it twice produces the same result -- the `@` is already stripped after the first pass). Document this explicitly.
**Warning signs:** None -- this is a non-issue but should be documented.

## Code Examples

### Current: How mention handler sanitizes (already working)
```typescript
// src/handlers/mention.ts:227-228
async function postMentionReply(replyBody: string): Promise<void> {
  const sanitizedBody = sanitizeOutgoingMentions(replyBody, possibleHandles);
  // ... posts sanitizedBody via Octokit
}
```

### Proposed: MCP server with sanitization injected
```typescript
// src/execution/mcp/comment-server.ts (modified)
export function createCommentServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  botHandles: string[],  // NEW
  reviewOutputKey?: string,
  onPublish?: () => void,
  prNumber?: number,
) {
  function sanitizeBody(body: string): string {
    return sanitizeOutgoingMentions(body, botHandles);
  }

  // In create_comment tool handler:
  const sanitized = sanitizeBody(
    maybeStampMarker(
      sanitizeKodiaiReReviewSummary(
        sanitizeKodiaiReviewSummary(
          sanitizeKodiaiDecisionResponse(body)
        )
      )
    )
  );
  // ... post sanitized via Octokit
}
```

### Proposed: buildMcpServers updated
```typescript
// src/execution/mcp/index.ts (modified)
export function buildMcpServers(deps: {
  // ... existing deps
  botHandles: string[];  // NEW
}) {
  servers.github_comment = createCommentServer(
    deps.getOctokit,
    deps.owner,
    deps.repo,
    deps.botHandles,  // NEW
    deps.reviewOutputKey,
    deps.onPublish,
    deps.prNumber,
  );
  // ... same for other servers
}
```

### Proposed: executor.ts wiring
```typescript
// src/execution/executor.ts (modified)
const mcpServers = buildMcpServers({
  // ... existing deps
  botHandles: context.botHandles ?? [],  // NEW -- passed from handler
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No mention sanitization | `sanitizeOutgoingMentions` in mention handler only | Phase 46 | Primary conversational paths protected |
| Per-path sanitization | Centralized shared publish sanitization | Phase 50 (this) | All outbound paths protected uniformly |

**Deprecated/outdated:** None. The `sanitizeOutgoingMentions` function is stable and well-tested.

## Key Findings for Planning

### Finding 1: Exactly 3 MCP servers need sanitization added (HIGH confidence)
- `comment-server.ts` -- 3 publish points (`update_comment`, `create_comment`, approval review)
- `inline-review-server.ts` -- 1 publish point (`create_inline_comment`)
- `review-comment-thread-server.ts` -- 1 publish point (`reply_to_pr_review_comment`)

### Finding 2: Review handler has 7 direct publish points, most are low-risk static content (HIGH confidence)
- `[no-review]` skip comment (static string)
- Cost warning comment (static template)
- 2 error comment paths (error messages, low risk)
- Auto-approval review (idempotency marker)
- `upsertReviewDetailsComment` (bot-generated metrics)
- `appendReviewDetailsToSummary` (appends to existing comment)

Of these, the error comment paths are the most worth protecting (error messages could theoretically contain user-supplied content that includes mentions).

### Finding 3: Bot handles are deterministic and available early (HIGH confidence)
The handles list is always `[appSlug, "claude"]`. The `appSlug` is available from `GitHubApp.getAppSlug()` which is called in the mention handler already. For the review handler, the same `GitHubApp` instance is available.

### Finding 4: The simplest approach is constructor injection into MCP servers (HIGH confidence)
Rather than creating an entirely new module, the lightest-touch approach is:
1. Add `botHandles: string[]` parameter to each MCP server factory
2. Apply `sanitizeOutgoingMentions(body, botHandles)` inside each tool handler before the Octokit call
3. Thread `botHandles` through `buildMcpServers` and `executor.ts`
4. For the review handler's direct publish paths, apply `sanitizeOutgoingMentions` at each call site (or extract a local helper)

### Finding 5: Sanitization is idempotent -- double-application is safe (HIGH confidence)
The mention handler already sanitizes before calling `postMentionReply`, and the executor's MCP tools may also sanitize after this phase. Since `sanitizeOutgoingMentions("kodiai text", ["kodiai"])` returns the same result when run twice, this is safe.

### Finding 6: ExecutionContext needs a `botHandles` field (HIGH confidence)
The `ExecutionContext` type in `src/execution/types.ts` does not currently carry bot handles. It needs a new optional field so the executor can pass handles to `buildMcpServers`.

## Open Questions

1. **Should we create a shared publish module (`src/lib/publish.ts`) or just inject handles into MCP servers?**
   - What we know: Both approaches work. The shared module is more architectural; the injection approach is lighter.
   - What's unclear: Whether future phases will add more publish paths that would benefit from a centralized module.
   - Recommendation: Start with constructor injection (lighter touch). A shared module can be extracted later if needed. The phase goal is "shared sanitizing helper" which can be satisfied by the `sanitizeOutgoingMentions` function itself being the shared helper, applied at each publish site.

2. **Should review handler static-content publish paths also be sanitized?**
   - What we know: Static strings like "Review skipped per `[no-review]`" cannot contain mentions. Cost warnings are templates. Review details are bot metrics.
   - What's unclear: Whether the audit requires literally every path, or just LLM-authored and user-content-adjacent paths.
   - Recommendation: Apply sanitization to ALL publish paths for uniformity, even if some are provably safe. The cost is negligible (a no-op regex pass on a short string) and it closes the audit gap definitively.

## Sources

### Primary (HIGH confidence)
- `src/lib/sanitizer.ts` -- `sanitizeOutgoingMentions` implementation and its 10 unit tests in `sanitizer.test.ts`
- `src/handlers/mention.ts` -- All 4 existing sanitization call sites (L228, L257, L1186, L1231)
- `src/execution/mcp/comment-server.ts` -- 3 unsanitized publish points
- `src/execution/mcp/inline-review-server.ts` -- 1 unsanitized publish point
- `src/execution/mcp/review-comment-thread-server.ts` -- 1 unsanitized publish point
- `src/handlers/review.ts` -- 7 direct publish points, none sanitized
- `.planning/v0.8-MILESTONE-AUDIT.md` -- Identifies the DEGRADED flow and recommends centralized sanitized publish helper

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` L80 -- Phase 46 decision: "sanitizeOutgoingMentions remains self-contained in sanitizer.ts to avoid circular imports"

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, purely internal refactoring
- Architecture: HIGH -- all publish paths identified by exhaustive grep; injection pattern is straightforward
- Pitfalls: HIGH -- pitfalls are well-understood from Phase 46 experience and milestone audit

**Research date:** 2026-02-14
**Valid until:** 2026-03-14 (stable domain, no external dependencies)
