# Feature Research

**Domain:** GitHub App AI code review bot
**Researched:** 2026-02-07
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **PR auto-review on open/ready** | Every competitor (CodeRabbit, Copilot, Qodo, Bugbot, Greptile) does this automatically. Users expect zero-config review on PR creation. | MEDIUM | Trigger on `pull_request.opened` and `pull_request.ready_for_review`. Must handle draft PR transitions correctly. Already planned in Phase 2. |
| **Inline review comments on changed lines** | All tools post comments anchored to specific diff lines, not just top-level PR comments. Line-level feedback is the core value proposition. | MEDIUM | Use GitHub's pull request review API to batch inline comments into a single review submission. Batching avoids notification spam. |
| **Code suggestion blocks** | GitHub Copilot, CodeRabbit, and Qodo all provide `suggestion` code blocks that users can accept with one click. This is the mechanism that makes AI review *actionable* rather than advisory. | LOW | Use GitHub's suggestion markdown syntax (triple-backtick with `suggestion` tag). Users commit suggestions directly from the GitHub UI. Already planned. |
| **PR summary / description** | CodeRabbit, Qodo (`/describe`), and Graphite all auto-generate PR summaries. Reviewers use these to quickly understand "what changed and why" before diving into code. | LOW | Post a top-level PR comment with a structured summary: what changed, why, files affected. Do NOT auto-edit the PR description body -- that overwrites author intent. |
| **Per-repo configuration** | CodeRabbit uses `.coderabbit.yaml`, Qodo uses TOML config, Bugbot uses `.cursor/BUGBOT.md`. Users expect to customize review behavior per repository. | LOW | `.kodiai.yml` in repo root. Already planned. Include: review enable/disable, path filters, skip authors, custom prompts, trigger phrase. |
| **@mention conversational interaction** | CodeRabbit, Greptile (`@greptileai`), Ellipsis (`@ellipsis-dev`), and Qodo (`/ask`) all support conversational interaction in PR comments. Users expect to ask follow-up questions and get contextual answers. | MEDIUM | Already planned in Phase 3. Handle `issue_comment`, `pull_request_review_comment`, `pull_request_review`, and `issues` events containing the trigger phrase. |
| **Webhook-based (no YAML in repo)** | GitHub App install model (CodeRabbit, Greptile, Bugbot) requires zero workflow files. This is the whole point of being a GitHub App vs a GitHub Action. | LOW | Already the core architectural decision. One-click install, webhook-driven. |
| **Bot self-reference prevention** | Every bot must ignore its own comments to prevent infinite loops. Standard engineering requirement. | LOW | Check `sender.type === 'Bot'` and/or match sender login against the app's own identity. Already planned in filters. |
| **Content sanitization** | Prevent prompt injection via PR descriptions, comments, or file contents that contain adversarial instructions. CodeRabbit and Qodo both deal with this. | MEDIUM | Strip invisible characters, HTML comments, token-like patterns. Port from claude-code-action's `sanitizer.ts`. Already planned. |
| **Timeout and resource limits** | Long-running reviews must not block the system. All production bots enforce timeouts. | LOW | Per-job timeout (e.g., 300s). Kill job gracefully, post error comment. Already planned in Phase 4. |
| **Error handling with user feedback** | When something fails (API error, timeout, LLM error), the user must see a comment explaining what happened -- not silence. | LOW | Post a clear error comment on failure. Already planned in Phase 4. |
| **Fork PR support** | Open-source projects receive many fork PRs. CodeRabbit and tools that run as GitHub Apps handle this natively because the App has its own identity and tokens. | LOW | GitHub Apps receive webhooks for fork PRs. Clone the fork repo with the installation token. Already a key motivator for Kodiai. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Code modification via @mention** | Ellipsis is the only major competitor that auto-commits fixes. Most tools (CodeRabbit, Greptile, Copilot) only *suggest* changes. The ability to say `@kodiai fix this` and have it create a branch, commit, and push is a strong differentiator. Users save the round-trip of applying fixes manually. | HIGH | Requires write access to repo, branch creation, commit, push. Already planned in Phase 3 via file-ops MCP server. This is the hardest feature and the highest-value one. |
| **Full agentic loop (Claude Code toolchain)** | Most competitors use single-shot LLM calls (Qodo explicitly states "each tool has a single LLM call"). Kodiai uses Claude Code's full agent loop with multi-turn tool use, file editing, and MCP servers. This enables deeper analysis and multi-step fixes that single-shot tools cannot do. | MEDIUM | Already the architecture via `@anthropic-ai/claude-agent-sdk`. The agent can read files, run commands, and iteratively refine -- not just comment on the diff. |
| **Silent approval for clean PRs** | CodeRabbit is widely criticized for being noisy -- inventing concerns when none exist. Kodiai's "if no issues, approve silently" approach directly addresses the #1 complaint about AI code review bots: noise. This is an explicit design choice, not a missing feature. | LOW | Prompt engineering: instruct the LLM to only comment when there are real issues. No comment = implicit approval. This reduces alert fatigue dramatically. |
| **Minimal noise / high signal** | Cursor Bugbot has differentiated itself specifically on "less noise, more signal" -- only flagging high-impact issues. CodeRabbit's review fatigue problem is well documented. Kodiai can win by being the bot developers do NOT mute. | LOW | Prompt design + configurable review intensity. Default to "only real problems" rather than style nitpicks. Let users opt into more verbose reviews via `.kodiai.yml`. |
| **Unified review + chat in one bot** | Some tools do review only (Bugbot, Greptile). Some do chat only. Having both auto-review AND @mention chat AND code modification in one installable app eliminates needing multiple bots. CodeRabbit is the closest competitor here. | MEDIUM | Already planned. The three modes (auto-review, mention-response, code-modification) share infrastructure but have different handlers. |
| **Custom review prompts per repo** | CodeRabbit supports path-based instructions and AST rules. Qodo has TOML config. Kodiai's `.kodiai.yml` with custom `review.prompt` and `mention.prompt` fields lets teams define exactly what the bot focuses on -- "check for SQL injection", "enforce our naming convention", etc. | LOW | Already planned. The YAML schema includes prompt customization. Could expand to path-specific prompts later. |
| **Eyes emoji reaction on trigger** | Small UX touch. When a user @mentions the bot, it immediately reacts with an eyes emoji to signal "I see your request." This provides instant feedback before the actual response (which may take 30-60s). Most competitors do not do this. | LOW | Already planned. Use GitHub Reactions API. Adds ~1 API call but dramatically improves perceived responsiveness. |
| **TOCTOU protection** | Prevent time-of-check-to-time-of-use attacks where malicious users edit comments between when the bot reads them and when it acts. This is a security feature most competitors do not advertise. | MEDIUM | Timestamp-based comment filtering. Port from claude-code-action. Important for any bot that takes code-modification actions based on user comments. |
| **Collapse long responses** | Wrap verbose bot responses in `<details>` tags so they don't dominate the PR conversation. Keeps the timeline clean while preserving full information for those who want it. | LOW | Already planned in settings. `collapse_responses: true`. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Auto-approve PRs** | "If the bot finds no issues, just approve it." | AI cannot take accountability for approvals. GitHub Copilot explicitly only leaves "Comment" reviews, never "Approve" or "Request Changes." Auto-approval bypasses the human review gate that catches business logic, architectural, and intentional security issues the AI cannot understand. | Silent approval (no comment = implicitly fine). Humans still click the Approve button. The bot reduces review burden, not replaces reviewers. |
| **Multi-LLM provider selector** | "Let users pick GPT-4, Claude, Gemini per repo." | Over-engineering for a small user group. Creates testing/maintenance burden across providers. Each provider has different capabilities, token limits, and failure modes. The Graphite article explicitly warns against "dropdown of LLMs" as a product trap. | Ship with Claude (via Agent SDK) as the single provider. It is the best agentic coding model. Add a second provider only if a specific user need arises, not speculatively. |
| **Full codebase indexing / RAG** | "Index the entire repo so the bot understands everything." | Massive infrastructure cost (vector DB, embedding pipeline, incremental updates). Greptile does this but requires SOC2-level infra. For a small-user tool, the ROI does not justify the complexity. The diff + file context from the clone is sufficient for PR review. | Clone the repo (already planned). Claude Code can read any file during the agent loop. This gives full codebase access without the overhead of maintaining an index. |
| **Sequence diagrams / architecture diagrams** | "Auto-generate Mermaid diagrams for every PR." | CodeRabbit and Greptile generate these but users report they are rarely useful and add visual noise. Diagrams for a 3-file PR are unnecessary overhead. | Do not generate diagrams by default. If a user wants one, they can ask via @mention: `@kodiai draw a sequence diagram of this change`. On-demand, not automatic. |
| **PR description auto-editing** | "Rewrite the PR description with an AI summary." | Overwrites the author's original description and intent. Authors write descriptions for context that AI summaries lose. CodeRabbit posts a separate summary comment instead of editing the description. | Post a summary as a separate comment. Never modify the PR description body. |
| **Style / formatting enforcement** | "Flag missing semicolons, wrong indentation, unused imports." | This is what linters do, better and faster. AI code review that flags style issues is the #1 source of noise and the #1 reason developers mute bots. Qodo and Bugbot explicitly focus on "bugs, not style." | Delegate style enforcement to existing linters (ESLint, Prettier, Ruff). Kodiai should focus on bugs, security, logic errors, and performance -- things linters cannot catch. |
| **Cross-repo / multi-repo analysis** | "Understand how changes in repo A affect repo B." | Requires indexing multiple repos, understanding their relationships, and maintaining dependency graphs. Qodo does this for enterprise ($30/user/month+). Massive scope for a small-user tool. | Stay single-repo. The clone gives full context for one repo. If users need cross-repo analysis, that is a different product category entirely. |
| **PR labeling / auto-categorization** | "Auto-label PRs as bug/feature/refactor." | Low value, easy to get wrong, and teams have their own labeling conventions. Getting a wrong label is worse than no label. | Do not auto-label. If users want categorization, include it in the summary comment as text, not as applied labels. |
| **Test generation** | "Auto-generate unit tests for changed code." | Test quality from AI is inconsistent. Generated tests often test implementation details rather than behavior, creating brittle test suites. Teams have strong opinions about test patterns. | Do not auto-generate tests. The bot can *suggest* that tests are missing ("this function has no test coverage for the error path") but should not write them unsolicited. Users can ask via @mention if they want test scaffolding. |
| **Ticket/issue alignment validation** | "Check if the PR actually solves the linked Jira/Linear ticket." | Requires integration with external issue trackers, understanding ticket descriptions, and making subjective judgments about whether code "solves" a problem. High false-positive rate. | Do not integrate with external issue trackers. Stay focused on code quality. If users link issues in PR descriptions, the bot can see that context naturally. |

## Feature Dependencies

```
[Webhook Server + Event Router]
    |
    +--requires--> [GitHub App Auth]
    |                  |
    |                  +--requires--> [Installation Token Minting]
    |
    +--requires--> [Config Loader (.kodiai.yml)]
    |
    +--enables--> [PR Auto-Review]
    |                 |
    |                 +--requires--> [Job Queue]
    |                 +--requires--> [Repo Cloning / Workspace]
    |                 +--requires--> [Claude CLI Executor]
    |                 +--requires--> [Context Builder (PR data fetching)]
    |                 +--requires--> [Inline Comment MCP Server]
    |                 +--requires--> [Progress Comment MCP Server]
    |
    +--enables--> [@mention Handler]
    |                 |
    |                 +--requires--> [All PR Auto-Review dependencies]
    |                 +--requires--> [Content Sanitizer]
    |                 +--requires--> [TOCTOU Protection]
    |                 +--enhances--> [Eyes Emoji Reaction]
    |
    +--enables--> [Code Modification via @mention]
                      |
                      +--requires--> [@mention Handler]
                      +--requires--> [File Ops MCP Server]
                      +--requires--> [Branch Creation]
                      +--requires--> [Git Push via Installation Token]

[Silent Approval] --enhances--> [PR Auto-Review]
[Collapse Responses] --enhances--> [@mention Handler]
[Custom Prompts] --enhances--> [PR Auto-Review, @mention Handler]
[Timeout Enforcement] --enhances--> [Job Queue]
[Error Handling] --enhances--> [All Handlers]
```

### Dependency Notes

- **PR Auto-Review requires Job Queue:** Reviews are async (30-120s). Must not block the webhook response. Queue ensures per-installation concurrency limits.
- **@mention Handler requires all PR Auto-Review deps:** The mention handler uses the same infrastructure (clone, context building, Claude execution) but with different prompt/context construction.
- **Code Modification requires @mention Handler:** Code changes are triggered by mentions (`@kodiai fix this`). The mention handler detects the request, and the file-ops MCP server + branch creation enable the actual modification.
- **TOCTOU Protection enhances Code Modification:** Without TOCTOU checks, a malicious user could edit their comment between when the bot reads it and when it acts. Critical for any bot that commits code based on user instructions.
- **Content Sanitizer is critical for @mention:** User-authored comments are direct LLM input. Sanitization prevents prompt injection attacks that could make the bot execute unintended actions.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what is needed to validate the concept and replace the current GitHub Action workflow.

- [x] **Webhook server + GitHub App auth** -- Foundation. Without this, nothing works.
- [x] **PR auto-review with inline comments + suggestion blocks** -- The core value proposition. This is why users install the app.
- [x] **Per-repo .kodiai.yml configuration** -- Users need to customize review behavior (enable/disable, custom prompts, path filters).
- [x] **Silent approval for clean PRs** -- Anti-noise strategy. The default should be "no comment if no problems."
- [x] **Fork PR support** -- Key motivator for building Kodiai. Must work from day one.
- [x] **Bot self-reference prevention** -- Safety. Infinite loops would make the product unusable.
- [x] **Timeout enforcement** -- Safety. Runaway jobs must be killed.
- [x] **Error handling with user feedback** -- UX. Silence on failure is the worst user experience.

### Add After Validation (v1.x)

Features to add once core review is working and validated with real users.

- [ ] **@mention conversational interaction** -- Add when auto-review is stable. Users will naturally want to ask follow-up questions about review comments.
- [ ] **Eyes emoji reaction** -- Add alongside @mention. Small UX improvement for perceived responsiveness.
- [ ] **Content sanitization (full)** -- Harden before enabling @mention on repos with external contributors.
- [ ] **TOCTOU protection** -- Add before enabling code modification features.
- [ ] **Collapse long responses** -- Add when users report that bot responses are too long in the PR timeline.
- [ ] **Custom review prompts** -- Add when users request repo-specific review focus areas.

### Future Consideration (v2+)

Features to defer until the product is proven and user needs are clear.

- [ ] **Code modification via @mention** -- Highest complexity, highest risk. Defer until mention handling is stable and trusted. Requires careful security review (the bot is committing code).
- [ ] **Direct SDK agent loop (non-Claude providers)** -- Only build if a specific user needs a non-Claude provider. Do not build speculatively.
- [ ] **Path-specific review instructions** -- Add if users have repos with very different review needs per directory (e.g., `src/` vs `tests/` vs `docs/`).
- [ ] **CI status reading** -- Add if users want the bot to incorporate CI failure context into its review. Low priority for small user group.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| PR auto-review (inline + suggestions) | HIGH | MEDIUM | P1 |
| Per-repo .kodiai.yml config | HIGH | LOW | P1 |
| Silent approval for clean PRs | HIGH | LOW | P1 |
| Fork PR support | HIGH | LOW | P1 |
| Webhook server + App auth | HIGH (prerequisite) | MEDIUM | P1 |
| Bot self-reference prevention | HIGH (safety) | LOW | P1 |
| Timeout enforcement | HIGH (safety) | LOW | P1 |
| Error handling with feedback | HIGH | LOW | P1 |
| @mention conversational chat | HIGH | MEDIUM | P2 |
| Eyes emoji reaction | MEDIUM | LOW | P2 |
| Content sanitization (full) | HIGH (security) | MEDIUM | P2 |
| TOCTOU protection | MEDIUM (security) | MEDIUM | P2 |
| Collapse long responses | MEDIUM | LOW | P2 |
| Custom review prompts per repo | MEDIUM | LOW | P2 |
| Code modification via @mention | HIGH | HIGH | P3 |
| Path-specific review instructions | LOW | LOW | P3 |
| CI status reading | LOW | MEDIUM | P3 |
| Direct SDK agent loop | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | CodeRabbit | Qodo/PR-Agent | Copilot Review | Bugbot | Ellipsis | Kodiai (Our Approach) |
|---------|------------|---------------|----------------|--------|----------|----------------------|
| Auto-review on PR open | Yes | Yes | Yes (org-wide) | Yes | Yes | Yes |
| Inline comments | Yes | Yes | Yes | Yes | Yes | Yes |
| Suggestion blocks | Yes | Yes (`/improve`) | Yes (one-click apply) | Yes | Yes | Yes |
| PR summary | Yes (walkthrough) | Yes (`/describe`) | Yes | No | Yes | Yes (as comment, not description edit) |
| @mention chat | Yes (in PR comments) | Yes (`/ask`) | Limited | No | Yes (`@ellipsis-dev`) | Yes (`@kodiai`) |
| Auto-commit fixes | No | No | Via Copilot Agent | Via Cursor IDE | Yes (from reviewer comments) | Yes (via @mention, Phase 3) |
| Per-repo config | `.coderabbit.yaml` | TOML config | No (org-level) | `.cursor/BUGBOT.md` | Not documented | `.kodiai.yml` |
| Custom review prompts | Yes (path + AST rules) | Yes | Yes (custom instructions) | Yes (BUGBOT.md rules) | Not documented | Yes (prompt field in YAML) |
| Fork PR support | Yes (App model) | Yes | Yes (GitHub-native) | Yes (App model) | Yes (App model) | Yes (App model) |
| Noise level | High (known issue) | Medium | Medium | Low (by design) | Medium | Low (by design -- silent approval) |
| Sequence diagrams | Yes | No | No | No | No | No (anti-feature -- on-demand only) |
| Multi-repo analysis | No | Yes (enterprise) | No | No | No | No (anti-feature -- single repo) |
| Linter integration | 50+ linters built in | Some | No | No | No | No (delegate to existing linters) |
| Pricing model | $24-30/user/mo | $30/user/mo (Teams) | Included in Copilot | Included in Cursor | Custom | Self-hosted (target audience is small known group) |
| Self-hostable | Enterprise only ($15k/mo) | Yes (open-source PR-Agent) | No | No | No | Yes (by design -- Azure Container Apps) |

### Key Competitive Insights

1. **CodeRabbit is the feature leader** but is criticized for noise. Kodiai competes on signal quality, not feature quantity.
2. **Qodo/PR-Agent is the open-source alternative** with self-hosting. Kodiai's Claude Code agent loop is more capable than Qodo's single-LLM-call design.
3. **Copilot Review is integrated but limited.** It only does Comment reviews (never Approve/Request Changes) and has no @mention chat.
4. **Bugbot is the noise-reducer** but is IDE-only (Cursor). Kodiai brings the low-noise philosophy to a GitHub App.
5. **Ellipsis is the auto-fix pioneer** but is not widely adopted. Kodiai's code modification via @mention is a similar capability built on a stronger agent foundation (Claude Code toolchain vs single-shot LLM).
6. **No competitor combines auto-review + @mention chat + code modification in a self-hosted GitHub App.** This is Kodiai's unique positioning.

## Sources

- [CodeRabbit Documentation](https://docs.coderabbit.ai/) -- Feature details, configuration options (HIGH confidence)
- [CodeRabbit Configuration Reference](https://docs.coderabbit.ai/reference/configuration) -- YAML schema, path instructions, AST rules (HIGH confidence)
- [CodeRabbit Review Instructions Guide](https://docs.coderabbit.ai/guides/review-instructions) -- Custom review instructions (HIGH confidence)
- [Qodo Merge Review Tool Docs](https://qodo-merge-docs.qodo.ai/tools/review/) -- /review features and config (HIGH confidence)
- [Qodo PR-Agent GitHub](https://github.com/qodo-ai/pr-agent) -- Open-source PR agent features (HIGH confidence)
- [GitHub Copilot Code Review Docs](https://docs.github.com/en/copilot/concepts/agents/code-review) -- Copilot review capabilities and limitations (HIGH confidence)
- [Cursor Bugbot Docs](https://docs.cursor.com/bugbot) -- Bugbot features, BUGBOT.md rules (HIGH confidence)
- [8 Best AI Code Review Tools 2026 - Qodo Blog](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/) -- Competitor comparison (MEDIUM confidence)
- [State of AI Code Review Tools 2025 - DevTools Academy](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) -- Tool comparison, strengths/weaknesses (MEDIUM confidence)
- [6 Best AI Code Review Tools for PRs 2025 - DEV Community](https://dev.to/heraldofsolace/the-6-best-ai-code-review-tools-for-pull-requests-in-2025-4n43) -- Feature comparison across tools (MEDIUM confidence)
- [Problems with AI Code Review - Graphite](https://graphite.com/blog/problems-with-ai-code-review) -- Anti-patterns, noise problems, philosophical issues (MEDIUM confidence)
- [3 Best CodeRabbit Alternatives 2026 - Cubic](https://www.cubic.dev/blog/the-3-best-coderabbit-alternatives-for-ai-code-review-in-2025) -- Competitor analysis (MEDIUM confidence)
- [9 Best GitHub AI Code Review Tools 2026 - CodeAnt](https://www.codeant.ai/blogs/best-github-ai-code-review-tools-2025) -- Broad tool survey (MEDIUM confidence)

---
*Feature research for: GitHub App AI code review bot*
*Researched: 2026-02-07*
