---
gsd_state_version: 1.0
milestone: v0.25
milestone_name: Wiki Content Updates
status: unknown
stopped_at: Phase 120 context gathered
last_updated: "2026-03-03T07:28:21.459Z"
progress:
  total_phases: 84
  completed_phases: 79
  total_plans: 195
  completed_plans: 202
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-03-03)

**Core value:** When a PR is opened, `@kodiai` is mentioned on GitHub, or `@kodiai` is addressed in Slack, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.25 Wiki Content Updates -- Phase 120: Embedding Migration

## Current Position

Phase: 120 of 124 (Embedding Migration)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-03-02 -- Roadmap created with 5 phases (120-124), 20 requirements mapped

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

All decisions through v0.24 archived to `.planning/PROJECT.md` Key Decisions table.

### Key Constraints (Carry-Forward)

- Schema migrations must be additive-only (new tables, nullable columns)
- Slack v1: single workspace, single channel (#kodiai), in-process session state
- Wiki corpus migrating from voyage-code-3 to voyage-context-3; all other corpora stay on voyage-code-3
- voyage-context-3 uses different API: `contextualizedEmbed()` with `inputs: string[][]`, not `/v1/embeddings`
- wiki-store.ts hardcodes "voyage-code-3" at lines 87 and 131 -- must parameterize
- kodi.wiki has NO PageViewInfo extension -- use inbound links + citation frequency + edit recency instead
- GitHub secondary rate limit caps at ~80 req/min for content creation -- need 3s delays between comments
- Must verify GitHub App installation on xbmc/wiki before publishing phase
- Fail-open philosophy: embedding/retrieval failures logged but never block critical path
- Bun `streamText()` has production build failure (oven-sh/bun#25630) -- use `generateText()` exclusively
- Agent SDK owns agentic tasks; Vercel AI SDK owns non-agentic tasks only

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

**Last session:** 2026-03-03T07:28:21.455Z
**Stopped At:** Phase 120 context gathered
**Resume with:** `/gsd:plan-phase 120`
