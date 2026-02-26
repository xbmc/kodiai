# Feature Research

**Domain:** GitHub issue triage automation -- template validation, labeling, commenting, duplicate detection
**Researched:** 2026-02-26
**Milestone:** v0.21 Issue Triage Foundation
**Confidence:** HIGH for core triage features, MEDIUM for advanced classification

## Existing Foundation (Already Built)

These features are production and form the base for v0.21:

| Existing Capability | Module | How v0.21 Extends It |
|---------------------|--------|---------------------|
| `@kodiai` mention handling on issue_comment surface | `handlers/mention.ts`, `mention-types.ts` | Triage agent wired as new intent when mention is on an issue (not PR) |
| `.kodiai.yml` config with feature gating | `execution/config.ts` | Add `triage:` section to enable/disable and configure label sets |
| MCP tool pattern (github_pr_review, github_pr_comment) | `execution/executor.ts` | Add `github_issue_label` and `github_issue_comment` MCP tools following existing patterns |
| PostgreSQL with pgvector HNSW + tsvector | Knowledge stores | New `issues` table with same hybrid search pattern for duplicate detection |
| Voyage AI embeddings with chunking pipeline | `knowledge/` stores | Embed issue bodies for semantic similarity search |
| Multi-LLM task routing via Vercel AI SDK | `execution/task-router.ts` | Triage classification as non-agentic task routed to fast/cheap model |
| Contributor profiles with expertise tiers | `knowledge/contributor-profile-store.ts` | Tone adaptation based on whether issue author is first-timer vs core contributor |
| `normalizeIssueComment()` already distinguishes issue vs PR surface | `handlers/mention-types.ts` | Surface detection already works; triage logic branches on `surface === "issue_comment"` |

## Table Stakes

Features users expect from any issue triage bot. Missing these makes the feature feel broken or useless.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Template field validation** | Primary stated goal. Issues missing required fields (version, steps to reproduce, logs) are the #1 maintainer pain point. xbmc/xbmc uses markdown templates with `bug_report.md` and `roadmap_item.md` -- bot must parse heading-based sections and detect empty/placeholder content. | MEDIUM | Mention handler (trigger path), config loader | Must handle both YAML form templates and markdown templates. xbmc uses markdown format. Parse `### Section Name` headings and check body below each for "No response" / empty / placeholder text. |
| **Label application on triage outcome** | Every triage bot applies labels -- "needs more info", "bug", "feature request", type classification. Without labeling the bot is just a commenter. | LOW | New `github_issue_label` MCP tool, Octokit `issues.addLabels()` | Label must exist in repo or be created. Use `issues.addLabels()` (additive, not replacement). Configurable label names in `.kodiai.yml`. |
| **Guidance comment when fields missing** | Bot must explain what is missing and how to fix it. Comment should be specific ("Missing: Kodi version, Steps to reproduce") not generic ("Please fill out the template"). | LOW | New `github_issue_comment` MCP tool, existing comment posting patterns | Follow existing tracking comment pattern (post once, update on re-triage). Include checklist of missing fields. |
| **Config gating via .kodiai.yml** | Triage must be opt-in. Auto-triaging issues without consent would anger maintainers. Every serious bot provides config toggle. | LOW | Config schema extension | `triage: { enabled: false }` default. Mirrors existing `write: { enabled: false }` pattern. |
| **Trigger via @kodiai mention on issues** | Consistent with existing UX -- maintainers already use @kodiai on PRs. Same invocation pattern on issues. | LOW | Mention handler already routes issue_comment surface | Branch in mention handler: if surface is issue_comment and not on a PR, check triage config and dispatch to triage agent. |
| **Bot self-loop prevention** | Bot must not triage its own comments or react to its own labels. Already solved for PR reviews but must extend to issue surface. | LOW | Existing `botHandles` defense-in-depth sanitization | Same pattern: check comment author against bot handle before processing. |

## Differentiators

Features that set Kodiai's triage apart from actions/stale, fancy-triage-bot, and basic GitHub Actions workflows.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **Semantic duplicate detection** | Most triage bots use string similarity or keyword matching. Kodiai has an embedding pipeline and pgvector -- can do real semantic similarity against all past issues. Maintainers spend significant time closing duplicates; 30% of triage users want duplicate detection (per GitHub research). | MEDIUM | Issue vector corpus (new), Voyage AI embeddings, pgvector HNSW search | Embed issue title+body, search against existing issues with cosine similarity. Threshold configurable. Comment with "This may be related to #123, #456" with similarity scores. |
| **Knowledge-informed triage** | Kodiai already has wiki, code, review comment, and snippet corpora. Triage can cross-reference issue content against codebase to identify affected components, relevant wiki pages, and past review patterns. No competing bot has this. | MEDIUM | Cross-corpus retrieval pipeline, RRF merging | Retrieve relevant code files and wiki pages to add context to triage comment: "This appears to affect `xbmc/cores/VideoPlayer/` -- see [wiki: Video Playback Architecture]" |
| **Contributor-aware tone** | First-time issue reporters get friendlier, more explanatory guidance. Core contributors get terse, actionable feedback. Existing contributor profiles enable this for free. | LOW | Contributor profile store, expertise tiers | Map issue author to contributor profile. Adjust comment verbosity and tone based on tier. Same pattern as adaptive review depth. |
| **Area/component classification** | LLM reads issue content and classifies into project-specific area labels (e.g., "Component: VideoPlayer", "Component: PVR", "Platform: Android"). VS Code's triage bot does this with ML models on a 30-min cycle; Kodiai can do it inline with LLM on mention trigger. | MEDIUM | Task router (non-agentic task), configurable label taxonomy in .kodiai.yml | Define area labels in config. LLM classifies; agent applies via MCP tool. Non-agentic task routed to fast model. |
| **Issue corpus for retrieval augmentation** | Storing issues as embeddings creates a 5th retrieval corpus. Future PR reviews can surface "This change may address #789" and mention responses can reference past issues. Compounds value across the whole product. | MEDIUM | New issue store following knowledge store patterns | Schema: `issues(id, repo, number, title, body, state, labels, author, created_at, embedding, tsv)`. HNSW + tsvector indexes matching existing corpus pattern. |
| **Template-aware smart parsing** | Rather than regex-matching section headers, use LLM to understand what information is present vs missing even when users don't follow the template structure exactly. Handles cases where users provide info but in the wrong section. | LOW | Task router for classification | Parse with LLM rather than rigid regex. "User provided version info in the description body but not in the Version field" -- still mark as satisfied. |

## Anti-Features

Features that seem valuable but create problems. Explicitly avoid these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Auto-triage on issue.opened event** | "Triage everything automatically!" Seems efficient. | Maintainers lose control. False positives anger users. Auto-commenting on every issue is noisy. xbmc/xbmc gets community contributions from non-technical users who would be confused by bot comments they didn't ask for. VS Code can do this at scale with ML models trained on 100K+ issues; Kodiai cannot. | Trigger only on explicit `@kodiai` mention or configurable `issues.opened` opt-in (default off). Start with mention-only; add auto-triage later if maintainers request it. |
| **Auto-close issues** | "Close issues that don't follow template." Common in stale bots. | Hostile to contributors. Closes legitimate issues with formatting problems. Creates PR for the bot to get an issue reopened. Even VS Code's bot only auto-closes after 60 days of inactivity, not on template violations. | Comment with guidance and apply "needs more info" label. Let humans close. |
| **Auto-assign to maintainers** | "Route issues to the right person." | Requires knowing team structure, on-call rotations, expertise areas. Wrong assignment is worse than no assignment -- people ignore mis-routed issues. VS Code trains ML models monthly on Azure for this. | Apply area/component labels. Maintainers can set up GitHub CODEOWNERS or notification filters on labels. |
| **Priority/severity auto-classification** | "Label P0/P1/P2 automatically." | Priority is a human judgment call requiring business context, user impact assessment, and roadmap awareness. LLM-assigned priority will be wrong often enough to erode trust. | Classify type (bug/feature/question) and area -- these are more objective. Leave priority to maintainers. |
| **Stale issue management** | "Close issues after 30 days of inactivity." | Well-solved by existing tools (actions/stale). Adding this creates feature overlap and maintenance burden. Not related to triage intelligence. | Recommend actions/stale in docs. Keep Kodiai focused on intelligent triage, not lifecycle management. |
| **Real-time streaming triage UI** | "Show triage progress in a dashboard." | Out of scope per PROJECT.md constraints. GitHub comments are the interface. | Post triage results as issue comment. |

## Feature Dependencies

```
[Issue Schema & Vector Corpus]
    |
    |--required-by--> [Semantic Duplicate Detection]
    |--required-by--> [Issue Corpus for Retrieval Augmentation]
    |--required-by--> [Knowledge-Informed Triage] (needs issue history for context)
    |
[github_issue_label MCP Tool]
    |--required-by--> [Label Application]
    |--required-by--> [Area/Component Classification]
    |
[github_issue_comment MCP Tool]
    |--required-by--> [Guidance Comment]
    |--required-by--> [Duplicate Detection Comment]
    |--required-by--> [Knowledge-Informed Triage Comment]
    |
[Template Field Validation]
    |--required-by--> [Guidance Comment] (needs to know what is missing)
    |
[Config Gating (.kodiai.yml)]
    |--required-by--> [All triage features] (nothing fires without opt-in)
    |
[Contributor Profile Store] --enhances--> [Contributor-Aware Tone]
[Cross-Corpus Retrieval] --enhances--> [Knowledge-Informed Triage]
[Task Router] --enhances--> [Area/Component Classification]
```

### Dependency Notes

- **Issue Schema required before Duplicate Detection:** Cannot search for similar issues without the vector corpus. Schema and embedding pipeline must land first.
- **MCP Tools required before any agent action:** The triage agent uses `github_issue_label` and `github_issue_comment` as its output mechanism. These are prerequisite for all visible triage behavior.
- **Config gating is Phase 1 work:** Must exist before any triage logic fires, even in dev. Prevents accidental activation.
- **Template Validation before Guidance Comment:** The comment content depends on knowing which fields are missing. Validation logic is the input; comment is the output.
- **Contributor profiles enhance but don't block:** Tone adaptation is a nice-to-have that uses existing infrastructure. Triage works without it; just uses default tone.

## MVP Definition

### Launch With (v0.21)

Minimum viable triage -- what the milestone issue (#73) explicitly requires.

- [ ] **Issue schema & vector corpus** -- PostgreSQL table with HNSW + tsvector indexes following existing knowledge store patterns
- [ ] **`github_issue_label` MCP tool** -- Additive label application via Octokit, agent-callable
- [ ] **`github_issue_comment` MCP tool** -- Post or update issue comment, agent-callable
- [ ] **Template parser** -- Read `.github/ISSUE_TEMPLATE/` files from repo, identify required sections, detect missing/empty/placeholder content in issue body
- [ ] **Triage agent** -- Wired to @kodiai mention on issues. Validates template fields, comments with specific guidance, applies "Ignored rules" label when fields are missing
- [ ] **Config gating** -- `triage: { enabled: true/false }` in `.kodiai.yml`, default disabled

### Add After Validation (v0.21.x or v0.22)

Features to add once core triage is working and maintainers have feedback.

- [ ] **Semantic duplicate detection** -- Trigger: maintainers report duplicate issues are a bigger pain than template violations
- [ ] **Area/component classification** -- Trigger: label taxonomy defined in `.kodiai.yml` with maintainer-provided area list
- [ ] **Knowledge-informed triage comments** -- Trigger: cross-corpus retrieval producing useful context for issue content
- [ ] **Contributor-aware tone** -- Trigger: contributor profiles populated for the target repo
- [ ] **Auto-triage on issues.opened** -- Trigger: maintainers explicitly request it after using mention-based triage successfully

### Future Consideration (v0.23+)

Features to defer until triage product-market fit is established.

- [ ] **Issue corpus as 5th retrieval source for PR reviews** -- Requires issue backfill pipeline similar to review comment backfill
- [ ] **Issue-to-PR linking** -- Detect when a PR addresses an open issue and comment on both
- [ ] **Batch triage** -- Triage backlog of unlabeled issues in bulk (VS Code does this on a schedule)
- [ ] **Custom validation rules** -- User-defined validators beyond template field presence (regex, team verification)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|------------|---------------------|----------|-----------|
| Template field validation | HIGH | MEDIUM | P1 | Core ask from issue #73. Primary maintainer pain point. |
| Label application | HIGH | LOW | P1 | Useless without visible action. Labels are the triage output. |
| Guidance comment | HIGH | LOW | P1 | Users need to know what to fix. Comment is the communication channel. |
| Config gating | HIGH | LOW | P1 | Safety requirement. Must exist before anything else fires. |
| @kodiai mention trigger | HIGH | LOW | P1 | Consistent with existing UX. Reuses proven infrastructure. |
| Issue schema & corpus | MEDIUM | MEDIUM | P1 | Foundation for duplicate detection and retrieval. Build now even if not fully used in v0.21. |
| MCP tools (label + comment) | HIGH | LOW | P1 | Agent's hands. Required for any visible output. |
| Semantic duplicate detection | HIGH | MEDIUM | P2 | High value but needs corpus populated first. Add in follow-up. |
| Area/component classification | MEDIUM | MEDIUM | P2 | Needs per-repo label taxonomy. More config complexity. |
| Knowledge-informed triage | MEDIUM | LOW | P2 | Low cost (retrieval pipeline exists) but needs tuning for issue context. |
| Contributor-aware tone | LOW | LOW | P3 | Polish feature. Profiles may not be populated for issue authors. |
| Auto-triage on opened | MEDIUM | LOW | P3 | Must prove value with mentions first. Risk of noise. |

## Competitor Feature Analysis

| Feature | actions/stale | fancy-triage-bot | issue-ops/validator | VS Code triage | GitHub AI triage (native) | Kodiai (planned) |
|---------|--------------|------------------|---------------------|----------------|--------------------------|-----------------|
| Template validation | No | Glob pattern matching | YAML form validation with custom rules | No (different approach) | No | LLM-based semantic parsing of markdown templates |
| Label application | Stale label only | Pattern-matched labels | No (validation only) | ML-classified area labels | AI-suggested labels | Agent-applied labels via MCP tool |
| Guidance comments | Stale warning only | Configurable per-pattern | Validation summary comment | Needs-more-info comment | No | Specific missing-field checklist with contributor-aware tone |
| Duplicate detection | No | No | No | No | Similarity check (experimental) | Semantic vector similarity via pgvector |
| Codebase awareness | No | No | No | Feature area ML model | No | Cross-corpus retrieval (code, wiki, reviews, snippets) |
| Auto-close | After inactivity | No | No | After 60 days low votes | No | Explicitly avoided (anti-feature) |
| Config approach | Workflow YAML | Workflow YAML | Workflow YAML + config | Workflow YAML + Azure ML | Repository settings | `.kodiai.yml` (consistent with existing Kodiai config) |
| Trigger mechanism | Scheduled cron | issues.opened event | issues.opened event | 30-min scheduled batch | issues.opened event | @kodiai mention (opt-in, explicit) |

### Key Competitive Insight

Most existing triage tools are GitHub Actions that run on `issues.opened` with pattern matching or simple validation. They lack codebase awareness, semantic understanding, and knowledge retrieval. Kodiai's advantage is the existing knowledge platform (4 corpora + hybrid search + contributor profiles) that no Actions-based tool can replicate. The mention-triggered approach is also unique -- it gives maintainers control over when triage happens rather than auto-firing on every issue.

The closest competitor in sophistication is VS Code's triage system, which uses custom ML models trained monthly on Azure. However, VS Code's system is bespoke (not reusable), requires massive training data (100K+ issues), and operates on a scheduled batch rather than on-demand. Kodiai's LLM-based approach works out of the box without training data.

## Sources

- [VS Code Automated Issue Triaging Wiki](https://github.com/microsoft/vscode/wiki/Automated-Issue-Triaging) -- ML-based area classification, feature request lifecycle, needs-more-info automation
- [VS Code Triage Actions repo](https://github.com/microsoft/vscode-github-triage-actions) -- Implementation of VS Code's triage automation
- [GitHub Agentic Workflows: Issue Triage](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows/) -- GitHub's own agentic triage workflow patterns
- [GitHub Docs: Triaging an issue with AI](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/triaging-an-issue-with-ai) -- Native GitHub AI triage features
- [issue-ops/validator](https://github.com/issue-ops/validator) -- YAML form validation with custom rules
- [The Fancy Triage Bot](https://github.com/marketplace/actions/the-fancy-triage-bot) -- Glob pattern matching for labels and comments
- [GitHub Docs: Syntax for issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) -- YAML form template specification
- [Kubernetes Issue Triage Guidelines](https://www.kubernetes.dev/docs/guide/issue-triage/) -- Enterprise triage process and labeling taxonomy
- [simili-bot](https://github.com/similigh/simili-bot) -- AI-powered semantic duplicate detection
- [ai-duplicate-detector](https://github.com/mackgorski/ai-duplicate-detector) -- Semantic similarity for issue deduplication

---
*Feature research for: GitHub issue triage automation (v0.21 milestone)*
*Researched: 2026-02-26*
