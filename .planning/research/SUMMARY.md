# Project Research Summary

**Project:** Kodiai v0.21 Issue Triage Foundation
**Domain:** GitHub issue triage automation integrated into existing GitHub App
**Researched:** 2026-02-26
**Confidence:** HIGH

## Executive Summary

Kodiai v0.21 adds intelligent issue triage to an existing, production GitHub App. The feature is narrowly scoped: when a maintainer mentions `@kodiai` on an issue, the bot validates the issue body against the repo's issue template, comments with specific guidance on missing fields, and applies a configurable label. The entire implementation reuses existing infrastructure -- no new dependencies are required. The existing Octokit client, Agent SDK MCP tool pattern, pgvector schema conventions, and config-gating approach cover every capability needed. The primary build artifacts are six new files (migration, issue store, two MCP servers, template parser, prompt builder) and three small modifications to existing files.

The recommended approach is a three-phase build order derived from dependency constraints. Phase 1 (schema and store) and Phase 2 (MCP tools) are independent and can execute in parallel; Phase 3 (triage agent wiring) depends on both. This ordering is non-negotiable: the agent needs both its output mechanism (MCP tools) and its input data (template parser) before it can be wired to the mention handler. The issue corpus schema must also be correct before the agent is built, because adding metadata columns later requires backfilling from the GitHub API at rate-limited cost.

The critical risks are operational, not architectural. Five pitfalls can cause real damage: label 404 errors when applying non-existent labels, triage firing on PR comments due to GitHub's conflation of issue and PR comment events, template parser built for YAML forms failing against xbmc/xbmc's markdown templates, infinite comment loops from bot-self-triggering, and issue corpus schema missing the metadata columns the agent needs. All five are preventable with targeted defenses established in the correct phase. The overall risk profile is LOW given that the foundational patterns (corpus stores, MCP servers, config-gated handlers) are battle-tested in the existing codebase.

## Key Findings

### Recommended Stack

No new dependencies are required for v0.21. Every capability maps to an already-installed package: `@octokit/rest` for label and comment API calls, `@anthropic-ai/claude-agent-sdk` for MCP tool definition, `zod` for tool input validation, `js-yaml` for issue template frontmatter parsing, `postgres` + pgvector for the issue corpus. The existing `voyage-code-3` model (1024-dim) is reused for issue embeddings -- switching would require re-embedding all existing corpora. See [STACK.md](.planning/research/STACK.md) for full version compatibility table.

**Core technologies:**
- `@octokit/rest ^22.0.1`: Issue label and comment APIs -- `issues.addLabels()`, `issues.createComment()` verified against existing auth pattern
- `@anthropic-ai/claude-agent-sdk 0.2.37`: MCP tool creation via `createSdkMcpServer()` + `tool()` -- 5 existing servers use identical pattern
- `postgres ^3.4.8` + pgvector: Issue corpus schema with HNSW (cosine, m=16) + tsvector indexes -- direct parallel to review_comments table
- `zod ^4.3.6`: MCP tool input schemas and config section validation -- already used throughout
- `js-yaml ^4.1.1`: Issue template YAML frontmatter parsing -- already used in `loadRepoConfig()`

### Expected Features

The feature set is well-defined by the milestone issue (#73) and competitor analysis. The competitive advantage over existing tools (actions/stale, fancy-triage-bot, issue-ops/validator, VS Code's ML triage) is Kodiai's knowledge platform: cross-corpus retrieval and contributor profiles are unavailable to any Actions-based competitor. See [FEATURES.md](.planning/research/FEATURES.md) for full competitor analysis.

**Must have (table stakes) -- v0.21:**
- Template field validation -- primary stated maintainer pain point; xbmc uses markdown templates
- Label application via `github_issue_label` MCP tool -- visible output without which triage is just a commenter
- Guidance comment via `github_issue_comment` MCP tool -- specific missing-field checklist, not generic feedback
- Config gating (`triage: enabled: false` default) -- safety requirement, must exist before any logic fires
- `@kodiai` mention trigger on issues -- consistent with existing UX; reuses proven mention infrastructure
- Bot self-loop prevention -- must extend existing BotFilter coverage to issue surface

**Should have (competitive differentiators) -- v0.21.x or v0.22:**
- Semantic duplicate detection -- pgvector already capable; needs corpus populated first
- Area/component classification -- LLM-based inline vs VS Code's monthly ML retraining cycle
- Knowledge-informed triage comments -- cross-corpus retrieval for affected component identification
- Contributor-aware tone -- first-timer vs core contributor adaptation via existing profile store

**Defer (v0.23+):**
- Issue corpus as 5th retrieval source for PR reviews -- needs backfill pipeline
- Issue-to-PR linking -- detect when PR addresses open issue
- Batch triage of backlog -- scheduled rather than mention-triggered
- Auto-triage on `issues.opened` -- must prove mention-based value first; noise risk is high

### Architecture Approach

The triage feature integrates at four well-defined seams inside the existing codebase: the database schema layer, the MCP tool registry, the mention handler routing branch, and the config schema. The event router and webhook layer require zero changes. The critical architectural constraint is that the event router dispatches ALL handlers for a key via `Promise.allSettled` -- registering a second handler for `issue_comment.created` would cause double-firing. Triage must be a routing branch inside the existing `handleMention` function, not a parallel handler. See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for verified integration points and data flow diagrams.

**Major components:**
1. **Issue Schema + Store** (`014-issues.sql` + `knowledge/issue-store.ts`) -- PostgreSQL table with HNSW + tsvector indexes, full metadata columns; direct parallel to `review_comments` corpus
2. **MCP Tools** (`execution/mcp/issue-label-server.ts` + `issue-comment-server.ts`) -- Agent's output mechanism; separate from existing `github_comment` server due to incompatible review-specific validators
3. **Template Parser** (`execution/issue-template-parser.ts`) -- Handles both markdown (`.md`) and YAML form (`.yml`) template formats; extracts required sections and diffs against issue body
4. **Triage Prompt Builder** (`execution/triage-prompt.ts`) -- Constructs agent prompt from template diff + issue context
5. **Mention Handler Branch** (modify `handlers/mention.ts`) -- Routes `isIssueThreadComment && config.triage.enabled` to triage path before write-intent parsing; early return prevents fallthrough

### Critical Pitfalls

Top pitfalls from [PITFALLS.md](.planning/research/PITFALLS.md) with prevention strategy per phase:

1. **Label 404 on non-existent labels** -- The `github_issue_label` MCP tool must catch 404 from `addLabels` and return available labels to agent; config must allowlist permitted labels to prevent arbitrary label application. Address in MCP tools phase.

2. **Triage fires on PR comments** -- GitHub's `issue_comment.created` fires for both issues and PRs. The triage branch must check `!payload.issue.pull_request` (equivalently, `event.prNumber === undefined`) as its first guard. Add explicit test case: triage does NOT activate when `pull_request` field is set. Address in triage agent wiring phase.

3. **Template parser fails against xbmc's markdown templates** -- xbmc/xbmc uses `.md` markdown templates, not YAML forms. Parser must support both formats from day one: detect by file extension, then parse `## ` / `### ` section headers for markdown vs. `body[].label` fields for YAML forms. This is the primary target repo -- YAML-only parser is a hard blocker. Address in template parsing phase.

4. **Infinite comment loop** -- Bot posts comment, which fires `issue_comment.created`, which re-triggers triage. Existing BotFilter handles direct self-comment prevention if triage uses the same dispatch path. Add per-issue cooldown (default 30 min) as second defense. Only re-triage on explicit `@kodiai` mention, not on `issues.edited`. Address in triage agent wiring phase.

5. **Issue corpus schema missing critical metadata** -- Schema must include `state`, `author_association`, `label_names`, `template_slug`, `comment_count` beyond basic corpus columns. Missing columns require costly GitHub API backfill later. Get schema right before building the agent. Address in schema phase.

## Implications for Roadmap

Based on the dependency graph from FEATURES.md and build order from ARCHITECTURE.md, three phases are required. Phases 1 and 2 are independent and parallelizable; Phase 3 requires both.

### Phase 1: Issue Corpus Schema and Store

**Rationale:** The issue store is a dependency for semantic duplicate detection (v0.22+) and creates the metadata foundation the triage agent needs. Schema mistakes are expensive to fix post-deploy (backfill at rate-limited API calls). Build first, independently of MCP tool work.

**Delivers:** PostgreSQL `issues` table with HNSW + tsvector indexes; `IssueStore` interface with CRUD, embedding, and hybrid search; migration 014 following existing `migrate.ts` pattern.

**Addresses:** Issue schema + vector corpus (P1 feature), foundation for semantic duplicate detection (P2 feature)

**Avoids:** Pitfall 5 (schema missing metadata) -- include `state`, `author_association`, `label_names`, `template_slug`, `comment_count` from the start

**Research flag:** Standard pattern -- direct parallel to review_comments corpus. No additional research needed.

### Phase 2: MCP Tools (Label + Comment Servers)

**Rationale:** The triage agent's output mechanism must exist before the agent can be built. These two servers are the agent's only way to take visible action. Independent of Phase 1, can execute in parallel.

**Delivers:** `github_issue_label` MCP server with label validation and 404 handling; `github_issue_comment` MCP server with mention sanitization (no review template validators); wired into `buildMcpServers()` via new feature flags.

**Uses:** Agent SDK `createSdkMcpServer()` + `tool()` pattern (5 existing precedents), Octokit `issues.addLabels()` + `issues.createComment()`

**Implements:** In-Process MCP Server pattern (Architecture Pattern 2)

**Avoids:** Pitfall 1 (label 404) -- validate label existence, return available labels on failure; Reuse anti-pattern -- separate server avoids being rejected by review-specific comment validators

**Research flag:** Standard pattern -- fifth and sixth MCP server following identical blueprint. No additional research needed.

### Phase 3: Triage Agent Wiring

**Rationale:** Depends on both Phase 1 (schema/store for context) and Phase 2 (MCP tools for output). All integration points converge here: config schema, mention handler branch, template parser, prompt builder, and end-to-end integration test.

**Delivers:** `triageSchema` in `.kodiai.yml` config (default disabled); triage routing branch in mention handler with PR-filter guard and cooldown; `issue-template-parser.ts` supporting both markdown and YAML form formats; `triage-prompt.ts` building context-aware agent prompt; end-to-end integration test covering the full webhook-to-GitHub-API flow.

**Implements:** Config-Gated Feature Branch pattern (Architecture Pattern 1); Mention Handler Internal Routing (Architecture Pattern 3)

**Avoids:** Pitfall 2 (PR comment firing) -- `prNumber === undefined` guard as first check; Pitfall 3 (markdown template parsing) -- support both `.md` and `.yml` formats; Pitfall 4 (infinite loop) -- BotFilter + 30-min cooldown

**Research flag:** Template parsing for markdown format needs implementation verification against xbmc/xbmc's actual `bug_report.md` structure before finalizing the parser. A brief spike to read the actual template file and write test cases against its real section headers will eliminate the main implementation risk.

### Phase Ordering Rationale

- **Phases 1 and 2 are independent** -- no shared dependencies; can be assigned to parallel work streams or executed sequentially in either order
- **Phase 3 requires both** -- the agent needs MCP tools to act and the template parser (in Phase 3) depends on store types defined in Phase 1
- **Schema-first discipline** -- all three prior corpus stores (review_comments, wiki, code_snippets) were built schema-first; deviating risks costly migrations
- **MCP tools before agent** -- an agent built before its tools exist cannot be integration-tested end-to-end; testing blind creates hidden defects in the most user-visible component
- **Pitfall sequencing** -- most critical pitfalls are addressed in the phase where they are introduced, not retroactively

### Research Flags

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1 (Schema + Store):** Direct structural copy of review_comments corpus. Schema, store interface, and index patterns are fully documented in existing source.
- **Phase 2 (MCP Tools):** Fifth and sixth MCP servers following an identical, verified blueprint. No novel integration surface.

Phases that may benefit from a targeted spike:
- **Phase 3 (Triage Agent Wiring):** The markdown template parser is the highest-uncertainty component. xbmc/xbmc's `bug_report.md` uses markdown section headers, but the exact format (`##`, `###`, HTML comment delimiters) should be verified against the live file before writing the parser. A 30-minute spike reading the actual template files and writing a handful of parser test cases would eliminate the main risk.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every capability verified against installed packages and Octokit API surface; no new deps required; version compatibility confirmed in package.json |
| Features | HIGH | Core triage features defined by milestone issue #73; competitor analysis grounded in real tools (VS Code, issue-ops/validator, fancy-triage-bot); anti-features explicitly documented with rationale |
| Architecture | HIGH | All integration points verified against actual source files with line references; data flow traced through existing codebase; anti-patterns documented from real code constraints (Promise.allSettled, review comment validators) |
| Pitfalls | MEDIUM-HIGH | GitHub API 404 behavior verified against official docs; template format verified against xbmc/xbmc repo; agent integration pitfalls derived from codebase patterns rather than observed failures in production |

**Overall confidence:** HIGH

### Gaps to Address

- **Markdown template exact format:** xbmc/xbmc's `bug_report.md` section header format (whether it uses `##`, `###`, HTML comments, or a mix) should be verified during implementation before finalizing the parser. Research confirms it's a markdown template, but the exact section structure determines the regex approach.

- **Label allowlist schema shape:** The config schema includes `missingFieldsLabel` as a single string. Research recommends a broader label allowlist to prevent arbitrary label application via prompt injection. The `.kodiai.yml` schema shape (single string vs. array) should be decided during Phase 2 implementation and validated against the expected maintainer UX.

- **Cooldown storage mechanism:** Research recommends a per-issue cooldown to prevent comment spam. Storage approach (in-memory map vs. database column) is left open. For v0.21's expected volume (single-digit mentions/day), an in-memory map is sufficient but resets on restart. Decide during Phase 3 based on observed deployment restart frequency.

## Sources

### Primary (HIGH confidence)

- `src/execution/mcp/comment-server.ts` -- existing MCP tool pattern with review sanitization (direct blueprint for issue-comment-server)
- `src/knowledge/review-comment-store.ts` -- existing corpus store pattern (direct blueprint for issue-store)
- `src/execution/config.ts` -- existing config schema with section-fallback parsing (direct blueprint for triageSchema)
- `src/handlers/mention.ts` + `src/handlers/mention-types.ts` -- existing mention handler and surface normalization
- `src/webhook/router.ts` -- event dispatch model (Promise.allSettled, handler isolation)
- `@octokit/rest` v22 -- `issues.addLabels()`, `issues.createComment()` verified in existing codebase usage
- [GitHub REST API - Labels endpoints](https://docs.github.com/en/rest/issues/labels) -- label 404 behavior confirmed
- [xbmc/xbmc ISSUE_TEMPLATE/bug_report.md](https://github.com/xbmc/xbmc/blob/master/.github/ISSUE_TEMPLATE/bug_report.md) -- confirmed markdown format, not YAML forms

### Secondary (MEDIUM confidence)

- [VS Code Automated Issue Triaging](https://github.com/microsoft/vscode/wiki/Automated-Issue-Triaging) -- competitor patterns, cooldown strategies, label taxonomy approach
- [GitHub Docs: Triaging an issue with AI](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/triaging-an-issue-with-ai) -- native GitHub AI triage features and gaps
- [GitHub Issue Forms syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) -- YAML template field schema for dual-format parser
- [issue-ops/validator](https://github.com/issue-ops/validator) -- YAML form validation patterns and comment idempotency approaches

### Tertiary (LOW confidence)

- [simili-bot](https://github.com/similigh/simili-bot), [ai-duplicate-detector](https://github.com/mackgorski/ai-duplicate-detector) -- semantic similarity patterns for future duplicate detection (v0.22+ scope; not needed for v0.21)

---
*Research completed: 2026-02-26*
*Ready for roadmap: yes*
