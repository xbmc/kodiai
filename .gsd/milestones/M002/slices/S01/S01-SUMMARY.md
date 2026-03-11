---
id: S01
parent: M002
milestone: M002
provides:
  - Configurable @claude alias for mention triggers (default on, repo opt-out)
  - Word-boundary-safe mention detection and stripping for multiple handles
  - Skip execution (no reply) when a mention contains no question after stripping
  - Context builder for mention replies (conversation + PR metadata + inline diff context)
  - Mention prompt includes bounded context and "reply only if useful" rules
  - Operator/maintainer runbook for diagnosing mention failures by deliveryId and surface
  - Human-verified inline thread replies for inline review comment mentions
  - Human-verified top-level PR comment replies for @kodiai mentions
  - In-thread replies for inline PR review comment mentions via MCP tool
  - Mention prompt routing that selects thread replies for pr_review_comment surface
requires: []
affects: []
key_files: []
key_decisions:
  - "Default `mention.acceptClaudeAlias` to true so @claude continues to trigger without retraining"
  - "Make `mention` config strict to catch typos in `.kodiai.yml` mention settings"
  - "Default context bounds: last 20 comments, 800 chars per comment, 1200 chars for PR body"
  - "Context build failures are non-fatal; proceed with empty context to avoid dropping mention replies"
  - "Expose thread reply tool via MCP server key 'reviewCommentThread' and tool name reply_to_pr_review_comment"
  - "Wrap thread reply bodies with wrapInDetails() to enforce collapsed-bot UX even if the model forgets"
patterns_established:
  - "Mention trigger gates: detect possible handles early, then re-check allowed handles after loading repo config"
  - "Mention context builder is a dedicated module (buildMentionContext) rather than being embedded in prompt construction"
  - "Runbooks should include: expected GitHub surface -> expected publish location mapping + concrete code pointers"
  - "If a tool should only be available for a surface, gate its MCP server registration on the required identifiers (PR number + comment id)"
observability_surfaces: []
drill_down_paths: []
duration: 5 min
verification_result: passed
completed_at: 2026-02-09
blocker_discovered: false
---
# S01: Mention Ux Parity

**# Phase 11 Plan 01: Mention UX Parity Summary**

## What Happened

# Phase 11 Plan 01: Mention UX Parity Summary

**Config-driven @claude aliasing for mentions, with word-boundary-safe parsing and a per-repo opt-out that prevents empty/ack-only replies.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-09T22:45:10Z
- **Completed:** 2026-02-09T22:50:14Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `.kodiai.yml` support for `mention.acceptClaudeAlias` (default true) with tests for defaults + opt-out.
- Updated mention detection/stripping to accept multiple handles with `@handle\b` matching (avoids `@claude123`).
- Wired mention handler to consult repo config before reacting/executing; skips when stripped body is empty.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add mention.acceptClaudeAlias config (default true)** - `54d817d481` (feat)
2. **Task 2: Implement alias-aware mention detection and stripping** - `bc4f7b675f` (feat)

**Plan metadata:** (docs commit)
 

## Files Created/Modified

- `src/execution/config.ts` - Extends repo config schema with `mention.acceptClaudeAlias`.
- `src/execution/config.test.ts` - Proves alias defaults + opt-out + strict mention-key validation.
- `src/handlers/mention-types.ts` - Accepts multiple mention handles and strips via word-boundary regex.
- `src/handlers/mention.ts` - Loads repo config to decide accepted handles and skip empty mentions.
- `src/handlers/mention-types.test.ts` - Covers detection/stripping for `@kodiai` and `@claude`.

## Decisions Made

- Default aliasing on (`mention.acceptClaudeAlias: true`) to preserve @claude muscle memory while still allowing opt-out.
- Enforce strict parsing for `mention` config keys to catch typos early.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed nullability mismatch for review submitted timestamps**
- **Found during:** Task 2 (mention-types refactor)
- **Issue:** `pull_request_review.submitted` payload types allow `review.submitted_at` to be null, but `MentionEvent.commentCreatedAt` expects a string.
- **Fix:** Fallback to `pull_request.updated_at` when `review.submitted_at` is null.
- **Files modified:** `src/handlers/mention-types.ts`
- **Verification:** `bun test src/handlers/mention-types.test.ts` and plan verification suite.
- **Committed in:** `bc4f7b675f`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix was necessary for type correctness; no scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Mention parsing and config gating are in place; ready for `11-02-PLAN.md`.

## Self-Check: PASSED

- Confirmed `.planning/phases/11-mention-ux-parity/11-01-SUMMARY.md` exists
- Confirmed `src/handlers/mention-types.test.ts` exists
- Confirmed task commits `54d817d481` and `bc4f7b675f` exist in git history

---
*Phase: 11-mention-ux-parity*
*Completed: 2026-02-09*

# Phase 11 Plan 02: Mention Context Builder Summary

**Bounded, TOCTOU-safe mention context (thread + PR + inline diff) is now injected into the mention prompt, enabling contextual replies without adding any tracking comments.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-09T22:59:06Z
- **Completed:** 2026-02-09T23:04:26Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `buildMentionContext()` that fetches recent thread comments, applies TOCTOU filtering, sanitizes content, and deterministically bounds/truncates prompt context.
- Included PR metadata (title/author/branches/description) and inline review context (file/line + diff hunk) when available.
- Wired context into the mention handler and tightened prompt language to avoid ack/tracking noise (eyes reaction remains the only tracking signal).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create a mention context builder with TOCTOU + sanitization** - `2aa5c7ea12` (feat)
2. **Task 2: Wire context into mention handler and tighten prompt rules** - `12f36ae98b` (feat)

## Files Created/Modified

- `src/execution/mention-context.ts` - Builds bounded, sanitized context for mention replies (thread + PR + inline review).
- `src/execution/mention-context.test.ts` - Tests TOCTOU exclusion, sanitization, deterministic truncation, and inline review context inclusion.
- `src/handlers/mention-types.ts` - Extends normalized review comment surface with optional file/line metadata.
- `src/handlers/mention.ts` - Builds mention context before executor and passes it into the prompt builder.
- `src/execution/mention-prompt.ts` - Accepts `mentionContext` and clarifies "reply only when useful" / no tracking comment rules.

## Decisions Made

- Default bounds chosen to keep prompts small but useful: last 20 comments, 800 chars/comment, 1200 chars PR body.
- Context fetch is best-effort; failures do not drop mention processing.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Mention replies now have contextual grounding (conversation + PR context) while preserving eyes-only tracking.
- Ready for follow-up plans that tune formatting/structure or add additional PR surfaces (e.g., commits/files summaries) if desired.

---
*Phase: 11-mention-ux-parity*
*Completed: 2026-02-09*

## Self-Check: PASSED

# Phase 11 Plan 04: Mention UX Verification + Runbook Summary

**Mention UX parity was verified on real GitHub threads (inline + top-level) and documented as an operator-focused troubleshooting runbook keyed by deliveryId.**

## Performance

- **Duration:** 2h 46m
- **Started:** 2026-02-09T23:16:57Z
- **Completed:** 2026-02-10T02:03:12Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Wrote a high-signal mention debugging runbook focused on evidence collection, deliveryId correlation, and surface-specific publish expectations.
- Human-verified inline review-comment mentions reply in the same thread (and that the reply targets the triggering comment).
- Human-verified top-level PR mention triggers create a normal PR comment reply, with eyes-only acknowledgment (no tracking comment).

## Human Verification Checkpoint

Approved by user with evidence links:

- Inline mention trigger: https://github.com/kodiai/xbmc/pull/9#discussion_r2785392815
- Bot in-thread reply: https://github.com/kodiai/xbmc/pull/9#discussion_r2785394144
- Top-level PR mention trigger: https://github.com/kodiai/xbmc/pull/9#issuecomment-3874488025
- Bot top-level reply: https://github.com/kodiai/xbmc/pull/9#issuecomment-3874488300

## Task Commits

Each task was committed atomically:

1. **Task 1: Write mention troubleshooting runbook** - `25e7595283` (docs)
2. **Task 2: Human verification checkpoint** - No commit (human-verify)

## Files Created/Modified

- `docs/runbooks/mentions.md` - Operator/maintainer checklist for diagnosing mention flows (deliveryId, surface, reaction, publish path) with code pointers.

## Decisions Made

None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Mention UX parity behavior is verified and supportable; ready to proceed to Phase 12 plans.

## Self-Check: PASSED

- FOUND: `.planning/phases/11-mention-ux-parity/11-04-SUMMARY.md`
- FOUND commit: `25e7595283`

# Phase 11 Plan 03: Inline Review Comment Thread Replies Summary

**Inline PR review comment mentions now reply in-thread via a dedicated MCP tool (with prompt routing), while other mention surfaces remain top-level PR/issue comments.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-09T23:06:32Z
- **Completed:** 2026-02-09T23:12:29Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `reply_to_pr_review_comment` MCP tool that posts replies into the exact PR review comment thread.
- Wired MCP registry + mention handler context so inline review comment mentions enable and use the thread reply tool.
- Updated mention prompt instructions so `pr_review_comment` uses thread replies and everything else uses top-level `create_comment`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement MCP tool to reply to a PR review comment thread** - `2517338f73` (feat)
2. **Task 2: Wire thread reply tool into MCP registry and mention prompt routing** - `4ffff90bff` (feat)

## Files Created/Modified

- `src/execution/mcp/review-comment-thread-server.ts` - MCP server exposing `reply_to_pr_review_comment` using Octokit PR review comment reply endpoint.
- `src/execution/mcp/review-comment-thread-server.test.ts` - Stubbed Octokit test asserting correct REST call + wrapped body.
- `src/execution/mcp/index.ts` - Registers `reviewCommentThread` server when PR number + triggering comment id are available.
- `src/execution/mention-prompt.ts` - Routes `pr_review_comment` to thread reply tool; other surfaces remain top-level comment replies.
- `src/handlers/mention.ts` - Passes triggering review comment id into executor context for inline review mentions.

## Decisions Made

- Used a surface-gated MCP server (`reviewCommentThread`) so the thread reply tool only appears when the executor has both `prNumber` and the triggering review `commentId`.
- Enforced `<details>` wrapping at the tool layer for thread replies via `wrapInDetails()` to guarantee collapsed UX.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `bun test` exceeded the default 120s command timeout once; reran with an extended timeout and the full suite passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Inline mention publishing now has parity with in-thread reply expectations; ready to proceed to `11-04-PLAN.md`.

## Self-Check: PASSED

- FOUND: `.planning/phases/11-mention-ux-parity/11-03-SUMMARY.md`
- FOUND commits: `2517338f73`, `4ffff90bff`
