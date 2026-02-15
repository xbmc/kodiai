# Phase 39: Language-Aware Enforcement - Context

**Gathered:** 2026-02-13
**Status:** Ready for planning

<domain>
## Phase Boundary

The bot intelligently filters review findings based on language-specific tooling config and enforces safety-critical severity floors for dangerous patterns. This phase delivers:

1. **Suppression** of auto-fixable findings when language-specific tooling config exists (formatters, linters)
2. **Elevation** of safety-critical patterns to appropriate severity regardless of LLM judgment
3. **User override** capability via `.kodiai.yml` for custom language rules

Scope is limited to filtering/elevating findings within existing review pipelines. Adding support for new linters or languages beyond the core set is out of scope.

</domain>

<decisions>
## Implementation Decisions

### Severity Floor Enforcement Strategy

- **Context-aware enforcement**: Severity floors apply conditionally based on code context, not unconditionally to all instances
- **Factors that affect enforcement**:
  - File type (test vs production vs example code) — relax floors in test files
  - Code criticality markers — use file paths, comments, or annotations to identify critical sections
  - Language ecosystem norms — adjust based on how the language community treats the pattern (e.g., Go's strict error handling culture)
- **When a pattern is detected**: Check context factors first, then apply floor if context indicates production/critical code

### Pattern Catalog Scope

- **Hybrid approach to pattern sources**:
  - **Built-in catalog**: Core universally-dangerous patterns (C++ null deref/uninitialized members → CRITICAL, Go unchecked errors/Python bare except → MAJOR)
  - **Project-derived patterns**: Analyze last 100 closed PRs in kodiai repo, extract common safety-critical patterns specific to this project
  - **Pattern classification logic**: If a pattern from PR history is obviously universal (e.g., null pointer issues), add to built-in catalog. If project-specific (e.g., specific API misuse), keep in example `.kodiai.yml` config
- **Initial seed set**: Start with patterns mentioned in requirements + patterns derived from kodiai PR history (not a comprehensive multi-language catalog on day one)
- **Extensibility**: Design pattern definition format to allow easy addition without code changes

### Pattern Analysis from PR History

- **Data source**: Last 100 closed PRs in the kodiai repository
- **What to extract**: Patterns that appeared in review comments or fixes — particularly those related to correctness, safety, or security
- **Focus languages**: TypeScript (primary), any other languages present in the codebase
- **Output**: Document patterns found, severity levels applied, and whether they should be built-in or project-specific

### Claude's Discretion

- Exact data structure for storing patterns (JSON schema, TypeScript types)
- How to detect file type (test vs prod) — heuristics, path patterns, etc.
- How to match LLM-generated findings to known patterns for floor enforcement
- Configuration file format details for `.kodiai.yml` language rules

</decisions>

<specifics>
## Specific Ideas

- "Go thru the last 100 closed PRs and find the common patterns here that affect our project and use them" — real project data should inform the initial pattern catalog
- Context factors should prevent noisy enforcement in test files while maintaining safety in production code
- Language ecosystem norms matter — Go treats unchecked errors more seriously than Python treats bare excepts, severity floors should reflect this

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 39-language-aware-enforcement*
*Context gathered: 2026-02-13*
