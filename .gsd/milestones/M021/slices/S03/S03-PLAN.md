# S03: Triage Agent Wiring

**Goal:** Implement the issue template parser using TDD.
**Demo:** Implement the issue template parser using TDD.

## Must-Haves


## Tasks

- [x] **T01: 105-triage-agent-wiring 01**
  - Implement the issue template parser using TDD.

Purpose: Parse `.md` issue templates from `.github/ISSUE_TEMPLATE/`, extract required sections, and diff against an issue body to identify missing/empty fields.
Output: `types.ts`, `template-parser.ts`, and `template-parser.test.ts` in `src/triage/`
- [x] **T02: 105-triage-agent-wiring 02**
  - Implement the triage validation agent using TDD.

Purpose: Validate an issue body against repo templates, generate structured guidance comments and label recommendations.
Output: `triage-agent.ts` and `triage-agent.test.ts` in `src/triage/`
- [x] **T03: 105-triage-agent-wiring 03**
  - Wire triage validation into the @kodiai mention path for issues.

Purpose: Connect the template parser and triage agent to the existing mention handler, executor, and prompt builder so that when @kodiai is mentioned on an issue, the bot answers the question AND appends a triage nudge if template fields are missing.
Output: Modified config, executor, mention handler, and mention prompt files with integration tests.

## Files Likely Touched

- `src/triage/template-parser.ts`
- `src/triage/template-parser.test.ts`
- `src/triage/types.ts`
- `src/triage/triage-agent.ts`
- `src/triage/triage-agent.test.ts`
- `src/execution/config.ts`
- `src/execution/executor.ts`
- `src/execution/mention-prompt.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
