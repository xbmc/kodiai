---
phase: 111-troubleshooting-agent
plan: 02
status: complete
completed: "2026-02-27"
duration: ~8min
tasks_completed: 2
tasks_total: 2
key_files:
  created:
    - src/handlers/troubleshooting-agent.ts
    - src/handlers/troubleshooting-agent.test.ts
  modified:
    - src/index.ts
decisions:
  - "WikiKnowledgeMatch uses rawText (not content) and pageTitle/pageUrl for citations"
  - "Details/sources block rendered when either matches or wiki results exist (not only matches)"
  - "Option A independent parallel handler approach -- troubleshooting handler coexists with mention handler on issue_comment.created"
requirements: [TSHOOT-04, TSHOOT-05, TSHOOT-07, TSHOOT-08]
---

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
