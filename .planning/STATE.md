---
gsd_state_version: 1.0
milestone: v0.25
milestone_name: Wiki Content Updates
status: active
stopped_at: Defining requirements
last_updated: "2026-03-03T04:30:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-03)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.25 Wiki Content Updates

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-03 — Milestone v0.25 started

## Accumulated Context

### Decisions

All decisions through v0.24 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 16 | Parse Windows package lists and harden pipeline against all-null enrichment | 2026-03-03 | cd571d7945 | [16-parse-windows-package-lists-and-harden-p](./quick/16-parse-windows-package-lists-and-harden-p/) |
| 17 | Add patch-to-PR feature: detect "create a patch" as write intent on PR surfaces | 2026-03-03 | b0d41ac420 | [17-add-patch-to-pr-feature-when-asked-to-cr](./quick/17-add-patch-to-pr-feature-when-asked-to-cr/) |

## Session Continuity

**Last session:** 2026-03-03
**Stopped At:** Completed quick task 17
**Resume with:** `/gsd:new-milestone`
