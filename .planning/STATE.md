---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: milestone
status: Idle — ready for next milestone
stopped_at: Completed 127-03-PLAN.md
last_updated: "2026-03-07T21:56:42.923Z"
last_activity: 2026-03-07 -- v0.25 Wiki Content Updates shipped
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 3
  completed_plans: 2
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-07)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** Planning next milestone

## Current Position

Milestone: v0.25 shipped
Status: Idle — ready for next milestone
Last activity: 2026-03-07 -- v0.25 Wiki Content Updates shipped

Progress: Milestone complete

## Accumulated Context

### Roadmap Evolution

- Phase 127 added: Fork-based write mode with gist patches — use forked repos instead of branches in main, gist creation for patch requests, prevent direct branch creation

### Decisions

All decisions through v0.25 archived to `.planning/PROJECT.md` Key Decisions table.
- [Phase 127]: BotUserClient uses getter-based stub that throws on access when disabled
- [Phase 127]: Fork policy instructions added to write-mode prompt only, centralized in src/execution/prompts.ts

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks; Vercel AI SDK owns non-agentic tasks only

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

## Session Continuity

**Last session:** 2026-03-07T21:56:42.922Z
**Stopped At:** Completed 127-03-PLAN.md
**Resume file:** None
