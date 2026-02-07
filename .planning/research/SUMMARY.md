# Project Research Summary

**Project:** Kodiai - GitHub App AI Code Review Bot
**Domain:** Webhook-driven GitHub App with AI agent backend (Claude Code CLI)
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

Kodiai is a GitHub App that provides AI-powered code review via webhook-driven automation. Unlike GitHub Actions, it operates as a standalone webhook server receiving events from GitHub, processing them asynchronously, and responding via GitHub API calls. The architecture uses Claude Code CLI (via `@anthropic-ai/claude-agent-sdk`) as the agentic backend, with custom MCP servers providing GitHub integration capabilities.

The recommended approach is a webhook-to-queue-to-worker architecture built on Bun + Hono + Octokit + Claude Agent SDK. The core insight from architecture research is that this MUST be async-first: webhooks have a 10-second response timeout, but AI reviews take 30-300 seconds. The Acknowledge-Then-Process pattern is mandatory. Stack research confirms all pre-selected technologies (Bun, Hono, TypeScript, Claude Agent SDK) are the correct choices with battle-tested integrations. Feature research reveals the competitive landscape is dominated by tools that create noise (CodeRabbit) or lack agentic depth (single-shot LLM calls). Kodiai's differentiators are the full Claude Code agent loop and a "silent approval" anti-noise strategy.

The primary risks are webhook timeout failures (causes duplicate processing), bot self-triggering loops (infinite cost burn), prompt injection (security), and process leaks (resource exhaustion). All four have documented prevention strategies from the reference implementation and require architectural enforcement from Phase 1. The research provides high confidence that with proper implementation of the Acknowledge-Then-Process pattern, per-installation job queues, ephemeral workspaces, and robust content sanitization, these risks are manageable.

## Key Findings

### Recommended Stack

The pre-selected stack (Bun + Hono + TypeScript + Claude Agent SDK) is optimal for this domain. All components have verified compatible versions and battle-tested integration patterns from the reference implementation (`tmp/claude-code-action/`).

**Core technologies:**
- **Bun 1.3.7**: JavaScript runtime — Pre-selected constraint, fastest JS runtime, native TypeScript, built-in test runner, works natively with Hono
- **Hono 4.11.8**: HTTP framework — Pre-selected constraint, built on Web Standards, works natively with Bun (no adapter), ultrafast, tiny bundle
- **@anthropic-ai/claude-agent-sdk 0.2.37**: AI agent execution — Pre-selected constraint, the core execution engine with `query()` function streaming `SDKMessage` events, supports MCP servers
- **@octokit/auth-app 8.1.2**: GitHub App authentication — Handles JWT generation, installation token minting with automatic caching (up to 15K tokens), auto-refresh on expiry
- **@octokit/rest 22.0.1 + @octokit/graphql 9.0.3**: GitHub API clients — Typed REST + GraphQL clients for efficient PR data fetching
- **@modelcontextprotocol/sdk 1.26.0**: MCP server implementation — For the 4 MCP servers (comment, inline-comment, actions, file-ops) running as stdio child processes
- **p-queue 8.1.0**: In-process job queue — Concurrency-limited async queue for job processing, per-installation rate limiting
- **Zod 3.24.4**: Schema validation — Validate `.kodiai.yml` config, webhook payloads; stay on 3.x (Zod 4.x breaks Claude Agent SDK compatibility)

**Critical version constraints:**
- Must use Zod 3.x (not 4.x) because Claude Agent SDK's `tool()` function uses Zod 3 `ZodRawShape`
- Must use `@octokit/webhooks-methods` (lightweight sig verify) instead of full `@octokit/webhooks` package (duplicates Hono routing)
- p-queue is pure ESM (no Redis needed for MVP, migrate to external queue only when scaling beyond single instance)

**Infrastructure:**
- Docker base: `oven/bun:1-alpine` (~130MB)
- Deployment: Azure Container Apps (pre-selected constraint, scale-to-zero capable)
- Logging: Structured JSON to stdout (Azure ingests directly, no Pino needed for MVP)

### Expected Features

Feature research reveals that users expect zero-config operation (table stakes) but the market is frustrated with noise (60-80% of AI review comments are low-value). Kodiai's competitive advantage is the full agentic loop combined with anti-noise prompt engineering.

**Must have (table stakes):**
- **PR auto-review on open/ready** — Every competitor does this; users expect zero-config review on PR creation
- **Inline review comments on changed lines** — Line-level feedback with GitHub's suggestion blocks (one-click apply)
- **Per-repo configuration** — `.kodiai.yml` in repo root (CodeRabbit uses `.coderabbit.yaml`, Qodo uses TOML)
- **@mention conversational interaction** — CodeRabbit, Greptile, Ellipsis all support this; users expect it
- **Webhook-based (no YAML in repo)** — One-click install, no workflow files (the whole point of being a GitHub App vs Action)
- **Bot self-reference prevention** — Standard engineering requirement to prevent infinite loops
- **Fork PR support** — Key motivator for building Kodiai (GitHub Apps handle fork PRs natively)
- **Error handling with user feedback** — Silence on failure is unacceptable UX

**Should have (competitive differentiators):**
- **Silent approval for clean PRs** — CodeRabbit is widely criticized for noise; "no comment = implicitly fine" addresses this directly
- **Full agentic loop (Claude Code toolchain)** — Most competitors use single-shot LLM calls; Kodiai's multi-turn tool use enables deeper analysis
- **Code modification via @mention** — Ellipsis is the only major competitor that auto-commits fixes; saying `@kodiai fix this` and having it create a branch, commit, push is high-value but high-complexity
- **Minimal noise / high signal** — Bugbot differentiated on this; Kodiai can win by being the bot developers do NOT mute
- **Eyes emoji reaction on trigger** — Small UX touch; instant feedback before actual response (30-60s)
- **TOCTOU protection** — Security feature most competitors don't advertise; prevents time-of-check-to-time-of-use attacks

**Defer (v2+):**
- **Multi-LLM provider selector** — Over-engineering; ship with Claude only, add second provider only if specific user need arises
- **Full codebase indexing / RAG** — Massive infrastructure cost (vector DB, embedding pipeline); repo clone gives full access without overhead
- **Sequence diagrams / architecture diagrams** — CodeRabbit generates these but users report they're rarely useful; make on-demand via @mention, not automatic
- **Test generation** — AI-generated test quality is inconsistent; bot can suggest tests are missing but shouldn't write them unsolicited

**Anti-features (explicitly avoid):**
- **Auto-approve PRs** — AI cannot take accountability; humans must click Approve
- **PR description auto-editing** — Overwrites author intent
- **Style / formatting enforcement** — This is what linters do; AI flagging style issues is the #1 noise source
- **PR labeling / auto-categorization** — Low value, easy to get wrong

### Architecture Approach

Standard webhook-driven GitHub App architecture with Acknowledge-Then-Process pattern. The webhook handler responds 200 within milliseconds, then processes asynchronously via a per-installation job queue. Each job gets an ephemeral workspace (fresh git clone in temp directory), fetches PR context via GraphQL, generates MCP config, and invokes Claude Code CLI.

**Major components:**
1. **Ingress Layer** (Webhook Endpoint, Signature Verify, Health Check, Event Router, Delivery Dedup) — Trust boundary, responds to GitHub within 10s
2. **Orchestration Layer** (Event Filters, Config Loader, GitHub Auth, Handler Dispatch, Job Queue) — Per-installation concurrency control, config merging
3. **Execution Layer** (Workspace Manager, Context Builder, MCP Config Generator, Claude Code CLI Executor, 4 MCP Servers) — Heavyweight AI review execution
4. **Cleanup** (Update tracking comment, remove temp dir, log result) — Resource reclamation

**Key architectural patterns:**
- **Acknowledge-Then-Process**: Return 200 immediately, process async (mandatory for webhook timeout compliance)
- **Per-Installation Job Queue**: Each installation gets its own p-queue concurrency slot (prevents one noisy repo from starving others)
- **Ephemeral Workspace Per Job**: Each job gets a fresh git clone in temp dir, fully isolated, destroyed after completion (~2-5s clone overhead acceptable)
- **MCP Servers as Stdio Child Processes**: 4 servers (comment, inline-comment, CI status, file-ops) run as child processes, communicate via JSON-RPC on stdin/stdout
- **TOCTOU-Safe Context Fetching**: Use webhook payload timestamp to filter comments, preventing attacker-edited content

**Data flow for PR auto-review:**
```
GitHub webhook -> Signature verify -> Dedup -> Event router -> Filters ->
Config loader -> Auth -> ReviewHandler -> Job queue (when slot available) ->
Workspace clone -> Context builder (GraphQL fetch + sanitize) ->
MCP config generation -> Claude CLI executor -> Cleanup
```

**Scaling considerations:**
- 1-10 installations: Single container, in-process p-queue, in-memory dedup (MVP)
- 10-100 installations: Still single container, monitor queue depth
- 100-1K installations: External queue (Azure Service Bus or BullMQ), persistent dedup (Redis)
- First bottleneck: Claude CLI cold start (~12s overhead per invocation)
- Second bottleneck: Concurrent workspace clones (concurrency: 4 means 4 concurrent clones)
- Third bottleneck: GitHub API rate limits (5,000 req/hr per installation token)

### Critical Pitfalls

Research identified 7 critical pitfalls from GitHub official docs, Claude Code issue tracker, and reference implementation battle scars.

1. **Webhook Response Timeout Causing Duplicate Deliveries** — GitHub terminates connections after 10s; AI reviews take minutes; timeout causes retries and duplicate processing. **Prevention:** Acknowledge-Then-Process pattern (respond 200 immediately, queue async). **Phase 1 (Foundation).**

2. **Bot Self-Triggering Infinite Loops** — Bot's own comments trigger webhooks; without filtering, creates infinite loop burning credits. **Prevention:** Multi-layer checks (sender.type === "Bot", sender.id comparison, per-PR cooldown). **Phase 1 (Foundation).**

3. **Prompt Injection via Malicious PR Content** — Attacker embeds instructions in PR body/comments to override system prompt. **Prevention:** Port full sanitizer (`sanitizer.ts`) to strip HTML comments, invisible unicode, markdown injection; TOCTOU protections; path validation; tool restrictions. **Phase 2 (PR Auto-Review) for initial sanitization; Phase 3 (Mention) for TOCTOU.**

4. **Claude Code Process Leaks Exhausting Container Resources** — Claude CLI spawns child processes that become orphaned on crash/timeout, consuming memory (~200MB each); temp files (`/tmp/claude-*-cwd`) never cleaned up; cache in `~/.claude/` grows to gigabytes. **Prevention:** Process group isolation with `kill -TERM -pgid`, temp directory isolation per job, periodic cache cleanup, hard timeout enforcement, container restart policy. **Phase 2 (basic cleanup); Phase 4 (robust process group management).**

5. **Installation Token Expiration Mid-Job** — Tokens expire after 1 hour; long jobs (10+ min) start with valid token but it expires before completion, causing GitHub API failures mid-review. **Prevention:** Token freshness check before job start, Octokit auto-refresh wrapper, short-circuit for old webhooks, graceful mid-job retry on 401. **Phase 2 (basic token management); Phase 4 (automatic refresh).**

6. **Webhook Signature Verification Done Wrong** — Common mistakes: using `===` instead of `crypto.timingSafeEqual` (timing attack), computing HMAC on parsed body instead of raw bytes (signature mismatch), proxy modifying body. **Prevention:** Raw body access via `c.req.raw.clone().arrayBuffer()`, timing-safe comparison, SHA-256 only, test with real webhooks. **Phase 1 (Foundation).**

7. **Noisy Reviews Causing Developer Fatigue** — Bot floods PRs with low-value comments (style, naming, obvious observations); developers mute all feedback including genuine bugs; trust lost. **Prevention:** Review prompt engineering ("only report actual bugs, security, logic errors; if no issues, approve silently"), comment budget (max 10 per review), configurable strictness in `.kodiai.yml`, track signal-to-noise ratio. **Phase 2 (PR Auto-Review) — prompt engineering is core.**

**Additional UX pitfalls:**
- Silent failures (job crashes with no GitHub comment) — Always post error comment
- "Thinking..." comment that never updates — Use single tracking comment with status updates
- Auto-reviewing every PR including bots (Dependabot, Renovate) — Skip known bot authors
- Reviewing draft PRs — Only auto-review on `opened` (non-draft) and `ready_for_review`

## Implications for Roadmap

Based on combined research, the roadmap should follow the dependency chain discovered in architecture analysis. The critical insight is that Phase 1 MUST establish the trust boundary and async processing pattern before ANY feature work begins, because webhook timeout compliance and bot loop prevention are existential requirements.

### Phase 1: Foundation (Webhook Server + Authentication)
**Rationale:** Establishes the trust boundary (webhook signature verification, GitHub App auth) and the Acknowledge-Then-Process pattern. Without this, everything fails (webhook timeouts cause duplicate processing, bot loops burn credits). This is pure infrastructure with no user-facing features, but it's the architectural skeleton that everything else hangs on.

**Delivers:**
- Webhook server (Hono) with signature verification (HMAC-SHA256, timing-safe comparison)
- GitHub App authentication (JWT generation, installation token minting via `@octokit/auth-app`)
- Health check endpoint (Azure Container Apps liveness probe)
- Event router (dispatch based on `X-GitHub-Event` header + action field)
- Event filters (bot self-reference prevention, mention detection, permission checks)
- Delivery deduplication (in-memory Set with TTL for `X-GitHub-Delivery` header)

**Addresses features:** Webhook-based (no YAML), bot self-reference prevention, fork PR support (infrastructure)

**Avoids pitfalls:**
- Pitfall 1 (webhook timeout) via Acknowledge-Then-Process
- Pitfall 2 (bot loops) via event filters
- Pitfall 6 (signature verification) via correct HMAC implementation

**Research needs:** Standard patterns, well-documented. Skip `/gsd:research-phase`.

---

### Phase 2: PR Auto-Review (Core Value Proposition)
**Rationale:** Delivers the core user value (AI code review on PR open). This is the most complex phase because it requires ALL infrastructure: job queue, workspace management, context building, Claude Code execution, and MCP servers. But it's the highest payoff — this is why users install the app. Dependencies force this to come after Phase 1 (needs auth and webhook routing).

**Delivers:**
- Config loader (fetch + parse `.kodiai.yml` from repo default branch, Zod validation, merge with defaults)
- Job queue (`p-queue` with per-installation concurrency limits)
- Workspace manager (ephemeral git clone in temp dir, cleanup in `finally` block)
- GitHub service (Octokit wrapper with retry logic, shared REST + GraphQL clients)
- Context builder (GraphQL queries for PR data, content sanitization, prompt formatting)
- MCP servers: comment-server (tracking comments), inline-comment-server (suggestion blocks), actions-server (CI status)
- Claude Code CLI executor (`query()` invocation, message streaming, result handling)
- Job worker (wires workspace + context + executor together)
- ReviewHandler (orchestrates PR auto-review flow end-to-end)

**Addresses features:**
- PR auto-review on open/ready (table stakes)
- Inline review comments + suggestion blocks (table stakes)
- Per-repo .kodiai.yml config (table stakes)
- Silent approval for clean PRs (differentiator)
- Minimal noise / high signal (differentiator)

**Avoids pitfalls:**
- Pitfall 3 (prompt injection) via content sanitizer
- Pitfall 4 (process leaks) via ephemeral workspace + basic cleanup
- Pitfall 5 (token expiration) via basic token management
- Pitfall 7 (noisy reviews) via prompt engineering

**Uses stack:**
- `@anthropic-ai/claude-agent-sdk` for `query()`
- `@modelcontextprotocol/sdk` for MCP servers
- `@octokit/rest` + `@octokit/graphql` for PR data fetching
- `p-queue` for job queue
- `zod` for config validation

**Implements architecture components:** Entire Orchestration Layer + Execution Layer

**Research needs:** Most patterns are standard, but prompt engineering for noise reduction may need iteration during implementation. Consider `/gsd:research-phase` focused specifically on "anti-noise prompt strategies" if initial attempts produce too many low-value comments.

---

### Phase 3: Mention Handler (Conversational Interaction + Code Modification)
**Rationale:** Reuses almost all infrastructure from Phase 2 but adds conversation context, TOCTOU protections, and code modification support. This is the second highest-value feature (users naturally want to ask follow-up questions about reviews). Code modification (`@kodiai fix this`) is the most complex feature and the highest-risk (bot is committing code), so it comes last.

**Delivers:**
- MentionHandler (orchestrates @mention response flow)
- Eyes emoji reaction (immediate feedback on trigger comment)
- Extended context builder (conversation history, TOCTOU timestamp filtering)
- Full content sanitization hardening (before enabling on repos with external contributors)
- File-ops MCP server (branch creation, commit, push via Git Data API for signed commits)

**Addresses features:**
- @mention conversational interaction (table stakes)
- Eyes emoji reaction (differentiator)
- Code modification via @mention (differentiator — highest complexity, highest value)
- TOCTOU protection (differentiator)

**Avoids pitfalls:**
- Pitfall 3 (prompt injection) via TOCTOU timestamp filtering
- Ensures only pre-trigger content is processed

**Research needs:** TOCTOU patterns are well-documented in reference implementation. Code modification via Git Data API is standard. Skip `/gsd:research-phase`.

---

### Phase 4: Polish (Hardening + Monitoring)
**Rationale:** Makes the system production-ready. Adds robustness, monitoring, and operational tools. No new user-facing features, but essential for reliability at scale.

**Delivers:**
- Robust process group management (kill entire process group on timeout, not just parent PID)
- Periodic cache cleanup (Claude Code's `~/.claude/` directories)
- Structured logging / monitoring (Azure Application Insights integration)
- Rate limiting per user/repo (prevent abuse via @mention spam)
- Timeout enforcement hardening (watchdog timer, SIGKILL handling)
- Webhook deduplication persistence (if scaling to external queue)
- Error handling improvements (clear error messages, unique error IDs)
- Collapse long responses (wrap in `<details>` tags via config)
- Custom review prompts (per-repo prompt customization in `.kodiai.yml`)

**Addresses features:**
- Timeout enforcement (table stakes)
- Error handling with user feedback (table stakes)
- Collapse long responses (differentiator)
- Custom review prompts per repo (differentiator)

**Avoids pitfalls:**
- Pitfall 4 (process leaks) via robust process group cleanup
- Pitfall 5 (token expiration) via automatic refresh

**Research needs:** Standard operational patterns. Skip `/gsd:research-phase`.

---

### Phase Ordering Rationale

**Why this order:**
1. **Phase 1 first** because webhook timeout compliance and bot loop prevention are existential — without these, the system doesn't work at all (duplicate processing, infinite loops).
2. **Phase 2 second** because it delivers the core value proposition (PR auto-review). This is the most complex phase, but it has the highest payoff. All infrastructure (queue, workspace, executor, MCP) is built here because review needs it all.
3. **Phase 3 third** because it reuses Phase 2 infrastructure but adds conversational features. Code modification is deferred to Phase 3 because it's high-risk (bot is committing code) and should only be enabled after mention handling is stable and trusted.
4. **Phase 4 last** because it's hardening that makes the system production-ready but doesn't add new features. Error handling, monitoring, and resource management are important but can be layered on after core features work.

**How this avoids pitfalls:**
- Phases 1-2 address all 7 critical pitfalls at their foundation (webhook timeout, bot loops, signature verification, prompt injection, process leaks, token expiration, noisy reviews)
- Phase 3 hardens security (TOCTOU) before enabling code modification
- Phase 4 adds operational robustness (monitoring, rate limiting, graceful degradation)

**Dependency chain validated by architecture research:**
```
Phase 1 (auth + webhook) -> Phase 2 (all infrastructure + review) ->
Phase 3 (mention + code mod, reuses Phase 2) -> Phase 4 (hardening)
```

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2** (if noise persists): Anti-noise prompt engineering may need iteration. If initial reviews produce too many low-value comments, run `/gsd:research-phase` focused on "prompt strategies for high signal-to-noise ratio in AI code review."
- **Phase 3** (if code modification is complex): Git Data API for signed commits has edge cases. If branch creation/push fails during implementation, research GitHub's tree/blob/commit creation patterns.

**Phases with standard patterns (skip research-phase):**
- **Phase 1**: Webhook signature verification, GitHub App auth, event routing are well-documented standard patterns
- **Phase 3**: TOCTOU protections are documented in reference implementation (`fetcher.ts`)
- **Phase 4**: Operational patterns (logging, monitoring, rate limiting) are standard

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry and official docs (2026-02-07). Reference implementation validates Bun + Hono + Claude Agent SDK + Octokit integration. Critical constraint: Zod 3.x (not 4.x) due to Agent SDK compatibility. |
| Features | HIGH | Competitor analysis across 6 major tools (CodeRabbit, Qodo, Copilot, Bugbot, Ellipsis, Greptile). Table stakes identified from market expectations. Differentiators (silent approval, agentic loop) address documented pain points (noise). Anti-features explicitly called out to prevent over-engineering. |
| Architecture | HIGH | Standard webhook-driven GitHub App architecture. Acknowledge-Then-Process pattern is mandatory (GitHub official docs). Per-installation job queue, ephemeral workspaces, MCP stdio servers all battle-tested in reference implementation. Scaling path clear (in-process p-queue -> external queue at 100+ installations). |
| Pitfalls | HIGH | All 7 critical pitfalls verified against GitHub official docs, Claude Code issue tracker (#13126, #8856, #8865), and reference implementation. Prevention strategies documented with code examples. Pitfall-to-phase mapping ensures each is addressed at the right time. |

**Overall confidence:** HIGH

All four research files sourced from high-confidence materials: official documentation (GitHub, Claude, npm), verified issue trackers, and working reference code. The pre-selected stack (Bun, Hono, TypeScript, Claude Agent SDK) is optimal and proven. The competitive landscape is well-understood. The architecture follows standard patterns with clear anti-patterns documented. The pitfalls are real but preventable.

### Gaps to Address

**Gaps discovered during research:**

1. **Claude Code CLI cold start performance** — Each `query()` call has ~12s overhead (verified via GitHub issue #34). For MVP with low volume, this is acceptable. If it becomes a bottleneck, investigate when upstream SDK releases optimizations or session reuse. **Handle during Phase 2 implementation:** Monitor job duration, log cold start overhead separately from AI execution time.

2. **Large PR handling** — Research didn't specify exact thresholds for "too large" (file count, diff size). CodeRabbit and competitors don't document their limits. **Handle during Phase 2 implementation:** Start with a conservative threshold (e.g., skip auto-review if PR changes >200 files or diff >500KB). Make configurable in `.kodiai.yml`. Validate against real monorepo PRs.

3. **Fork PR security boundary** — Feature research identifies that fork PRs should run in read-only mode (no file-ops MCP server), but architecture research doesn't detail the permission check mechanism. **Handle during Phase 2 implementation:** Check if `pull_request.head.repo.full_name !== pull_request.base.repo.full_name` to detect fork PRs. Conditionally exclude file-ops from MCP config.

4. **Prompt engineering for noise reduction** — High confidence that anti-noise prompts are critical, but the exact prompt wording needs validation. **Handle during Phase 2 implementation:** Start with reference implementation's prompt, add explicit "silent approval" instruction, test on 5-10 real PRs, iterate based on comment signal-to-noise ratio.

5. **Azure Container Apps deployment specifics** — Stack research notes this is a pre-selected constraint but marks confidence as MEDIUM because "Bun + Alpine + Claude Code CLI combination needs validation in actual build." **Handle during Phase 1 implementation:** Test Docker build locally first. Claude CLI installer (`curl -fsSL https://claude.ai/install.sh | bash`) may assume debian packages; if it fails on Alpine, use debian-slim base image instead.

## Sources

### Primary (HIGH confidence)
- **GitHub Official Documentation:** Webhook best practices, signature verification, App authentication, rate limits, GraphQL API (official docs verified 2026-02-07)
- **Claude Agent SDK Official Documentation:** TypeScript reference, quickstart, MCP integration (platform.claude.com/docs verified 2026-02-07)
- **npm Registry:** All package versions verified (Bun 1.3.7, Hono 4.11.8, @anthropic-ai/claude-agent-sdk 0.2.37, @octokit/* packages, etc.)
- **Reference Implementation:** `tmp/claude-code-action/` — Battle-tested patterns for MCP servers, prompt construction, context fetching, sanitization, and Claude SDK invocation (direct code review)
- **Claude Code Issue Tracker:** GitHub issues #13126 (OOM from subprocesses), #8856 (temp file cleanup), #8865 (background task cleanup) — Primary sources for process leak pitfall

### Secondary (MEDIUM confidence)
- **Competitor Analysis Articles:** Qodo blog (Best AI Code Review Tools 2026), DevTools Academy (State of AI Code Review 2025), DEV Community (tool comparisons) — Factual feature comparisons, corroborated across multiple sources
- **CodeRabbit, Qodo, Bugbot, Ellipsis Official Docs:** Feature details, configuration options — Vendor docs but factual about capabilities
- **Security Research:** Orca Security (pull_request_nightmare), GitHub Security Lab (preventing pwn requests), Google Cloud Build TOCTOU writeup — Verified security research, applicable patterns
- **Community Analysis:** DEV Community articles on AI review noise (80% noise claim) — Anecdotal but corroborated by multiple independent sources

### Tertiary (LOW confidence)
- None — All research sources are HIGH or MEDIUM confidence. No findings requiring validation.

---
*Research completed: 2026-02-07*
*Ready for roadmap: yes*
