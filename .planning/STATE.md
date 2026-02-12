# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-11)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 28 — Knowledge Store & Explicit Learning

## Current Position

Phase: 28 of 29 (Knowledge Store & Explicit Learning)
Plan: 8 of 8 in current phase (PHASE COMPLETE)
Status: Phase Complete
Last activity: 2026-02-12 - Completed 28-08 plan execution

Progress: [███████░░░] 75% (of v0.4)

## Performance Metrics

**Velocity:**
- Total plans completed: 55 (across v0.1 + v0.2 + v0.3 + v0.4)
- Average duration: 5min
- Total execution time: 289min

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
| 27-context-aware-reviews | 4 | 11min | 3min |
| 28-knowledge-store-explicit-learning | 4 | 9min | 2min |

*Updated after each plan completion*
| Phase 28 P04 | 560 | 8 tasks | 14 files |
| Phase 28 P06 | 1 min | 2 tasks | 2 files |
| Phase 28 P05 | 2 min | 3 tasks | 5 files |
| Phase 28 P07 | 5 min | 3 tasks | 2 files |
| Phase 28 P08 | 3 min | 3 tasks | 7 files |

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
- [Phase 27-context-aware-reviews]: 27-03: Use adaptive deepen plus unshallow attempts before switching from triple-dot to two-dot diff
- [Phase 27-context-aware-reviews]: 27-03: Collect changed files, numstat, and full diff from one resolved diff range to keep prompt context aligned
- [Phase 27]: 27-04: Emit elapsed-time degradation as a stable risk signal to preserve DiffAnalysis output compatibility
- [Phase 27]: 27-04: Keep metrics computed from full changed-file and numstat inputs even when scanning truncates by time budget
- [Phase 28]: 28-01: Knowledge store follows telemetry-style factory pattern with WAL, foreign keys, and normalized review/finding/suppression tables
- [Phase 28]: 28-02: Suppression config supports string and object forms while confidence scoring stays deterministic from severity/category/pattern signals
- [Phase 28]: 28-03: Knowledge store writes are non-fatal and capture review-level metrics immediately while finding parsing is deferred
- [Phase 28]: 28-04: Operator reporting uses self-contained read-only SQLite CLI scripts with human and JSON outputs
- [Phase 28]: Knowledge store writes stay non-fatal and fire-and-forget
- [Phase 28]: Suppression patterns support string shorthand and metadata filters
- [Phase 28]: Confidence scores are deterministic from severity/category/pattern signals
- [Phase 28]: CLI stats and trends query knowledge SQLite directly in read-only mode
- [Phase 28]: 28-06: Review Details metrics requirements are mode-agnostic so standard runtime still enforces quantitative output
- [Phase 28]: 28-06: Prompt tests assert files reviewed, lines analyzed/changed, and severity-grouped counts to prevent contract regressions
- [Phase 28]: 28-05: Centralized knowledge DB path resolution with shared arg/env/default precedence
- [Phase 28]: 28-05: Stats CLI missing-path errors now include explicit KNOWLEDGE_DB_PATH and --db recovery examples
- [Phase 28]: 28-07: Runtime finding extraction now parses emitted inline review comments into normalized severity/category/path metadata
- [Phase 28]: 28-07: Suppressed findings are excluded from deterministic output sections but persisted with confidence and suppression-pattern metadata
- [Phase 28]: 28-07: Handler enforces Review Details and Low Confidence Findings via marker-based upsert with explicit time-saved formula
- [Phase 28]: 28-08: Enforce suppression and minConfidence on visible inline comments by marker-scoped post-publication deletion with non-fatal per-comment handling
- [Phase 28]: 28-08: Keep per-repo persistence as default and gate anonymized global aggregate writes behind knowledge.shareGlobal opt-in

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
Stopped at: Completed 28-08-PLAN.md
Resume file: None
