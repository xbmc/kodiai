---
id: S02
parent: M023
milestone: M023
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: ~5min
verification_result: passed
completed_at: 2026-02-27
blocker_discovered: false
---
# S02: Troubleshooting Agent

**# Phase 111 Plan 02: Troubleshooting Handler with Synthesis & Citations Summary**

## What Happened

# Phase 111 Plan 02: Troubleshooting Handler with Synthesis & Citations Summary

Full troubleshooting agent handler with LLM synthesis, provenance citations, comment formatting, and wiring in src/index.ts.

## What Was Done

### Task 1: Create troubleshooting handler with synthesis, citations, and comment formatting

Created `src/handlers/troubleshooting-agent.ts` with three exports:

- **`createTroubleshootingHandler(deps)`** -- Factory function registering on `issue_comment.created`. 16-step handler flow: extract payload, skip PRs, skip closed issues, check @kodiai mention, skip bot self-mentions, strip mention and classify intent, load repo config via workspace clone, check `triage.troubleshooting.enabled` config gate (TSHOOT-07), get Octokit, marker dedup check (TSHOOT-08), retrieve troubleshooting context, synthesize guidance via `generateWithFallback`, format comment, sanitize outgoing mentions, post comment, log success. Wrapped in try/catch for fail-open behavior.

- **`buildTroubleshootingSynthesisPrompt(result, queryTitle, queryBody)`** -- Builds multi-section prompt: Current Issue (title + truncated body), Similar Resolved Issues (number, title, match %, body, tail comments, semantic comments), Related Wiki Pages (title, raw text), Instructions (6 numbered synthesis rules).

- **`formatTroubleshootingComment(params)`** -- Formats comment with `## Troubleshooting Guidance` header, synthesized text, collapsible `<details>` sources section with citations table (`| Issue | Title | Match |`) and wiki bullet links, provenance footer quote, and HTML marker comment (TSHOOT-05).

Created `src/handlers/troubleshooting-agent.test.ts` with 13 tests:
- 6 prompt builder tests (issue title, match numbers/percentages, tail comments, wiki titles, instructions, body truncation)
- 7 comment formatter tests (header, citations table, details tag, provenance quote, marker position, wiki-only, issues-only)

**Commit:** `c28e5bd237`

### Task 2: Wire troubleshooting handler in src/index.ts

Added import for `createTroubleshootingHandler` after `createIssueOpenedHandler` import. Added handler wiring inside the existing `if (issueStore && embeddingProvider)` block, immediately after `createIssueOpenedHandler` call, with all required deps: eventRouter, jobQueue, githubApp, workspaceManager, issueStore, wikiPageStore, embeddingProvider, taskRouter, costTracker, sql, logger.

**Commit:** `c28e5bd237` (same commit -- both tasks committed together)

## Verification

- `bun test src/handlers/troubleshooting-agent.test.ts` -- 13/13 pass
- `bun build src/handlers/troubleshooting-agent.ts --no-bundle` -- compiles clean
- `bun build src/index.ts --no-bundle` -- compiles clean
- `createTroubleshootingHandler` confirmed in src/index.ts (import + wiring)
- `sanitizeOutgoingMentions` confirmed in troubleshooting-agent.ts (import + usage)
- `retrieveTroubleshootingContext` confirmed in troubleshooting-agent.ts
- Provenance text "synthesized from similar resolved issues" confirmed
- `hasTroubleshootMarker` used for comment-scoped dedup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WikiKnowledgeMatch field name mismatch**
- **Found during:** Task 1
- **Issue:** Research code examples used `wiki.title` and `wiki.content` but the actual `WikiKnowledgeMatch` type uses `pageTitle` and `rawText`
- **Fix:** Used correct field names from the actual type definition in wiki-retrieval.ts
- **Files modified:** src/handlers/troubleshooting-agent.ts

## Self-Check: PASSED

- [x] src/handlers/troubleshooting-agent.ts exists
- [x] src/handlers/troubleshooting-agent.test.ts exists
- [x] src/index.ts contains createTroubleshootingHandler import and wiring
- [x] Commit c28e5bd237 exists

# Phase 111 Plan 01: Intent Classifier & Marker Dedup Summary

Compound keyword intent classifier, comment-scoped marker dedup, and troubleshooting.synthesis task type registration.

## What Was Done

### Task 1: Intent classifier and comment-scoped marker dedup

Created `src/handlers/troubleshooting-intent.ts` with four exports:

- **`classifyTroubleshootingIntent()`** -- Pure function using compound keyword heuristic (TSHOOT-06). Checks `PROBLEM_KEYWORDS` (19 terms: crash, error, bug, broken, fail, etc.) against issue title+body and `HELP_KEYWORDS` (15 terms: troubleshoot, debug, help, how to fix, etc.) against mention text. Returns true only when both signals present.
- **`TROUBLESHOOT_MARKER_PREFIX`** -- String constant `"kodiai:troubleshoot"`.
- **`buildTroubleshootMarker(repo, issueNumber, triggerCommentId)`** -- Produces HTML comment `<!-- kodiai:troubleshoot:{repo}:{issueNumber}:comment-{commentId} -->` keyed by trigger comment ID (TSHOOT-08).
- **`hasTroubleshootMarker(comments, triggerCommentId)`** -- Scans comment bodies for marker matching specific trigger comment ID.

Created `src/handlers/troubleshooting-intent.test.ts` with 13 tests:
- 8 intent classification tests (true positives, true negatives, case insensitivity, null body)
- 1 marker format test
- 4 marker detection tests (match, no match, different ID, null/undefined body)

**Commit:** `e5abedf36d`

### Task 2: Add troubleshooting.synthesis task type

Added `TROUBLESHOOTING_SYNTHESIS: "troubleshooting.synthesis"` to `TASK_TYPES` in `src/llm/task-types.ts`. Deliberately NOT added to `AGENTIC_TASK_TYPES` -- troubleshooting synthesis is stateless text generation via `generateWithFallback()`, no MCP tools or workspace needed.

**Commit:** `7e756f1252`

## Verification

- `bun test src/handlers/troubleshooting-intent.test.ts` -- 13/13 pass
- `bun build src/handlers/troubleshooting-intent.ts --no-bundle` -- compiles clean
- `bun build src/llm/task-types.ts --no-bundle` -- compiles clean
- `TROUBLESHOOT_MARKER_PREFIX` exported from troubleshooting-intent.ts (confirmed via grep)
- `troubleshooting.synthesis` NOT in AGENTIC_TASK_TYPES (confirmed via grep)

## Deviations from Plan

None -- plan executed exactly as written.
