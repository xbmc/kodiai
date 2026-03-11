# T01: 105-triage-agent-wiring 01

**Slice:** S03 — **Milestone:** M021

## Description

Implement the issue template parser using TDD.

Purpose: Parse `.md` issue templates from `.github/ISSUE_TEMPLATE/`, extract required sections, and diff against an issue body to identify missing/empty fields.
Output: `types.ts`, `template-parser.ts`, and `template-parser.test.ts` in `src/triage/`

## Must-Haves

- [ ] "Parser reads .md template files and extracts YAML frontmatter (name, labels, assignees)"
- [ ] "Parser extracts ## section headers as required fields from template body"
- [ ] "Sections marked with <!-- optional --> comment are flagged as optional"
- [ ] "diffAgainstTemplate() identifies absent headings in issue body"
- [ ] "diffAgainstTemplate() identifies headings with empty/placeholder content"
- [ ] "Missing vs empty sections are distinguished in the result"
- [ ] "Templates without YAML frontmatter fall back to header-only parsing"
- [ ] "parseTemplate() returns structured TemplateDefinition with sections array"

## Files

- `src/triage/template-parser.ts`
- `src/triage/template-parser.test.ts`
- `src/triage/types.ts`
