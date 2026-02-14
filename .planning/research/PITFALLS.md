# Domain Pitfalls

**Domain:** Adding language-aware enforcement, risk-weighted file prioritization, and feedback-driven suppression to an existing LLM PR review system
**Researched:** 2026-02-13
**Confidence:** MEDIUM-HIGH (integration pitfalls are HIGH confidence from codebase analysis; feedback-loop risks are MEDIUM from academic research + industry analogues)

---

## Critical Pitfalls

Mistakes that cause rewrites, trust collapse, or silent correctness regression.

---

### Pitfall 1: Language Severity Overrides Create Rule Conflicts with Existing Config

**What goes wrong:**
Language-aware severity rules (e.g., "treat bare `except` in Python as MAJOR") interact unpredictably with the existing `review.severity.minLevel`, `review.focusAreas`, `review.ignoredAreas`, and `review.suppressions` config fields. A user sets `severity.minLevel: major` to reduce noise, but language rules promote what was previously MEDIUM to MAJOR, causing a flood of new findings. Or a suppression pattern matches a language-specific finding that should not be suppressible.

**Why it happens:**
The current system already has four layers of severity/filtering control (see `src/execution/config.ts` lines 113-151 and `src/execution/review-prompt.ts` lines 271-317): `minLevel`, `focusAreas`, `ignoredAreas`, and `suppressions`. Adding language-specific severity overrides creates a fifth layer with no defined precedence order. When these layers are injected into the prompt as separate sections, the LLM arbitrates ambiguity -- but nondeterministically.

**Consequences:**
- Users see findings they explicitly configured to suppress.
- Same PR reviewed twice produces different finding sets depending on LLM resolution of conflicting instructions.
- Users lose trust in configuration: "I set minLevel to major but still get medium findings."

**Prevention:**
- Define explicit precedence: `user config suppressions > user config severity.minLevel > language severity overrides > default severity`. Document this in config validation.
- Apply language severity overrides **before** prompt construction, not as additional prompt text. Resolve conflicts deterministically in TypeScript (in `review-prompt.ts` or a new `language-rules.ts`), not in the LLM prompt.
- Add config validation warnings when language overrides would conflict with existing severity/suppression settings. The existing `ConfigWarning` system in `config.ts` (line 275) already supports this pattern.
- Test the cross-product: for each language rule, verify it respects `minLevel`, `focusAreas`, `ignoredAreas`, and `suppressions` filters.

**Detection:**
- Finding counts spike after enabling language rules for a specific language without config changes.
- Same PR produces different finding sets on re-review with identical config.
- User complaints of "I suppressed X but it keeps appearing."

**Phase to address:**
Language-aware enforcement phase -- rule conflict resolution must be implemented before language rules ship.

---

### Pitfall 2: Language Rules Over-Tuned to One Language Degrade Others

**What goes wrong:**
The `LANGUAGE_GUIDANCE` map in `review-prompt.ts` (line 14) is manually curated and currently covers Python, Go, Rust, Java, C++, C, Ruby, PHP, and Swift. When the team adds severity overrides or additional rules for the most-used language (e.g., TypeScript), the prompt grows significantly for that language, biasing the LLM to spend more attention budget on TypeScript-specific patterns and less on other languages in mixed-language PRs. Result: TypeScript findings improve but Go/Rust findings regress in quality.

**Why it happens:**
LLM attention allocation is roughly proportional to prompt section length. Existing `MAX_LANGUAGE_GUIDANCE_ENTRIES = 5` caps the number of languages but not the total token budget per language. If one language profile has 15 rules and another has 3, the LLM weight shifts.

**Consequences:**
- Mixed-language PRs (e.g., TypeScript + Go) show thorough TypeScript analysis but shallow Go analysis.
- Minority languages in a repo get progressively worse reviews as majority-language rules expand.
- False sense of "language-aware" when only one language actually benefits.

**Prevention:**
- Cap per-language guidance to a fixed token budget (e.g., 500 tokens per language), not just entry count. Truncate least-important rules per language when budget exceeded.
- Weight guidance presentation by file count in the current PR: language with more changed files gets more guidance budget. The `filesByLanguage` data from `analyzeDiff()` already provides this (line 283 of `diff-analysis.ts`).
- Add per-language recall metrics: track finding-count-per-file-count-per-language. Alert when one language's ratio drops below a threshold relative to others.
- For mixed-language PRs, consider a two-pass strategy for critical languages if prompt budget allows.

**Detection:**
- Per-language finding rates diverge significantly (e.g., 2x findings/file for TypeScript vs Go in same repo).
- Adding rules for language A correlates with declining finding quality for language B (track via feedback reactions per language).
- User feedback skews negative for minority-language findings.

**Phase to address:**
Language-aware enforcement phase -- implement token budgeting per language from the start.

---

### Pitfall 3: Feedback-Driven Suppression Creates Silent False-Negative Amplification

**What goes wrong:**
Thumbs-down reactions on findings feed into learning memory (via `feedback_reactions` table, `src/knowledge/store.ts`) and eventually suppress similar findings. But thumbs-down does not mean "this finding category is always wrong" -- it means "this specific instance was not actionable in this context." The system generalizes a contextual signal into a category-level suppression, progressively silencing valid findings. Over time, security and concurrency findings (which are often dismissed as "too noisy" or "won't fix now") get suppressed to near-zero.

**Why it happens:**
This is a well-documented feedback loop bias amplification pattern (see Taori et al., 2023, "Data Feedback Loops: Model-driven Amplification of Dataset Biases"). In code review specifically: developers dismiss hard-to-fix findings more than easy-to-fix ones, creating a selection bias where the learning system interprets "hard to fix" as "wrong." The existing `MemoryOutcome` type in `src/learning/types.ts` (line 1) distinguishes `thumbs_up` / `thumbs_down` / `accepted` / `suppressed`, but if retrieval context includes too many `thumbs_down` outcomes for a pattern, the LLM will avoid flagging that pattern -- even when it is a genuine defect.

**Consequences:**
- Security findings decline over time while defect escape rate rises.
- "The bot got quieter" appears positive but masks regression.
- Hard to detect because the metric being tracked (noise reduction) improves while the metric that matters (defect detection) degrades.
- Recovery requires rebuilding trust in the suppressed categories, which takes months.

**Prevention:**
- **Non-negotiable category floors:** Never let feedback suppress findings below a per-category minimum. For `security` and `correctness`, set a floor (e.g., minimum 2 findings per 1000 LOC changed, regardless of feedback history). Kodiai already has `CATEGORY_BOOST` in `confidence.ts` (line 31) that gives security +15 and correctness +10 -- extend this to a hard floor.
- **Decay feedback signals over time:** A thumbs-down from 6 months ago should carry less weight than one from this week. Apply exponential decay to feedback retrieval scores.
- **Require minimum sample size before suppression:** Do not auto-suppress based on < N thumbs-down (e.g., N=5). A single thumbs-down should never trigger suppression.
- **Separate "collect" from "act":** The existing `LEARN-05` constraint (v0.4 captures feedback but does not change behavior) is correct. When v0.5+ acts on feedback, gate changes behind explicit config (`review.learning.autoSuppression: true`), default OFF.
- **Monitor escape rate:** Track post-merge incidents per category. If security findings drop 50% but security incidents stay flat, the suppression is masking real defects.

**Detection:**
- Sharp decline in finding counts for a category with no corresponding codebase architecture change.
- Thumbs-down / thumbs-up ratio heavily skewed toward certain categories (security, concurrency).
- Post-merge defect rate stable or rising while bot finding rate drops.
- Feedback corpus dominated by one or two prolific reactors (suggests gaming).

**Phase to address:**
Feedback-driven learning phase -- implement floors and decay before enabling any auto-suppression behavior.

---

### Pitfall 4: Risk-Weighted File Prioritization Drops Critical Files in Large PRs

**What goes wrong:**
When a PR exceeds the token/file budget (`MAX_ANALYSIS_FILES = 200` in `diff-analysis.ts`, line 3), the system must choose which files to analyze. A naive risk-scoring approach (e.g., prioritize `auth/*`, deprioritize `test/*`) causes the system to consistently skip certain file categories. In practice: (1) test files get deprioritized, but test regressions cause production incidents; (2) config files get deprioritized, but `.github/workflows/*.yml` changes can introduce CI vulnerabilities; (3) new files without history get low risk scores but are where novel bugs live.

**Why it happens:**
The existing `PATH_RISK_SIGNALS` in `diff-analysis.ts` (lines 120-167) already identify high-risk paths (auth, secrets, dependencies, migrations). But file prioritization inverts this: instead of "flag these as risky" (additive), it becomes "skip everything else" (subtractive). The risk model was designed for annotation, not selection.

**Consequences:**
- Critical bugs in deprioritized files are never seen by the reviewer.
- Users discover the tool missed a serious issue in a file it chose to skip, destroying trust.
- "Large PR" label becomes an excuse for incomplete review rather than a trigger for deeper scrutiny.

**Prevention:**
- **Never fully skip files:** Use a tiered approach: high-risk files get full analysis, medium-risk get abbreviated analysis (summary-only), low-risk get mention-only ("N files in category X were not individually reviewed"). Zero files should be invisible.
- **Always analyze new files:** Files with no prior review history (new additions) should get medium priority regardless of risk score. Novel code is where novel bugs live.
- **Preserve category coverage:** Ensure at least one file from each file category (source, test, config, docs, infra) is analyzed, even in the abbreviated tier. The `filesByCategory` data from `analyzeDiff()` already provides this breakdown.
- **Show the user what was skipped:** When files are deprioritized, explicitly list them in the review summary: "The following N files were reviewed at reduced depth due to PR size: [list]." Transparency preserves trust.
- **Cap deprioritization, not analysis:** Instead of hard file limits, use token budgets that allow partial analysis of all files rather than full analysis of some and zero analysis of others.

**Detection:**
- Post-merge bugs consistently in file categories that the system deprioritized.
- Users report "the bot didn't look at [file]" for files in the PR.
- Test file coverage in reviews drops to near-zero for large PRs.

**Phase to address:**
Large PR intelligence phase -- tiered analysis must be the design from the start, not bolted on.

---

### Pitfall 5: Feedback Spam and Gaming Pollutes the Learning Corpus

**What goes wrong:**
A single disgruntled developer (or an automated bot account that slipped through filtering) mass-reacts thumbs-down to all Kodiai findings, injecting a large negative signal into the learning corpus. Alternatively, a developer thumbs-ups all findings to boost their perceived importance, skewing the corpus in the opposite direction. The current `isHumanThumbReaction` filter in `feedback-sync.ts` (line 53) blocks bot accounts but not humans acting in bad faith.

**Why it happens:**
GitHub reactions are cheap (no commit, no review, just a click). The `UNIQUE(repo, comment_id, reaction_id)` constraint prevents duplicate reactions but not mass reactions from one user. No rate limiting exists on the reactor side, only on the ingestion side (`maxCandidates` in `feedback-sync.ts`, line 39).

**Consequences:**
- One actor can significantly skew the feedback corpus for an entire repository.
- If auto-suppression is enabled, this directly translates to suppressed categories.
- Difficult to distinguish "legitimate widespread disagreement" from "one person gaming the system."

**Prevention:**
- **Per-reactor weighting:** Weight each reactor's feedback inversely to their total reaction count. A developer who reacts to 3 findings carries more signal than one who reacts to 300. Cap any single reactor's influence at a maximum percentage of total feedback (e.g., 20%).
- **Reactor diversity threshold:** Require thumbs-down from >= N distinct reactors before counting a pattern as suppression-worthy. Single-reactor signals should be logged but not acted upon.
- **Anomaly detection:** Flag reactors whose thumbs-down rate exceeds 2 standard deviations from the repo mean. Alert operators, do not auto-act.
- **Immutable audit trail:** The existing `feedback_reactions` table stores `reactor_login`, `reacted_at`, and `reaction_content` -- use this for anomaly queries. Add a periodic integrity check that counts reactions per reactor and flags outliers.

**Detection:**
- One `reactor_login` accounts for > 30% of all thumbs-down reactions in a repo.
- Sudden spike in thumbs-down reactions across many findings in a short time window.
- Feedback corpus coverage (distinct comment IDs with reactions) grows much faster than organic PR activity would explain.

**Phase to address:**
Feedback-driven learning phase -- reactor weighting and diversity thresholds before any auto-suppression.

---

## Moderate Pitfalls

Mistakes that cause significant rework or user frustration but are recoverable.

---

### Pitfall 6: Language Rules in Prompt Conflict with Existing Noise Suppression Rules

**What goes wrong:**
The `buildNoiseSuppressionRules()` function (line 171 of `review-prompt.ts`) explicitly tells the LLM: "NEVER flag style-only issues." But language-specific guidance often includes style-adjacent rules (e.g., "type hint consistency" for Python, "missing `[weak self]`" for Swift). The LLM receives contradictory instructions: "never flag style issues" vs "check for type hint consistency." It resolves this nondeterministically, sometimes flagging type hints as `style/minor` (which gets suppressed) and sometimes as `correctness/medium` (which passes).

**Prevention:**
- Categorize each language rule explicitly: tag it as `correctness`, `security`, or `performance` in the rule definition itself, not just in the guidance text. The `LANGUAGE_GUIDANCE` map should become `LANGUAGE_RULES: Record<string, Array<{rule: string, category: FindingCategory, minSeverity: FindingSeverity}>>`.
- Update noise suppression to reference the categorized rules: "style-only issues EXCEPT language-specific rules tagged as correctness or above."
- Test each language rule in isolation: given a synthetic diff, does the rule produce findings in the expected category?

**Detection:**
- Language-specific findings oscillate between `style` and `correctness` category across reviews.
- Suppression rates for language-specific findings are inconsistent (50% suppressed on one PR, 0% on the next).

**Phase to address:**
Language-aware enforcement phase -- structured rule definitions rather than free-text guidance.

---

### Pitfall 7: Risk Scoring Becomes a Black Box Users Cannot Debug

**What goes wrong:**
The risk-weighted file prioritization algorithm assigns scores to files, but users cannot see why a file was prioritized or deprioritized. When the system misses a finding in a deprioritized file, the user has no recourse except "turn off prioritization" or "make the PR smaller."

**Why it happens:**
Risk scoring internals (path patterns, content signals, language weights) are implementation details. The existing `riskSignals` array in `DiffAnalysis` (line 78 of `diff-analysis.ts`) is used for prompt annotation but not for user-facing explanations.

**Prevention:**
- Expose risk scores in the review details comment. The existing `formatReviewDetailsSummary` function in `review.ts` already renders a details block -- add a "File prioritization" section showing top/bottom files and their scores.
- Provide config override: `review.prioritization.alwaysAnalyze: ["**/auth/**", "**/*.yml"]` to let users force-include files regardless of risk score.
- Log risk scores at debug level for operator troubleshooting (existing `pino` logger supports this).

**Detection:**
- Users file issues like "bot missed a critical file" without understanding why.
- Users disable prioritization entirely rather than tuning it.

**Phase to address:**
Large PR intelligence phase -- transparency built into the first implementation.

---

### Pitfall 8: Feedback Collection Latency Creates Stale Learning Context

**What goes wrong:**
The current feedback-sync design (in `feedback-sync.ts`) triggers on unrelated PR events (opened, ready_for_review, etc.) and polls reactions for recent findings. If a developer reacts to a finding 5 minutes after the review, the reaction is not captured until the next triggering event -- which might be hours or days later, or never if the PR is merged and no new events fire. By the time the reaction is captured, the learning context for the next review may already be stale.

**Why it happens:**
GitHub does not provide a `reaction.created` webhook (verified in Phase 29 research). The current event-triggered sync is a workaround, but its latency depends entirely on the cadence of other webhook events for the same repo.

**Prevention:**
- Add a periodic sweep (e.g., every 15-30 minutes) for repos with active PRs, in addition to event-triggered sync. Use the existing `jobQueue` for scheduling.
- For auto-suppression purposes, batch feedback processing on a schedule (e.g., nightly) rather than real-time. This adds a deliberate delay that prevents reactive gaming and ensures feedback is collected from the full lifecycle of a PR (open -> review -> merge).
- Accept and document the latency: "Feedback is incorporated within 24 hours of reaction." This sets expectations and prevents surprise.

**Detection:**
- Feedback reactions captured timestamps (`reacted_at` vs `created_at` in `feedback_reactions` table) show multi-day gaps.
- Learning context for next review does not include recent feedback from the same PR.

**Phase to address:**
Feedback capture enhancement -- add periodic sweep before enabling feedback-driven behavior changes.

---

### Pitfall 9: Language Detection Misclassifies Files Leading to Wrong Rules

**What goes wrong:**
The `EXTENSION_LANGUAGE_MAP` in `diff-analysis.ts` (line 9) maps file extensions to languages. But extension-based classification fails for: (1) `.h` files (could be C or C++), (2) `.jsx`/`.tsx` files in projects using both React and React Native with different patterns, (3) files without extensions (e.g., `Makefile`, `Dockerfile`), (4) polyglot files (e.g., `.vue` files containing TypeScript, HTML, and CSS). Wrong classification means wrong language rules applied, producing false positives.

**Prevention:**
- Use content-based heuristics as tiebreaker for ambiguous extensions (`.h` -> check for `class` keyword, `#include` patterns vs C-style function declarations).
- Allow user override in config: `review.languageOverrides: {".h": "C++"}`.
- For known polyglot formats (`.vue`, `.svelte`), either apply rules from all contained languages or apply only the dominant language's rules.
- The existing `classifyFileLanguage` function already returns `"Unknown"` for unmapped extensions -- ensure that unknown-language files get no language-specific rules rather than random rules.

**Detection:**
- Findings cite language-specific patterns for the wrong language (e.g., Python mutable default argument check on a Go file).
- User reports false positives that only make sense if the file was misclassified.

**Phase to address:**
Language-aware enforcement phase -- classification accuracy before rule application.

---

### Pitfall 10: Incremental Re-Review + Language Rules = Inconsistent Findings Across Runs

**What goes wrong:**
First review uses language rules version A. User pushes a small fix. Incremental re-review uses language rules version B (because rules were updated between runs). Delta classifier (`delta-classifier.ts`) compares findings across runs but cannot distinguish "finding disappeared because code was fixed" from "finding disappeared because rule was removed/changed." Result: the delta summary shows findings as "resolved" that were actually just re-classified or dropped by a rule change.

**Why it happens:**
The `classifyFindingDeltas` function (line 67 of `delta-classifier.ts`) uses `filePath:titleFingerprint` composite keys. If a language rule change alters the title or severity of a finding, the fingerprint changes, making the old finding appear "resolved" and the new version appear "new" -- even though the underlying code is identical.

**Prevention:**
- Version language rules and include the version in review metadata (stored in `config_snapshot` field of the `reviews` table).
- When rule versions differ between prior and current review, downgrade from delta mode to full review mode. The existing `deltaContext` null-check in `buildReviewPrompt` (line 829 of `review-prompt.ts`) already supports this -- add a rule-version mismatch check.
- Alternatively: normalize finding fingerprints to be rule-version-independent by hashing only the code location and defect class, not the specific rule title.

**Detection:**
- Delta summaries show many "resolved" findings immediately after a language rule update with no corresponding code changes.
- Users report "the bot says it's fixed but I didn't change anything."

**Phase to address:**
Language-aware enforcement phase AND delta re-review phase -- coordinate rule versioning with delta classification.

---

## Minor Pitfalls

Mistakes that cause friction but are quickly fixable.

---

### Pitfall 11: Language Rules Expand Prompt Beyond Token Budget

**What goes wrong:**
Adding language-specific guidance for 5 languages in a mixed-language monorepo PR expands the system prompt significantly. The current `buildLanguageGuidanceSection` (line 729 of `review-prompt.ts`) caps at `MAX_LANGUAGE_GUIDANCE_ENTRIES = 5` languages but does not cap total token length. With severity overrides and additional rules per language, the language guidance section can consume 2000+ tokens, crowding out other sections (suppression rules, retrieval context, path instructions) and reducing finding quality for the non-language-specific review.

**Prevention:**
- Set a hard token budget for the language guidance section (e.g., 800 tokens max).
- Prioritize language sections by file count (already sorted by `b[1].length - a[1].length` on line 735) and truncate lower-priority languages when budget exceeded.
- Move detailed language rules to a reference lookup rather than prompt inclusion: "For Python-specific rules, see [internal rule ID]" with the full rules available via tool use.

**Detection:**
- Total prompt length grows beyond expected bounds for mixed-language PRs.
- Review quality for general findings (security, correctness) drops in mixed-language PRs vs single-language PRs.

**Phase to address:**
Language-aware enforcement phase -- token budgeting from the start.

---

### Pitfall 12: Risk Score Gamification via PR Structure

**What goes wrong:**
Developers learn that the risk scoring algorithm deprioritizes certain file patterns (e.g., test files, docs) and start putting questionable code in those locations to avoid scrutiny. For example: security-sensitive logic in a file named `test_helpers.go` or configuration with credentials in a file matching the docs pattern.

**Prevention:**
- Risk scoring should boost (annotate for attention) not degrade (skip). The fundamental framing should be "high-risk files get extra attention" not "low-risk files get less attention."
- Content-based risk signals (the `CONTENT_RISK_SIGNALS` in `diff-analysis.ts` line 169) should override path-based deprioritization. A test file containing `crypto` or `auth` patterns should be flagged regardless of its path category.
- Include all files in the basic analysis; only reduce depth for truly low-risk files (pure docs, pure formatting).

**Detection:**
- Security findings appearing in file categories typically marked as low-risk.
- Discrepancy between path-based risk score and content-based risk signals.

**Phase to address:**
Large PR intelligence phase -- content signals override path heuristics.

---

### Pitfall 13: Feedback Reactions on Resolved Threads Create Noise

**What goes wrong:**
A developer resolves a review comment thread (accepting the finding) and later another team member thumbs-down the same finding (disagreeing with the original review). Both signals enter the feedback corpus. The learning system now has conflicting signals for the same finding: one implicit accept (thread resolved) and one explicit reject (thumbs-down).

**Prevention:**
- Define signal hierarchy: explicit reactions (thumbs-up/down) > implicit signals (thread resolved/unresolved). When both exist, explicit wins.
- Only count reactions within a time window relative to the finding creation (e.g., within 7 days). Late reactions may reflect changed context, not disagreement with the finding.
- Store both signals but use only the most recent explicit reaction per finding for learning purposes.

**Detection:**
- Same `finding_id` in `feedback_reactions` has both `+1` and `-1` from different reactors.
- Feedback corpus has conflicting signals for the same pattern fingerprint.

**Phase to address:**
Feedback-driven learning phase -- signal resolution before learning application.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Language-aware enforcement | Rule precedence conflicts with existing config (Pitfall 1) | CRITICAL | Deterministic resolution in TypeScript, not LLM prompt |
| Language-aware enforcement | Over-tuning to dominant language (Pitfall 2) | MODERATE | Per-language token budget proportional to file count |
| Language-aware enforcement | Conflict with noise suppression (Pitfall 6) | MODERATE | Structured rule definitions with explicit categories |
| Language-aware enforcement | File misclassification (Pitfall 9) | MODERATE | Content-based tiebreaker, user override config |
| Language-aware enforcement | Prompt token bloat (Pitfall 11) | MINOR | Hard token budget for language section |
| Language-aware enforcement | Delta inconsistency across rule versions (Pitfall 10) | MODERATE | Version rules, fall back to full review on mismatch |
| Large PR file prioritization | Dropping critical files (Pitfall 4) | CRITICAL | Tiered analysis: full/abbreviated/mention -- never invisible |
| Large PR file prioritization | Black-box scoring (Pitfall 7) | MODERATE | Expose scores in review details, allow user overrides |
| Large PR file prioritization | Score gamification (Pitfall 12) | MINOR | Content signals override path heuristics |
| Feedback-driven suppression | False-negative amplification (Pitfall 3) | CRITICAL | Category floors, decay, minimum sample size, separate collect from act |
| Feedback-driven suppression | Corpus gaming/spam (Pitfall 5) | CRITICAL | Per-reactor weighting, diversity thresholds, anomaly detection |
| Feedback-driven suppression | Collection latency (Pitfall 8) | MODERATE | Periodic sweep, batch processing, documented SLA |
| Feedback-driven suppression | Conflicting signals (Pitfall 13) | MINOR | Signal hierarchy, time-window filtering |

## Integration Pitfalls: Feature Interactions

These pitfalls emerge from the interaction between the three features, not from any single feature in isolation.

| Interaction | What Goes Wrong | Prevention |
|-------------|----------------|------------|
| Language rules + feedback suppression | Thumbs-down on a Python-specific finding suppresses the same pattern for Go (where it is valid) because the learning corpus does not partition by language | Key feedback records by `(pattern, language)` not just `(pattern)`. The `file_path` field in `feedback_reactions` enables this -- extract language from path at query time. |
| Risk scoring + language rules | High-risk file in an unsupported language gets boosted priority but receives no language-specific guidance, creating a false sense of thorough review | When a file is prioritized by risk but its language has no rules, annotate the review: "This file was flagged as high-risk but has no language-specific analysis available." |
| Risk scoring + feedback | Files in categories that receive frequent thumbs-down get deprioritized by the risk model (double penalty) | Keep risk scoring independent of feedback signals. Risk scoring is about the file; feedback is about the finding. Mixing them creates compounding bias. |
| Language rules + delta re-review + feedback | A language rule change causes a finding to appear "new" in delta mode (Pitfall 10), and the "new" finding gets immediate thumbs-down (because the user already saw it last review), amplifying suppression for that pattern | When delta classification detects a rule-version mismatch, annotate "new" findings as "reclassified" and exclude reclassified findings from feedback learning. |
| All three features + existing suppression config | User has `suppressions: ["unused import"]` in config, language rules promote some unused imports to MEDIUM severity, risk scoring includes the file, and a prior thumbs-down exists. Four systems interact to determine whether this finding appears. | Define a single resolution pipeline with deterministic stages: (1) apply config suppressions, (2) apply language severity overrides, (3) apply risk-weighted inclusion, (4) apply feedback-based confidence adjustment. Each stage's output feeds the next. Document the pipeline so users can reason about outcomes. |

## Pitfall-to-Phase Mapping

| Pitfall | ID | Severity | Prevention Phase | Verification Criteria |
|---------|----|----------|------------------|-----------------------|
| Rule precedence conflicts | P1 | CRITICAL | Language enforcement | Cross-product test: each language rule respects minLevel, focusAreas, ignoredAreas, suppressions. Zero config violations in test matrix. |
| Over-tuning to dominant language | P2 | MODERATE | Language enforcement | Per-language finding rate variance < 2x across languages with > 10 files in golden corpus. |
| False-negative amplification | P3 | CRITICAL | Feedback learning | Category floors enforced: security and correctness findings never drop below floor despite feedback. Replay test with 100% thumbs-down still produces floor-level findings. |
| Dropping critical files | P4 | CRITICAL | Large PR intelligence | Every file in PR appears in at least one analysis tier (full/abbreviated/mention). Zero invisible files in test corpus. |
| Feedback spam/gaming | P5 | CRITICAL | Feedback learning | Single-reactor influence capped at 20% of corpus weight. Anomaly detection flags reactors at > 2 sigma from mean. |
| Noise suppression conflict | P6 | MODERATE | Language enforcement | Each language rule has explicit category tag. No rule produces findings in `style` category unless explicitly tagged. |
| Black-box risk scoring | P7 | MODERATE | Large PR intelligence | Review details comment includes file prioritization breakdown. Config allows `alwaysAnalyze` path overrides. |
| Feedback latency | P8 | MODERATE | Feedback capture | Feedback reactions captured within 30 minutes of reaction for repos with active PRs. Periodic sweep operational. |
| Language misclassification | P9 | MODERATE | Language enforcement | Ambiguous extensions (`.h`, `.jsx`) produce correct classification in > 95% of test corpus files. |
| Delta inconsistency | P10 | MODERATE | Language enforcement + delta | Rule version stored in review metadata. Version mismatch triggers full review mode, not delta. |
| Prompt token bloat | P11 | MINOR | Language enforcement | Language guidance section stays under 800 tokens for PRs with <= 5 languages. |
| Score gamification | P12 | MINOR | Large PR intelligence | Content-based risk signals override path-based deprioritization in test cases (e.g., crypto code in test file is flagged). |
| Conflicting feedback signals | P13 | MINOR | Feedback learning | Most recent explicit reaction wins. Late reactions (> 7 days) excluded from learning. |

## Prioritized Risk Register

| Priority | Pitfall | Impact | Probability | Rationale |
|----------|---------|--------|-------------|-----------|
| P0 | False-negative amplification (P3) | Very High | High | Directly undermines the tool's core value proposition; hardest to detect and recover from |
| P0 | Dropping critical files in large PRs (P4) | Very High | High | Visible trust-destroying failure; users will immediately notice and lose confidence |
| P0 | Rule precedence conflicts (P1) | High | High | Config already has 4 layers; adding a 5th without precedence rules is almost certain to cause conflicts |
| P1 | Feedback corpus gaming (P5) | Very High | Medium | High impact if it happens; medium probability because it requires intentional bad-faith action |
| P1 | Over-tuning to dominant language (P2) | High | Medium | Likely in mixed-language repos; detectable with metrics but easy to miss without them |
| P1 | Delta inconsistency across rule versions (P10) | High | Medium | Guaranteed to happen on first rule update; moderate impact per incident but erodes trust cumulatively |
| P2 | Noise suppression conflict (P6) | Medium | High | LLM resolves the conflict differently each time; annoying but not dangerous |
| P2 | Black-box risk scoring (P7) | Medium | High | Missing transparency is a UX problem, not a correctness problem; recoverable |
| P2 | Feedback collection latency (P8) | Medium | Medium | Learning context is slightly stale; acceptable if documented and expectations set |
| P3 | Language misclassification (P9) | Medium | Low | Most projects use unambiguous extensions; edge cases are fixable with overrides |
| P3 | Prompt token bloat (P11) | Low | Medium | Detectable via prompt size monitoring; fixable with truncation |
| P3 | Score gamification (P12) | Low | Low | Requires deliberate effort by developers; content signals mitigate |
| P3 | Conflicting feedback signals (P13) | Low | Medium | Noisy but small scale; signal hierarchy resolves most cases |

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| False-negative amplification (P3) | HIGH | (1) Disable auto-suppression immediately, (2) Audit feedback corpus for category distribution skew, (3) Apply category floors retroactively, (4) Re-review recent PRs in shadow mode to measure what was suppressed, (5) Rebuild trust with users by publishing transparency report |
| Dropping critical files (P4) | MEDIUM | (1) Add tiered analysis immediately, (2) Re-review affected large PRs with full file coverage, (3) Publish which files were previously skipped |
| Rule precedence conflicts (P1) | MEDIUM | (1) Move conflict resolution from LLM prompt to deterministic TypeScript, (2) Add config validation warnings, (3) Re-run affected reviews with fixed precedence |
| Feedback corpus gaming (P5) | HIGH | (1) Quarantine suspect reactor's feedback, (2) Recalculate learning corpus without quarantined data, (3) Add reactor weighting and diversity thresholds, (4) Consider requiring "reason" field for thumbs-down in future |
| Delta inconsistency (P10) | LOW | (1) Add rule version to review metadata, (2) Trigger full review on version mismatch, (3) No need to fix historical data -- delta classification is ephemeral |

## Sources

### Primary (HIGH confidence)
- Kodiai codebase analysis: `src/execution/review-prompt.ts` (language guidance, noise suppression, severity filtering, prompt construction), `src/execution/diff-analysis.ts` (risk signals, file categorization, language classification), `src/execution/config.ts` (review config schema with severity/suppression/focus controls), `src/knowledge/confidence.ts` (severity/category boost scores, suppression matching), `src/handlers/feedback-sync.ts` (reaction ingestion, human filtering), `src/learning/types.ts` (memory outcomes), `src/lib/delta-classifier.ts` (delta classification logic), `src/lib/finding-dedup.ts` (fingerprint-based dedup)
- Phase 29 feedback capture research: `.planning/phases/29-feedback-capture/29-RESEARCH.md` (webhook limitations, correlation design)

### Secondary (MEDIUM confidence)
- [Taori et al., 2023 - Data Feedback Loops: Model-driven Amplification of Dataset Biases](https://arxiv.org/abs/2209.03942) -- bias amplification in systems that train on their own outputs
- [Fairness Feedback Loops: Training on Synthetic Data Amplifies Bias (FAccT 2024)](https://dl.acm.org/doi/10.1145/3630106.3659029) -- feedback loop bias amplification with disproportionate impact on minority groups
- [State of AI Code Review Tools 2025](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) -- false positive rates, detection accuracy benchmarks (CodeRabbit 46%, Graphite 18%)
- [ESLint rule configuration and precedence](https://eslint.org/docs/latest/use/configure/rules) -- severity override precedence patterns
- [SonarQube rule severity configuration](https://docs.sonarsource.com/sonarqube/latest/user-guide/rules/overview/) -- language-specific rule filtering and severity override patterns
- [Greptile feedback learning](https://www.greptile.com/what-is-ai-code-review) -- thumbs-up/down reaction-based learning in production code review tools

### Tertiary (LOW confidence)
- [CodeRabbit false positive management](https://www.coderabbit.ai/) -- claims to filter false positives from 40+ linters; specific mechanism not documented publicly
- General feedback loop literature from recommender systems applied by analogy to code review context

---
*Pitfalls research for: Kodiai -- Language-Aware Enforcement, Large PR Intelligence, and Feedback-Driven Learning*
*Researched: 2026-02-13*
*Supersedes: 2026-02-12 v0.5 pitfalls research (broader scope)*
