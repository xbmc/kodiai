# Pitfalls Research

**Domain:** GitHub App AI-powered code review bot (webhook-driven, Claude Code CLI backend)
**Researched:** 2026-02-07
**Confidence:** HIGH (verified against GitHub official docs, Claude Code issue tracker, community reports)

## Critical Pitfalls

### Pitfall 1: Webhook Response Timeout Causing Duplicate Deliveries

**What goes wrong:**
GitHub terminates webhook connections after 10 seconds without a 2XX response. The bot processes the webhook inline (clone repo, run Claude, post review), which takes minutes. GitHub marks the delivery as failed and retries, triggering duplicate reviews, duplicate comments, or concurrent conflicting operations on the same PR.

**Why it happens:**
Developers treat the webhook handler like an HTTP API endpoint and do all the work before responding. The 10-second limit is much shorter than people expect. Claude Code runs can take 1-5 minutes.

**How to avoid:**
Acknowledge the webhook immediately (return 200/202), then enqueue the job for async processing. The webhook handler should do three things only: (1) verify signature, (2) basic payload validation, (3) enqueue job. All actual work happens in background workers via p-queue.

```
POST /webhooks/github  -->  verify sig  -->  enqueue job  -->  return 202
                                                |
                                          background worker
                                          clone, review, cleanup
```

**Warning signs:**
- GitHub webhook delivery logs show "timed out" errors
- Duplicate bot comments appearing on PRs
- GitHub webhook settings page shows high failure rate

**Phase to address:** Phase 1 (Foundation) -- this is architectural and must be correct from day one.

---

### Pitfall 2: Bot Self-Triggering Infinite Loops

**What goes wrong:**
The bot posts a comment on a PR. GitHub fires an `issue_comment.created` webhook for that comment. The bot processes the webhook, sees it as a new event, and responds again. This creates an infinite loop that burns API quota, Claude credits, and may get the GitHub App rate-limited or banned.

**Why it happens:**
The bot's own comments trigger `issue_comment` webhooks. If the bot doesn't robustly filter its own activity, every bot comment triggers another bot comment. Edge cases make this worse: the bot's identity differs between comment author (app) and webhook sender (app[bot]), and different event types have different payload structures for identifying the actor.

**How to avoid:**
Implement multi-layer self-trigger prevention:
1. **Sender check**: Compare `payload.sender.type` -- reject if `"Bot"` (unless explicitly allowed).
2. **App identity check**: Compare `payload.sender.id` against the GitHub App's bot user ID (fetchable via `GET /app`). Hardcode this after initial setup.
3. **Comment author check**: For `issue_comment` events, check if `payload.comment.user.login` ends with `[bot]` and matches the app name.
4. **Rate guard**: Even with all checks, add a per-PR cooldown (e.g., no more than 1 job per PR per 30 seconds) as a safety net.

The reference code in `tmp/claude-code-action/src/github/validation/actor.ts` has the pattern -- it calls `octokit.users.getByUsername` to verify actor type. Port this but also add the sender.id fast-path check since making an API call for every webhook adds latency.

**Warning signs:**
- Bot posting multiple identical or sequential comments on the same PR
- Rapidly increasing API usage or Claude credit consumption
- GitHub showing dozens of webhook deliveries in quick succession for the same repo

**Phase to address:** Phase 1 (Foundation) -- must be in the event filters before any handler runs.

---

### Pitfall 3: Prompt Injection via Malicious PR Content

**What goes wrong:**
An attacker opens a PR (especially from a fork) containing crafted content in the PR body, commit messages, code comments, or file contents designed to override the bot's system prompt. The AI follows the injected instructions instead of the review prompt, potentially: leaking the system prompt, posting misleading reviews ("LGTM, no issues found" on malicious code), exfiltrating repository secrets via MCP tool calls, or creating files/commits with malicious content.

**Why it happens:**
The bot feeds PR content (body, comments, diff) directly into the LLM prompt. LLMs cannot reliably distinguish between "instructions from the system" and "data from the user." Attackers can embed instructions in HTML comments (invisible in rendered markdown but present in raw text), invisible Unicode characters, or code comments that look innocuous.

**How to avoid:**
1. **Content sanitization**: Port the full sanitizer from `tmp/claude-code-action/src/github/utils/sanitizer.ts` -- it strips HTML comments, invisible characters, markdown image alt text (injection vector), hidden HTML attributes, and GitHub tokens. This is a battle-tested defense.
2. **TOCTOU protections**: Port the timestamp-based comment filtering from `fetcher.ts` -- only include comments/body text that existed BEFORE the trigger event. This prevents an attacker from editing content after an authorized user triggers the bot.
3. **Path validation**: Port `path-validation.ts` for MCP file ops -- prevents path traversal attacks via `../` or symlinks.
4. **Tool restrictions**: Limit which MCP tools the AI can call. The review handler should not have write permissions to the repo unless explicitly requested.
5. **Fork PR paranoia**: Treat fork PR content as higher risk. Consider requiring maintainer approval before running on fork PRs, or limiting fork PRs to read-only review mode (no code modifications).

**Warning signs:**
- Bot producing reviews that seem "too positive" or off-topic for the actual code changes
- Bot comments containing content that looks like it came from the PR body rather than the review prompt
- Unusual MCP tool call patterns in logs (file writes during what should be a read-only review)

**Phase to address:** Phase 2 (PR Auto-Review) for initial sanitization; Phase 3 (Mention Handler) for TOCTOU; Phase 4 (Polish) for hardening.

---

### Pitfall 4: Claude Code Process Leaks Exhausting Container Resources

**What goes wrong:**
Claude Code CLI spawns child processes (subagents, bash commands, MCP servers). If the parent process crashes, times out, or is killed, child processes become orphaned (PPID=1) and continue consuming memory (~200MB each) and CPU. Additionally, Claude Code creates `/tmp/claude-*-cwd` files (~14.5/hour) that never get cleaned up, and accumulated cache in `~/.claude/` can grow to gigabytes, eventually triggering the OOM killer.

In a containerized server handling multiple concurrent jobs, this is catastrophic: orphaned processes pile up across jobs, temp files fill the disk, and the container eventually runs out of memory and crashes -- killing ALL in-progress jobs, not just the problematic one.

**Why it happens:**
- Claude Code has documented bugs around orphaned subprocess cleanup (GitHub issues #13126, #8856, #8865).
- The server runs indefinitely (unlike GitHub Actions where each run gets a fresh runner), so leaked resources accumulate.
- Shell snapshot cache in `~/.claude/shell-snapshots/` can hit 1.5GB+ during heavy use.
- `/tmp/claude-*-cwd` tracking files are created but never deleted by Claude Code.

**How to avoid:**
1. **Process group isolation**: Run each Claude Code invocation in its own process group (`setsid` or `detached: true` with custom group). On timeout/cleanup, kill the entire process group (`kill -TERM -pgid`), not just the parent PID.
2. **Temp directory isolation**: Create a unique temp directory per job (`/tmp/kodiai-{job-id}/`). Set `TMPDIR` env var for the Claude Code process. On cleanup, recursively delete the entire directory.
3. **Periodic cache cleanup**: After each job completes, clean up Claude Code's cache directories: `~/.claude/shell-snapshots/`, `~/.claude/projects/`, accumulated history files.
4. **Resource monitoring**: Track per-job memory usage. If a job exceeds a threshold (e.g., 2GB RSS), kill it proactively.
5. **Hard timeout enforcement**: Implement timeout at two levels: (a) per-job timeout via `AbortController`/signal, (b) watchdog timer that force-kills any job exceeding max duration.
6. **Container restart policy**: Configure Azure Container Apps to restart the container if it becomes unhealthy (memory > 90%, for example).

**Warning signs:**
- Container memory usage trending upward over time (without proportional job increase)
- `ps aux` showing orphaned node/claude processes with PPID=1
- `/tmp` filling up with `claude-*` files
- OOM killer messages in container logs
- Jobs failing with "out of memory" errors after the container has been running for days

**Phase to address:** Phase 2 (PR Auto-Review) -- basic cleanup; Phase 4 (Polish) -- robust process group management, monitoring, and resource limits.

---

### Pitfall 5: Installation Token Expiration Mid-Job

**What goes wrong:**
GitHub App installation access tokens expire after exactly 1 hour. A Claude Code review job that takes 10+ minutes may start with a valid token but the token expires before the job finishes. This causes GitHub API calls made by MCP servers to fail mid-review, resulting in partial reviews (some inline comments posted, others failing silently), inability to post the final summary comment, and git push failures if the bot was making code changes.

**Why it happens:**
Tokens are minted once at job start and passed to Claude Code via environment variables. Claude Code and MCP servers use these tokens for the entire job duration. No refresh mechanism exists because installation tokens cannot be refreshed -- you must mint a new one.

**How to avoid:**
1. **Token freshness check**: Before starting a job, check if the token will expire within the expected job duration (e.g., if job timeout is 5 minutes, ensure token has at least 10 minutes of validity).
2. **Token refresh wrapper**: Rather than passing raw tokens, have MCP servers request tokens through a callback/service that mints new installation tokens as needed. The Octokit `@octokit/auth-app` library handles this automatically when configured correctly -- it regenerates tokens when they expire.
3. **Short-circuit for old webhooks**: If a webhook arrived more than 50 minutes ago (token is already mostly expired), skip processing and log a warning rather than starting a job that will fail halfway through.
4. **Graceful mid-job failure**: If a GitHub API call fails with a 401 during a job, attempt to mint a new token and retry the operation before giving up. Post an error comment to the PR explaining what happened.

**Warning signs:**
- Sporadic 401 errors in job logs, especially for longer-running jobs
- Partial reviews: some inline comments appear but no summary
- Jobs that succeed for small PRs but fail for large ones (longer processing time)

**Phase to address:** Phase 2 (PR Auto-Review) for basic token management; Phase 4 (Polish) for automatic refresh.

---

### Pitfall 6: Webhook Signature Verification Done Wrong

**What goes wrong:**
The webhook signature verification has subtle implementation bugs that either (a) make the bot reject legitimate webhooks or (b) fail to protect against spoofed webhooks. Common mistakes: comparing signature strings with `===` instead of `crypto.timingSafeEqual` (timing attack vulnerability), computing HMAC on a parsed/re-serialized body instead of the raw bytes (signature mismatch), or the proxy/load balancer modifying the request body before it reaches the app.

**Why it happens:**
HMAC verification requires the exact bytes that GitHub signed. JSON parsing and re-serialization changes whitespace, key ordering, or encoding. Timing-safe comparison requires buffer-level comparison, not string equality. Many tutorials and Stack Overflow answers show the insecure `===` pattern.

**How to avoid:**
1. **Raw body access**: In Hono, use `c.req.raw.clone().arrayBuffer()` or equivalent to get the exact bytes GitHub sent. Do NOT use `c.req.json()` first -- that parses the body and you lose the original bytes.
2. **Timing-safe comparison**: Use `crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))` for the final comparison. Never use `===`.
3. **SHA-256 only**: Use the `X-Hub-Signature-256` header (HMAC-SHA256). The `X-Hub-Signature` header uses SHA-1 and exists only for legacy compatibility.
4. **Test with real webhooks**: Use GitHub's webhook delivery tab to redeliver real webhooks during testing. Don't rely only on hand-crafted test payloads.

**Warning signs:**
- All webhooks being rejected (usually a raw body issue)
- Webhooks working in local dev but failing in production (proxy/load balancer issue)
- Security audit finding timing-attack vulnerability

**Phase to address:** Phase 1 (Foundation) -- must be correct and secure from day one.

---

### Pitfall 7: Noisy Reviews Causing Developer Fatigue and Bot Disablement

**What goes wrong:**
The bot floods PRs with low-value comments: style nitpicks, variable naming suggestions, obvious observations ("this function returns a boolean"), and restating what the code already clearly does. Developers start ignoring ALL bot feedback -- including genuine bug catches and security warnings. Eventually, developers uninstall the app or add blanket ignore rules that disable it entirely.

Research shows 60-80% of AI code review comments are noise. When developers spend 20+ minutes per PR filtering noise, critical issues get buried in cosmetic suggestions.

**Why it happens:**
The default prompt tells the AI to "review this PR" without clear constraints on what constitutes a useful comment. LLMs are verbose by default and will find something to say about every function. Without explicit instruction to be silent when code is acceptable, the AI feels compelled to comment.

**How to avoid:**
1. **Review prompt engineering**: The default review prompt must explicitly instruct:
   - Only report actual bugs, security issues, logic errors, and performance problems
   - Do NOT comment on style, naming, or formatting
   - If no issues found, approve silently (no comment at all)
   - Use a severity threshold: only report issues the reviewer would flag as "must fix before merge"
2. **Comment budget**: Consider limiting the number of inline comments per review (e.g., max 10). Force the AI to prioritize.
3. **Configurable strictness**: The `.kodiai.yml` should let repo owners tune the review focus (e.g., `focus: [bugs, security]` vs `focus: [bugs, security, performance, patterns]`).
4. **Track signal-to-noise ratio**: Log whether bot comments lead to code changes (suggestion accepted) vs being dismissed/ignored. This data informs prompt tuning.

**Warning signs:**
- Developers consistently dismissing or ignoring bot comments
- PRs with 20+ bot comments on a 50-line change
- Users asking how to disable the bot or reduce its verbosity
- Bot commenting on formatting in repos that have linters

**Phase to address:** Phase 2 (PR Auto-Review) -- prompt engineering is the core of this feature.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-process p-queue instead of external queue (Redis/SQS) | Zero infrastructure, simple implementation | No persistence across restarts, lost jobs on crash, no multi-instance scaling | Acceptable for small user group; must migrate before marketplace launch |
| Cloning full repo instead of sparse checkout | Simpler git commands, Claude Code can read any file | Large repos (monorepos) consume excessive disk and clone time; 10GB repos will timeout | Acceptable for most repos; add `--depth=1 --filter=blob:none` for initial clone, fetch needed files lazily |
| Single container instance | No load balancing complexity, no shared state concerns | Single point of failure, one stuck job blocks the queue, limited concurrent capacity | Acceptable for small user group; Azure Container Apps can scale horizontally later |
| Hardcoded Claude Code as only LLM backend | Ship faster, one code path to maintain | Locked to Anthropic pricing/availability, can't offer alternatives when Claude is down | Acceptable for MVP; plan the executor abstraction from Phase 1 so Phase 2+ can add backends |
| Storing no persistent state (stateless webhook processing) | No database to manage, simpler deployment | Cannot deduplicate webhooks across restarts, cannot track job history, cannot implement usage quotas | Never acceptable without at least in-memory dedup; add Redis or SQLite before scaling |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub App JWT Auth | Storing PEM private key in env var without preserving newlines; key gets corrupted | Store as base64-encoded string in env var, decode at startup: `Buffer.from(process.env.PRIVATE_KEY, 'base64').toString('utf8')`. Or use Azure Key Vault which preserves multiline secrets. |
| GitHub GraphQL API | Making many sequential queries to fetch PR data (comments, reviews, diff, CI) | Use a single consolidated GraphQL query that fetches all needed data in one request. The reference code in `fetcher.ts` does this. GraphQL was designed for exactly this use case. |
| GitHub REST API - Review Comments | Using `position` parameter (line number in diff) which breaks if the diff changes between fetch and comment creation | Always use `line` + `side` parameters (absolute line numbers) instead of `position`. Include `commit_id` set to the HEAD commit SHA fetched at job start. |
| GitHub REST API - Content Creation | Rapid-fire posting of inline comments individually, hitting the secondary rate limit (80 content-creating requests/minute) | Batch inline comments into a single review submission using `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with the `comments` array. One API call instead of N. |
| Claude Code CLI / Agent SDK | Assuming `query()` always succeeds and returns cleanly | The SDK can throw, hang, or return partial results. Wrap in try/catch with timeout. Handle the streaming interface's error events. Always run cleanup (temp dir deletion) in a `finally` block. |
| Octokit Installation Auth | Creating a new Octokit instance per API call with fresh JWT generation | Use `@octokit/auth-app` with `createAppAuth` once, then use `getInstallationOctokit(installationId)`. The library caches and auto-refreshes tokens. |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Cloning repos synchronously in the webhook handler thread | Request timeouts, webhook delivery failures | Clone in background worker; respond to webhook immediately | Immediately (10s webhook timeout) |
| No concurrency limit on jobs | Container OOM, all jobs fail simultaneously, disk fills up | p-queue with `concurrency: 2-3` depending on container RAM (each Claude Code job uses ~500MB-1GB) | At 3-5 concurrent jobs on a 4GB container |
| Fetching entire PR diff for huge PRs (1000+ files) | GraphQL timeout, token exhaustion, prompt too large for context window | Limit diff to changed files matching review patterns; truncate diffs over a size threshold (e.g., 100KB); skip auto-review for PRs over a file count threshold | At ~200+ changed files or ~500KB diff |
| Not deduplicating webhook deliveries | Duplicate reviews posted, wasted Claude credits | Store `X-GitHub-Delivery` header in a Set or Redis; skip if already seen | When GitHub retries due to prior timeout |
| Single-threaded Bun process handling webhooks + jobs | Webhook responses delayed while jobs run, GitHub marks deliveries as failed | Bun is single-threaded for JS but handles I/O concurrently; ensure Claude Code runs as a subprocess (not blocking the event loop) and use async patterns for all I/O | At ~10 concurrent webhook deliveries during active job processing |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Running Claude Code with write permissions on fork PRs from untrusted contributors | Attacker's PR code runs with access to repo secrets (installation token), can exfiltrate data or push malicious commits | Fork PRs should run in read-only mode: no MCP file-ops server, no git push capability. Only allow inline review comments. |
| Passing the installation token as a plain env var to Claude Code subprocess | Token appears in process listings, child process crash dumps, and potentially in Claude Code's debug logs | Use the minimum-privilege token. Consider a token-vending proxy that MCP servers call rather than storing the token in the process environment. |
| Not sanitizing PR content before feeding to LLM | Prompt injection via HTML comments, invisible unicode, markdown alt-text, or code comments can override review instructions | Port the full sanitization pipeline from `sanitizer.ts`: strip HTML comments, invisible chars, image alt text, link titles, hidden attributes, normalize HTML entities, redact GitHub tokens |
| Trusting the webhook payload's user data without verification | An attacker could replay/modify webhooks if signature verification is weak, escalating privilege | Always verify webhook signature. After verification, re-fetch user permissions from GitHub API to confirm write access, rather than trusting payload claims. |
| Storing cloned repos with embedded installation tokens in git remote URLs | Token persists in `.git/config` after job completes; if cleanup fails, token is exposed on disk | Remove the token from the remote URL immediately after clone, or use credential helpers that provide tokens on-demand rather than embedding in URLs. Clean up clone dirs in a `finally` block. |
| Not rate-limiting @kodiai mention triggers per user | A single user (or compromised account) can trigger unlimited Claude Code runs, draining credits and compute | Implement per-user, per-repo rate limits on trigger processing (e.g., max 10 mentions per user per hour per repo). Return a polite rate-limit message as a GitHub comment. |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent failures -- job crashes with no GitHub comment | Developer waits indefinitely for a review that will never come; files a bug report | Always post an error comment on failure: "Kodiai encountered an error processing this PR. The team has been notified." Include a unique error ID for debugging. |
| Posting a "thinking..." comment that never updates | Creates noise in the PR timeline; developer can't tell if bot is working or stuck | Use a single tracking comment with status updates (via MCP comment server). Update it from "Processing..." to "Review complete" or "Error occurred." Collapse the tracking detail in a `<details>` tag. |
| Long reviews posted as a single massive comment | Developers skip the entire review because it's too long to parse | Use inline review comments positioned on the relevant code lines, not a single summary comment. Group related comments into a single review submission so they appear together. |
| Auto-reviewing every PR including bots (Dependabot, Renovate) | Wastes credits and creates noise on automated PRs that don't need code review | Default config should skip PRs from known bot authors (dependabot, renovate, github-actions). Make this configurable via `skip_authors` in `.kodiai.yml`. |
| Reviewing draft PRs | Developers create draft PRs for work-in-progress; reviewing them wastes credits and generates premature feedback | Only auto-review on `opened` (non-draft) and `ready_for_review` actions. Explicitly skip `pull_request.opened` when `pull_request.draft === true`. |
| No way to tell the bot "stop" or "skip this PR" | Developer stuck receiving unwanted reviews; only option is to uninstall the app | Support `@kodiai skip` or `@kodiai ignore` commands on a PR. Also support a `kodiai:skip` label that prevents auto-review. |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Webhook handler:** Often missing raw body preservation for HMAC verification -- verify that Hono middleware doesn't consume the body before signature check
- [ ] **Bot filtering:** Often missing the case where the bot's own review submission triggers a `pull_request_review.submitted` webhook -- verify self-review events are filtered
- [ ] **Fork PR support:** Often missing the case where fork PRs have different `head.repo` than `base.repo` -- verify clone URL uses the fork repo, not the base repo
- [ ] **Config loading:** Often missing graceful handling of invalid YAML (syntax errors, wrong types) -- verify that malformed `.kodiai.yml` falls back to defaults with a warning, not a crash
- [ ] **Cleanup on timeout:** Often missing the case where the process is killed by timeout but the `finally` block doesn't run (SIGKILL vs SIGTERM) -- verify a watchdog process handles force-kill cleanup
- [ ] **Large PR handling:** Often missing diff size limits -- verify the bot doesn't try to feed a 2MB diff into the LLM context window, causing a token limit error or massive cost
- [ ] **Inline comment positioning:** Often missing validation that the line number is within the diff range -- verify comments targeting lines not in the diff are converted to PR-level comments instead of silently failing
- [ ] **Concurrent job handling:** Often missing the case where two `@kodiai` mentions arrive within seconds for the same PR -- verify jobs are serialized per-PR to prevent conflicting operations
- [ ] **Installation token in clone URL:** Often missing cleanup of the token from `.git/config` after clone -- verify the token doesn't persist on disk after the job completes

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Infinite loop (bot self-triggering) | LOW | Kill the process; add sender.id check to filters; redeploy. Delete duplicate bot comments manually or via script. |
| Prompt injection causing bad review | LOW | Delete the misleading review comment. Harden sanitization. No lasting damage unless code changes were made. |
| Container OOM from leaked processes | MEDIUM | Restart container (auto-recovery via Azure). Add process group cleanup. Investigate which job leaked. Implement resource monitoring. |
| Token exposed in clone URL on disk | HIGH | Immediately revoke the installation token via GitHub API. Rotate the GitHub App private key if the token could have been exfiltrated. Audit for unauthorized API calls. |
| Duplicate reviews from webhook retry | LOW | Delete duplicate review comments. Add `X-GitHub-Delivery` deduplication. No lasting damage. |
| Noisy reviews causing developer distrust | HIGH | Difficult to recover trust once lost. Requires prompt re-engineering, user communication, and possibly an opt-back-in campaign. Prevent this from the start. |
| Disk full from accumulated clone directories | MEDIUM | Restart container to reclaim /tmp. Add cleanup in `finally` blocks. Add periodic cleanup cron. Monitor disk usage with alerts. |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Webhook response timeout | Phase 1 (Foundation) | Confirm webhook handler returns 202 within 100ms; GitHub delivery logs show 100% success rate |
| Bot self-triggering loops | Phase 1 (Foundation) | Test: bot posts comment -> no new webhook processing for that comment; verify with real GitHub App |
| Webhook signature verification | Phase 1 (Foundation) | Test with valid and invalid signatures; test with tampered payloads; verify timing-safe comparison |
| Installation token management | Phase 2 (PR Auto-Review) | Test job that takes >5 minutes; verify token refresh works; test with deliberately expired token |
| Content sanitization / prompt injection | Phase 2 (PR Auto-Review) | Test with HTML comments containing instructions; test with invisible unicode; test with markdown injection |
| Process leak / resource cleanup | Phase 2 (PR Auto-Review) | Monitor container memory across 10+ sequential jobs; verify no orphaned processes; verify /tmp is clean |
| Noisy review prevention | Phase 2 (PR Auto-Review) | Test on 5+ real PRs; verify comment count is reasonable (1-5 per PR); verify clean PRs get silent approval |
| TOCTOU protections | Phase 3 (Mention Handler) | Test: trigger mention, then edit PR body before job starts; verify old body is used, not new one |
| Fork PR security | Phase 2 (PR Auto-Review) | Test fork PR review in read-only mode; verify no write tools available; verify correct clone URL |
| Rate limiting per user/repo | Phase 4 (Polish) | Trigger 20 mentions in 1 minute from same user; verify rate limit message after threshold |
| Webhook deduplication | Phase 4 (Polish) | Redeliver a webhook via GitHub UI; verify no duplicate processing |
| Draft PR filtering | Phase 2 (PR Auto-Review) | Open draft PR; verify no auto-review triggers; mark ready; verify review triggers |

## Sources

- [GitHub Docs: Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) -- HIGH confidence (official docs)
- [GitHub Docs: Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app) -- HIGH confidence (official docs)
- [GitHub Docs: Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) -- HIGH confidence (official docs)
- [GitHub Docs: Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) -- HIGH confidence (official docs)
- [GitHub Docs: Rate limits for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps) -- HIGH confidence (official docs)
- [GitHub Docs: Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation) -- HIGH confidence (official docs)
- [Claude Code issue #13126: OOM killer due to subprocess issue](https://github.com/anthropics/claude-code/issues/13126) -- HIGH confidence (primary source)
- [Claude Code issue #8856: Missing cleanup for /tmp/claude-*-cwd files](https://github.com/anthropics/claude-code/issues/8856) -- HIGH confidence (primary source)
- [Claude Code issue #8865: Background tasks not properly killed](https://github.com/anthropics/claude-code/issues/8865) -- HIGH confidence (primary source)
- [Claude Code process forking bug writeup](https://shivankaul.com/blog/claude-code-process-exhaustion) -- MEDIUM confidence (third-party analysis, verified by issue tracker)
- [DEV Community: Why 80% of AI Code Reviews Are Just Noise](https://dev.to/synthaicode_commander/why-80-of-ai-code-reviews-are-just-noise-4i0o) -- MEDIUM confidence (community analysis, corroborated by multiple sources)
- [DEV Community: Drowning in AI Code Review Noise](https://dev.to/jet_xu/drowning-in-ai-code-review-noise-a-framework-to-measure-signal-vs-noise-304e) -- MEDIUM confidence (community analysis)
- [Qodo: Best AI Code Review Tools 2026](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/) -- MEDIUM confidence (vendor analysis but factual)
- [Orca Security: pull_request_nightmare - GitHub Actions exploit](https://orca.security/resources/blog/pull-request-nightmare-github-actions-rce/) -- HIGH confidence (security research)
- [GitHub Security Lab: Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) -- HIGH confidence (GitHub official security team)
- [arxiv: Demystifying Prompt Injection Attacks on AI Coding Editors](https://arxiv.org/html/2509.22040v1) -- MEDIUM confidence (academic research)
- [Google Cloud Build TOCTOU vulnerability writeup](https://adnanthekhan.com/posts/cloud-build-toctou/) -- HIGH confidence (verified security research, similar architecture)
- Reference codebase: `tmp/claude-code-action/` -- HIGH confidence (working production code, direct inspection)

---
*Pitfalls research for: GitHub App AI-powered code review bot (Kodiai)*
*Researched: 2026-02-07*
