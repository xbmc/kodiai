# Domain Pitfalls: Intelligent Review System

**Domain:** Adding intelligent review capabilities to an existing LLM-powered code review GitHub App
**Researched:** 2026-02-11
**Confidence:** HIGH (verified against codebase inspection, industry research, real-world data from AI code review tools)

---

## Critical Pitfalls

Mistakes that cause user abandonment, require significant rework, or break the existing working system.

### Pitfall 1: False Positive Flood Destroys Trust (The Cardinal Sin)

**What goes wrong:**
Adding multi-category issue detection with severity scoring causes the review to surface far more findings than the current system. Where the existing prompt-driven review might post 2-3 inline comments on a PR, an "intelligent" review scanning for security, performance, maintainability, and logic issues across multiple categories will post 10-15 comments per PR. Most of these are low-confidence findings the LLM generates to be thorough. Developers start ignoring ALL comments, including the genuine critical issues buried in the noise.

Industry data confirms this is the primary failure mode: studies show up to 40% of AI code review alerts get ignored. Only 18% of AI review feedback results in actual code changes (Jellyfish, 2025). Tools that flood PRs with comments get turned off -- not tuned.

**Why it happens:**
- LLMs are reluctant to deprioritize findings -- they err on the side of reporting everything rather than risk missing something (HN discussion: "LLMs are reluctant to risk downplaying the severity of an issue")
- Multi-category detection multiplies findings multiplicatively -- each new category (security, performance, maintainability, concurrency) adds its own false positives
- Severity scoring sounds good in theory but LLMs consistently over-classify findings as "medium" or "high" because under-classifying feels riskier
- The current prompt already instructs "ONLY report actionable issues" but adding structured categories gives the model more "slots" to fill

**Consequences:**
- Developers disable the bot entirely (catastrophic -- worse than no intelligent review at all)
- Critical real issues get buried under cosmetic suggestions
- Review comments become background noise nobody reads
- PR merge velocity slows as developers manually dismiss bot comments
- Trust erosion is nearly irreversible -- once users learn to ignore the bot, re-earning trust takes months

**Prevention:**
1. **Start with FEWER categories than planned, not more.** Launch with only the categories the current system already covers (bugs, security, error handling) and add new categories one at a time with measurement.
2. **Hard cap on comments per PR.** The system MUST enforce a maximum (e.g., 5 inline comments) regardless of how many issues the analysis finds. Force the model to prioritize.
3. **Default to strict precision over recall.** It is better to miss 3 real issues than to report 10 false positives. Users can always increase sensitivity; they rarely decrease it.
4. **Measure dismissal rate from day one.** Track how many bot comments get resolved without changes vs. with changes. If dismissal rate exceeds 50%, the system is too noisy.
5. **Use the existing `review.prompt` config field for per-repo tuning** rather than building a complex category enable/disable matrix.

**Detection:**
- More than 5 comments per PR on average
- Users resolving bot comments without making changes
- Users adding `review.enabled: false` to their `.kodiai.yml`
- Declining ratio of "changes made after review" over time

**Warning signs during development:**
- Test PRs consistently generating 8+ comments
- Difficulty getting the model to NOT report a finding it detected
- Severity scoring clustering everything at "medium"

**Phase to address:** Must be the FIRST design constraint, not an afterthought. Every feature in the intelligent review milestone should be evaluated against "does this increase false positive risk?"

---

### Pitfall 2: Prompt Complexity Explosion (The Mega-Prompt Trap)

**What goes wrong:**
The current review prompt in `buildReviewPrompt()` is ~190 lines and works well. Adding multi-category detection, severity scoring, repo-specific conventions, and configurable review modes requires embedding structured instructions for each category, scoring rubrics, output format requirements, and conditional logic into the prompt. The prompt balloons to 500+ lines. At this size, the LLM starts ignoring or misinterpreting instructions. Conflicting instructions (e.g., "be thorough" vs. "minimize false positives") cause inconsistent behavior.

**Why it happens:**
- Each new feature adds prompt instructions: category definitions (~50 lines), severity rubrics (~30 lines), output format (~40 lines), repo conventions (~variable), configurable modes (~30 lines per mode)
- Prompt instructions interact in unexpected ways -- "focus on security" + "minimize noise" creates ambiguity about whether to report a low-confidence security finding
- LLMs have finite attention; instructions at the end of a long prompt get less weight than those at the beginning
- Conditional prompt assembly (if strict mode, add X; if lenient, add Y) creates a combinatorial testing problem

**Consequences:**
- Non-deterministic review behavior: same PR gets different reviews on re-run
- Model ignores later instructions in favor of earlier ones (recency/primacy bias)
- Impossible to debug why a specific comment was or was not generated
- Testing becomes intractable -- cannot test every prompt variant

**Prevention:**
1. **Keep the core prompt under 200 lines.** The current prompt length is approximately right. Add minimal structured instructions rather than prose explanations.
2. **Use the Agent SDK's system prompt append, not inline prompt bloat.** Move category definitions and severity rubrics to `systemPromptAppend` in the config, separate from the per-PR context.
3. **Do NOT embed repo conventions in the review prompt.** Instead, rely on the CLAUDE.md mechanism (the executor already sets `settingSources: ['project']`). Repo conventions go in a `.claude/CLAUDE.md` file or equivalent, not in the review prompt.
4. **Test with a "prompt diff" approach:** When adding new instructions, measure the delta in review output on the same set of test PRs. If adding 30 lines of instructions changes output for PRs that should not be affected, the instructions are interfering.
5. **Prefer few-shot examples over prose rules.** "Here is an example of a finding NOT worth reporting" is more effective than "Do not report stylistic preferences."

**Detection:**
- Review prompt exceeds 300 lines
- Same PR produces different findings on consecutive runs (non-determinism)
- New prompt instructions change behavior for unrelated PR types
- Developers reporting "the bot used to be better" after adding new categories

**Phase to address:** Architecture phase -- define the prompt structure and boundaries before implementing any new analysis categories.

---

### Pitfall 3: Breaking Existing Working Reviews During Migration

**What goes wrong:**
The current review system works. Users have calibrated their expectations to its behavior. Replacing `buildReviewPrompt()` with a new "intelligent" version changes the character of reviews for every installed repo simultaneously. Even if the new system is objectively better on average, any change in behavior -- different comment style, different severity language, more or fewer comments -- is perceived as a regression by users who were satisfied with the old behavior.

This is especially dangerous because Kodiai does not currently have feature flags or per-repo version selection. A deploy changes behavior for ALL installations at once.

**Why it happens:**
- The new system is deployed as a wholesale replacement of the review prompt and analysis pipeline
- No A/B testing or gradual rollout mechanism exists
- Users never opted into the new behavior -- it appears one day without warning
- The new system may surface issues the old one did not (which users interpret as new false positives, not improved detection)

**Consequences:**
- Users who were satisfied now see "broken" reviews and file complaints
- No way to roll back for specific repos without rolling back the entire deploy
- Lost trust is harder to regain than lost features

**Prevention:**
1. **Implement a config-driven review mode BEFORE changing any prompt logic.** Add `review.mode: "standard"` (default, current behavior) and `review.mode: "enhanced"` (new intelligent review). Only repos that opt in get the new behavior.
2. **The default MUST remain the current behavior.** Never change the default mode in the same release as the new feature. Wait until the enhanced mode has proven stable across opt-in repos.
3. **Use the existing `.kodiai.yml` config system** to gate new features. The forward-compatible config parsing from v0.3 supports this perfectly -- unknown `review.mode` values degrade to the default.
4. **Deploy the new analysis alongside the old, logging differences but not publishing them.** "Shadow mode" lets you measure accuracy before exposing it to users.
5. **Announce changes.** Post a PR comment when a repo first uses the enhanced mode, explaining what changed and how to revert.

**Detection:**
- Users reporting "reviews changed" without having modified their config
- Increase in `review.enabled: false` configs after a deploy
- Support inquiries about unfamiliar review comment formats

**Phase to address:** Must be addressed in the FIRST phase of the milestone. The mode switch mechanism must exist before any analysis changes are deployed.

---

### Pitfall 4: Severity Scoring Becomes Meaningless (The "Everything is Medium" Problem)

**What goes wrong:**
You define a severity scale (Critical / High / Medium / Low / Info). The LLM consistently classifies 60-70% of findings as "Medium" because Medium is the safe default -- it is neither alarmist nor dismissive. Critical and Low are rarely used. The severity system provides no signal: if everything is Medium, severity is noise, not information.

The current prompt already uses severity headings ("Critical, Must Fix, Major, Medium, Minor") in the summary comment format. But these are unstructured -- the model chooses them freely. Making severity a first-class system feature with structured output amplifies this problem because the system will treat "Critical" and "Medium" differently (e.g., blocking merge for Critical), but the model's classification is unreliable.

**Why it happens:**
- LLMs optimize for not being wrong. Classifying a real issue as "Low" risks looking like it missed something. Classifying a non-issue as "Critical" risks crying wolf. "Medium" is always defensible.
- Severity rubrics in prompts are inherently subjective. "Could cause data loss" vs. "might cause performance degradation" -- both could be Medium or High depending on context.
- The model lacks production context: a race condition in a high-traffic payment service is Critical; the same race condition in a test utility is Low. Without deployment context, the model cannot calibrate.

**Consequences:**
- "Severity fatigue" -- users stop reading severity labels entirely
- If severity drives automation (e.g., "Critical blocks merge"), false Criticals block PRs unnecessarily, false Lows let real issues through
- The entire severity system becomes cosmetic overhead that adds complexity without value

**Prevention:**
1. **Use a 3-level scale, not 5.** "Must Fix" / "Should Fix" / "Consider" is enough. Fewer levels means clearer boundaries and less ambiguity for the model.
2. **Define severity by CONSEQUENCE, not by category.** Not "security issues are Critical" but "issues that could cause data loss or unauthorized access in production are Must Fix." This gives the model a concrete decision criterion.
3. **Do NOT automate merge blocking based on severity in v0.4.** The classification will not be reliable enough. Use severity for display/sorting only until you have data proving accuracy.
4. **Anchor severity with examples in the prompt.** Provide 2-3 concrete examples per level: "Must Fix: SQL injection allowing arbitrary query execution. Should Fix: Missing null check on optional parameter that would cause 500 error. Consider: Variable name does not match team convention."
5. **Track severity distribution as a health metric.** If more than 60% of findings are the same severity level, the system is not discriminating.

**Detection:**
- Severity distribution histogram showing >60% at one level
- Users ignoring severity labels (treating all comments the same)
- Must Fix / Critical findings that users dismiss without changes

**Phase to address:** Severity design phase -- define the scale and rubric before implementing category detection. Validate with test PRs before shipping.

---

## Moderate Pitfalls

### Pitfall 5: Feedback Learning System Creates Perverse Incentives

**What goes wrong:**
The feedback learning system collects signals about which comments users acted on (resolved with changes) vs. dismissed (resolved without changes). Over time, this is used to adjust what the system reports. The pitfall: users dismiss comments for many reasons other than "this was wrong" -- they might dismiss because "I will fix this later," "this is a known issue," "I disagree with the convention," or simply "I am in a hurry." Treating all dismissals as negative feedback teaches the system to suppress legitimate findings.

Conversely, if users resolve comments by making changes to PLEASE the bot rather than because the changes are valuable, the system learns to double down on unhelpful but easy-to-fix suggestions (like renaming variables).

**Why it happens:**
- Comment resolution on GitHub is binary (resolved/unresolved) with no reason attached
- There is no reliable way to distinguish "this was a false positive" from "I acknowledge this but will fix later"
- Developers under time pressure dismiss valid findings to unblock merges
- Easy fixes (formatting, naming) have high acceptance rates but low value; hard fixes (architecture, security) have low acceptance rates but high value

**Consequences:**
- The system gradually suppresses its most valuable findings (hard issues that take time to fix)
- The system amplifies its least valuable findings (trivial fixes that are easy to accept)
- A negative feedback spiral: system gets worse -> users dismiss more -> system suppresses more real issues -> users lose trust completely

**Prevention:**
1. **Do NOT use implicit feedback (resolution status) for learning in v0.4.** The signal is too noisy. Start with explicit feedback only: thumbs up/down reactions on comments, or a `@kodiai feedback: false-positive` command.
2. **If using implicit feedback, weight by SEVERITY not by acceptance.** Never suppress a high-severity category just because users dismiss it often -- that may mean users are ignoring real security issues, not that the findings are wrong.
3. **Separate "learning" from "auto-tuning."** Collect feedback data for analysis but do not automatically adjust behavior. A human operator should review feedback trends and manually adjust category thresholds.
4. **Implement a feedback floor:** No category can be suppressed below a minimum reporting threshold, regardless of feedback. Security findings always report, even if dismissed 90% of the time.
5. **Track feedback signal quality.** If a repo dismisses >80% of all findings, the system is noisy for that repo (address noise, do not just suppress). If they accept >80%, the system is working well (do not change).

**Detection:**
- Declining number of reported findings over time without configuration changes
- High-value categories (security, bugs) being reported less frequently than low-value ones
- User complaints that the bot "stopped catching things it used to catch"

**Phase to address:** Feedback system should be the LAST feature implemented in this milestone, after analysis accuracy has been validated. Collect data first, automate tuning later (or never in v0.4).

---

### Pitfall 6: Repo-Specific Learning Overfits to Bad Patterns

**What goes wrong:**
The system analyzes repository history to learn conventions -- naming patterns, error handling styles, architectural patterns. It then flags deviations from these conventions. The problem: if the codebase has inconsistent or bad patterns (which most codebases do), the system learns and enforces those bad patterns. It might flag a developer for using proper error handling because the rest of the codebase uses a sloppy pattern.

A subtler variant: the system learns patterns from the most prolific contributor (who wrote 70% of the code) and flags code from other contributors as "non-conventional" even when those contributors are using better practices.

**Why it happens:**
- Statistical convention detection treats frequency as correctness: if 80% of error handlers swallow exceptions, the system considers exception-swallowing "conventional"
- Codebases evolve -- old patterns should be replaced, not reinforced
- No mechanism to distinguish "this is our convention" from "this is tech debt we have not cleaned up yet"
- Small repos have insufficient data for reliable pattern detection

**Consequences:**
- System reinforces anti-patterns and tech debt
- New developers following best practices are flagged for "non-conventional" code
- Codebases calcify around their worst patterns instead of improving
- Users perceive the system as actively harmful -- "it told me to REMOVE my error handling"

**Prevention:**
1. **Convention learning should be OPT-IN and explicit, not automatic.** Let repo owners define conventions in `.kodiai.yml` or a conventions file rather than mining them from code history.
2. **Never flag a deviation from a mined convention as an "issue."** Use language like "Note: this differs from the common pattern in this repo" -- informational, not prescriptive.
3. **Apply a quality filter to learned patterns.** Do not learn conventions that conflict with language best practices or known security guidelines. The system should know that "swallow all exceptions" is not a convention worth enforcing, even if the codebase does it.
4. **Require minimum sample size.** Do not mine conventions from repos with fewer than 100 files or 10 contributors. Small repos have too little data for reliable pattern detection.
5. **Let users override with explicit config.** `review.conventions.errorHandling: "require-explicit"` overrides whatever the system learned from history.

**Detection:**
- Review comments suggesting worse code than what was submitted
- Comments referencing "repo convention" that contradict language best practices
- Inconsistent convention enforcement (flagging a pattern in one PR, not in another)

**Phase to address:** Pattern analysis phase -- design convention detection with explicit quality filters and opt-in mechanisms before implementing repo scanning.

---

### Pitfall 7: Analysis Overhead Adds Unacceptable Latency

**What goes wrong:**
The current review execution takes 30-120 seconds (one Claude invocation reading the diff and posting comments). Adding pre-analysis steps (repo convention scanning, category-specific analysis passes, severity scoring) adds processing time. If the system runs multiple analysis passes or queries additional context before the main review, latency doubles or triples. A review that took 60 seconds now takes 3 minutes. Users waiting for review before merging are now blocked for 3x longer.

**Why it happens:**
- Each new analysis capability requires either additional LLM calls or additional context gathering
- Repo convention learning might require reading files outside the diff to establish patterns
- Multi-category analysis tempts developers to run separate passes per category (security pass, performance pass, etc.)
- Context enrichment (fetching related files, understanding dependencies) requires additional git operations and file reads

**Consequences:**
- Reviews take long enough that developers merge before the review completes
- Increased token consumption drives up costs (the cost warning system from v0.3 starts firing)
- Timeout rate increases (current 600-second default becomes insufficient)
- Users perceive the "intelligent" review as slower and worse, not better

**Prevention:**
1. **Single-pass architecture.** All analysis MUST happen in one Claude invocation, not multiple sequential passes. The prompt should instruct the model to consider all categories simultaneously while reading the diff once.
2. **Pre-compute convention context at INSTALL time, not review time.** When a repo installs Kodiai, scan conventions once and cache the result. Reference the cached conventions in review prompts.
3. **Set a latency budget.** Review latency MUST NOT exceed 2x the current baseline. If current p90 is 90 seconds, the intelligent review p90 must be under 180 seconds.
4. **Monitor latency as a first-class metric.** The telemetry system already tracks `durationMs`. Add alerting for latency regression.
5. **If pre-analysis is needed, run it ASYNCHRONOUSLY before the review prompt.** Do not block the review on convention analysis -- use stale-but-fast cached conventions.

**Detection:**
- `durationMs` increasing by >50% after deploying intelligent review features
- Timeout rate increasing (more `conclusion: "error"` with `isTimeout: true`)
- Cost per review increasing significantly (token count visible in telemetry)
- Users merging PRs before the review posts

**Phase to address:** Architecture phase -- define the single-pass constraint and latency budget before implementing any analysis features.

---

### Pitfall 8: Configuration Complexity Overwhelms Users (The Settings Page Nobody Uses)

**What goes wrong:**
Each intelligent review feature adds configuration options: category enables/disables, severity thresholds, review mode, convention overrides, feedback sensitivity, analysis depth. The `.kodiai.yml` config grows from its current ~15 fields to 40+ fields. New users see a wall of options and do not configure any of them. Power users spend more time tuning config than benefiting from reviews. The zero-config experience degrades because defaults must now balance dozens of competing concerns.

**Why it happens:**
- Each feature developer adds "just one more config option" to support their feature
- The system tries to be configurable instead of opinionated
- Exposing internal tuning parameters as user config (e.g., `analysis.securityConfidenceThreshold: 0.7`) satisfies completionists but confuses everyone else
- Per-category settings multiply the config surface: 6 categories x 3 settings each = 18 new fields

**Consequences:**
- Zero-config repos (no `.kodiai.yml`) get surprising behavior from poorly-chosen defaults
- Users who try to configure get analysis paralysis ("what should my severity threshold be?")
- Support burden increases as users misconfigure and blame the tool
- Config schema evolution becomes a maintenance nightmare (forward compatibility, migrations)

**Prevention:**
1. **Maximum 3 new user-facing config fields for the entire v0.4 milestone.** Candidates: `review.mode` (standard/enhanced), `review.strictness` (strict/balanced/lenient), and maybe `review.categories` (array of enabled categories). That is it.
2. **Encode complexity in PRESETS, not individual knobs.** `review.strictness: strict` internally maps to higher confidence thresholds, fewer categories, and shorter comments. Users pick a word, not 15 numbers.
3. **Internal tuning parameters stay internal.** Confidence thresholds, category weights, context depth -- these are code constants tuned by operators, not YAML fields tuned by users.
4. **The existing `review.prompt` field already supports per-repo customization.** Custom instructions like "focus on security, ignore style" are more flexible than structured config and more natural for users to write.
5. **Validate that `repoConfigSchema.parse({})` still returns sensible defaults** after every config addition (existing test pattern from v0.3).

**Detection:**
- `.kodiai.yml` schema exceeding 20 user-facing fields
- Users copying config from documentation without understanding it
- Default behavior producing unexpected results in common cases
- Support requests about "what should I set X to?"

**Phase to address:** Config phase -- define the config surface BEFORE implementing features. Resist adding fields during implementation.

---

### Pitfall 9: Non-Deterministic Output Erodes Confidence

**What goes wrong:**
LLM-based analysis is inherently non-deterministic. The same PR reviewed twice produces different comments, different severity scores, and different category classifications. Users discover this when they re-request a review (which Kodiai supports via `review_requested`) and get a completely different set of findings. They lose confidence in any individual review: "If it found a different bug last time, how do I know THIS review caught everything?"

**Why it happens:**
- LLM output varies with temperature, context ordering, and token sampling
- Multi-category prompts amplify variance: the model might focus on security in one run and performance in another
- Context window differences from cached vs. uncached prompts can shift attention
- The `review_requested` trigger re-runs the entire analysis from scratch with no continuity from the previous review

**Consequences:**
- Users re-request reviews to "check" the bot, discover inconsistency, lose trust
- Two reviewers see different bot comments on the same PR (if one re-requested), causing confusion
- The idempotency system (existing `ensureReviewOutputNotPublished`) prevents duplicate posts but not inconsistent content across different deliveries

**Prevention:**
1. **Do NOT advertise re-review as a "check" mechanism.** Re-review is for code changes, not for verifying the bot's findings.
2. **Minimize variance by using deterministic analysis structure.** Instead of open-ended "find issues," provide a checklist of specific checks to run. Checklist-based prompts produce more consistent output.
3. **Track consistency across re-reviews.** If the same PR is reviewed twice (same HEAD SHA), log the overlap in findings. If overlap is <50%, the system is too non-deterministic.
4. **For severity scoring, prefer rule-based post-processing over LLM classification.** The LLM identifies the issue; deterministic rules assign severity based on category and keywords. This ensures severity is stable even if phrasing varies.
5. **Consider caching analysis results per HEAD SHA** so re-review of unchanged code returns the same output.

**Detection:**
- Users re-requesting reviews and getting different findings on unchanged code
- Severity scores for the same issue type varying across PRs
- User complaints about "the bot said something different last time"

**Phase to address:** Testing phase -- measure consistency on a set of golden PRs before shipping.

---

### Pitfall 10: GitHub API Rate Limits Hit with Multi-Comment Reviews

**What goes wrong:**
The current system posts comments via MCP tools (inline comments and summary comments). With intelligent review generating more findings, the system may attempt to post 10-15 inline comments plus a summary comment on a single PR. GitHub's secondary rate limits throttle rapid content creation. The MCP tool calls fail mid-review, resulting in partial reviews (some comments posted, others dropped) with no error surfaced to the user.

Additionally, if the model posts comments one by one rather than as a batch review, each comment is a separate API call. GitHub's REST API for individual line comments is rate-limited more aggressively than the batch review submission endpoint.

**Why it happens:**
- The current MCP inline comment server (`inline-review-server.ts`) posts individual comments via the REST API
- GitHub's secondary rate limits are not documented with precise thresholds but trigger on rapid content creation
- More findings = more API calls = higher chance of hitting rate limits
- The model controls when to call MCP tools; there is no batching layer between the model and the API

**Consequences:**
- Partial reviews: 5 of 10 comments posted, the rest silently dropped
- Error comments appearing alongside partial review output (confusing)
- Inconsistent behavior: sometimes all comments post, sometimes only some
- Users see incomplete reviews and lose trust

**Prevention:**
1. **Implement a hard cap on inline comments (5-7 max).** Enforce this in the prompt AND in the MCP server (reject tool calls beyond the cap).
2. **Investigate using the batch review submission API** (`POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews` with `comments` array) instead of individual comment creation. This is a single API call regardless of comment count.
3. **Add rate limit awareness to MCP servers.** Check response headers for `X-RateLimit-Remaining` and pause/retry if approaching limits.
4. **The MCP server should log every tool call outcome.** If a tool call fails, the model should be informed so it can stop attempting further comments.
5. **Test with PRs that trigger many findings** and verify all comments are posted successfully.

**Detection:**
- Review output logging `published: true` but fewer comments visible on the PR than expected
- GitHub API 403 errors in logs during review execution
- Inconsistent comment counts across reviews of similarly-sized PRs

**Phase to address:** Infrastructure phase -- review the MCP inline comment implementation before increasing comment volume.

---

## Minor Pitfalls

### Pitfall 11: Category Detection Inconsistency Across Languages

**What goes wrong:**
The intelligent review system defines categories like "security," "performance," and "concurrency." The model's ability to detect issues in these categories varies dramatically by language. It may be excellent at finding SQL injection in JavaScript/TypeScript but poor at finding memory management issues in C++, or excellent at detecting race conditions in Go but poor at finding them in Python. If the system claims to check for "concurrency issues" but reliably only detects them in 2 of 5 supported languages, users develop false confidence.

**Prevention:**
1. **Do not claim category coverage you cannot deliver.** Start with categories that work well for the languages your current users actually use (TypeScript, based on the `kodiai/xbmc` test repo).
2. **Language-specific category enablement.** If you know concurrency detection is weak for language X, do not enable it for repos in that language.
3. **Test each category against multiple languages** before advertising it.

**Phase to address:** Category implementation phase -- test each category per language before enabling.

---

### Pitfall 12: Learning Data Storage Grows Unbounded

**What goes wrong:**
The existing telemetry system has 90-day retention and modest storage needs (~3.5 MB/year). A learning system that stores per-repo conventions, per-comment feedback signals, and pattern analysis results will require significantly more storage. Convention data includes file patterns, naming examples, and code snippets. Without retention and compaction policies, this data grows linearly with the number of repos and reviews.

**Prevention:**
1. **Define storage budget per repo for learned data.** Cap convention data at 100KB per repo, feedback data at 50KB per repo.
2. **Implement retention for feedback data.** Feedback older than 90 days should be aggregated into summary statistics and the raw data purged.
3. **Store conventions as compact representations** (patterns and rules), not raw code examples.
4. **Use the existing SQLite infrastructure** with a new table, not a separate database. This inherits WAL mode, checkpointing, and the persistent volume mount.

**Phase to address:** Storage/learning phase -- define storage schema with size constraints from the start.

---

### Pitfall 13: Custom Instructions Conflict with Intelligent Analysis

**What goes wrong:**
Users have existing `review.prompt` custom instructions like "do not report style issues" or "focus only on security." The new intelligent analysis might override or conflict with these instructions. For example, if the analysis inserts category instructions after the custom prompt, the model sees conflicting directives. Or if the analysis pre-filters findings before the model sees them, the custom instructions become irrelevant.

**Prevention:**
1. **Custom instructions always take priority over system analysis.** The prompt hierarchy must be: custom instructions > analysis configuration > system defaults.
2. **Test the interaction between custom instructions and each new analysis feature.** Common custom instructions to test: "only security," "no style comments," "be brief," "use Spanish."
3. **Document how custom instructions interact with review modes.** Users need to know if `review.mode: "enhanced"` respects their custom prompt or overrides it.

**Phase to address:** Prompt architecture phase -- define the instruction priority hierarchy early.

---

### Pitfall 14: Shadow Mode Leaks into User-Visible Output

**What goes wrong:**
If implementing a shadow/comparison mode where the new analysis runs alongside the old but does not publish, a bug in the gating logic could cause the shadow analysis to publish comments. This is especially dangerous because shadow mode output may be more verbose, unformatted, or contain internal debug information.

**Prevention:**
1. **Shadow mode should be implemented at the prompt level, not the MCP level.** The analysis produces results but the MCP tools are never called. Do not rely on a flag check at the MCP server level -- mistakes there publish to GitHub.
2. **Shadow mode output goes to logs only.** Use `logger.info({ shadowAnalysis: true, findings: [...] })`, never MCP tool calls.
3. **Test shadow mode by verifying ZERO GitHub API calls** are made during shadow analysis.

**Phase to address:** Migration/rollout phase -- implement shadow mode with strict output isolation.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Review mode config | Breaking existing reviews (Pitfall 3) | Mode switch with `"standard"` default before any analysis changes |
| Review mode config | Config complexity (Pitfall 8) | Maximum 3 new user-facing fields; use presets not knobs |
| Prompt architecture | Prompt complexity explosion (Pitfall 2) | Keep under 200 lines; use systemPromptAppend for category defs |
| Prompt architecture | Custom instruction conflicts (Pitfall 13) | Define priority hierarchy: custom > analysis config > defaults |
| Category detection | False positive flood (Pitfall 1) | Hard cap on comments; start with fewer categories |
| Category detection | Language inconsistency (Pitfall 11) | Test per-language before enabling; start with TypeScript |
| Severity scoring | Everything is medium (Pitfall 4) | 3-level scale; consequence-based definitions; anchored examples |
| Severity scoring | Automation risk (Pitfall 4) | Display-only in v0.4; no merge blocking |
| Repo convention learning | Overfitting to bad patterns (Pitfall 6) | Opt-in explicit conventions; quality filter against best practices |
| Repo convention learning | Storage growth (Pitfall 12) | Cap per-repo; 90-day retention for raw feedback |
| Feedback system | Perverse incentives (Pitfall 5) | Explicit feedback only; no auto-tuning from implicit signals |
| Feedback system | Negative spiral (Pitfall 5) | Category suppression floor; human-reviewed adjustments only |
| Performance | Latency regression (Pitfall 7) | Single-pass architecture; 2x latency budget; pre-compute conventions |
| Performance | API rate limits (Pitfall 10) | Hard cap on comments; batch review API; rate limit awareness |
| Testing/rollout | Non-determinism (Pitfall 9) | Golden PR test suite; checklist-based prompts; consistency tracking |
| Testing/rollout | Shadow mode leaks (Pitfall 14) | Prompt-level gating; log-only output; verify zero API calls |

## Integration Pitfalls: How New Features Break Existing Kodiai Behavior

These are specific to adding intelligent review features to the EXISTING Kodiai v0.3 system.

| Integration Point | Risk | Prevention |
|---|---|---|
| `buildReviewPrompt()` modification | All existing repos get new behavior simultaneously | Gate behind `review.mode` config; default to current behavior |
| Adding fields to `.kodiai.yml` schema | v0.3 config parsing rejects unknown fields in strict sub-schemas | v0.3 already removed `.strict()` from user-facing schemas -- verify this holds |
| New SQLite tables for learning data | Startup migration adds latency; schema changes risk breaking telemetry | Separate tables; idempotent CREATE IF NOT EXISTS; test with existing DB |
| MCP inline comment server posting more comments | GitHub secondary rate limits trigger partial reviews | Hard cap on comment count in MCP server; consider batch review API |
| Executor `execute()` context expansion | New context fields (conventions, feedback) increase token count | Monitor token usage in telemetry; set a context size budget |
| `review.prompt` custom instructions | New analysis categories conflict with user-specified instructions | Custom instructions always take priority; test common custom prompts |
| Telemetry recording for new metrics | New fields in TelemetryRecord break existing CLI reports | Add new columns as nullable; update CLI queries to handle new fields gracefully |
| Per-repo learning data | Data accumulates across repos sharing an installation | Per-repo storage caps; retention policy from day one |

## The Meta-Pitfall: Building Too Much Before Validating

The single most dangerous pitfall for this milestone is building the full intelligent review system (multi-category detection + severity scoring + convention learning + feedback system + configurable modes) before validating that users want ANY of it. The current system works. Users have not asked for these features.

**The correct sequence is:**
1. Add the review mode switch (zero behavior change, just the mechanism)
2. Improve the existing prompt to reduce false positives (users already want this)
3. Add basic severity tagging to existing findings (small change, big signal)
4. Measure whether severity tagging improves user engagement
5. ONLY THEN add new detection categories, convention learning, or feedback systems

Building features 3-5 without validating feature 2-3 risks months of work on capabilities nobody uses.

## Sources

- [Jellyfish: Impact of AI Code Review Agents (2025)](https://jellyfish.co/blog/impact-of-ai-code-review-agents/) -- 18% of AI feedback results in code changes; 56% of reviews get human response -- HIGH confidence (primary research, 1000+ reviews analyzed)
- [Graphite: AI Code Review False Positives](https://graphite.com/guides/ai-code-review-false-positives) -- Industry false positive rates of 5-15%; context-aware analysis reduces them -- MEDIUM confidence (vendor blog with industry benchmarks)
- [Qodo: 5 AI Code Review Pattern Predictions in 2026](https://www.qodo.ai/blog/5-ai-code-review-pattern-predictions-in-2026/) -- Severity-driven review, alert fatigue, feedback loop deficiencies, attribution-based learning -- MEDIUM confidence (industry analysis with specific failure modes)
- [Hacker News: AI Code Review Bubble Discussion](https://news.ycombinator.com/item?id=46766961) -- Developer complaints about verbosity, false positives, non-determinism, lack of context, contradictory suggestions -- HIGH confidence (firsthand developer experience reports)
- [Cubic: The False Positive Problem](https://www.cubic.dev/blog/the-false-positive-problem-why-most-ai-code-reviewers-fail-and-how-cubic-solved-it) -- Up to 40% of AI code review alerts ignored -- MEDIUM confidence (vendor blog citing industry data)
- [ezyang: Code Review as Human Alignment in the Era of LLMs](https://blog.ezyang.com/2025/12/code-review-as-human-alignment-in-the-era-of-llms/) -- LLMs generate overly defensive code; no memory across sessions; alignment gap between AI and human expectations -- HIGH confidence (experienced engineer's analysis)
- [DevTools Academy: State of AI Code Review Tools 2025](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) -- Leading tools catch only 40-48% of real bugs; false positive/noise remains primary complaint -- MEDIUM confidence (benchmark study)
- [CodeRabbit: AI vs Human Code Generation Report](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report) -- AI PRs show 1.4-1.7x more critical/major findings than human PRs; AI does not adhere to repo idioms -- HIGH confidence (quantitative analysis of 470 PRs)
- [GitHub Docs: Rate Limits for GitHub Apps](https://docs.github.com/en/developers/apps/building-github-apps/rate-limits-for-github-apps) -- Secondary rate limits on content creation -- HIGH confidence (official GitHub documentation)
- Kodiai codebase inspection: `src/execution/review-prompt.ts`, `src/execution/executor.ts`, `src/execution/config.ts`, `src/handlers/review.ts`, `src/telemetry/store.ts`, `src/execution/mcp/inline-review-server.ts` -- HIGH confidence (direct code inspection)

---
*Pitfalls research for: Kodiai v0.4 Intelligent Review System*
*Researched: 2026-02-11*
