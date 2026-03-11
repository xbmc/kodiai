# T01: 111-troubleshooting-agent 01

**Slice:** S02 — **Milestone:** M023

## Description

Create the troubleshooting intent classifier (keyword heuristics), comment-scoped marker dedup functions, and register the troubleshooting.synthesis task type. This is the pure logic layer with no handler wiring or LLM calls.

Purpose: Phase 111's handler (plan 02) needs these building blocks to gate troubleshooting activation, prevent duplicate responses, and route LLM synthesis through the task router.

Output: `src/handlers/troubleshooting-intent.ts` with exported pure functions, unit tests, and updated task-types.ts.

## Must-Haves

- [ ] "classifyTroubleshootingIntent returns true only when both problem keywords appear in issue context AND help keywords appear in mention text"
- [ ] "classifyTroubleshootingIntent returns false for general questions like 'help me understand this code'"
- [ ] "buildTroubleshootMarker produces an HTML comment keyed by repo, issueNumber, and triggerCommentId"
- [ ] "hasTroubleshootMarker correctly detects existing markers for a specific trigger comment ID"
- [ ] "TASK_TYPES.TROUBLESHOOTING_SYNTHESIS is registered as a non-agentic task type"

## Files

- `src/handlers/troubleshooting-intent.ts`
- `src/handlers/troubleshooting-intent.test.ts`
- `src/llm/task-types.ts`
