# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-11)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 27 — Context-Aware Reviews

## Current Position

Phase: 27 of 29 (Context-Aware Reviews)
Plan: 2 of 2 in current phase (PHASE COMPLETE)
Status: Phase Complete
Last activity: 2026-02-12 - Completed 27-02 plan execution

Progress: [██░░░░░░░░] 25% (of v0.4)

## Performance Metrics

**Velocity:**
- Total plans completed: 49 (across v0.1 + v0.2 + v0.3 + v0.4)
- Average duration: 3min
- Total execution time: 277min

**By Phase (v0.3):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 22-config-validation-safety | 1 | 4min | 4min |
| 23-telemetry-foundation | 3 | 11min | 4min |
| 25-reporting-tools | 1 | 2min | 2min |
| 24-enhanced-config-fields | 2 | 10min | 5min |

**By Phase (v0.4):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 26-review-mode-severity-control | 2 | 4min | 2min |
| 27-context-aware-reviews | 2 | 8min | 4min |

*Updated after each plan completion*

## Deployment Info

- **FQDN:** ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- **Webhook URL:** https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github
- **GitHub App ID:** 2822869
- **GitHub App slug:** kodiai

## Accumulated Context

### Decisions

All decisions are logged in PROJECT.md Key Decisions table.
v0.3 decisions archived. v0.4 decisions will accumulate here.

- 26-01: New review fields purely additive, no changes to existing schema or fallback logic
- 26-02: All review intelligence prompt-driven, noise suppression and severity guidelines always included, custom instructions override noise rules
- [Phase 27]: 27-01: Path instructions modeled as ordered array entries with string|string[] glob support and default empty list
- [Phase 27]: 27-01: Diff analysis classifies up to 200 files for context while keeping metrics over full PR change set
- [Phase 27]: 27-02: Handler resolves profile presets with schema-default heuristic so explicit non-default config wins
- [Phase 27]: 27-02: Prompt enrichment injects diff context and path-specific instructions only when available

### Pending Todos

None yet.

### Blockers/Concerns

None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Fix @kodiai review delegation bug - should perform review directly not delegate to aireview team | 2026-02-11 | 1d3a429 | [1-fix-kodiai-review-delegation-bug-should-](./quick/1-fix-kodiai-review-delegation-bug-should-/) |
| 2 | Change APPROVE with no issues to submit PR approval review (green checkmark) | 2026-02-12 | c9c3071 | [2-change-approve-with-no-issues-to-submit-](./quick/2-change-approve-with-no-issues-to-submit-/) |
| 3 | Add --revision-suffix to deploy.sh to force new revision on every deploy | 2026-02-12 | cb55e0f | [3-add-revision-suffix-to-deploy-sh-to-forc](./quick/3-add-revision-suffix-to-deploy-sh-to-forc/) |

## Session Continuity

Last session: 2026-02-12
Stopped at: Completed 27-02-PLAN.md (Phase 27 complete)
Resume file: None
