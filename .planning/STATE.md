---
gsd_state_version: 1.0
milestone: v0.24
milestone_name: Hallucination Prevention & Fact Verification
status: unknown
stopped_at: Phase 115 context gathered
last_updated: "2026-03-02T17:51:29.447Z"
progress:
  total_phases: 84
  completed_phases: 79
  total_plans: 195
  completed_plans: 202
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-02)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.24 Phase 115 -- PR Review Epistemic Guardrails

## Current Position

Phase: 115 (1 of 5) -- PR Review Epistemic Guardrails
Plan: 0 of 1 in current phase
Status: Ready to plan
Last activity: 2026-03-02 -- Roadmap created for v0.24

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

## Accumulated Context

### Decisions

All decisions through v0.23 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- All corpora use voyage-code-3 (1024 dims) -- consistent model
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks (PR review, mentions, Slack write); Vercel AI SDK owns non-agentic tasks only

### Hallucination Context (v0.24 Motivation)

- PR #27932: bot fabricated libxkbcommon version numbers (1.13.0, 1.11.0, 1.12.x) as [CRITICAL]
- Root cause 1: Prompt says "Do NOT use hedged or vague language" -- encourages assertiveness over accuracy for external facts
- Root cause 2: No post-generation fact-verification layer -- confidence scoring is mathematical, not semantic
- Root cause 3: CRITICAL findings bypass all suppression -- hallucinated CRITICALs are worst-case
- Key files: src/execution/review-prompt.ts, src/knowledge/confidence.ts, src/feedback/safety-guard.ts, src/enforcement/severity-floors.ts

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to.

### Blockers/Concerns

None.

## Session Continuity

**Last session:** 2026-03-02T17:51:29.444Z
**Stopped At:** Phase 115 context gathered
**Resume with:** `/gsd:plan-phase 115`
