# Requirements: Kodiai

**Defined:** 2026-02-07
**Core Value:** When a PR is opened or @kodiai is mentioned, the bot responds with accurate, actionable code feedback without requiring any workflow setup in the target repo.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Webhook Infrastructure

- [ ] **INFRA-01**: Webhook server receives GitHub POST events on `/webhooks/github`
- [ ] **INFRA-02**: Server verifies webhook signatures using HMAC-SHA256
- [ ] **INFRA-03**: GitHub App authenticates via JWT and mints installation access tokens
- [ ] **INFRA-04**: Events are processed asynchronously (acknowledge-then-process pattern)
- [ ] **INFRA-05**: Job queue enforces per-installation concurrency limits
- [ ] **INFRA-06**: Bot ignores its own comments and events from bot accounts
- [ ] **INFRA-07**: Event router classifies webhooks by type/action and dispatches to handlers
- [ ] **INFRA-08**: Health endpoint returns 200 for Azure probes

### PR Auto-Review

- [ ] **REVIEW-01**: Auto-review triggers on `pull_request.opened` and `ready_for_review`
- [ ] **REVIEW-02**: Review posts inline comments anchored to specific diff lines
- [ ] **REVIEW-03**: Review includes suggestion blocks that can be committed via GitHub UI
- [ ] **REVIEW-04**: Clean PRs receive silent approval (no comment posted)
- [ ] **REVIEW-05**: Review works on fork PRs natively

### Mention Handling

- [ ] **MENTION-01**: Bot responds to `@kodiai` mentions in issue comments
- [ ] **MENTION-02**: Bot responds to `@kodiai` mentions in PR comments
- [ ] **MENTION-03**: Bot responds to `@kodiai` mentions in PR review comments
- [ ] **MENTION-04**: Bot responds to `@kodiai` mentions in PR review bodies
- [ ] **MENTION-05**: Bot posts/updates a tracking comment showing progress
- [ ] **MENTION-06**: Content is sanitized before passing to LLM (invisible chars, HTML comments, tokens)
- [ ] **MENTION-07**: TOCTOU protections filter comments by timestamp to prevent tampering

### Execution

- [ ] **EXEC-01**: Jobs clone target repo to temp directory with shallow depth
- [ ] **EXEC-02**: Git auth configured with installation token for clone and push
- [ ] **EXEC-03**: MCP servers provide GitHub interaction tools (comments, inline reviews, CI status)
- [ ] **EXEC-04**: Claude Code CLI invoked via Agent SDK with prompt, MCP config, and working directory
- [ ] **EXEC-05**: Job workspace cleaned up after execution (temp dirs, processes)

### Operations

- [ ] **OPS-01**: Jobs that exceed timeout are killed with error comment posted
- [ ] **OPS-02**: Execution failures result in user-visible error comment (not silence)
- [ ] **OPS-03**: App defaults work with zero configuration (no .kodiai.yml required)
- [ ] **OPS-04**: Application packaged as Docker container
- [ ] **OPS-05**: Deployed to Azure Container Apps with secrets management

### UX Enhancements

- [ ] **UX-01**: PR summary comment (structured what/why/files)
- [ ] **UX-02**: Eyes emoji reaction on trigger comments
- [ ] **UX-03**: Collapse long responses in `<details>` tags

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Configuration

- **CONFIG-01**: Per-repo `.kodiai.yml` configuration (enable/disable review, path filters, skip authors)
- **CONFIG-02**: Custom review and mention prompts per repo

### Code Modification

- **MOD-01**: Code modification via @mention (branch creation, commit, push)
- **MOD-02**: File ops MCP server for creating/updating files via Git Data API


### Advanced

- **ADV-01**: CI status reading via actions MCP server
- **ADV-02**: Path-specific review instructions
- **ADV-03**: Direct SDK agent loop for non-Claude LLM providers

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-approve PRs | AI cannot take accountability for approvals; humans must click Approve |
| Multi-LLM provider selector | Over-engineering for small user group; Claude is the best agentic model |
| Full codebase indexing / RAG | Massive infra cost; clone + Claude Code file reading is sufficient |
| Sequence diagrams / architecture diagrams | Rarely useful, adds visual noise; available on-demand via @mention |
| PR description auto-editing | Overwrites author intent; summary as separate comment instead |
| Style / formatting enforcement | Linters do this better and faster; focus on bugs, security, logic |
| Cross-repo / multi-repo analysis | Different product category; stay single-repo |
| PR labeling / auto-categorization | Low value, easy to get wrong, teams have own conventions |
| Test generation | Inconsistent quality, teams have strong opinions; suggest missing tests instead |
| Ticket/issue alignment validation | Requires external integrations; high false-positive rate |
| Public GitHub Marketplace listing | Small group of known users; not public |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 2 | Pending |
| INFRA-06 | Phase 1 | Pending |
| INFRA-07 | Phase 1 | Pending |
| INFRA-08 | Phase 1 | Pending |
| REVIEW-01 | Phase 4 | Pending |
| REVIEW-02 | Phase 4 | Pending |
| REVIEW-03 | Phase 4 | Pending |
| REVIEW-04 | Phase 4 | Pending |
| REVIEW-05 | Phase 4 | Pending |
| MENTION-01 | Phase 5 | Pending |
| MENTION-02 | Phase 5 | Pending |
| MENTION-03 | Phase 5 | Pending |
| MENTION-04 | Phase 5 | Pending |
| MENTION-05 | Phase 5 | Pending |
| MENTION-06 | Phase 6 | Pending |
| MENTION-07 | Phase 6 | Pending |
| EXEC-01 | Phase 2 | Pending |
| EXEC-02 | Phase 2 | Pending |
| EXEC-03 | Phase 3 | Pending |
| EXEC-04 | Phase 3 | Pending |
| EXEC-05 | Phase 2 | Pending |
| OPS-01 | Phase 7 | Pending |
| OPS-02 | Phase 7 | Pending |
| OPS-03 | Phase 3 | Pending |
| OPS-04 | Phase 8 | Pending |
| OPS-05 | Phase 8 | Pending |
| UX-01 | Phase 9 | Pending |
| UX-02 | Phase 9 | Pending |
| UX-03 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-02-07*
*Last updated: 2026-02-07 after roadmap creation*
