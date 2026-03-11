---
id: T01
parent: S03
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
# T01: 105-triage-agent-wiring 01

**# Plan 105-01 Summary: Issue Template Parser (TDD)**

## What Happened

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
