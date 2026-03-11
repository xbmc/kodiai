# S02: Troubleshooting Agent

**Goal:** Create the troubleshooting intent classifier (keyword heuristics), comment-scoped marker dedup functions, and register the troubleshooting.
**Demo:** Create the troubleshooting intent classifier (keyword heuristics), comment-scoped marker dedup functions, and register the troubleshooting.

## Must-Haves


## Tasks

- [x] **T01: 111-troubleshooting-agent 01** `est:~5min`
  - Create the troubleshooting intent classifier (keyword heuristics), comment-scoped marker dedup functions, and register the troubleshooting.synthesis task type. This is the pure logic layer with no handler wiring or LLM calls.

Purpose: Phase 111's handler (plan 02) needs these building blocks to gate troubleshooting activation, prevent duplicate responses, and route LLM synthesis through the task router.

Output: `src/handlers/troubleshooting-intent.ts` with exported pure functions, unit tests, and updated task-types.ts.
- [x] **T02: 111-troubleshooting-agent 02** `est:~8min`
  - Create the full troubleshooting handler with LLM synthesis, provenance citations, comment formatting, and wire it into src/index.ts. When @kodiai is mentioned on an open issue with troubleshooting intent, the handler retrieves similar resolved issues, synthesizes guidance via generateWithFallback, formats a comment with citations and provenance disclosure, and posts it.

Purpose: This is the user-facing feature -- the troubleshooting agent that responds to @kodiai mentions with actionable guidance grounded in resolved issues.

Output: `src/handlers/troubleshooting-agent.ts` (handler + helpers), tests, and wiring in `src/index.ts`.

## Files Likely Touched

- `src/handlers/troubleshooting-intent.ts`
- `src/handlers/troubleshooting-intent.test.ts`
- `src/llm/task-types.ts`
- `src/handlers/troubleshooting-agent.ts`
- `src/handlers/troubleshooting-agent.test.ts`
- `src/index.ts`
