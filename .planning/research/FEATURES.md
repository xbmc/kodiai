# Feature Landscape: Intelligent Review (v0.4)

**Domain:** AI-powered code review -- noise reduction, severity, learning, and context awareness
**Researched:** 2026-02-11
**Overall Confidence:** MEDIUM-HIGH

## Scope

This research covers **new intelligent review features only** for the v0.4 milestone. Already-built capabilities are treated as existing infrastructure:

- PR auto-review with inline comments and suggestion blocks (v0.1)
- Review summary comments with severity headings and `<details>` wrapping (v0.1)
- `.kodiai.yml` config: `review.enabled`, `review.prompt`, `review.skipPaths`, `review.skipAuthors`, `review.autoApprove`, `review.triggers` (v0.1-v0.3)
- @kodiai mention handling with `mention.allowedUsers` (v0.1-v0.3)
- Telemetry recording with cost tracking (v0.3)

The v0.4 goal: make reviews smarter, not just present. Reduce noise, catch real issues, understand repo context, and give users control over what gets flagged.

## Table Stakes

Features users expect from any tool claiming "intelligent review." Missing these means the review tool feels like a generic LLM wrapper with no domain awareness.

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Configurable severity threshold** | Users need `review.severity: high` to suppress minor/medium findings and only see critical and high-severity issues. Without this, noisy repos get buried in low-value comments. CodeRabbit has `review_profile: chill/assertive`; Kilo has strict/balanced/lenient. This is the single most requested feature class in AI review tools. | MEDIUM | Prompt engineering in `review-prompt.ts`; new `review.severity` config field in `repoConfigSchema` |
| **Structured severity in review output** | Every review comment must have an explicit severity tag (Critical, High, Medium, Low). The existing summary comment already groups by severity headings. Inline comments need severity prefixed consistently so users can visually scan importance. | LOW | Prompt engineering only -- instruct model to prefix inline comments with severity |
| **Focus area configuration** | Users need `review.focusAreas` to specify which issue categories matter: `["security", "bugs", "performance"]`. A repo that only cares about security should not get performance nits. The existing prompt hardcodes all categories. | LOW | New config field `review.focusAreas: string[]`; conditional inclusion in `buildReviewPrompt()` |
| **Custom review instructions (per-repo)** | The `review.prompt` field already exists but is poorly documented and underused. Users need clear guidance that this is where repo-specific conventions go: "We use Result types not exceptions," "All API handlers must validate input schemas," etc. | ALREADY BUILT | `review.prompt` field in config; passed as `customInstructions` in `buildReviewPrompt()` |
| **Noise suppression rules** | Explicit rules in the prompt to suppress known low-value patterns: no style-only comments, no "consider renaming" without a concrete bug, no commenting on test file structure, no flagging intentional `any` types when the context shows they are deliberate. The current prompt says "Focus on correctness and safety, not style preferences" but this is too vague. | LOW | Prompt engineering -- expand the Rules section with explicit suppression patterns |
| **Skip review for trivial PRs** | Auto-skip or fast-track PRs below a threshold (e.g., fewer than 5 lines changed, only markdown/docs, only lockfile changes). Currently `skipPaths` handles file-type filtering, but there is no line-count threshold. Wasting a full Claude session on a one-line typo fix is cost-inefficient. | LOW | New config field `review.skipIfOnlyPaths` or a line-count check in review handler before executor call |

## Differentiators

Features that set Kodiai apart from generic review tools. Not expected by default, but valued by teams that use AI review daily.

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| **Path-scoped review instructions** | Different review rules for different parts of the codebase: "For `src/api/**`, enforce input validation on every handler. For `tests/**`, only flag incorrect assertions, ignore style." CodeRabbit's `path_instructions` is the gold standard here. Kodiai currently has one global `review.prompt`; adding path-scoped instructions makes the review context-aware per directory. | MEDIUM | New config field `review.pathInstructions: [{path: string, instructions: string}]`; path matching with picomatch (already a dependency); prompt assembly in `buildReviewPrompt()` |
| **Review profiles (strictness presets)** | Named presets that bundle severity threshold + focus areas + noise suppression rules. Three levels: `strict` (flag everything including style), `balanced` (bugs + security + performance, skip style), `minimal` (only critical/high severity bugs and security). Users set `review.profile: balanced` instead of configuring 5 fields individually. CodeRabbit has `chill`/`assertive`; Kilo has `strict`/`balanced`/`lenient`. | MEDIUM | New config field `review.profile`; preset definitions that set defaults for severity, focusAreas, and noise rules; must interact correctly with explicit field overrides |
| **Incremental re-review (new changes only)** | When a developer pushes new commits to address review feedback, re-review should focus on the new changes rather than re-reviewing the entire diff. Currently, re-requesting review re-reviews everything. CodeRabbit does this by tracking prior review comments and focusing on new commits. | HIGH | Requires storing or retrieving prior review state (which comments were posted, on which SHA); modified diff calculation (`git diff oldSHA..newSHA` instead of `git diff base...HEAD`); prompt modification to include prior context. This is the hardest feature on this list. |
| **Issue category tags on inline comments** | Each inline comment tagged with its category: `[Security]`, `[Bug]`, `[Performance]`, `[Error Handling]`. Enables users to quickly filter what matters. Combined with severity, a comment reads: `**Critical** [Security]: SQL injection via unsanitized input`. | LOW | Prompt engineering only -- instruct model to prefix comments with category tag |
| **Confidence-based filtering** | The model self-assesses confidence on each finding (HIGH/MEDIUM/LOW). Config option `review.minConfidence: medium` suppresses low-confidence findings. Research shows low-confidence AI findings are where most false positives live. This directly attacks the 5-15% false positive rate cited in industry benchmarks. | MEDIUM | Prompt engineering to elicit confidence scores; new config field `review.minConfidence`; either trust the model's self-assessment (simpler) or implement post-processing to filter (harder). The simpler approach (prompt-only) is recommended initially. |
| **Feedback-driven learning via config** | A `review.suppressions` list in config where users document patterns to stop flagging: `["ignore: 'any' type in test fixtures", "ignore: missing error handling in scripts/"]`. This is explicit, version-controlled, and auditable -- unlike implicit ML-based learning. Acts as a team knowledge base for "things the bot gets wrong." | LOW | New config field `review.suppressions: string[]`; injected into prompt as "Do NOT flag these patterns" |
| **Review summary with metrics** | Enhance the summary comment with metadata: number of files reviewed, lines of diff analyzed, number of issues by severity, and estimated review time saved. Gives teams quantitative signal that the review was thorough. | LOW | Prompt engineering plus potentially a few calculations in the review handler (file count and diff line count are already available) |

## Anti-Features

Features to explicitly NOT build. These seem valuable but create disproportionate complexity or undermine the tool's strengths.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **ML-based learning from past reviews** | Requires storing historical review data, training a feedback model, managing concept drift, and handling the cold-start problem. CodeRabbit and Qodo spend massive engineering effort here because they are SaaS products amortizing cost across thousands of repos. For a self-hosted tool serving a few repos, explicit config-based learning (suppressions, custom instructions) is more predictable and debuggable. | Use `review.prompt`, `review.suppressions`, and `review.pathInstructions` for explicit, version-controlled learning. The "model" is the config file, not a neural network. |
| **Reaction-based feedback loop (thumbs up/down on comments)** | Requires tracking which comments the bot posted, monitoring reaction events via webhooks, storing feedback data, and implementing a pipeline to translate reactions into prompt modifications. The feedback signal is noisy (a thumbs-down could mean "wrong finding" or "right finding, bad suggestion" or "not important enough to fix"). | If users disagree with a finding pattern, they add it to `review.suppressions`. Explicit text is unambiguous. Reactions can be added later as a convenience layer on top of the suppression system. |
| **Auto-fix / auto-commit for review findings** | The review tool should identify issues, not fix them. Auto-fixing conflates review (advisory) with write-mode (action). Kodiai already has write-mode via @mentions -- if a user wants a fix, they can say `@kodiai fix the SQL injection in auth.ts`. Auto-fixing review findings risks making unwanted changes and breaks the advisory nature of reviews. GitClear research shows AI reviewing its own output produces 8x code duplication. | Keep review as advisory (inline comments with suggestion blocks). Users click "Accept suggestion" in GitHub UI or ask @kodiai to fix specific issues. The separation between review and write is a feature, not a limitation. |
| **Cross-repo architectural analysis** | Analyzing dependencies across multiple repos to catch breaking changes. Qodo positions this as a key differentiator. Building it requires: cloning dependent repos, building dependency graphs, understanding API contracts. This is a product unto itself. | Stay within single-PR scope. If the user wants cross-repo awareness, they document API contracts in `review.prompt` or `review.pathInstructions` for the relevant paths. |
| **Integrated linter/SAST tool orchestration** | Running ESLint, Semgrep, Trivy, etc. alongside the LLM review and merging findings. CodeRabbit integrates 40+ tools. This adds configuration complexity, tool installation, version management, and result deduplication. The LLM already catches many of the same issues that static analyzers catch, and it catches them with better context. | Let CI/CD handle linting and SAST. The LLM review focuses on issues that static tools miss: logic errors, incorrect business logic, subtle bugs, architectural drift. If users want linter integration, they run linters in CI independently. |
| **PR label auto-assignment from review findings** | Automatically labeling PRs with `needs-security-fix` or `has-performance-issues` based on review findings. Requires: parsing review output structured data, mapping severity/category to labels, calling GitHub API to apply labels. | If needed, use the review summary as the source of truth. Users can manually label based on the severity headings in the summary. Auto-labeling adds API calls and label management overhead for marginal benefit. |
| **Review gating / merge blocking** | Blocking PR merges when critical issues are found. GitHub already supports required reviews and status checks. Making the bot's review a hard gate introduces responsibility the tool should not carry -- an LLM can have false positives, and a false positive blocking merge erodes trust fast. | Use GitHub's native branch protection. Kodiai posts a "Comment" review (not "Request Changes"). If teams want the bot to block merges, they can configure branch protection to require Kodiai's approval and use `autoApprove` to approve only when no issues are found (already built). |

## Feature Dependencies

```
[Severity & Noise Control]  (Foundation -- build first)
    |
    +-- review.severity config field
    |       +--requires--> repoConfigSchema update, prompt conditional logic
    |
    +-- review.focusAreas config field
    |       +--requires--> repoConfigSchema update, prompt conditional logic
    |
    +-- Structured severity tags on inline comments
    |       +--requires--> prompt engineering only (no code deps)
    |
    +-- Noise suppression rules in prompt
            +--requires--> prompt engineering only

[Context-Aware Review]  (Build second -- depends on config infrastructure)
    |
    +-- review.pathInstructions config field
    |       +--requires--> repoConfigSchema update
    |       +--requires--> picomatch for path matching (already installed)
    |       +--requires--> buildReviewPrompt() to assemble path-specific context
    |
    +-- review.profile presets
    |       +--requires--> review.severity and review.focusAreas (must exist first)
    |       +--requires--> preset definitions mapping profile -> field defaults
    |
    +-- Issue category tags on comments
            +--requires--> prompt engineering only

[Feedback & Adaptation]  (Build third -- needs the above in place)
    |
    +-- review.suppressions config field
    |       +--requires--> repoConfigSchema update
    |       +--requires--> prompt injection of suppression rules
    |
    +-- Confidence-based filtering
    |       +--requires--> review.minConfidence config field
    |       +--requires--> prompt engineering for confidence self-assessment
    |
    +-- Review summary with metrics
            +--requires--> diff line count (available from git)
            +--requires--> file count (available from changedFiles array)

[Incremental Re-review]  (Build last -- highest complexity, most dependencies)
    |
    +-- requires--> Prior review state (comments posted, SHA reviewed)
    +-- requires--> Differential diff calculation
    +-- requires--> Modified prompt with prior context
    +-- requires--> Telemetry store or GitHub API for state retrieval
```

## MVP Recommendation

### Phase 1: Severity and Noise Control (Foundation)

Prioritize noise reduction above all else. The single biggest complaint about AI review tools is too many low-value comments. Research shows concise reviews are 3x more likely to be acted upon.

Build:
1. `review.severity` config field -- threshold for minimum severity to report
2. `review.focusAreas` config field -- which categories to review
3. Expanded noise suppression rules in prompt -- explicit "do not flag" patterns
4. Structured severity and category tags on all inline comments

### Phase 2: Context-Aware Instructions

Make the review understand the repo, not just the diff.

Build:
1. `review.pathInstructions` -- per-path review instructions with picomatch globs
2. `review.profile` presets -- `strict`/`balanced`/`minimal` as convenience bundles
3. Enhance `review.prompt` documentation and examples

### Phase 3: Feedback and Adaptation

Let teams teach the bot what to ignore.

Build:
1. `review.suppressions` -- explicit patterns to stop flagging
2. `review.minConfidence` -- filter out low-confidence findings
3. Review summary metrics (files, lines, issue counts)

### Defer: Incremental Re-review

This is the most impactful differentiator but also the hardest to build correctly. It requires state management across review cycles, differential diff calculation, and prompt context that includes prior findings. Defer to v0.4.x or v0.5 after the foundation is solid. A botched incremental review (re-flagging already-fixed issues, missing new issues) is worse than a full re-review.

### Defer: ML-Based Learning, Auto-Fix, Cross-Repo Analysis

These are product-level features that require months of engineering each. They belong in a roadmap discussion about Kodiai's long-term direction, not in a v0.4 milestone.

## Competitor Feature Matrix (Intelligent Review Focus)

| Feature | CodeRabbit | Qodo | GitHub Copilot | Kilo | Kodiai Current | Kodiai v0.4 Target |
|---------|------------|------|----------------|------|----------------|-------------------|
| Severity levels | Implicit (chill/assertive) | Yes (risk scoring) | No | Yes (strict/balanced/lenient) | Summary headings only | Configurable threshold + tags on all comments |
| Focus area config | Via path_instructions | Via workflows | Via custom instructions | Via focus areas | Hardcoded in prompt | Configurable `review.focusAreas` |
| Path-scoped instructions | `path_instructions` (glob) | Directory scoping | File-level custom instructions | Not documented | Single global `review.prompt` | `review.pathInstructions` with picomatch |
| Noise suppression | Learnings from chat | Automated workflows | Not documented | Not documented | "Focus on correctness" rule | Explicit `review.suppressions` + expanded prompt rules |
| Incremental re-review | Yes (per-commit) | Yes | No (full review) | Not documented | No (full re-review) | Deferred to v0.5 |
| Feedback learning | Chat replies -> learnings | PR history analysis | Not documented | Not documented | None | Explicit suppressions (v0.4); reactions later |
| Confidence scores | Not exposed | Not exposed | Not exposed | Not exposed | None | Self-assessed confidence with configurable filter |
| Profile presets | chill / assertive | N/A | N/A | strict / balanced / lenient | None | strict / balanced / minimal |
| Auto-fix from review | No | Remediation patches | Copilot coding agent | Not documented | Separate write-mode | Separate write-mode (intentional) |

### Key Insight

CodeRabbit's advantage is breadth (40+ integrated tools, Jira/Linear integration, learnings system). Kodiai's advantage is depth of configuration control and transparency. As a self-hosted tool where the operator sees every config field and prompt instruction, Kodiai can offer precision that SaaS tools cannot: explicit suppressions instead of opaque ML, version-controlled path instructions instead of chat-trained models, and direct access to severity/confidence controls instead of binary chill/assertive toggles.

The strategic play is: make Kodiai the most configurable and transparent AI reviewer, not the most feature-rich.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/execution/review-prompt.ts`, `src/handlers/review.ts`, `src/execution/config.ts` -- verified current prompt structure, config schema, and review handler flow
- [CodeRabbit Configuration Reference](https://docs.coderabbit.ai/reference/configuration) -- full YAML schema, path_instructions, review profiles, learnings
- [CodeRabbit Review Instructions Guide](https://docs.coderabbit.ai/guides/review-instructions) -- path_instructions vs code guidelines distinction, glob pattern usage
- [GitHub Copilot Code Review Docs](https://docs.github.com/copilot/using-github-copilot/code-review/using-copilot-code-review) -- Copilot review behavior, custom instructions, comment-only reviews

### Secondary (MEDIUM confidence)
- [Signal vs Noise Framework for AI Code Review](https://jetxu-llm.github.io/posts/low-noise-code-review/) -- Three-tier classification (Critical/Pattern/Noise), signal ratio metrics, cost of false positives
- [Context Engineering for AI Code Reviews (CodeRabbit Blog)](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews) -- 1:1 code-to-context ratio, context source types, verification scripts
- [Why Your AI Code Reviews Are Broken (Qodo Blog)](https://www.qodo.ai/blog/why-your-ai-code-reviews-are-broken-and-how-to-fix-them/) -- Confirmation bias in AI review, multi-agent architecture, anchoring effects
- [AI Code Review False Positive Rates (Graphite)](https://graphite.com/guides/ai-code-review-false-positives) -- 5-15% industry FP rate, triage cost of 15-30 min per FP
- [AI Code Review Accuracy 2026 (CodeAnt)](https://www.codeant.ai/blogs/ai-code-review-accuracy) -- Severity-based prioritization, context understanding for FP reduction
- [Google Research: Resolving Code Review Comments with ML](https://research.google/blog/resolving-code-review-comments-with-ml/) -- 52% comment resolution rate, 50% suggestion acceptance rate
- [5 Ways to Measure AI Code Review Impact (Baz)](https://baz.co/resources/5-ways-to-measure-the-impact-of-ai-code-review) -- Acceptance rate metrics, resolution tracking categories

### Tertiary (LOW confidence)
- [8 Best AI Code Review Tools 2026 (Qodo Blog)](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/) -- Competitor comparison overview
- [State of AI Code Review Tools 2025 (DevTools Academy)](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025) -- Ecosystem landscape
- [Self-Learning Code Review with Cursor (Elementor)](https://medium.com/elementor-engineers/the-self-learning-code-review-teaching-ai-cursor-to-learn-from-human-feedback-454df64c98cc) -- Feedback loop implementation patterns

---
*Feature landscape for: Intelligent review capabilities (v0.4 milestone)*
*Researched: 2026-02-11*
