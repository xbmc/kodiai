# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Phase 10 review-request reliability hardening committed, deployed, and log-correlated on production.

## Current Position

Phase: 10 of 10 (Review Request Reliability)
Plan: 2 of 2 in current phase
Status: Phase complete with one external-scope blocker
Last activity: 2026-02-09 -- Completed 10-02 (commit + deploy + review_requested validation evidence).

Progress: [####################] 100% (25/25 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 25
- Average duration: 3min
- Total execution time: 81min

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
| 09-review-ux-improvements | 4/4 | 5min | 1min |
| 10-review-request-reliability | 2/2 | 44min | 22min |

*Updated after each plan completion*

## Deployment Info

- **FQDN:** ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- **Webhook URL:** https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github
- **GitHub App ID:** 2822869
- **GitHub App slug:** kodiai
- **GitHub repo:** https://github.com/xbmc/kodiai (private)
- **Azure resources:** rg-kodiai (resource group), kodiairegistry (ACR), ca-kodiai (container app), cae-kodiai (environment)
- **Latest revision:** ca-kodiai--0000012 (deployed 2026-02-09, includes review_requested reliability hardening and deliveryId correlation logs)

## Accumulated Context

### Decisions

- [09-01]: 500-character threshold for wrapInDetails() (matches UX-03 spec)
- [09-01]: pr_review_body skipped for reactions (review ID is not a comment ID)
- [09-01]: Fire-and-forget pattern for reactions -- failure never blocks processing
- [09-02]: Summary comment posted FIRST before inline comments to appear at top of PR conversation
- [09-02]: Trivial PR threshold: fewer than 3 files AND under 50 lines changed
- [09-02]: 500-character threshold triggers details wrapping for long summaries
- [09-03]: autoApprove defaults to true so clean PRs get APPROVE review without config
- [09-03]: reactions.createForIssue for PR description (PR is an issue, not a comment)
- [09-04]: Removed 500-char COLLAPSE_THRESHOLD -- all bot comments now wrapped unconditionally
- [09-04]: Review summary conditional on finding actionable issues (clean PRs = zero comments)
- [09-04]: Tracking comment uses <details> with 'Kodiai is thinking...' as summary text
- [08-02]: ACR remote build used instead of local docker build + push
- [08-02]: Managed identity with AcrPull role for registry auth
- [08-02]: min-replicas 1 to prevent webhook timeouts from cold starts
- [08-02]: Health probe YAML must include full container spec (image + env vars)
- [08-02]: Explicit git refspec needed for base branch fetch in single-branch clones
- [08-02]: Microsoft.ContainerRegistry provider must be pre-registered
- [Phase 10]: Recovered deploy env vars from existing ACA secrets when local shell vars were missing.

### Roadmap Evolution

- Phase 9 added: Review UX Improvements

### Pending Todos

None.

### Blockers/Concerns

- Active: GitHub webhook delivery API requires `admin:repo_hook` scope on `gh` token to fetch delivery status metadata (`status_code`, `delivered_at`) for forensic evidence.

Resolved:
- ~~GitHub App not yet registered~~ RESOLVED: App ID 2822869, slug "kodiai"
- ~~Azure Container Apps not yet provisioned~~ RESOLVED: deployed to ca-kodiai
- ~~Claude CLI on Alpine~~ RESOLVED: agent-sdk bundles cli.js, works on Alpine
- GitHub webhook delivery API requires gh token scope admin:repo_hook to capture status_code/delivered_at evidence.

## Session Continuity

Last session: 2026-02-09
Stopped at: Completed 10-02-PLAN.md
Resume file: None
