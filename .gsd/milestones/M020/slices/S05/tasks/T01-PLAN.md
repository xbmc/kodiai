# T01: 101-wire-executor-deps-cost-tracking 1

**Slice:** S05 — **Milestone:** M020

## Description

Wire taskRouter and costTracker into createExecutor and fix the missing repo field in wiki-staleness-detector's generateWithFallback call.

Purpose: Closes GAP-1 (executor missing dependencies — agent SDK calls never write cost rows, .kodiai.yml model routing has no effect on agentic tasks) and GAP-2 (wiki staleness LLM calls silently skip cost tracking because repo is undefined).

Output: Both integration gaps closed; all LLM invocations — agentic and non-agentic — produce cost rows.

## Must-Haves

- [ ] "Agent SDK executor calls write cost rows to Postgres via costTracker"
- [ ] ".kodiai.yml model routing is operative for agentic tasks via taskRouter"
- [ ] "Wiki staleness LLM evaluations write cost rows (repo field no longer missing)"

## Files

- `src/index.ts`
- `src/knowledge/wiki-staleness-detector.ts`
- `src/knowledge/wiki-staleness-detector.test.ts`
