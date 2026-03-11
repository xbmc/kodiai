# S05: Wire Executor Deps Cost Tracking

**Goal:** Wire taskRouter and costTracker into createExecutor and fix the missing repo field in wiki-staleness-detector's generateWithFallback call.
**Demo:** Wire taskRouter and costTracker into createExecutor and fix the missing repo field in wiki-staleness-detector's generateWithFallback call.

## Must-Haves


## Tasks

- [x] **T01: 101-wire-executor-deps-cost-tracking 1** `est:2min`
  - Wire taskRouter and costTracker into createExecutor and fix the missing repo field in wiki-staleness-detector's generateWithFallback call.

Purpose: Closes GAP-1 (executor missing dependencies — agent SDK calls never write cost rows, .kodiai.yml model routing has no effect on agentic tasks) and GAP-2 (wiki staleness LLM calls silently skip cost tracking because repo is undefined).

Output: Both integration gaps closed; all LLM invocations — agentic and non-agentic — produce cost rows.

## Files Likely Touched

- `src/index.ts`
- `src/knowledge/wiki-staleness-detector.ts`
- `src/knowledge/wiki-staleness-detector.test.ts`
