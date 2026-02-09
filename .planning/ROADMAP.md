# Roadmap: Kodiai

## Overview

Kodiai delivers AI-powered PR auto-review and conversational code assistance as a GitHub App, replacing per-repo workflow YAML with a single app installation. The roadmap follows the natural dependency chain: webhook infrastructure and safety must exist before any feature handler, the job execution shell must exist before wiring Claude CLI, and the core review capability must work before adding mention handling, security hardening, operational resilience, and deployment.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Webhook Foundation** - Server receives, verifies, and routes GitHub events safely (completed 2026-02-08)
- [x] **Phase 2: Job Infrastructure** - Queued job execution with ephemeral workspaces (completed 2026-02-08)
- [x] **Phase 3: Execution Engine** - Claude Code CLI invocation with MCP servers (completed 2026-02-07)
- [x] **Phase 4: PR Auto-Review** - Inline review comments with suggestions on PR open (completed 2026-02-08)
- [x] **Phase 5: Mention Handling** - Conversational responses to @kodiai across all surfaces (completed 2026-02-08)
- [x] **Phase 6: Content Safety** - Sanitization and TOCTOU protections (completed 2026-02-08)
- [x] **Phase 7: Operational Resilience** - Timeout enforcement and error reporting (completed 2026-02-08)
- [x] **Phase 8: Deployment** - Docker packaging and Azure Container Apps (completed 2026-02-08)
- [x] **Phase 10: Review Request Reliability** - Ensure one manual re-request triggers exactly one reliable, traceable review (completed 2026-02-09)

## Phase Details

### Phase 1: Webhook Foundation
**Goal**: The server receives GitHub webhook events, verifies their authenticity, authenticates as a GitHub App, and routes events to the correct handlers -- while filtering bot-generated noise and processing asynchronously to avoid webhook timeouts.
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-06, INFRA-07, INFRA-08
**Success Criteria** (what must be TRUE):
  1. A GitHub webhook POST to `/webhooks/github` with valid signature returns 200 and the event payload is available for processing
  2. A webhook with invalid or missing signature is rejected with 401/403
  3. The server authenticates as a GitHub App via JWT and can mint installation access tokens for any installation
  4. Events from bot accounts (including the app's own comments) are silently dropped and never reach handlers
  5. The health endpoint at `/health` returns 200 for Azure liveness probes
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md -- Project init, Hono server, webhook endpoint, signature verification, delivery dedup, health endpoints
- [x] 01-02-PLAN.md -- GitHub App authentication (JWT + installation tokens), app slug discovery, readiness probe
- [x] 01-03-PLAN.md -- Event handler registry, bot filtering pipeline, async dispatch wiring

### Phase 2: Job Infrastructure
**Goal**: Webhook handlers can enqueue jobs that clone a target repo into an ephemeral workspace, enforce per-installation concurrency limits, and clean up after themselves.
**Depends on**: Phase 1
**Requirements**: INFRA-05, EXEC-01, EXEC-02, EXEC-05
**Success Criteria** (what must be TRUE):
  1. Jobs are queued and execute with per-installation concurrency limits (one active job per installation at a time)
  2. Each job gets a fresh shallow clone of the target repo in a temporary directory with git auth configured via installation token
  3. After job completion (success or failure), the temporary workspace directory is deleted and no orphaned resources remain
**Plans:** 2 plans

Plans:
- [x] 02-01-PLAN.md -- Job queue with per-installation concurrency (p-queue), job/workspace types, getInstallationToken on GitHubApp
- [x] 02-02-PLAN.md -- Workspace manager (clone, git auth, cleanup, branch validation), server wiring, startup stale cleanup

### Phase 3: Execution Engine
**Goal**: The system can invoke Claude Code CLI against a workspace with MCP servers providing GitHub interaction tools, using sensible defaults when no per-repo config exists.
**Depends on**: Phase 2
**Requirements**: EXEC-03, EXEC-04, OPS-03
**Success Criteria** (what must be TRUE):
  1. Claude Code CLI is invoked via Agent SDK `query()` with a prompt, MCP server config, and working directory pointing to the cloned repo
  2. MCP servers for posting comments, posting inline review comments, and reading CI status are available to the CLI during execution
  3. The system operates with sensible defaults when no `.kodiai.yml` exists in the target repo (zero-config works)
**Plans:** 3 plans

Plans:
- [x] 03-01-PLAN.md -- Execution types (ExecutionContext, ExecutionResult) and config loader (.kodiai.yml with Zod defaults)
- [x] 03-02-PLAN.md -- In-process MCP servers (comment, inline-review, CI status) via Agent SDK createSdkMcpServer
- [x] 03-03-PLAN.md -- Claude Code CLI executor (Agent SDK query invocation, prompt builder, config+MCP wiring)

### Phase 4: PR Auto-Review
**Goal**: When a PR is opened or marked ready for review, the bot automatically posts inline review comments anchored to specific diff lines with suggestion blocks -- or silently approves clean PRs.
**Depends on**: Phase 3
**Requirements**: REVIEW-01, REVIEW-02, REVIEW-03, REVIEW-04, REVIEW-05
**Success Criteria** (what must be TRUE):
  1. Opening a non-draft PR or marking a draft PR as ready triggers an automatic review within 2 minutes
  2. Review comments are anchored to specific changed lines in the diff (not posted as general PR comments)
  3. Review comments include GitHub suggestion blocks that the PR author can apply with one click
  4. A PR with no issues receives a silent approval (no comment posted, no noise)
  5. Fork PRs are reviewed natively without any workarounds or special configuration
**Plans:** 2 plans

Plans:
- [x] 04-01-PLAN.md -- Config extension (review.skipAuthors, skipPaths, prompt) and review prompt builder
- [x] 04-02-PLAN.md -- Review handler (event registration, fork PR support, silent approval) and server wiring

### Phase 5: Mention Handling
**Goal**: Users can @kodiai in any comment surface (issue comments, PR comments, PR review comments, PR review bodies) and receive a contextual response, with a tracking comment showing progress during long-running jobs.
**Depends on**: Phase 3
**Requirements**: MENTION-01, MENTION-02, MENTION-03, MENTION-04, MENTION-05
**Success Criteria** (what must be TRUE):
  1. Typing `@kodiai` followed by a question in an issue comment produces a contextual response as a reply
  2. Typing `@kodiai` in a PR comment, PR review comment, or PR review body produces a contextual response
  3. A tracking comment appears within seconds showing the job is in progress, and updates when the response is ready
  4. The bot's response demonstrates awareness of the surrounding conversation context (prior comments, PR diff if applicable)
**Plans:** 2 plans

Plans:
- [x] 05-01-PLAN.md -- MCP write tool extension, MentionEvent types with normalizers, conversation context builder, mention prompt
- [x] 05-02-PLAN.md -- Mention handler (event registration, tracking comment, execution orchestration) and server wiring

### Phase 6: Content Safety
**Goal**: Content passed to the LLM is sanitized to prevent prompt injection, and comment filtering uses timestamps to prevent time-of-check-to-time-of-use attacks.
**Depends on**: Phase 5
**Requirements**: MENTION-06, MENTION-07
**Success Criteria** (what must be TRUE):
  1. Invisible unicode characters, HTML comments, and embedded tokens are stripped from all user content before it reaches the LLM
  2. Only comments that existed at or before the trigger timestamp are included in conversation context (comments added after the trigger are excluded)
**Plans:** 2 plans

Plans:
- [x] 06-01-PLAN.md -- Content sanitizer module (7-step pipeline) and TOCTOU comment filter with unit tests
- [x] 06-02-PLAN.md -- Integrate sanitization and TOCTOU filtering into all prompt builders

### Phase 7: Operational Resilience
**Goal**: Jobs that exceed their timeout are killed with a user-visible error comment, and any execution failure results in a clear error message posted to the PR or issue (never silent failure).
**Depends on**: Phase 4, Phase 5
**Requirements**: OPS-01, OPS-02
**Success Criteria** (what must be TRUE):
  1. A job that exceeds the configured timeout is terminated and an error comment is posted explaining the timeout
  2. Any unhandled execution failure (crash, API error, resource exhaustion) results in a user-visible error comment on the originating PR or issue
  3. Error comments are clear and actionable (not stack traces or generic "something went wrong")
**Plans:** 2 plans

Plans:
- [x] 07-01-PLAN.md -- Error classification/formatting module, config timeoutSeconds, executor AbortController-based timeout
- [x] 07-02-PLAN.md -- Wire error reporting into review and mention handlers (never silent failure)

### Phase 8: Deployment
**Goal**: The application is packaged as a Docker container and deployed to Azure Container Apps with proper secrets management, running end-to-end in production.
**Depends on**: Phase 7
**Requirements**: OPS-04, OPS-05
**Success Criteria** (what must be TRUE):
  1. The application builds as a Docker container using `oven/bun:1-alpine` (or debian-slim if Alpine fails with Claude CLI)
  2. The container is deployed to Azure Container Apps with GitHub App secrets (private key, webhook secret, app ID) managed via Azure secrets
  3. A real PR opened on an installed repo triggers a review and the response appears as inline comments
**Plans:** 2 plans

Plans:
- [x] 08-01-PLAN.md -- Dockerfile and .dockerignore creation, local image build verification
- [x] 08-02-PLAN.md -- Azure deployment script, provisioning, GitHub App registration, end-to-end verification

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Note: Phase 5 depends on Phase 3 (not Phase 4), so Phases 4 and 5 could theoretically run in parallel. The roadmap sequences them for simplicity.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Webhook Foundation | 3/3 | Complete | 2026-02-08 |
| 2. Job Infrastructure | 2/2 | Complete | 2026-02-08 |
| 3. Execution Engine | 3/3 | Complete | 2026-02-07 |
| 4. PR Auto-Review | 2/2 | Complete | 2026-02-08 |
| 5. Mention Handling | 2/2 | Complete | 2026-02-08 |
| 6. Content Safety | 2/2 | Complete | 2026-02-08 |
| 7. Operational Resilience | 2/2 | Complete | 2026-02-08 |
| 8. Deployment | 2/2 | Complete | 2026-02-08 |
| 9. Review UX Improvements | 2/4 | Gap Closure | 2026-02-08 |
| 10. Review Request Reliability | 0/2 | Planned | - |

### Phase 9: Review UX Improvements

**Goal:** The bot provides clear visual feedback when triggered and formats responses for readability -- adding emoji reactions to acknowledge mentions and PR reviews, collapsing ALL bot comments to reduce noise, and conditionally posting summary comments only when actionable issues are found.
**Depends on:** Phase 8
**Requirements:** UX-01, UX-02, UX-03
**Success Criteria** (what must be TRUE):
  1. When a user mentions @kodiai or a PR is opened for review, the trigger comment/event receives an eyes emoji reaction within seconds to show acknowledgment
  2. ALL bot comments are automatically wrapped in `<details>` tags to reduce noise in PR/issue threads
  3. PR auto-review only posts a summary comment when there are actionable issues to report (clean PRs = silence + approval)
**Plans:** 4 plans

Plans:
- [x] 09-01-PLAN.md -- Eyes emoji reaction on mention triggers, formatting utility (wrapInDetails), <details> wrapping in mention prompt and error comments
- [x] 09-02-PLAN.md -- Structured PR summary comment (what/why/files) in review prompt
- [ ] 09-03-PLAN.md -- Eyes reaction on PR open, autoApprove default to true (gap closure)
- [ ] 09-04-PLAN.md -- Conditional summary (only when issues found), always-collapse all bot comments (gap closure)

### Phase 10: Review Request Reliability

**Goal:** A manual `pull_request.review_requested` event for kodiai results in exactly one review execution with full delivery-to-execution traceability, so re-review behavior is predictable and supportable in production.
**Depends on:** Phase 9
**Requirements:** REL-01, REL-02, REL-03
**Success Criteria** (what must be TRUE):
  1. A single manual re-request for `kodiai` triggers exactly one review execution and one review submission batch (no duplicate fan-out)
  2. Every `review_requested` processing attempt is traceable by `delivery_id` across ingress, router, queue, handler, and completion logs
  3. Duplicate webhook deliveries and retry scenarios are idempotently handled without duplicate review output
  4. A production runbook exists for diagnosing `review_requested` failures with concrete command/query steps
**Plans:** 4 plans

Plans:
- [x] 10-01-PLAN.md -- Observability and gating hardening for review_requested event path (ingress/router/queue/handler correlation)
- [x] 10-02-PLAN.md -- Duplicate-review elimination, deployment validation, and production evidence capture on test PR
- [x] 10-03-PLAN.md -- Deterministic downstream idempotency keying and publication guard for review_requested output
- [x] 10-04-PLAN.md -- Regression coverage for duplicate/retry idempotency and gap-closure verification evidence
