# Feature Landscape

**Domain:** Language-aware enforcement, large PR intelligence, and feedback-driven learning for AI code review
**Researched:** 2026-02-13
**Confidence:** HIGH (grounded in XBMC real-world analysis + competitive landscape + existing codebase audit)

## Existing Foundation (Already Built)

Before defining new features, here is what Kodiai already has that these features build on:

| Existing Capability | Module | Relevance |
|---------------------|--------|-----------|
| Language classification (`classifyFileLanguage`) | `diff-analysis.ts` | Maps file extensions to 20+ languages; used for language guidance injection |
| Language guidance prompts (`LANGUAGE_GUIDANCE`) | `review-prompt.ts` | Static per-language rule sets for Python, Go, Rust, Java, C++, C, Ruby, PHP, Swift |
| File category classification (source/test/config/docs/infra) | `diff-analysis.ts` | Categorizes files by glob patterns; used in risk signals |
| Risk signal detection (auth, secrets, dependencies, DB, crypto) | `diff-analysis.ts` | Path-based and content-based risk heuristics |
| `isLargePR` flag (>200 files or >5000 lines) | `diff-analysis.ts` | Triggers "focus on most critical changes" prompt instruction |
| Suppression patterns (string, glob, regex) | `confidence.ts` | Matches finding titles with optional severity/category/path scoping |
| Feedback sync (thumbs up/down reactions) | `feedback-sync.ts` | Collects human thumb reactions on review comments, stores in knowledge store |
| Learning memory with embeddings | `learning/` | Writes findings with outcome labels, retrieves similar prior findings via Voyage Code 3 |
| Isolation layer (repo-scoped + optional owner sharing) | `learning/isolation.ts` | Enforces retrieval boundaries with provenance logging |
| Delta classification (new/resolved/still-open) | `delta-classifier.ts` | Compares current vs prior findings using FNV-1a fingerprints |
| Severity filtering (`review.severity.minLevel`) | `config.ts` | Configurable minimum severity threshold |
| Focus/ignored areas | `config.ts` | Category-level focus and exclusion with CRITICAL override |
| Confidence scoring (severity + category + known pattern) | `confidence.ts` | Deterministic confidence from -10 to +30 boosts |

---

## Table Stakes

Features users expect in this domain. Missing these makes the product feel broken or noisy.

### Language-Aware Enforcement

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Suppress linter-catchable findings** (formatting, import order, whitespace) | Every competing tool has learned this lesson. XBMC data: 10 formatting violations flagged, 0 addressed (100% noise). Users stop reading bot comments when they see style nits. CodeRabbit, Qodo, Greptile all suppress or filter these. | LOW | Existing suppression engine + `LANGUAGE_GUIDANCE`. Classify via prompt-level instructions (no linter runtime needed). |
| **Language-specific severity baselines** (e.g., C++ null deref = CRITICAL, Python bare except = MAJOR, Go unchecked error = MAJOR) | Users expect safety issues in their language to be flagged at appropriate severity. CodeRabbit, Qodo Merge, and Greptile all provide language-aware analysis. XBMC evidence: human reviewers consistently flag null deref as critical while bots flag formatting at same severity. | MEDIUM | Existing `LANGUAGE_GUIDANCE` + severity classification guidelines. Partition rules into auto-fixable vs safety-critical tiers. |
| **Per-language config surface** (`review.languageRules` in `.kodiai.yml`) | Teams need to override defaults. A C++ project using exceptions may not care about RAII; a Python data pipeline may want stricter type hint enforcement. Qodo Merge offers `extra_instructions` per language; Danger.js is entirely user-defined rules. | LOW | Existing config schema extension. |
| **CRITICAL findings never suppressed by language rules** | Safety override. No language configuration should silence SQL injection, auth bypass, or buffer overflow detection. Universal across all tools. | LOW | Hard floor in suppression logic. |

### Large PR Intelligence

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **File prioritization by risk** (review core logic first, skip mechanical callsite updates) | XBMC PR #27752: 312 files, humans reviewed 3 core files. CodeRabbit classifies diffs as trivial vs complex. Qodo Merge offers `require_can_be_split_review`. Every user expects large PRs to get focused review, not uniform noise. | HIGH | Existing `filesByCategory` + `riskSignals` from `diff-analysis.ts` |
| **Explicit coverage disclosure** ("Reviewed 50/312 files, prioritized by risk") | Users need to know what was reviewed and what was not. Incomplete review without disclosure is worse than no review. Transparency is table stakes for trust. | LOW | File prioritization (must know which files were selected) |
| **Comment budget allocation by risk** | When comment cap is 7, all 7 should go to the riskiest files, not spread evenly across trivial config changes and core logic. | LOW | File risk scoring + existing `maxComments` config |

### Feedback-Driven Learning

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Thumbs-down pattern tracking** | Every competitor learns from reactions. Greptile tracks thumbs up/down and improved address rate from 19% to 55%. This is the minimum viable feedback loop. | LOW | Already collected by `feedback-sync.ts`. New work is aggregation only. |
| **Feedback-informed suppression** (suppress patterns after N thumbs-down) | After repeated rejection of the same pattern, the system should stop flagging it. Greptile does this via embedding clustering. CodeRabbit uses explicit chat-based "Learnings." This is the expected learning behavior. | MEDIUM | Feedback aggregation by title fingerprint + suppression engine integration |
| **CRITICAL findings exempt from feedback suppression** | Same safety floor as language rules. No amount of thumbs-down should suppress SQL injection detection. | LOW | Hard floor in auto-suppression logic |

---

## Differentiators

Features that set Kodiai apart. Not universally expected, but high-value when present.

### Language-Aware Enforcement

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Post-execution severity floor enforcement** | Goes beyond "language guidance in prompt" to enforce hard severity floors that the LLM cannot override. No competitor does this deterministically -- CodeRabbit (46% accuracy) and Qodo Merge rely on LLM judgment alone. If the LLM tags a null deref as MEDIUM, Kodiai can upgrade it to CRITICAL based on language rules. | MEDIUM | Post-execution finding processing, severity normalization in `review.ts` |
| **Auto-detect formatter config files** (detect `.clang-format`, `.prettierrc`, `black.toml` in repo and auto-suppress style findings for those languages) | Eliminates an entire class of false positives automatically without user configuration. XBMC evidence: all formatting violations ignored because clang-format exists but bot did not know. No competitor auto-detects formatters. | MEDIUM | Workspace file detection in review handler |
| **Graduated language tiers** (explicitly label which languages get "deep" vs "basic" review) | Honest about coverage gaps. `LANGUAGE_GUIDANCE` already covers 9 languages deeply and 11 at basic level. Making tiers visible sets expectations and reduces surprise. | LOW | Existing `LANGUAGE_GUIDANCE` map |

### Large PR Intelligence

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Risk-weighted file scoring algorithm** (score = category_weight + lines_changed + risk_signal_bonus + extension_weight) | Goes beyond binary "large PR / not large PR" to rank every file on a numeric scale. Enables principled selection of top-N files for review. Research shows heuristic risk scoring improves review quality (Springer 2024 study, 3.66/5.0 effectiveness rating). | HIGH | Existing category + risk signal infrastructure in `diff-analysis.ts` |
| **Adaptive severity by PR size** (large PRs auto-escalate to MAJOR+ only, small PRs allow MEDIUM+) | XBMC evidence: large refactors get architectural focus from humans, small fixes get detailed review. Auto-adapting reduces noise without configuration. | MEDIUM | `isLargePR` flag, severity filter |
| **Risk heatmap in review summary** | Shows which files got most review attention and why. Builds trust that the tool is focusing correctly. No competitor surfaces the prioritization rationale. | LOW | Risk scoring data, `buildDiffAnalysisSection()` |
| **Split recommendation** for PRs exceeding threshold (>100 files or >5000 lines) | Qodo Merge has `require_can_be_split_review` but it is an add-on. Proactively recommending split before reviewing is higher value because it shapes contributor behavior. | LOW | File count + line count metrics |

### Feedback-Driven Learning

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **Feedback-weighted confidence adjustment** (patterns with consistent thumbs-up get +10 confidence; thumbs-down get -20) | Goes beyond binary suppress/allow to graduate confidence. A finding pattern with 2 thumbs-up and 0 thumbs-down should be surfaced more confidently. No competitor does graduated confidence from reactions. | MEDIUM | Existing confidence scoring in `confidence.ts`, feedback aggregation |
| **Feedback transparency in Review Details** ("3 patterns auto-suppressed based on prior feedback") | Builds trust. Teams need to know WHY a finding was suppressed. CodeRabbit's "Learnings" are inspectable; Kodiai's auto-suppression should be too. Avoids the "automatic behavior mutation" anti-pattern. | LOW | Review Details comment, suppression log |
| **Learning memory outcome update on thumbs-down** | When a finding gets thumbs-downed, update its outcome in learning memory so future embedding retrievals reflect the rejection. Prevents retrieval from surfacing previously-rejected patterns as positive evidence. | MEDIUM | Existing learning memory write path in `learning/` |
| **Embedding-based pattern clustering** (group similar downvoted findings and suppress the cluster, not just exact matches) | Greptile's key insight: "most nit comments cluster into a small number of semantic categories." Clustering catches variations that exact-match suppression misses. Their address rate went from 19% to 55% with this approach. | HIGH | Learning memory embeddings, vector similarity, threshold tuning |

---

## Anti-Features

Features to explicitly NOT build. These are commonly requested but harmful.

| Anti-Feature | Why Tempting | Why Avoid | What to Do Instead |
|--------------|-------------|-----------|-------------------|
| **AST-based language rule engine** (parse code with ast-grep or tree-sitter) | CodeRabbit integrates ast-grep with 35+ linters. Seems comprehensive. | Massive maintenance burden per language. The LLM already understands code structure. AST rules duplicate what the model does natively and add latency. CodeRabbit has 46% accuracy despite 35 linters -- proving more tools does not equal more accuracy. | Use LLM for structural analysis; enforce severity floors and suppressions post-execution. Let linter tools (eslint, clippy) run in CI separately. |
| **Run linters in workspace** (install ESLint, Ruff, Clippy in review workspace) | Deterministic linter output seems reliable. | Requires per-language toolchains. Workspace is a shallow clone with no dev dependencies. Adds 10-30s latency. Different projects use different linter configs. | Use prompt-driven classification. Claude's training knows what is auto-fixable. |
| **Auto-learning from every single emoji reaction** | "Zero config learning" sounds great. | CodeRabbit explicitly warns: "thumbs up means... what, exactly?" Ambiguous signal causes sycophantic drift. OpenAI found GPT-4o became "overly agreeable" from binary feedback. Single reactions are noisy. | Learn only from clustered patterns with minimum vote threshold (3+ unique thumbs-down). Never auto-suppress from a single reaction. |
| **Review all files in large PRs via multi-turn chunking** | "We should review everything for completeness." | Cost scales linearly: 312 files at ~$0.03/file = $9.36 per review. Latency explodes. Findings in file 280 are rarely actionable. | Prioritize by risk score, review top 50, disclose coverage. Offer `@kodiai review-all` escape hatch for explicit full-PR review. |
| **Cross-repo feedback sharing by default** | One repo's learned suppressions could help another. | One repo's "noise" might be another repo's "critical." Feedback preferences are context-dependent. Data leakage risk. | Keep feedback suppression repo-scoped. Org-level sharing is a separate, opt-in, future feature. |
| **Merge-blocking based on feedback confidence** | Teams want automation gates. | False positives in auto-learned suppressions can either block merges (frustrating) or allow bugs through (dangerous). Either outcome erodes trust. | Keep advisory mode. Show confidence and feedback history in Review Details. Let humans decide. |
| **Real-time reaction processing** | Faster learning loop seems better. | GitHub does not emit reaction-specific webhooks. Building workarounds (polling, frequent cron) adds complexity for minimal latency gain. | Sync reactions on next PR activity event (existing `feedback-sync.ts` pattern). |
| **Language-specific severity that cannot be overridden** | "We know best what's critical in C++." | Power users have valid reasons to downgrade. A team wrapping a C library may accept raw pointers deliberately. | Provide opinionated defaults but honor user overrides. Warn when overriding a safety baseline, but allow it. |
| **ML-based file risk prediction** | ML model could learn from historical review data. | Requires training data that does not exist yet. Heuristics are sufficient, debuggable, and explainable. | Use deterministic risk formula with configurable weights. |

---

## Feature Dependencies

```text
LANGUAGE-AWARE ENFORCEMENT
==========================
[Existing: LANGUAGE_GUIDANCE map in review-prompt.ts]
    |
    +-- extends --> [Language severity tiers: auto-fixable vs safety-critical]
    |                   |
    |                   +-- requires --> [Post-execution severity floor enforcement]
    |                   |
    |                   +-- optional --> [Auto-detect formatter config files in workspace]
    |
    +-- extends --> [review.languageRules config section]
                        |
                        +-- feeds --> [Language severity tier overrides]

LARGE PR INTELLIGENCE
=====================
[Existing: diff-analysis.ts (categories + risk signals + numstat)]
    |
    +-- extends --> [Per-file risk scoring formula]
    |                   |
    |                   +-- requires --> [Token-aware file budget / top-N selection]
    |                   |                     |
    |                   |                     +-- requires --> [Coverage disclosure in summary]
    |                   |
    |                   +-- optional --> [Risk heatmap in review summary]
    |                   |
    |                   +-- optional --> [Adaptive severity by PR size]
    |
    +-- optional --> [Split recommendation for oversized PRs]

FEEDBACK-DRIVEN LEARNING
=========================
[Existing: feedback-sync.ts + FeedbackReaction table in knowledge store]
    |
    +-- extends --> [Feedback aggregation query: count by title fingerprint per repo]
    |                   |
    |                   +-- requires --> [Auto-suppress rule generation when count >= threshold]
    |                   |                     |
    |                   |                     +-- integrates --> [matchesSuppression() in confidence.ts]
    |                   |
    |                   +-- feeds --> [Feedback-weighted confidence adjustment]
    |
    +-- extends --> [Learning memory outcome update on thumbs-down]
    |
    +-- extends --> [Feedback transparency in Review Details]
```

### Critical Path

1. **Language severity tiers** depend on the existing `LANGUAGE_GUIDANCE` map but need a new post-execution enforcement step (not just prompt injection)
2. **File risk scoring** depends on existing `diff-analysis.ts` infrastructure and must happen before the review prompt is built
3. **Auto-suppress** depends on feedback aggregation reaching threshold, which depends on `feedback-sync.ts` having collected enough data points

### Independence Points

- Language enforcement and large PR intelligence are **independent** -- can be built in parallel
- Language enforcement and feedback learning are **independent** -- can be built in parallel
- Large PR intelligence and feedback learning are **independent** -- can be built in parallel
- All three feature areas share no code dependencies

---

## MVP Recommendation

### Build First (P1) -- Highest ROI

1. **Language severity tiers** (auto-fixable suppression + safety-critical enforcement) -- Highest signal-to-noise improvement per line of code. XBMC data: eliminates 100% of formatting noise and ensures 100% of null deref findings are CRITICAL.
2. **File risk scoring and top-N prioritization** -- Addresses the 312-file problem directly. Without this, large PR reviews are either incomplete (truncated randomly) or noisy (uniform review of all files).
3. **Feedback auto-suppression with threshold** -- Closes the feedback loop. The infrastructure (feedback-sync.ts, FeedbackReaction table) already exists. New work is aggregation + threshold + suppression integration.
4. **Coverage disclosure** -- Required for trust once file selection is active.
5. **CRITICAL safety floor** (both language and feedback) -- Must ship with auto-suppression to prevent runaway learning.

### Build Second (P2) -- Add after P1 validated

6. **Auto-detect formatter config files** -- Refines language suppression without user configuration.
7. **Adaptive severity by PR size** -- Refines large PR noise reduction beyond file selection.
8. **Feedback-weighted confidence adjustment** -- Refines the confidence model using actual reaction data.
9. **Feedback transparency reporting** -- Makes auto-suppression auditable.
10. **Risk heatmap in review summary** -- Trust-building visibility into prioritization logic.
11. **Learning memory outcome update** -- Prevents retrieval from surfacing rejected patterns.

### Defer (P3) -- Future consideration

12. **Split recommendation** -- Low complexity but limited impact; humans already know their PR is too big.
13. **Embedding-based pattern clustering** -- Powerful but complex. Simple title-fingerprint aggregation handles 80% of cases. Add when exact-match shows insufficient coverage.
14. **Churn-aware risk scoring** -- Requires additional git commands per review. Add after basic risk scoring is validated.
15. **Auto-fixable finding grouping** -- Nice UX polish but not critical for initial release.

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Risk | Priority |
|---------|------------|------------|------|----------|
| Language severity tiers (auto-fixable/safety-critical) | HIGH | LOW | LOW | P1 |
| Suppress linter-catchable findings | HIGH | LOW | LOW | P1 |
| Post-execution severity floor enforcement | HIGH | MEDIUM | LOW | P1 |
| File risk scoring formula | HIGH | HIGH | MEDIUM | P1 |
| Top-N file selection + token budget | HIGH | MEDIUM | MEDIUM | P1 |
| Coverage disclosure in summary | HIGH | LOW | LOW | P1 |
| Comment budget allocation by risk | HIGH | LOW | LOW | P1 |
| Feedback auto-suppression with threshold | HIGH | MEDIUM | MEDIUM | P1 |
| CRITICAL findings safety floor | HIGH | LOW | LOW | P1 |
| Per-language config surface | MEDIUM | LOW | LOW | P1 |
| Auto-detect formatter config | MEDIUM | MEDIUM | LOW | P2 |
| Adaptive severity by PR size | MEDIUM | LOW | LOW | P2 |
| Feedback-weighted confidence | MEDIUM | MEDIUM | LOW | P2 |
| Feedback transparency reporting | MEDIUM | LOW | LOW | P2 |
| Risk heatmap in review summary | MEDIUM | LOW | LOW | P2 |
| Learning memory outcome update | MEDIUM | MEDIUM | LOW | P2 |
| Graduated language tier visibility | LOW | LOW | LOW | P2 |
| Split recommendation | LOW | LOW | LOW | P3 |
| Embedding-based pattern clustering | MEDIUM | HIGH | MEDIUM | P3 |
| Churn-aware risk scoring | MEDIUM | MEDIUM | LOW | P3 |
| Auto-fixable finding grouping | LOW | MEDIUM | LOW | P3 |

---

## Competitor Feature Analysis

### Language-Aware Enforcement

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **CodeRabbit** | ast-grep rules + 35 linters + LLM; auto-detects style preferences | Broadest static analysis integration; community rule library | 46% bug detection accuracy; heavy infrastructure; rule maintenance burden |
| **Qodo Merge** | Extra instructions per language; compliance checklist templates; language framework exclusion | Configurable; open-source core; YAML-based compliance | No deterministic severity enforcement; relies entirely on LLM judgment |
| **Greptile** | Full codebase indexing; semantic understanding per language | Deep context from entire repo, not just diff | Expensive compute; slower review times |
| **Danger.js** | Programmatic rules in JS/TS; no AI | Deterministic; fully controllable; zero false positives from rules | Manual rule authoring; no semantic understanding; no language awareness |
| **Kodiai (proposed)** | LLM language guidance + post-execution severity floors + configurable overrides | Best of both: LLM flexibility + deterministic enforcement; low maintenance | Severity floors only apply post-execution; cannot prevent LLM from missing issues |

### Large PR Intelligence

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **CodeRabbit** | Dual-model: trivial/complex classification; filters trivial changes | Cost-efficient (50% savings); identifies obvious low-risk changes | Binary classification (trivial vs complex) lacks granularity; 1/5 completeness score |
| **Qodo Merge** | PR compression; split detection; incremental update button | Manages large PRs progressively; suggests splitting | No file-level risk scoring; relies on user to trigger incremental review |
| **Microsoft Internal** | AI reviews 600K+ PRs/month; PR summarization; conversational follow-up | Massive scale validation; proven workflow integration | No public details on file prioritization algorithm |
| **Greptile** | Full codebase context; semantic dependency analysis | Cross-file understanding for impact analysis | Cost scales with repo size; latency concerns |
| **Kodiai (proposed)** | Risk-weighted file scoring; top-N selection; coverage disclosure; adaptive severity | Transparent prioritization; principled token budgeting; honest about coverage gaps | Heuristic scoring requires tuning; may miss important files in edge cases |

### Feedback-Driven Learning

| Tool | Approach | Strength | Weakness |
|------|----------|----------|----------|
| **CodeRabbit** | Natural language "Learnings" from chat; org/repo scoping; explicit reasoning required | High-quality signals; inspectable; team-specific | High friction (requires typing explanation, not just reacting); slow adoption |
| **Greptile** | Thumbs up/down + commit-addressed tracking; embedding clustering; team-specific filtering | Low friction; objective metric (did they actually fix it?); improved address rate 19% to 55% | Embedding infrastructure required; commit tracking is lossy |
| **Qodo Merge** | No persistent learning across PRs; extra instructions per run | Clean, no drift risk | Zero learning; same false positives repeat forever |
| **Kodiai (proposed)** | Reaction-based + title fingerprint aggregation; threshold-based auto-suppress; transparent reporting | Balanced friction (react, don't type); deterministic threshold (no drift from single reaction); auditable | Requires enough reactions to reach threshold; cold-start period per repo |

---

## Sources

### Direct Evidence (HIGH confidence)
- XBMC deep PR analysis (100 PRs, 96 review comments): `.planning/xbmc_deep_analysis.md`
- XBMC high-comment PR analysis (6 PRs, 450+ comments): `.planning/xbmc_high_comment_pr_analysis.md`
- Kodiai codebase audit: `src/execution/review-prompt.ts`, `src/execution/diff-analysis.ts`, `src/knowledge/confidence.ts`, `src/handlers/feedback-sync.ts`, `src/learning/`

### Competitive Intelligence (MEDIUM confidence)
- [CodeRabbit Learnings documentation](https://docs.coderabbit.ai/guides/learnings)
- [CodeRabbit: Why emojis suck for reinforcement learning](https://www.coderabbit.ai/blog/why-emojis-suck-for-reinforcement-learning)
- [Qodo Merge review tool documentation](https://qodo-merge-docs.qodo.ai/tools/review/)
- [Qodo Merge compliance documentation](https://qodo-merge-docs.qodo.ai/tools/compliance/)
- [Microsoft AI code review at scale](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/)
- [Greptile embedding-based comment filtering (ZenML case study)](https://www.zenml.io/llmops-database/improving-ai-code-review-bot-comment-quality-through-vector-embeddings)
- [ast-grep rule configuration](https://ast-grep.github.io/guide/rule-config.html)
- [Danger.js documentation](https://danger.systems/js/)

### Industry Analysis (LOW confidence -- used for context only)
- [Springer 2024 study on PR change impact analysis](https://link.springer.com/article/10.1007/s10664-024-10600-2)
- [CodeRabbit 2026 enterprise gap analysis](https://ucstrategies.com/news/coderabbit-review-2026-fast-ai-code-reviews-but-a-critical-gap-enterprises-cant-ignore/)
- [Qodo best AI code review tools 2026](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/)
- [GitHub webhook events -- no reaction webhooks](https://docs.github.com/en/webhooks/webhook-events-and-payloads)

---
*Feature research for: Kodiai -- Language-Aware Enforcement, Large PR Intelligence, Feedback-Driven Learning*
*Researched: 2026-02-13*
