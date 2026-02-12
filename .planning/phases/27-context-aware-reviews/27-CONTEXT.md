# Phase 27: Context-Aware Reviews - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable reviews to adapt to repository-specific conventions and risk patterns through path-scoped instructions, named profile presets, and deterministic diff analysis. The system enriches the review prompt with contextual intelligence before the LLM call, producing more targeted and relevant findings.

This phase does NOT include learning from past reviews (Phase 28) or feedback capture (Phase 29).

</domain>

<decisions>
## Implementation Decisions

### Path Instruction Matching
- Support negative patterns with `!` prefix for exclusions (e.g., `!**/*.test.ts`)
- Multiple match handling: Claude's discretion (choose sensible approach)
- Config structure: Claude's discretion (array vs map - pick most intuitive)
- Fallback behavior: Claude's discretion (define what happens when no patterns match)

### Diff Analysis Strategy
- File categorization: Hybrid approach with sensible defaults that users can override
- Risk signals to detect:
  - Auth/security patterns (auth*, login, password, token, jwt, session files/imports)
  - Dependency changes (package.json, go.mod, requirements.txt modifications)
  - Error handling changes (try/catch, error boundaries, panic/recover patterns)
- Complexity metrics: Full metrics tracked (lines added/removed, files touched, hunks count)
- Performance boundaries: Both time budget AND file count limit with graceful degradation for large PRs

### Prompt Enrichment
- Path instruction presentation: Claude's discretion (group by pattern/file/inline - choose clearest)
- Diff analysis formatting: Claude's discretion (structured summary vs prose vs tags - pick what Claude reads best)
- Token budget overflow: Claude's discretion (design smart truncation/prioritization strategy)
- Analysis metadata: Implicit context only - provide enriched data without meta-commentary about what analysis was performed

### Claude's Discretion
- Exact glob matching algorithm and precedence rules
- Config schema structure (array of objects vs map)
- Fallback behavior for unmatched paths
- Prompt formatting for path instructions and diff analysis
- Token budget management strategy
- File categorization default patterns

</decisions>

<specifics>
## Specific Ideas

- Success criteria specify these concrete examples:
  - `review.pathInstructions` with glob patterns applying different rules per directory
  - Example: stricter security checks for `src/api/**`
  - Named profiles: `strict`, `balanced`, `minimal` as preset bundles
  - Deterministic analysis runs BEFORE LLM call (no extra API cost)

- Performance requirements are explicit:
  - File categorization: source/test/config/docs
  - Risk signals must be detectable without LLM
  - Diff analysis must be deterministic and fast

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

Profile preset design was listed as a gray area but not selected for discussion. Implementation of profiles (what strict/balanced/minimal configure, customization, interaction with explicit config) is left to researcher and planner.

</deferred>

---

*Phase: 27-context-aware-reviews*
*Context gathered: 2026-02-11*
