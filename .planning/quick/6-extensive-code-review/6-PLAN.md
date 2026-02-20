---
phase: quick-6
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [".planning/quick/6-extensive-code-review/REVIEW.md"]
autonomous: true
must_haves:
  truths:
    - "Every source directory has been reviewed for code quality issues"
    - "Critical issues (bugs, security, data loss risks) are clearly flagged"
    - "Actionable improvement recommendations are provided with specific file:line references"
  artifacts:
    - path: ".planning/quick/6-extensive-code-review/REVIEW.md"
      provides: "Comprehensive code review findings"
      min_lines: 100
  key_links: []
---

<objective>
Perform an extensive code review of the entire Kodiai codebase (~54,500 lines of TypeScript across 94 source files in 15 directories).

Purpose: Identify bugs, security issues, architectural concerns, code quality problems, and improvement opportunities across the full codebase.
Output: A structured REVIEW.md documenting all findings by severity and category.
</objective>

<execution_context>
@/home/keith/.claude/get-shit-done/workflows/execute-plan.md
@/home/keith/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Review core pipeline — handlers, execution, and entry point</name>
  <files>.planning/quick/6-extensive-code-review/REVIEW.md</files>
  <action>
Read and review every non-test source file in the following directories and files, documenting findings:

**Entry point and config:**
- `src/index.ts` (12.8K — server setup, routing, lifecycle)
- `src/config.ts` (2.7K — configuration)

**Handlers (6,642 lines — largest module):**
- `src/handlers/review.ts` (141.1K — PR review handler, LARGEST FILE)
- `src/handlers/mention.ts` (74.8K — mention handler)
- `src/handlers/mention-types.ts` (5.6K)
- `src/handlers/feedback-sync.ts` (6.6K)
- `src/handlers/dep-bump-merge-history.ts` (6.0K)
- `src/handlers/review-idempotency.ts` (4.2K)
- `src/handlers/rereview-team.ts` (3.8K)

**Execution (5,626 lines):**
- `src/execution/review-prompt.ts` (63.1K — review prompt construction)
- `src/execution/config.ts` (19.3K)
- `src/execution/mention-context.ts` (16.3K)
- `src/execution/mention-prompt.ts` (10.6K)
- `src/execution/executor.ts` (9.9K)
- `src/execution/diff-analysis.ts` (9.1K)
- `src/execution/issue-code-context.ts` (9.6K)
- `src/execution/types.ts` (3.5K)
- `src/execution/prompt.ts` (900B)
- All files in `src/execution/mcp/`

For each file, evaluate:
1. **Bugs**: Logic errors, race conditions, unhandled edge cases, incorrect assumptions
2. **Security**: Input validation gaps, injection risks, auth bypass paths, secret exposure
3. **Error handling**: Swallowed errors, missing try/catch, unclear error propagation
4. **Performance**: N+1 patterns, unnecessary allocations, blocking operations, memory leaks
5. **Architecture**: God functions (>100 lines), tight coupling, unclear responsibilities
6. **Type safety**: `any` usage, unsafe casts, missing null checks
7. **Maintainability**: Dead code, duplicated logic, misleading names, missing abstractions

Create `.planning/quick/6-extensive-code-review/REVIEW.md` with initial findings. Use this structure:

```markdown
# Kodiai Code Review

## Summary
[Stats: files reviewed, total lines, finding counts by severity]

## Critical (Bugs, Security, Data Loss Risk)
[Each finding: file:line, description, impact, suggested fix]

## High (Error Handling, Race Conditions, Performance)
[Each finding: file:line, description, impact, suggested fix]

## Medium (Architecture, Type Safety, Maintainability)
[Each finding: file:line, description, impact, suggested fix]

## Low (Style, Naming, Minor Improvements)
[Each finding: file:line, description, impact, suggested fix]

## Positive Observations
[Well-designed patterns worth preserving]

## Recommendations
[Top 5-10 highest-impact improvements, ordered by value/effort]
```

NOTE: The handler and execution files are very large. Read them in chunks (2000 lines at a time) to ensure thorough coverage. Do NOT skip or skim — this is an extensive review.
  </action>
  <verify>REVIEW.md exists and contains findings from all listed files with specific file:line references</verify>
  <done>All handler, execution, entry point, and config files reviewed with findings documented in REVIEW.md</done>
</task>

<task type="auto">
  <name>Task 2: Review supporting modules — lib, slack, knowledge, learning, remaining directories</name>
  <files>.planning/quick/6-extensive-code-review/REVIEW.md</files>
  <action>
Continue the code review by reading and reviewing every non-test source file in the remaining directories:

**Lib (3,056 lines — utility functions):**
- All 21 non-test files in `src/lib/` (sanitizer, dep-bump-detector, dep-bump-enrichment, errors, file-risk-scorer, finding-prioritizer, pr-intent-parser, merge-confidence, search-cache, timeout-estimator, usage-analyzer, author-classifier, auto-profile, delta-classifier, finding-dedup, formatting, incremental-diff, logger, partial-review-formatter, retry-scope-reducer, scope-coordinator)

**Slack (1,719 lines):**
- All 10 non-test files in `src/slack/` (assistant-handler, client, repo-context, safety-rails, thread-session-store, types, verify, write-confirmation-store, write-intent, write-runner)

**Knowledge (1,585 lines):**
- All 4 non-test files in `src/knowledge/`

**Learning (1,425 lines):**
- All 10 non-test files in `src/learning/`

**Remaining directories:**
- `src/jobs/` (785 lines, 3 files)
- `src/enforcement/` (751 lines, 5 files)
- `src/telemetry/` (606 lines, 2 files)
- `src/webhook/` (280 lines, 5 files)
- `src/routes/` (264 lines, 3 files)
- `src/feedback/` (167 lines, 5 files)
- `src/auth/` (141 lines, 1 file)
- `src/api/` (29 lines, 2 files)
- `src/types/` (12 lines, 1 file)

Apply the same evaluation criteria from Task 1. Append findings to the existing REVIEW.md under the appropriate severity sections.

After all files reviewed, write the final Summary section with:
- Total files reviewed and lines of code
- Finding counts by severity (Critical/High/Medium/Low)
- Top 5-10 recommendations ordered by impact/effort ratio
- Positive observations about well-designed patterns
  </action>
  <verify>REVIEW.md contains findings from ALL source directories with the summary section completed</verify>
  <done>Every non-test source file in the codebase has been reviewed, findings documented with file:line references, and summary/recommendations finalized</done>
</task>

</tasks>

<verification>
- REVIEW.md exists at `.planning/quick/6-extensive-code-review/REVIEW.md`
- Every source directory (handlers, execution, lib, slack, knowledge, learning, jobs, enforcement, telemetry, webhook, routes, feedback, auth, api, types) has been covered
- Findings include specific file:line references, not vague descriptions
- Summary includes finding counts and prioritized recommendations
</verification>

<success_criteria>
- All 94 non-test source files reviewed
- Findings categorized by severity with actionable details
- Top recommendations prioritized by impact/effort
- No source directory skipped
</success_criteria>

<output>
After completion, create `.planning/quick/6-extensive-code-review/6-SUMMARY.md`
</output>
