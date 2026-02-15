# Phase 26: Review Mode & Severity Control - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Configurable AI code review system that lets users control review strictness through `.kodiai.yml` configuration. Users can specify review mode (standard/enhanced), filter by severity levels, focus on specific issue categories, and receive structured feedback with machine-parseable metadata. The phase delivers noise reduction and focused reviews without requiring workflow changes in target repositories.

</domain>

<decisions>
## Implementation Decisions

### Review Output Structure

**Enhanced mode format:**
- Each inline comment uses structured header with body format
- YAML frontmatter at the top of each comment with required fields:
  - `severity`: critical | major | medium | minor
  - `category`: security | correctness | performance | style | documentation
  - `suggested_action`: fix_required | review_recommended | consider_refactor
  - `related_docs_url`: link to relevant docs (optional, include when applicable)
- YAML frontmatter followed by blank line, then finding details
- No top-level summary comment — each inline comment stands alone

**Standard mode format:**
- Light structure: add severity prefix only (e.g., "[MAJOR]")
- Preserves simpler format for backward compatibility while adding basic structure

**Machine parseability:**
- Enhanced mode uses strict YAML frontmatter for programmatic consumption
- Users building tooling can parse severity/category/suggested_action reliably

### Severity Classification Approach

**Hybrid model: deterministic rules + LLM fallback**
- Known patterns get deterministic severity assignments
- Ambiguous cases defer to LLM with context-aware guidelines

**Four severity levels:**
- CRITICAL: must fix (security vulnerabilities, critical bugs)
- MAJOR: should fix (important bugs, error handling issues)
- MEDIUM: consider fixing (moderate issues, some maintainability concerns)
- MINOR: nice-to-have (code smells, minor improvements)

**Deterministic severity rules for:**
- Security patterns: SQL injection, XSS, auth bypass, secrets exposure → CRITICAL
- Critical bugs: NPE/null pointer, divide by zero, infinite loop → CRITICAL or MAJOR
- Common code smells: unused variables, duplicate code, magic numbers → MINOR
- Error handling issues: unhandled exceptions, swallowed errors → MAJOR or MEDIUM (context-dependent)

**Path-aware severity:**
- Same issue type has different severity based on file path
- Test files, config files, documentation, vs production source code context matters
- Example: unused variable in test file = lower severity than in production code

### Comment Limit Behavior

**7-comment cap:**
- Maximum 7 inline comments per PR review (from success criterion #4)
- Note: User questioned this limit — capture concern for discussion during planning

**Filtering precedence:**
- When more than 7 issues found, prioritization logic TBD
- User indicated concern about fixed limit, wants flexibility discussed
- Communication of omitted findings: TBD

### Focus Area Targeting

**Category taxonomy:**
- Available categories: security, correctness, performance, style, documentation
- Users specify `review.focusAreas: [security, correctness]` in config

**Filtering behavior:**
- `focusAreas` filters by category (include list)
- `ignoredAreas` explicitly excludes categories (exclude list)
- Both can be used together for fine-grained control

**Interaction with noise suppression:**
- Independent mechanisms — both apply
- focusAreas filters by category
- Noise suppression removes style/trivial issues within selected categories
- Style/trivial renamings always suppressed per success criterion #5

### Claude's Discretion

- Exact YAML frontmatter rendering format (choose what renders best in GitHub UI)
- Whether standard mode gets YAML frontmatter with just severity, or text prefix only
- Whether to add `review.format: plain` config option for opting out of structured output
- Comment prioritization strategy when hitting 7-comment limit (severity-first vs diversity vs file-spread)
- How to communicate omitted issues when more than 7 findings exist
- Whether comment limit should be configurable via `review.maxComments` or fixed at 7
- Whether minLevel filtering happens before or after comment limit
- How strictly to suppress non-focus categories (strict only vs critical exception vs soft de-prioritization)

</decisions>

<specifics>
## Specific Ideas

- User questioned the 7-comment hard limit — noted concern about fixed cap potentially hiding important issues
- Standard mode gets "light structure" (severity prefix) to incrementally improve existing behavior without breaking current users
- YAML frontmatter enables users to build tooling on top of Kodiai review output
- Path-aware severity means context matters: test code vs production code affects severity assignment

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 26-review-mode-severity-control*
*Context gathered: 2026-02-11*
