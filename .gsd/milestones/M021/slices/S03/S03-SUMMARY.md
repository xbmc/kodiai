---
id: S03
parent: M021
milestone: M021
provides: []
requires: []
affects: []
key_files: []
key_decisions: []
patterns_established: []
observability_surfaces: []
drill_down_paths: []
duration: 
verification_result: passed
completed_at: 
blocker_discovered: false
---
# S03: Triage Agent Wiring

**# Plan 105-03 Summary: Triage Agent Wiring**

## What Happened

# Plan 105-03 Summary: Triage Agent Wiring

## What was built
- Extended triage config schema with `labelAllowlist` (string[]) and `cooldownMinutes` (number, default 30)
- Wired `enableIssueTools` and `triageConfig` into executor's `buildMcpServers()` for issue mentions with triage enabled
- Integrated triage validation into mention handler: validates issue body, generates guidance context and label recommendation
- Added per-issue cooldown with body-hash reset to prevent triage spam
- Added `triageContext` parameter to `buildMentionPrompt()` with issue template compliance instructions
- Added `issueBody` field to `MentionEvent` interface for triage validation

## Key files
- `src/execution/config.ts` — triageSchema extended with labelAllowlist, cooldownMinutes
- `src/execution/executor.ts` — issue tool wiring when triage.enabled + issue mention
- `src/execution/mention-prompt.ts` — triageContext injection in prompt
- `src/handlers/mention.ts` — triage validation + cooldown logic
- `src/handlers/mention-types.ts` — issueBody field added to MentionEvent

## Test results
- 79/79 config tests pass
- 57/57 mention tests pass
- 102/102 MCP tests pass
- 41/41 triage tests pass

## Decisions
- Triage context injected as prompt context (not post-execution append) per CONTEXT.md: "the triage nudge should be a single sentence appended to whatever the bot's primary response is"
- Cooldown uses SHA-256 hash of issue body (first 16 chars) for edit detection
- Fail-open: triage errors logged but don't block primary mention response

# Plan 105-01 Summary: Issue Template Parser (TDD)

## What was built
- Issue template parser that reads `.md` templates and extracts YAML frontmatter + section headers
- `diffAgainstTemplate()` function that validates issue bodies against templates
- Distinguishes missing vs empty vs placeholder content in sections
- Supports `<!-- optional -->` markers and hint text extraction

## Key files
- `src/triage/types.ts` — TemplateDefinition, TriageValidationResult, SectionResult types
- `src/triage/template-parser.ts` — parseTemplate(), diffAgainstTemplate()
- `src/triage/template-parser.test.ts` — 21 tests, all passing

## Test results
- 21/21 tests pass
- Covers: frontmatter parsing, section extraction, optional markers, diffing, placeholders, case-insensitive matching

## Decisions
- Used regex for YAML frontmatter parsing instead of adding a YAML dependency (simple key-value fields)
- Placeholder detection includes N/A, None, TBD, whitespace-only, and hint-text-matching patterns

# Plan 105-02 Summary: Triage Validation Agent (TDD)

## What was built
- `validateIssue()` reads templates from workspace, matches best-fit, diffs against issue body
- `generateGuidanceComment()` produces friendly bulleted missing-section guidance
- `generateLabelRecommendation()` returns convention-based `needs-info:{slug}` labels with allowlist gating
- `generateGenericNudge()` returns template-suggestion message for unmatched issues

## Key files
- `src/triage/triage-agent.ts` — validateIssue, generateGuidanceComment, generateLabelRecommendation, generateGenericNudge
- `src/triage/triage-agent.test.ts` — 20 tests, all passing

## Test results
- 20/20 tests pass
- Covers: valid issues, missing sections, empty sections, no template match, null body, best-fit selection, guidance comments, label recommendations, generic nudge

## Decisions
- Used real filesystem (mkdtemp) for tests instead of mocking fs modules -- more reliable
- Best-fit template matching counts heading matches, requires at least 1
- Label allowlist supports both exact match and prefix match patterns
