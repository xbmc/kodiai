# Phase 28: Knowledge Store & Explicit Learning - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase adds **explicit learning capabilities** to Kodiai. The system persists review findings in a SQLite knowledge store and enables users to teach the bot what to ignore through suppression patterns and confidence thresholds. Users can view quantitative review metrics showing files analyzed, issues found by severity, and suppression activity. This phase focuses on storage, configuration, and metrics — it does NOT include automated learning or feedback loops (that's Phase 29).

</domain>

<decisions>
## Implementation Decisions

### Suppression patterns

- **Format:** Hybrid approach — string patterns with optional metadata (severity/category/paths)
  - Example: `pattern: "missing error handling"` with optional `severity: [minor, medium]` and `paths: ["**/*test*"]`
- **Scope:** Claude decides based on Phase 27 pathInstructions design (likely global by default with optional path scoping)
- **Interaction with focusAreas:** Claude decides most intuitive behavior (likely independent filters that stack)
- **Pattern syntax:** Support both glob wildcards and regex with format prefix
  - `glob:*test*` for simple matching
  - `regex:missing.*handling` for complex patterns
  - Prefix required to distinguish syntax and enable security validation

### Confidence levels

- **Display format:** Percentage score (0-100%) shown in review output
  - Example: "Missing error handling (72% confidence)"
- **Source:** Heuristic-based scoring calculated from deterministic signals
  - No reliance on Claude self-assessment — confidence computed from observable factors
- **Threshold behavior:** Soft filter with separate section
  - Low-confidence findings shown in collapsible "Low Confidence Findings" section
  - Users see everything but can focus on high-confidence issues first
- **Scoring signals:** Confidence heuristics use all three signals:
  - **Severity level** — Critical/major findings score higher
  - **Category type** — Security/bugs higher confidence than maintainability
  - **Pattern matching strength** — Findings matching known patterns score higher

### Review metrics

- **Standard metrics in every summary:**
  - Files and lines analyzed: "Reviewed 12 files, 847 lines changed"
  - Issues by severity: "Found 2 major, 5 medium, 3 minor issues"
- **Placement:** Metrics appear in collapsible "Review Details" section
  - Keeps main summary focused on findings
  - Users can expand for quantitative context
- **Historical tracking:** Yes, full history persisted
  - Store every review's metrics in knowledge store for trend analysis
  - Enables future reporting capabilities
- **Suppression counting:** Separate suppression metrics
  - Show both sections: active findings and suppressed findings
  - Example: "Found 5 major (3 shown, 2 suppressed)"

### Knowledge store structure

- **Persisted data:** All of the above — comprehensive storage
  - **Finding details:** Issue type, severity, category, confidence, file path, line numbers
  - **Review metadata:** PR number, repo, timestamp, config used, files analyzed, lines changed
  - **Suppression matches:** Which suppressions fired and what they blocked
- **Scope:** Both per-repo + optional global
  - Each repo's findings isolated by default (clean boundaries)
  - Optional global store for anonymized pattern sharing across repos
  - Users opt-in to global knowledge sharing
- **Retention policy:** Keep forever
  - Never delete historical reviews
  - Enables long-term trend analysis and learning improvements
  - Storage growth acceptable given SQLite efficiency
- **User access:** CLI query commands
  - Add commands like `kodiai-cli stats --repo=owner/name` for on-demand queries
  - Enable trend analysis: `kodiai-cli trends --repo=owner/name --last-30-days`
  - No direct database export (security boundary)

### Claude's Discretion

- Exact suppression pattern matching algorithm
- Confidence scoring formula calibration
- SQLite schema design and indexing strategy
- CLI command interface details
- Global knowledge store anonymization approach

</decisions>

<specifics>
## Specific Ideas

- Suppression patterns should feel intuitive — most users will use simple glob patterns, advanced users can reach for regex
- Confidence scores help users trust the review — "This is definitely a bug (95%)" vs "Possible issue (45%)"
- Metrics section validates the review value — users want to know scope and thoroughness
- Knowledge store is the foundation for future learning — Phase 29 will add feedback capture, later phases could add automated pattern detection

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Automated learning and feedback loops are explicitly in Phase 29.

</deferred>

---

*Phase: 28-knowledge-store-explicit-learning*
*Context gathered: 2026-02-11*
