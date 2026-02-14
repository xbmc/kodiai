# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-02-14)

**Core value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.
**Current focus:** v0.9 Smart Dependencies & Resilience

## Current Position

**Milestone:** v0.9 Smart Dependencies & Resilience
**Phase:** Not started (defining requirements)
**Status:** Defining requirements
**Last Activity:** 2026-02-14 — Milestone v0.9 started

**Progress:** [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 145
- Total milestones shipped: 8
- Total phases completed: 50

## Accumulated Context

### Decisions

All decisions logged in `.planning/PROJECT.md` Key Decisions table. v0.8 decisions archived.

### Pending Todos

v0.9 scope (confirmed):
- **Dependency bump analysis:** When a PR title signals a dependency version bump (e.g. `[depends]`, version bump patterns), auto-analyze the changelog between old/new versions, search for CVEs/security advisories, assess how the repo uses the dependency, and report breaking changes, new features, and merge confidence alongside the normal code review. Reference PR: xbmc/xbmc#27860.
- **Timeout & large PR resilience:** 2 observed timeouts (10% failure rate) in recent xbmc reviews. Progressive/chunked review for large PRs, better timeout handling with partial result publishing.
- **Intelligent retrieval improvements:** Multi-signal query construction, adaptive distance thresholds, language-aware retrieval boosting. (Issue #42)

### Explicit User Policies

- **No auto re-review on push.** Kodiai must NOT automatically re-review when new commits are pushed. Users explicitly requested this. Only review on initial open/ready or manual `review_requested`.
- **No unsolicited responses.** Kodiai must NOT respond unless explicitly spoken to (via @kodiai mention or review request trigger).

### Blockers/Concerns

- Search API rate limit (30/min) requires caching strategy validated under production load

## Session Continuity

**Last session:** 2026-02-14
**Stopped At:** v0.9 milestone initialization
**Resume File:** None
**Next action:** Define requirements and create roadmap
