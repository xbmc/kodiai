# Project Research Summary

**Project:** Kodiai -- Language-Aware Enforcement, Large PR Intelligence, Feedback-Driven Learning
**Domain:** AI Code Review Enhancement (Three-Feature Milestone)
**Researched:** 2026-02-13
**Confidence:** HIGH

## Executive Summary

This milestone adds three capabilities to Kodiai's existing AI code review system: (1) language-specific severity enforcement to reduce noise from linter-catchable findings while elevating safety-critical patterns, (2) risk-weighted file prioritization for large PRs to focus review attention where it matters most, and (3) feedback-driven learning from thumbs-down reactions to auto-suppress repeatedly rejected patterns. The critical finding from comprehensive research is that **zero new dependencies are required**. Every capability can be built using existing libraries, existing SQLite schema patterns, existing diff analysis infrastructure, and existing GitHub API methods already proven in production.

The recommended approach is **extension over addition**: extend existing `LANGUAGE_GUIDANCE`, `diff-analysis.ts`, and `feedback-sync.ts` pipelines with additional logic rather than building parallel systems. Each feature integrates into the existing review pipeline as preprocessing steps (file risk scoring, feedback suppression loading) or post-processing enhancements (language severity floor enforcement, confidence adjustment). The architecture follows established "fail-open enrichment" patterns throughout -- every new capability degrades gracefully when unavailable.

Key risks center on feedback loop bias amplification and rule precedence conflicts. The existing system already has four layers of severity/filtering control; adding language-specific rules creates a fifth layer requiring explicit precedence ordering. More critically, feedback-driven suppression can amplify false negatives if not carefully bounded: security findings dismissed as "too noisy" get progressively suppressed, masking real defects. Mitigation requires hard category floors (never suppress security/correctness below baseline), sample size thresholds (minimum 3-5 distinct thumbs-down), reactor diversity requirements, and explicit user opt-in with transparency reporting.

## Key Findings

### Recommended Stack

**Zero new dependencies needed.** All three features build on existing infrastructure:

**Core technologies (already in production):**
- **Bun SQLite** (builtin) -- Add `feedback_suppression_rules` table using existing WAL mode and additive schema patterns
- **Existing diff-analysis.ts** -- Extend `analyzeDiff()` with `computeFileRiskScore()` and `prioritizeFiles()` using existing `PATH_RISK_SIGNALS`, `CONTENT_RISK_SIGNALS`, and `filesByCategory` data
- **Existing LANGUAGE_GUIDANCE** -- Extend with severity tiers (auto-fixable vs safety-critical) and per-language config overrides
- **Existing feedback-sync.ts** -- Add aggregation trigger after reaction capture; polling approach is architecturally correct (GitHub does NOT emit reaction webhooks)
- **Existing confidence.ts** -- Extend `computeConfidence()` with feedback signals and integrate `matchesSuppression()` with feedback-derived rules
- **Zod** (^4.3.6) -- Extend config schema with `review.languageRules`, `review.largePR`, `review.feedback` sections

**What NOT to add:**
- NO linter runtime dependencies (ESLint, Ruff, Clippy) -- workspace lacks toolchains; use prompt-driven classification instead
- NO AST parsing libraries (tree-sitter, babel) -- cyclomatic complexity is not needed; lines changed + path signals are better predictors
- NO ML models for risk scoring -- heuristics are transparent, debuggable, and sufficient
- NO external vector DB, message queue, or NLP libraries -- existing `sqlite-vec`, `p-queue`, and binary reactions are sufficient

### Expected Features

**Must have (table stakes):**
- **Suppress linter-catchable findings** (formatting, import order) -- CodeRabbit, Qodo, Greptile all learned this; XBMC data shows 100% noise from style nits
- **Language-specific severity baselines** (C++ null deref = CRITICAL, Python bare except = MAJOR, Go unchecked error = MAJOR) -- Users expect safety issues flagged appropriately
- **File prioritization by risk** for large PRs -- XBMC PR #27752: 312 files, humans reviewed 3 core files; bot must focus similarly
- **Explicit coverage disclosure** ("Reviewed 50/312 files, prioritized by risk") -- Transparency is table stakes for trust
- **Thumbs-down pattern tracking** -- Every competitor learns from reactions; Greptile improved address rate from 19% to 55%
- **Feedback-informed suppression** after N thumbs-down -- Expected learning behavior
- **CRITICAL findings never suppressed** by language rules or feedback -- Safety floor is universal

**Should have (differentiators):**
- **Post-execution severity floor enforcement** -- Goes beyond prompt guidance to enforce hard floors LLM cannot override (no competitor does this deterministically)
- **Auto-detect formatter config files** (detect `.clang-format`, `.prettierrc` in repo and auto-suppress style findings) -- Eliminates false positives without user config
- **Risk-weighted file scoring algorithm** (category weight + lines changed + risk signal bonus + churn) -- Principled selection beyond binary "large/not large"
- **Feedback-weighted confidence adjustment** -- Patterns with consistent thumbs-up get +10 confidence; thumbs-down get -20 (graduated, not binary)
- **Feedback transparency reporting** ("3 patterns auto-suppressed based on prior feedback") -- Makes auto-suppression auditable

**Defer (v2+):**
- **Embedding-based pattern clustering** for feedback suppression -- Powerful but complex; exact-match handles 80% of cases
- **Churn-aware risk scoring** -- Requires additional git commands; add after basic risk scoring validated
- **Split recommendation** for oversized PRs -- Low impact; humans already know their PR is too big
- **Graduated language tier visibility** -- Nice UX but not critical

### Architecture Approach

All three features integrate into the existing review pipeline (`handlers/review.ts`) as **fail-open enrichments** -- new logic wrapped in try/catch blocks that log warnings on failure and allow review to proceed with degraded functionality. No new services, no new processes, no new databases.

**Major components (all extended, not created):**
1. **diff-analysis.ts** (ENHANCED) -- Add `parsePerFileNumstat()`, `computeFileRiskScore()`, `prioritizeFiles()` using existing `PATH_RISK_SIGNALS`, `CONTENT_RISK_SIGNALS`, category classification
2. **review-prompt.ts** (ENHANCED) -- Extend `buildLanguageGuidanceSection()` with severity tiers, add `buildLargePRPrioritizationSection()` for risk-weighted file hints
3. **knowledge/store.ts** (ENHANCED) -- Add `feedback_suppression_rules` table, `refreshFeedbackSuppressions()` aggregation, `loadFeedbackSuppressions()` query
4. **confidence.ts** (ENHANCED) -- Integrate feedback suppressions into `matchesSuppression()`, extend `computeConfidence()` with feedback signals
5. **config.ts** (ENHANCED) -- Add `languageRules`, `largePR`, `feedback` schema sections using existing Zod patterns
6. **feedback-sync.ts** (ENHANCED) -- Trigger aggregation after reaction capture (existing polling approach is correct)

**Integration points:**
- **Pre-execution** (before `buildReviewPrompt()`): File risk scoring, prioritization, feedback suppression loading
- **Prompt construction**: Language severity tiers, risk priority hints, feedback context
- **Post-execution** (after `extractFindings()`): Language severity floor enforcement, feedback-based suppression, confidence adjustment

**Key pattern to follow:** Static rule registries (not dynamic config or databases) for language rules. Rules change infrequently; static TypeScript data is simpler, testable, and version-controlled. Composite risk scoring with normalized 0-1 signals. Threshold-based suppression generation from aggregated SQL queries.

### Critical Pitfalls

1. **Language severity overrides create rule conflicts with existing config** -- System already has 4 layers of severity/filtering control (`minLevel`, `focusAreas`, `ignoredAreas`, `suppressions`). Adding language-specific rules creates a 5th layer with no defined precedence. **Prevention:** Define explicit precedence: `user suppressions > user minLevel > language overrides > default`. Apply language overrides deterministically in TypeScript before prompt construction, not as LLM prompt text. Test cross-product of language rules against all existing filters.

2. **Feedback-driven suppression creates silent false-negative amplification** -- Thumbs-down means "this instance not actionable" not "this category always wrong." Generalizing contextual signals to category-level suppressions progressively silences valid findings. Well-documented bias amplification pattern (Taori et al. 2023). **Prevention:** Non-negotiable category floors (never suppress security/correctness below baseline), decay feedback signals over time, require minimum sample size (5+ thumbs-down from 3+ distinct reactors), separate "collect" from "act" (default OFF), monitor escape rate per category.

3. **Risk-weighted file prioritization drops critical files in large PRs** -- When budget limits apply, naive scoring (prioritize `auth/*`, deprioritize `test/*`) causes system to consistently skip categories. Test regressions cause production incidents; config changes introduce CI vulnerabilities; new files without history are where novel bugs live. **Prevention:** Never fully skip files -- use tiered approach (full analysis / abbreviated / mention-only). Always analyze new files regardless of risk score. Preserve category coverage (at least one file from each category). Show user what was deprioritized in review summary.

4. **Feedback spam and gaming pollutes learning corpus** -- Single actor mass-reacts thumbs-down to all findings. GitHub reactions are cheap (no commit needed). `UNIQUE(repo, comment_id, reaction_id)` prevents duplicates but not mass reactions from one user. **Prevention:** Per-reactor weighting (inversely to total reaction count), diversity threshold (require reactions from >= N distinct reactors), anomaly detection (flag reactors > 2 sigma from mean), immutable audit trail with periodic integrity checks.

5. **Language rules over-tuned to one language degrade others** -- LLM attention roughly proportional to prompt section length. If TypeScript guidance has 15 rules and Go has 3, weight shifts. Mixed-language PRs show thorough TypeScript analysis but shallow Go analysis. **Prevention:** Cap per-language guidance to fixed token budget (500 tokens), weight guidance by file count in current PR, track per-language finding rates to detect divergence, consider two-pass strategy for critical languages.

## Implications for Roadmap

Based on combined research, these features are **independent** -- can be built in parallel with no code dependencies. However, sequential build order is recommended to allow validation and avoid compound complexity.

### Suggested Phase Structure

**Phase 1: Language-Aware Severity Enforcement**
**Rationale:** Extends existing `LANGUAGE_GUIDANCE` directly; config addition isolated; both prompt and post-processing are small and independently testable. Immediate noise reduction value for polyglot repos. No dependencies on other features.
**Delivers:** Language severity tiers (auto-fixable suppression + safety-critical enforcement), per-language config overrides, post-execution severity floor, auto-detect formatter configs (optional)
**Addresses:** Table stakes features (suppress linter-catchable, language-specific baselines), differentiators (post-execution enforcement, auto-detect formatters)
**Avoids:** Pitfall #1 (rule conflicts) via deterministic precedence, Pitfall #5 (over-tuning) via token budgeting

**Build order within phase:**
1. Config schema (`languageRules` Zod section)
2. `LANGUAGE_SEVERITY_RULES` static registry
3. Prompt builder extension (merge config + built-in guidance)
4. Post-processing filter (language severity floor)
5. Tests (cross-product: each language rule respects all existing filters)

**Phase 2: Large PR File Prioritization**
**Rationale:** Uses diff analysis output (already exists). Independent of feedback and language features (but benefits from language awareness for scoring). Addresses concrete pain point for monorepo PRs (XBMC 312-file example).
**Delivers:** Per-file risk scoring, top-N file selection with token budget, coverage disclosure in summary, risk heatmap (optional), adaptive severity by PR size (optional)
**Addresses:** Table stakes features (file prioritization, coverage disclosure), differentiators (risk-weighted scoring, transparent prioritization)
**Avoids:** Pitfall #4 (dropping critical files) via tiered analysis, Pitfall #7 (black-box scoring) via transparency reporting

**Build order within phase:**
1. Config schema (`largePR` Zod section)
2. `parsePerFileNumstat()` function
3. `computeFileRiskScore()` function (composite weighted formula)
4. `prioritizeFiles()` orchestrator (tiered selection: full/abbreviated/mention)
5. Prompt section (`buildLargePRPrioritizationSection`)
6. Handler integration (between `analyzeDiff` and `buildReviewPrompt`)
7. Tests (verify all files appear in at least one tier; no invisible files)

**Phase 3: Feedback-Driven Learning Loop**
**Rationale:** Depends on existing feedback infrastructure having captured data. Most complex -- involves new table, aggregation queries, suppression merging, confidence formula changes. Benefits from Phases 1-2 providing more training data.
**Delivers:** Feedback aggregation by title fingerprint, auto-suppress rule generation with threshold, suppression merging in confidence pipeline, feedback-weighted confidence adjustment, learning memory outcome update on thumbs-down (optional), transparency reporting
**Addresses:** Table stakes features (thumbs-down tracking, feedback-informed suppression), differentiators (feedback-weighted confidence, transparency reporting)
**Avoids:** Pitfall #3 (false-negative amplification) via category floors + decay + sample size thresholds, Pitfall #4 (spam/gaming) via reactor weighting + diversity + anomaly detection

**Build order within phase:**
1. Knowledge store schema (`feedback_suppression_rules` table)
2. `refreshFeedbackSuppressions()` aggregation method
3. `loadFeedbackSuppressions()` query method
4. Config schema (`review.feedback` section, `autoSuppressEnabled` default false)
5. Handler integration (load + merge feedback suppressions)
6. Feedback-sync handler integration (trigger aggregation after reaction capture)
7. Optional: confidence formula extension with feedback signal
8. Optional: learning memory bridge for thumbs_up/thumbs_down outcomes
9. Tests (verify category floors enforced; single-reactor influence capped; sample size respected)

### Phase Ordering Rationale

- **Independence allows parallel work** but sequential build provides incremental validation
- **Phase 1 first** because it has highest signal-to-noise improvement per line of code (XBMC data: eliminates 100% of formatting noise, ensures 100% of null deref findings are CRITICAL)
- **Phase 2 second** because file prioritization is most valuable once noise is reduced (Phase 1), and it provides more structured findings data for Phase 3 feedback learning
- **Phase 3 last** because it is most complex, has highest risk (bias amplification), benefits from data generated by Phases 1-2, and should start with explicit user opt-in (default OFF) until validated

### Research Flags

**Phases with standard patterns (skip deep research during planning):**
- **Phase 1 (Language enforcement):** Extends existing `LANGUAGE_GUIDANCE` map; prompt section builder pattern well-established; config schema extension is routine
- **Phase 2 (File prioritization):** Composite risk scoring is well-documented (Springer 2024 study); extends existing `analyzeDiff()` with pure functions

**Phases likely needing deeper research during planning:**
- **Phase 3 (Feedback learning):** SQL aggregation patterns are standard, but feedback loop bias mitigation strategies require careful validation. Monitor academic literature on reinforcement learning from human feedback (RLHF) pitfalls as implementation progresses. Test decay functions, threshold values, and reactor weighting formulas empirically.

**Integration research required (cross-phase):**
- Interaction between language rules and feedback suppression: ensure feedback records are keyed by `(pattern, language)` not just `(pattern)` to prevent cross-language suppression pollution
- Interaction between risk scoring and feedback: keep independent (risk scoring about the file, feedback about the finding) to avoid compounding bias
- Delta re-review + language rule versioning: store rule version in review metadata; version mismatch triggers full review mode instead of delta

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every capability verified in existing codebase; zero new dependencies required; exact line-level integration points identified |
| Features | HIGH | Grounded in XBMC real-world analysis (100 PRs, 96 review comments), competitive landscape (CodeRabbit, Qodo, Greptile), and existing codebase capabilities |
| Architecture | HIGH | All integration points identified with line numbers; follows existing "fail-open enrichment" patterns; extends proven pipelines |
| Pitfalls | MEDIUM-HIGH | Integration pitfalls HIGH confidence from codebase analysis; feedback-loop bias risks MEDIUM confidence from academic research + industry analogues |

**Overall confidence:** HIGH

### Gaps to Address

**Language rule coverage:** `LANGUAGE_GUIDANCE` currently covers 9 languages deeply (Python, Go, Rust, Java, C++, C, Ruby, PHP, Swift) and 11 at basic level. For languages outside this set, the system falls back to generic review. This is acceptable for MVP but should be explicitly disclosed in documentation. Consider adding tier labels (e.g., "Deep coverage: Python, Go, Rust; Basic coverage: JavaScript, TypeScript; No language-specific rules: Fortran").

**Risk scoring weights require empirical tuning:** The composite risk formula weights (0.35 lines changed, 0.30 path signals, 0.20 category, 0.15 churn) are informed by research but not validated against Kodiai's specific use cases. Initial weights should be configurable (`review.largePR.weights: { lines: 0.35, path: 0.30, category: 0.20, churn: 0.15 }`) and monitored via telemetry. Adjust based on post-merge incident correlation.

**Feedback threshold values need validation:** Minimum sample size (3-5 thumbs-down), reactor diversity (3+ distinct reactors), and decay function (exponential with what half-life?) are recommendations that require A/B testing or shadow mode validation. Start conservative (high thresholds, slow decay) and relax based on observed false-positive/false-negative rates.

**Formatter auto-detection scope:** Auto-detecting formatter config files (`.clang-format`, `.prettierrc`, `black.toml`) requires knowing which files to look for per language. The initial set should cover the 9 deeply-supported languages but will miss formatters for minority languages. This is acceptable; users can manually configure suppressions for unsupported formatters.

**GitHub API rate limits for reaction polling:** The existing `feedback-sync.ts` polls reactions via REST API on PR activity events. For high-volume repos (dozens of PRs per day), periodic sweeps (every 15-30 minutes for repos with active PRs) could approach rate limits. Monitor `x-ratelimit-remaining` headers and add backoff logic if needed. Consider batching reaction fetches across multiple PRs in a single API call where possible.

## Sources

### Primary (HIGH confidence)
- **Kodiai codebase analysis** (line-level integration points):
  - `src/handlers/review.ts` (1898 lines) -- full review pipeline with exact insertion points
  - `src/execution/diff-analysis.ts` (339 lines) -- `EXTENSION_LANGUAGE_MAP`, `PATH_RISK_SIGNALS`, `CONTENT_RISK_SIGNALS`, `analyzeDiff()`, `parseNumstat()`
  - `src/execution/review-prompt.ts` (1211 lines) -- `LANGUAGE_GUIDANCE`, section builders, noise suppression rules
  - `src/knowledge/store.ts` (777 lines) -- `feedback_reactions` table schema, existing SQLite patterns
  - `src/knowledge/confidence.ts` (97 lines) -- `computeConfidence()`, `matchesSuppression()`, severity/category boosts
  - `src/handlers/feedback-sync.ts` (204 lines) -- reaction polling pipeline, `isHumanThumbReaction()`, idempotent storage
  - `src/execution/config.ts` (481 lines) -- Zod schema patterns with section fallback
  - `src/learning/types.ts` (83 lines) -- `MemoryOutcome` includes `"thumbs_down"`
- **XBMC real-world analysis:**
  - `.planning/xbmc_deep_analysis.md` (100 PRs, 96 review comments)
  - `.planning/xbmc_high_comment_pr_analysis.md` (6 PRs, 450+ comments)
  - PR #27752: 312 files, humans reviewed 3 core files (large PR evidence)

### Secondary (MEDIUM confidence)
- **GitHub documentation:**
  - [Webhook events documentation](https://docs.github.com/en/webhooks/webhook-events-and-payloads) -- confirmed NO reaction webhook events (February 2026)
  - [GitHub community discussion](https://github.com/orgs/community/discussions/7168) -- reactions do not trigger webhooks
  - [Octokit reactions API](https://actions-cool.github.io/octokit-rest/api/reactions/) -- `listForPullRequestReviewComment` verified
- **Competitive intelligence:**
  - [CodeRabbit Learnings](https://docs.coderabbit.ai/guides/learnings), [Why emojis suck for RL](https://www.coderabbit.ai/blog/why-emojis-suck-for-reinforcement-learning) -- 46% bug detection accuracy, ast-grep + 35 linters
  - [Qodo Merge docs](https://qodo-merge-docs.qodo.ai/tools/review/), [Compliance](https://qodo-merge-docs.qodo.ai/tools/compliance/) -- extra instructions per language, YAML-based
  - [Greptile ZenML case study](https://www.zenml.io/llmops-database/improving-ai-code-review-bot-comment-quality-through-vector-embeddings) -- embedding clustering, 19% to 55% address rate improvement
  - [Microsoft AI code review at scale](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/) -- 600K+ PRs/month
- **Research literature:**
  - [Springer 2024 PR change impact analysis](https://link.springer.com/article/10.1007/s10664-024-10600-2) -- heuristic risk scoring effectiveness (3.66/5.0 rating)
  - [Taori et al. 2023 - Data Feedback Loops](https://arxiv.org/abs/2209.03942) -- bias amplification in systems training on own outputs
  - [Fairness Feedback Loops (FAccT 2024)](https://dl.acm.org/doi/10.1145/3630106.3659029) -- disproportionate impact on minority groups

### Tertiary (LOW confidence -- context only)
- [Code quality metrics 2026](https://www.qodo.ai/blog/code-quality-metrics-2026/) -- hotspot risk = complexity * churn * ownership (conceptual)
- [Graphite large PR prioritization](https://graphite.dev/guides/prioritize-code-reviews-large-projects) -- file risk heuristics (general guidance)
- [ESLint Node.js API](https://eslint.org/docs/latest/integrate/nodejs-api) -- fixable detection API (verified but rejected for Kodiai use case)

---

**Research completed:** 2026-02-13
**Ready for roadmap:** Yes
**Next step:** Requirements definition (roadmapper agent)
