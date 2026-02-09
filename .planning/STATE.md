# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-09)

**Core value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.
**Current focus:** Planning next milestone (fresh requirements + roadmap).

## Current Position

**Current Phase:** 11
**Current Phase Name:** mention-ux-parity
**Total Phases:** 13
**Current Plan:** 4
**Total Plans in Phase:** 4
**Status:** Ready to execute
**Progress:** [████████░░] 81%

**Last Activity:** 2026-02-09
**Last Activity Description:** Completed 11-01-PLAN.md
**Paused At:** None

Milestone: v0.1 MVP (archived)

## Performance Metrics

**Velocity:**
- Total plans completed: 27
- Average duration: 3min
- Total execution time: 86min

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
| 10-review-request-reliability | 4/4 | 49min | 12min |

*Updated after each plan completion*
| Phase 10 P03 | 3 min | 2 tasks | 7 files |
| Phase 10 P04 | 2 min | 3 tasks | 4 files |
| Phase 11 P01 | 5 min | 2 tasks | 5 files |
| Phase 11-mention-ux-parity P02 | 5 min | 2 tasks | 5 files |
| Phase 11-mention-ux-parity P03 | 5 min | 2 tasks | 5 files |

## Deployment Info

- **FQDN:** ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io
- **Webhook URL:** https://ca-kodiai.agreeableisland-d347f806.eastus.azurecontainerapps.io/webhooks/github
- **GitHub App ID:** 2822869
- **GitHub App slug:** kodiai
- **GitHub repo:** https://github.com/xbmc/kodiai (private)
- **Azure resources:** rg-kodiai (resource group), kodiairegistry (ACR), ca-kodiai (container app), cae-kodiai (environment)
- **Latest revision:** ca-kodiai--0000012 (deployed 2026-02-09, includes review_requested reliability hardening and deliveryId correlation logs)

## Decisions Made

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
- [Phase 10]: Delivery-scoped reviewOutputKey combines installation/repo/PR/action/delivery/head SHA for deterministic idempotency identity.
- [Phase 10]: Inline review publication checks existing kodiai:review-output-key marker once per execution and logs published vs already-published-skip outcomes.
- [Phase 10]: Use deterministic marker fixture assertions in tests to lock kodiai review-output marker parsing behavior.
- [Phase 10]: Treat replay/retry reliability as same-delivery reprocessing tests so downstream idempotency is proven independent of ingress dedup.
- [Phase 11]: Default mention.acceptClaudeAlias to true so @claude triggers by default
- [Phase 11]: Make mention config strict to reject unknown mention keys in .kodiai.yml
- [Phase 11-mention-ux-parity]: [11-02]: Default context bounds: last 20 comments, 800 chars per comment, 1200 chars for PR body
- [Phase 11-mention-ux-parity]: [11-02]: Mention context build is best-effort; failures proceed with empty context
- [Phase 11-mention-ux-parity]: [11-03]: Gate reviewCommentThread MCP server on having PR number + triggering review comment id
- [Phase 11-mention-ux-parity]: [11-03]: Enforce <details> wrapping for thread replies in the MCP tool via wrapInDetails()

## Roadmap Evolution

- Phase 9 added: Review UX Improvements

## Pending Todos

None.

## Blockers

- Active: GitHub webhook delivery API requires `admin:repo_hook` scope on `gh` token to fetch delivery status metadata (`status_code`, `delivered_at`) for forensic evidence.

Note: Redelivery replay can be verified via GitHub App UI even without the delivery APIs.

Resolved:
- ~~GitHub App not yet registered~~ RESOLVED: App ID 2822869, slug "kodiai"
- ~~Azure Container Apps not yet provisioned~~ RESOLVED: deployed to ca-kodiai
- ~~Claude CLI on Alpine~~ RESOLVED: agent-sdk bundles cli.js, works on Alpine
- GitHub webhook delivery API requires gh token scope admin:repo_hook to capture status_code/delivered_at evidence.

## Session

**Last Date:** 2026-02-09T23:13:26.677Z
**Stopped At:** Completed 11-03-PLAN.md
**Resume File:** None
