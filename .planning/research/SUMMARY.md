# Project Research Summary

**Project:** Kodiai v0.4 — Intelligent Review System
**Domain:** AI-powered code review enhancement (noise reduction, severity classification, learning, context awareness)
**Researched:** 2026-02-11
**Confidence:** HIGH

## Executive Summary

The v0.4 milestone adds intelligence to Kodiai's existing code review capabilities by reducing false positives, adding severity classification, and enabling repo-specific learning—all without restructuring the proven v0.1-v0.3 architecture. The research reveals that successful AI code review tools succeed through **prompt enrichment and configuration control**, not through complex multi-agent pipelines or external analysis libraries. The critical insight: Kodiai's existing single-pass Agent SDK execution model is architecturally superior to multi-stage pipelines that add latency and cost.

The recommended approach is prompt-centric intelligence. Claude Code already has Read, Grep, Glob, and git tools—it doesn't need tree-sitter AST parsers or ESLint integration. Instead, v0.4 enriches the review prompt with: (1) review mode instructions (strict/balanced/lenient), (2) severity classification guidance (3-level scale), (3) repo-specific conventions from config and SQLite-backed learning, and (4) deterministic diff analysis context. All new capabilities use existing dependencies—zero new npm packages required.

The key risks are false positive flood (the #1 killer of AI review tools per industry data) and prompt complexity explosion. Mitigation: hard cap inline comments at 5-7 maximum, enforce bounded context injection (max 20 learnings, 2000 chars), keep core prompt under 200 lines, and gate all new behavior behind `review.mode` config with "standard" (current behavior) as default. Start with fewer detection categories than planned, measure dismissal rates, and expand only after validation. The architecture preserves the single-pass execution model—no pre-analysis LLM calls, no post-processing filters.

## Key Findings

### Recommended Stack

**Zero new npm dependencies.** All v0.4 capabilities build on existing infrastructure. The research explicitly rejected tree-sitter (native addon complexity, duplicates Claude's built-in code understanding), ESLint-as-library (100+ transitive deps for style checks we explicitly want to avoid), and embedding-based clustering (deferred to v0.5 after feedback corpus accumulates).

**Core technology decisions:**
- **bun:sqlite (already in use)**: Extend existing telemetry database with new tables for review findings, feedback, and repo conventions. Same WAL mode, same factory pattern, same fire-and-forget writes.
- **Zod v4 (already in use)**: Extend `reviewSchema` for mode, severity, and pattern config. Forward-compatible parsing already handles new fields gracefully.
- **picomatch (already in use)**: Powers path-scoped review instructions for context-aware reviews.
- **Claude Code via Agent SDK (already in use)**: Single-pass intelligence. Prompt-driven severity scoring, pattern detection, and classification. No external analyzers needed.

**Deferred to v0.5+:**
- **Voyage AI embeddings (voyage-code-3 model)**: For feedback clustering once corpus exists. Greptile improved address rate 19% → 55% with embeddings, but this requires accumulated feedback data first.
- **sqlite-vec (0.1.7-alpha.2)**: Vector search extension for similarity-based feedback matching. Alpha quality, macOS compatibility caveats. Companion to Voyage AI.

**Critical architecture decision:** Intelligent review comes from **better prompts, not library-driven analysis**. Adding AST parsers or static analyzers would duplicate Claude's native capabilities while adding dependency burden.

### Expected Features

**Must have (table stakes) — users expect these from any "intelligent" review tool:**
- **Configurable severity threshold**: `review.severity.minLevel` to suppress low-value findings. Without this, noisy repos get buried. CodeRabbit's chill/assertive, Kilo's strict/balanced/lenient prove demand.
- **Structured severity in output**: Every comment tagged with severity (Critical/Major/Medium/Minor). Summary already groups by severity; inline comments need consistent prefixing.
- **Focus area configuration**: `review.focusAreas` to specify categories that matter (security, bugs, performance). A security-focused repo shouldn't get performance nits.
- **Noise suppression rules**: Explicit prompt rules: no style-only comments, no "consider renaming" without concrete bugs, no test file structure nits.
- **Skip trivial PRs**: Auto-skip reviews for docs-only, lockfile-only, or sub-5-line changes. Current `skipPaths` handles file types but not change magnitude.

**Should have (differentiators) — valued by teams using AI review daily:**
- **Path-scoped review instructions**: Different rules per directory (e.g., "For src/api/**, enforce input validation"). CodeRabbit's path_instructions is gold standard. Picomatch already in stack.
- **Review profiles (strictness presets)**: Named bundles like strict/balanced/minimal that set severity + focus + noise rules. Users set `review.profile: balanced` instead of 5 fields.
- **Issue category tags**: Inline comments prefixed with [Security], [Bug], [Performance]. Enables quick filtering.
- **Confidence-based filtering**: Model self-assesses confidence (HIGH/MEDIUM/LOW). `review.minConfidence: medium` suppresses low-confidence findings where false positives concentrate.
- **Feedback-driven suppressions**: `review.suppressions` list for patterns to stop flagging. Explicit, version-controlled, auditable—unlike opaque ML learning.
- **Review summary with metrics**: Files reviewed, lines analyzed, issues by severity, estimated time saved. Quantitative signal of thoroughness.

**Defer (anti-features for v0.4):**
- **ML-based learning from past reviews**: Requires feedback corpus, training pipeline, concept drift management. Explicit config-based learning (suppressions, custom instructions) is more predictable for self-hosted tool.
- **Reaction-based feedback loop**: Needs tracking comment IDs, monitoring reactions, noisy signal (thumbs-down could mean "wrong" or "not important"). Add after explicit suppressions prove value.
- **Auto-fix from review findings**: Conflates review (advisory) with write-mode (action). Kodiai has write-mode via @mentions—keep separation. GitClear shows AI reviewing own output = 8x code duplication.
- **Cross-repo architectural analysis**: Product unto itself. Stay within single-PR scope.
- **Integrated linter/SAST orchestration**: Let CI/CD handle linters. LLM focuses on issues static tools miss: logic errors, incorrect business logic, architectural drift.

### Architecture Approach

**Design principle: Enrich the prompt, don't restructure the pipeline.** The existing stateless job execution (clone → config → prompt → execute → publish → cleanup) is clean and well-factored. Intelligent review integrates by injecting enriched context into `buildReviewPrompt()` and adding a knowledge store alongside telemetry.

**Major components:**
1. **Knowledge Store** (`src/knowledge/store.ts`) — SQLite-backed per-repo learning storage. Three sources: config-defined patterns (HIGH confidence), feedback-derived learnings (MEDIUM confidence), analysis-derived context (LOW confidence). Bounded injection: max 20 learnings per review, 2000 char limit.

2. **Diff Analyzer** (`src/execution/diff-analysis.ts`) — Deterministic pre-execution analysis. Classifies files by category (source/test/config/docs/infra), detects risk signals (keyword/path-based heuristics), computes scale indicators. No AI call—fast, free, predictable context for Claude.

3. **Enhanced Config Schema** (`src/execution/config.ts`) — Extends `reviewSchema` with `mode` (strict/balanced/lenient), `severity.minLevel`, `patterns.focus/ignore/customRules`. Uses existing zod v4, forward-compatible parsing.

4. **Enhanced Review Prompt** (`src/execution/review-prompt.ts`) — Accepts review mode, severity config, learnings, diff analysis. Assembles mode-specific instruction sections. Stays under 200 lines through composable templates, not monolithic prose.

5. **Review Handler Integration** (`src/handlers/review.ts`) — Loads learnings from knowledge store, runs diff analysis, passes enriched context to prompt builder. Updates learning usage counts after execution.

**Patterns to follow:**
- **Prompt enrichment over pipeline complexity**: Add intelligence via prompt text, not pre/post-processing AI stages. Single `query()` call.
- **SQLite factory functions**: Same pattern as telemetry store—create, WAL mode, prepared statements, return interface.
- **Config-driven prompt sections**: Review mode maps to string templates, not code branches. Prompt is source of truth.
- **Bounded context injection**: All dynamic context has explicit size limits to prevent token bloat.

**Anti-patterns to avoid:**
- **Multi-agent review pipeline**: Doubles/triples cost and latency. Claude handles triage + analysis + formatting in one pass.
- **Post-processing filter on output**: Claude already spent tokens generating findings. Set thresholds in prompt, not after execution.
- **Storing learnings in workspace**: Workspaces are ephemeral. Use persistent SQLite.
- **Fine-grained feedback tracking before basics work**: Get severity tagging and review modes validated before building complex feedback loops.

### Critical Pitfalls

**1. False Positive Flood Destroys Trust (The Cardinal Sin)**
Industry data: up to 40% of AI review alerts get ignored; only 18% result in code changes (Jellyfish 2025). Multi-category detection multiplies findings—10-15 comments per PR vs. current 2-3. Users disable bot entirely. **Prevention:** Hard cap at 5-7 inline comments maximum (enforce in prompt AND MCP server). Start with fewer categories than planned (bugs, security, error handling only). Default to strict precision over recall—missing 3 real issues beats 10 false positives. Measure dismissal rate from day one; if >50%, system is too noisy.

**2. Prompt Complexity Explosion (The Mega-Prompt Trap)**
Current 190-line prompt works well. Adding category definitions + severity rubrics + repo conventions + mode instructions = 500+ lines. LLMs ignore/misinterpret at this size. **Prevention:** Keep core prompt under 200 lines. Use Agent SDK's `systemPromptAppend` for category definitions, not inline bloat. Do NOT embed repo conventions in prompt—rely on CLAUDE.md mechanism. Prefer few-shot examples over prose rules.

**3. Breaking Existing Working Reviews During Migration**
No feature flags or per-repo version selection. Deploy changes behavior for ALL installations. Users perceive any change as regression. **Prevention:** Implement `review.mode: "standard"` (default, current behavior) and `review.mode: "enhanced"` (new features) BEFORE changing any logic. Default stays current behavior. Wait for opt-in validation before changing default.

**4. Severity Scoring Becomes Meaningless (The "Everything is Medium" Problem)**
LLMs default 60-70% of findings to "Medium" (safe middle ground). If everything is Medium, severity is noise. **Prevention:** Use 3-level scale (Must Fix / Should Fix / Consider) not 5. Define severity by CONSEQUENCE not category ("causes data loss" not "security issue"). Do NOT automate merge blocking based on severity in v0.4—classification not reliable enough. Track severity distribution; if >60% at one level, system isn't discriminating.

**5. Feedback Learning System Creates Perverse Incentives**
Users dismiss comments for many reasons ("fix later", "known issue", "in a hurry"), not just "wrong finding". Treating all dismissals as negative feedback suppresses legitimate findings. Easy fixes (naming) have high acceptance but low value; hard fixes (security) have low acceptance but high value. **Prevention:** Do NOT use implicit feedback (resolution status) in v0.4. Signal too noisy. Start with explicit feedback only (thumbs up/down, @kodiai commands). Never suppress high-severity categories regardless of feedback. Collect data first, automate tuning later (or never in v0.4).

## Implications for Roadmap

Based on combined research, intelligent review should be structured in **3-4 phases** that build from noise reduction foundation → context awareness → feedback/learning. Critical constraint: avoid false positive flood from day one.

### Phase 1: Severity & Noise Control (Foundation)
**Rationale:** Noise reduction is prerequisite for all other intelligence features. Research shows concise reviews are 3x more likely to be acted upon. Must establish the mode-switching mechanism BEFORE changing any behavior to avoid migration breakage (Pitfall 3).

**Delivers:**
- `review.mode` config field with "standard" (default) and "enhanced" options
- `review.severity.minLevel` threshold configuration
- `review.focusAreas` to specify which categories to review
- Expanded noise suppression rules in prompt (explicit "do not flag" patterns)
- Structured severity and category tags on inline comments
- Hard cap on inline comments (5-7 maximum)

**Addresses features:**
- Configurable severity threshold (table stakes)
- Structured severity in output (table stakes)
- Focus area configuration (table stakes)
- Noise suppression rules (table stakes)

**Avoids pitfalls:**
- Pitfall 1 (false positive flood) via hard cap and fewer categories
- Pitfall 3 (breaking existing reviews) via mode switch with standard default
- Pitfall 8 (config complexity) via max 3 new user-facing fields

**Research flag:** Standard patterns—severity classification and config extension are well-documented. No phase-specific research needed.

---

### Phase 2: Context-Aware Instructions & Pattern Analysis
**Rationale:** With noise controls in place, add repo-specific intelligence. Path-scoped instructions and review profiles are proven differentiators (CodeRabbit's path_instructions, Kilo's strict/balanced/lenient). Diff analysis provides deterministic context without adding LLM calls or latency.

**Delivers:**
- `review.pathInstructions` config for per-directory rules (uses picomatch)
- `review.profile` presets (strict/balanced/minimal) as convenience bundles
- Diff analyzer component (file classification, risk signals, scale indicators)
- Diff analysis context injected into review prompt
- Enhanced `review.prompt` documentation and examples

**Addresses features:**
- Path-scoped review instructions (differentiator)
- Review profiles (differentiator)
- Issue category tags on comments (differentiator)

**Avoids pitfalls:**
- Pitfall 2 (prompt complexity) via bounded context injection (500 char limit on diff summary)
- Pitfall 7 (latency) via deterministic analysis (no AI call)
- Pitfall 11 (language inconsistency) by starting with TypeScript only

**Research flag:** Deterministic diff analysis is straightforward. Path instruction format can follow CodeRabbit's documented pattern. No deep research needed.

---

### Phase 3: Knowledge Store & Explicit Learning
**Rationale:** Enable teams to teach the bot what to ignore through explicit configuration. SQLite-backed storage follows proven telemetry pattern. Config-defined patterns provide HIGH confidence learnings without feedback corpus.

**Delivers:**
- Knowledge store component (`src/knowledge/store.ts`)
- SQLite tables: `review_issues`, `review_feedback`, `repo_conventions`
- `review.suppressions` config field for explicit patterns to ignore
- `review.minConfidence` config for confidence-based filtering
- Learnings injection into review prompt (bounded: max 20, 2000 chars)
- Review summary with metrics (files, lines, issue counts by severity)

**Addresses features:**
- Feedback-driven suppressions (differentiator)
- Confidence-based filtering (differentiator)
- Review summary with metrics (differentiator)

**Avoids pitfalls:**
- Pitfall 5 (perverse incentives) by using explicit config-defined patterns only, no implicit feedback
- Pitfall 6 (overfitting bad patterns) by making learning opt-in and explicit
- Pitfall 12 (unbounded storage) via per-repo caps and retention policy

**Research flag:** SQLite schema design and knowledge store factory pattern follow existing telemetry pattern. Low complexity.

---

### Phase 4 (Optional/Future): Feedback Capture & Implicit Learning
**Rationale:** After explicit learning proves value and feedback data accumulates, add webhook-based feedback capture. This is the highest complexity phase with most dependencies. Defer if time-constrained—explicit learning in Phase 3 delivers most value.

**Delivers:**
- Webhook handlers for comment reactions (thumbs up/down)
- Feedback correlation (map reactions to `review_issues.comment_id`)
- Feedback processing into learnings (with quality filters)
- Learning usage tracking and confidence adjustment

**Addresses features:**
- Implicit feedback signals (enhancement over explicit suppressions)

**Avoids pitfalls:**
- Pitfall 5 (perverse incentives) via category suppression floor and human-reviewed adjustments
- Pitfall 14 (shadow mode leaks) if implementing gradual rollout

**Research flag:** HIGH complexity. Needs research on GitHub webhook event correlation, reaction event handling, and feedback signal quality. Consider `/gsd:research-phase` before planning.

---

### Phase Ordering Rationale

**Why this order:**
1. **Phase 1 first (foundation):** Mode-switching mechanism MUST exist before any behavior changes to prevent migration breakage. Noise controls prevent false positive flood (the #1 killer per research). Config schema extensions establish the pattern for later phases.

2. **Phase 2 second (context):** Depends on Phase 1 config infrastructure (review.mode, review.severity) for profile presets. Diff analysis provides enriched prompt context. Path instructions multiply value of existing severity controls (different rules per directory).

3. **Phase 3 third (learning):** Requires Phase 1 severity system and Phase 2 prompt enrichment in place. Knowledge store is independent but learnings are most valuable when injected into context-aware prompts. Explicit learning validates the pattern before complex implicit feedback.

4. **Phase 4 last (optional):** Highest complexity, most dependencies. Requires Phase 3 knowledge store schema. Only pursue if Phase 3 explicit learning proves insufficient (unlikely—config-driven suppressions may be sufficient).

**Dependency graph:**
```
Phase 1 (Config + Mode)
    ├──> Phase 2 (Context + Diff Analysis)
    │         └──> Phase 3 (Knowledge Store)
    │                  └──> Phase 4 (Feedback Capture) [optional]
```

**How this avoids pitfalls:**
- Builds noise controls first (Pitfall 1 prevention)
- Establishes mode switch before any behavior changes (Pitfall 3 prevention)
- Keeps config surface minimal (Pitfall 8 prevention via 3 fields in Phase 1, 2 in Phase 2, 3 in Phase 3)
- Single-pass architecture maintained throughout (Pitfall 7 prevention)
- Explicit learning before implicit (Pitfall 5 prevention)

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 4 (Feedback Capture)**: If pursued, needs research on GitHub webhook event correlation, reaction tracking APIs, and feedback signal quality analysis. Complex state management across review cycles. Recommend `/gsd:research-phase` before planning.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Severity & Noise Control)**: Config extension follows existing v0.3 pattern. Severity classification and prompt engineering are well-documented.
- **Phase 2 (Context-Aware Instructions)**: Path matching with picomatch is established. Diff analysis is deterministic file operations.
- **Phase 3 (Knowledge Store)**: SQLite factory pattern mirrors existing telemetry store. Schema design is straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Verified from codebase package.json and architecture review. Zero new dependencies decision is based on Claude Code capabilities analysis and industry evidence (Greptile blog, Claude Code plugin docs, academic research). |
| Features | **HIGH** | Validated against competitor feature matrices (CodeRabbit config reference, Kilo blog, GitHub Copilot docs) and industry analysis (signal-vs-noise framework, context engineering patterns). Must-have vs. should-have distinction clear. |
| Architecture | **HIGH** | Full codebase analysis of existing pipeline. Integration points verified against actual implementation patterns. SQLite factory, config extension, MCP tool patterns already proven in v0.1-v0.3. |
| Pitfalls | **HIGH** | Sourced from primary industry data (Jellyfish study: 18% code change rate, 40% alert ignore rate), developer experience reports (HN discussion), and codebase risk analysis. Pitfalls are specific to LLM-based review challenges, not generic software risks. |

**Overall confidence:** **HIGH**

All four research tracks converged on consistent recommendations: prompt-driven intelligence, bounded context injection, explicit config over implicit ML, single-pass architecture. No conflicts or gaps between STACK, FEATURES, ARCHITECTURE, and PITFALLS findings.

### Gaps to Address

**1. Severity classification accuracy in practice:**
Research shows LLMs over-use "Medium" severity (60-70% of findings). The 3-level scale with consequence-based definitions should improve this, but accuracy needs measurement during Phase 1 implementation. **Mitigation:** Track severity distribution histogram as health metric. If >60% at one level after Phase 1, iterate on prompt rubrics before Phase 2.

**2. Comment count cap effectiveness:**
Hard cap of 5-7 inline comments is recommended based on industry best practices (Greptile, CodeRabbit behavior), but optimal number may vary by repo size and team preference. **Mitigation:** Make cap configurable via `review.maxInlineComments` with default of 7. Collect telemetry on comment counts vs. dismissal rates.

**3. Path instruction precedence with global config:**
When `review.pathInstructions` specifies rules for `src/api/**` and global `review.focusAreas` specifies categories, unclear which takes precedence. **Mitigation:** Document that path instructions OVERRIDE global settings for matched paths. Path-specific instructions should be able to broaden OR narrow focus relative to global config.

**4. Diff analysis risk signal precision:**
Keyword/path-based heuristics for risk signals (e.g., "auth" in file path = authentication-related) will have false positives. **Mitigation:** Risk signals are informational context for Claude, not gates. False positives just add unnecessary context but don't block reviews. Can refine heuristics post-launch based on logs.

**5. Knowledge store migration/versioning:**
Schema changes to `learnings` table in future versions could break existing knowledge databases. **Mitigation:** Use same migration strategy as telemetry store—idempotent `CREATE TABLE IF NOT EXISTS`, add columns with nullable defaults, never drop columns. Document schema version in a metadata table.

## Sources

### Primary (HIGH confidence)
- **Kodiai codebase**: Full inspection of `src/execution/review-prompt.ts`, `src/handlers/review.ts`, `src/execution/config.ts`, `src/execution/executor.ts`, `src/execution/mcp/*.ts`, `src/telemetry/store.ts`, `package.json`. Verified existing architecture, config patterns, MCP integration, telemetry store design.
- **[CodeRabbit Configuration Reference](https://docs.coderabbit.ai/reference/configuration)**: Full YAML schema, path_instructions, review profiles, learnings system. Used for competitive feature comparison and path instruction design.
- **[GitHub Copilot Code Review Docs](https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review)**: Copilot review behavior, custom instructions, comment-only reviews. Validated table stakes features.
- **[Claude Code code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md)**: Multi-agent architecture, confidence scoring >=80 threshold. Validated that Claude Code already handles review intelligence natively.
- **[Jellyfish: Impact of AI Code Review Agents (2025)](https://jellyfish.co/blog/impact-of-ai-code-review-agents/)**: 18% of AI feedback results in code changes; 56% of reviews get human response. Primary research analyzing 1000+ reviews. Critical for false positive prevention strategy.
- **[Bun SQLite documentation](https://bun.com/docs/runtime/sqlite)**: loadExtension API, WAL mode, Database class. Verified for knowledge store design.
- **[GitHub Docs: Rate Limits for GitHub Apps](https://docs.github.com/en/developers/apps/building-github-apps/rate-limits-for-github-apps)**: Secondary rate limits on content creation. Critical for comment count cap rationale.

### Secondary (MEDIUM confidence)
- **[Greptile: AI Code Review Bubble](https://www.greptile.com/blog/ai-code-review-bubble)**: Embedding clustering improved address rate 19% → 55%; prompting alone was ineffective. Validated deferred embeddings approach for v0.5.
- **[Benchmarking LLM-based Code Review (arxiv)](https://arxiv.org/html/2509.01494v1)**: Top ACR achieves 19% F1; false positives are primary bottleneck. Academic validation of industry challenges.
- **[Signal vs Noise Framework for AI Code Review](https://jetxu-llm.github.io/posts/low-noise-code-review/)**: Three-tier classification, signal ratio metrics, cost of false positives. Informed severity scale design.
- **[Context Engineering for AI Code Reviews (CodeRabbit Blog)](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews)**: 1:1 code-to-context ratio, context source types. Validated bounded context injection approach.
- **[Graphite: AI Code Review False Positives](https://graphite.com/guides/ai-code-review-false-positives)**: Industry false positive rates of 5-15%; context-aware analysis reduces them. Informed hard cap strategy.
- **[Qodo: 5 AI Code Review Pattern Predictions in 2026](https://www.qodo.ai/blog/5-ai-code-review-pattern-predictions-in-2026/)**: Severity-driven review, alert fatigue, feedback loop deficiencies. Validated pitfall prevention strategies.
- **[Kilo AI code reviews](https://blog.kilo.ai/p/introducing-code-reviews)**: strict/balanced/lenient review modes. Validated review profile design.
- **[Voyage AI TypeScript SDK](https://github.com/voyage-ai/typescript-sdk)**: voyageai ^0.1.0, voyage-code-3 model for code embeddings. Informed v0.5 deferred features.
- **[Anthropic Embeddings docs](https://docs.claude.com/en/docs/build-with-claude/embeddings)**: Voyage AI as recommended partner. Validated embedding provider choice.
- **[sqlite-vec documentation](https://alexgarcia.xyz/sqlite-vec/js.html)**: Bun compatibility via loadExtension, macOS caveats. Informed deferred vector search approach.

### Tertiary (LOW confidence)
- **[Hacker News: AI Code Review Bubble Discussion](https://news.ycombinator.com/item?id=46766961)**: Developer complaints about verbosity, false positives, non-determinism. Anecdotal but consistent with primary research findings.
- **[DevTools Academy: State of AI Code Review Tools 2025](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/)**: Ecosystem landscape, leading tools catch 40-48% of bugs. Broad survey, lacks methodological detail.
- **[8 Best AI Code Review Tools 2026 (Qodo Blog)](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/)**: Competitor comparison overview. Marketing-oriented but useful feature matrix.

---
*Research completed: 2026-02-11*
*Ready for roadmap: yes*
