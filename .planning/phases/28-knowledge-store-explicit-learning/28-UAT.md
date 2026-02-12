---
status: diagnosed
phase: 28-knowledge-store-explicit-learning
source: 28-01-SUMMARY.md, 28-02-SUMMARY.md, 28-03-SUMMARY.md, 28-04-SUMMARY.md
started: 2026-02-12T07:19:14Z
updated: 2026-02-12T07:33:48Z
---

## Current Test

[testing complete]

## Tests

### 1. Knowledge Store Persists Review Data and Exposes Stats
expected: After at least one review runs, knowledge data is persisted and queryable. Running `bun scripts/kodiai-stats.ts --repo xbmc/kodiai` returns non-empty review metrics (review count and severity totals) instead of missing-data errors.
result: issue
reported: "keith@sf:~/src/kodiai$ bun scripts/kodiai-stats.ts --repo xbmc/kodiai\nNo knowledge store found at /home/keith/src/kodiai/data/kodiai-knowledge.db"
severity: major

### 2. Suppression Patterns Exclude Matching Findings
expected: With `review.suppressions` configured in `.kodiai.yml`, findings matching suppression patterns are omitted from posted review output while non-matching findings still appear.
result: pass

### 3. Min Confidence Threshold Filters Low-Confidence Findings
expected: Setting `review.minConfidence` to a stricter level reduces low-confidence findings in review output while keeping higher-confidence findings visible.
result: pass

### 4. Review Output Includes Quantitative Metrics
expected: Review output includes quantitative metrics from deterministic analysis (for example files reviewed, lines analyzed, severity counts), and the details section appears consistently when a review runs.
result: issue
reported: "Triggered live review on https://github.com/xbmc/kodiai/pull/39 via @kodiai review; response did not include quantitative metrics section (files reviewed, lines analyzed, severity counts)."
severity: major

## Summary

total: 4
passed: 2
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "After at least one review runs, knowledge data is persisted and queryable; `bun scripts/kodiai-stats.ts --repo xbmc/kodiai` returns review metrics instead of missing-data errors"
  status: failed
  reason: "User reported: keith@sf:~/src/kodiai$ bun scripts/kodiai-stats.ts --repo xbmc/kodiai\nNo knowledge store found at /home/keith/src/kodiai/data/kodiai-knowledge.db"
  severity: major
  test: 1
  root_cause: "Stats CLI and review runtime both default to a cwd-relative `./data/kodiai-knowledge.db`, so the CLI was executed in a filesystem context that did not contain the DB written by review runtime."
  artifacts:
    - path: "scripts/kodiai-stats.ts"
      issue: "Hard-fails on local resolved default path unless --db points at the actual writer location"
    - path: "src/index.ts"
      issue: "Knowledge store writer path resolves from server runtime env/cwd and can diverge from operator CLI cwd"
    - path: "src/handlers/review.ts"
      issue: "Writes depend on runtime knowledge store location, not surfaced to operator CLI by default"
  missing:
    - "Define one canonical KNOWLEDGE_DB_PATH contract shared by runtime and CLI"
    - "Make stats CLI prefer KNOWLEDGE_DB_PATH and print explicit missing-path guidance with --db example"
    - "Add regression coverage for runtime path vs local cwd path drift"
  debug_session: ".planning/debug/phase-28-uat-gap-1-kodiai-stats.md"

- truth: "Review output includes quantitative metrics (files reviewed, lines analyzed, severity counts) in a consistent details section"
  status: failed
  reason: "User reported: Triggered live review on https://github.com/xbmc/kodiai/pull/39 via @kodiai review; response did not include quantitative metrics section (files reviewed, lines analyzed, severity counts)."
  severity: major
  test: 4
  root_cause: "Prompt builder only injects metrics/details requirements when `review.mode` is enhanced, while default runtime mode is standard, so live output did not require the section."
  artifacts:
    - path: "src/execution/review-prompt.ts"
      issue: "Metrics instructions are gated behind mode === enhanced"
    - path: "src/execution/config.ts"
      issue: "Default review mode is standard"
    - path: "src/execution/review-prompt.test.ts"
      issue: "No assertion that standard mode includes metrics/details requirements"
  missing:
    - "Make metrics/details contract unconditional in buildReviewPrompt"
    - "Add explicit requirement text for details section with files, lines, and severity counts"
    - "Add tests asserting metrics/details requirements are present in standard mode"
  debug_session: ".planning/debug/phase-28-uat-gap-2-metrics.md"
