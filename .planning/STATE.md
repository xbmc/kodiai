# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 9 complete. Review UX improvements shipped.

## Current Position

Phase: 9 of 9 (Review UX Improvements)
Plan: 2 of 2 in current phase
Status: Phase 9 complete
Last activity: 2026-02-08 -- Completed 09-02-PLAN.md (PR summary comment in review prompt).

Progress: [####################] 100% (21/21 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 21
- Average duration: 3min
- Total execution time: 68min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-webhook-foundation | 3/3 | 11min | 4min |
| 02-job-infrastructure | 2/2 | 8min | 4min |
| 03-execution-engine | 3/3 | 9min | 3min |
| 04-pr-auto-review | 2/2 | 5min | 3min |
| 05-mention-handling | 2/2 | 6min | 3min |
| 06-content-safety | 2/2 | 4min | 2min |
| 07-operational-resilience | 2/2 | 5min | 3min |
| 08-deployment | 2/2 | 16min | 8min |
| 09-review-ux-improvements | 2/2 | 2min | 1min |

*Updated after each plan completion*

## Deployment Info

- **FQDN:** ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- **Webhook URL:** https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github
- **GitHub App ID:** 2822869
- **GitHub App slug:** kodiai
- **GitHub repo:** https://github.com/xbmc/kodiai (private)
- **Azure resources:** rg-kodiai (resource group), kodiairegistry (ACR), ca-kodiai (container app), cae-kodiai (environment)

## Accumulated Context

### Decisions

- [09-02]: Summary comment posted FIRST before inline comments to appear at top of PR conversation
- [09-02]: Trivial PR threshold: fewer than 3 files AND under 50 lines changed
- [09-02]: 500-character threshold triggers details wrapping for long summaries
- [08-02]: ACR remote build used instead of local docker build + push
- [08-02]: Managed identity with AcrPull role for registry auth
- [08-02]: min-replicas 1 to prevent webhook timeouts from cold starts
- [08-02]: Health probe YAML must include full container spec (image + env vars)
- [08-02]: Explicit git refspec needed for base branch fetch in single-branch clones
- [08-02]: Microsoft.ContainerRegistry provider must be pre-registered

### Roadmap Evolution

- Phase 9 added: Review UX Improvements

### Pending Todos

None.

### Blockers/Concerns

All resolved:
- ~~GitHub App not yet registered~~ RESOLVED: App ID 2822869, slug "kodiai"
- ~~Azure Container Apps not yet provisioned~~ RESOLVED: deployed to ca-kodiai
- ~~Claude CLI on Alpine~~ RESOLVED: agent-sdk bundles cli.js, works on Alpine

## Session Continuity

Last session: 2026-02-08
Stopped at: Completed 09-02-PLAN.md
Resume file: None
