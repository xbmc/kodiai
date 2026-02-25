# Phase 94: [depends] PR Deep Review - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Kodiai produces a structured deep-review comment on Kodi-convention dependency bump PRs. Detects `[depends]` and dependency-bump title patterns, fetches upstream changelogs, assesses impact on Kodi's codebase, verifies hashes/URLs, checks transitive dependencies, and posts a structured review comment. Detection is mutually exclusive with existing Dependabot/Renovate pipeline.

</domain>

<decisions>
## Implementation Decisions

### Detection & Routing
- Title-only detection — no file path analysis
- Broad matching: `[depends] Bump X Y.Z`, `[Platform] Refresh X Y.Z`, plus variations like "Update X to Y.Z", "Upgrade X"
- [depends] detector runs first in the pipeline; if matched, Dependabot path is skipped entirely
- Standard code review is conditional: only post it if the PR contains code changes beyond the dependency bump itself (e.g., source file modifications, not just cmake/build config)

### Review Comment Structure
- Technical and concise tone — assumes experienced C/C++ maintainers
- TL;DR verdict first (safe/risky/needs-attention), then expand into sections: version diff, changelog highlights, impact assessment, inline suggestions
- Inline suggestions woven into relevant sections rather than a separate action-item checklist
- Top-level summary comment on the PR, plus inline review comments on specific files where findings are relevant (e.g., hash mismatches on cmake files)

### Changelog & Version Analysis
- Fetch from GitHub releases API first, fall back to scraping project websites / NEWS files
- Filter to Kodi-relevant entries only: breaking changes, API changes, security fixes, build system changes — skip internal refactors
- When changelog unavailable: note it, fall back to analyzing the PR diff for clues, and provide upstream project URL for manual review
- Version detection: parse from PR title first (e.g., "Bump zlib 1.3.1 → 1.3.2"), fall back to diff analysis of cmake/build config if title doesn't contain both versions

### Impact Assessment
- Find direct consumers via #include directives and cmake target_link_libraries, then trace one level of transitive includes
- Hash/URL verification: fetch upstream release, compute hash, compare to PR values — flag mismatches, confirm matches, note when verification isn't possible
- Surface relevant retrieval context: query learning memories and wiki for past reviews/issues about this dependency (leveraging Phase 93's language-aware retrieval)

### Claude's Discretion
- Transitive dependency checking depth — determine feasibility based on Kodi's cmake-based dependency structure during research
- Exact degradation messaging and formatting
- How to handle multi-dependency bumps in a single PR

</decisions>

<specifics>
## Specific Ideas

- The deep review replaces the standard code review for pure dependency bumps — only add standard review if the PR touches actual source code beyond build configs
- Past dependency context (e.g., "last bumped in PR #1234, had build issues") should surface in the review to give maintainers historical awareness

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 94-depends-pr-deep-review*
*Context gathered: 2026-02-25*
