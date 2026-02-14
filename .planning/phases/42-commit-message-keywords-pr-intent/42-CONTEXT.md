# Phase 42: Commit Message Keywords & PR Intent - Context

**Gathered:** 2026-02-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Parse PR metadata (title, body, commit messages) to extract review intent signals that guide Kodiai's review behavior. This phase focuses purely on **detection and parsing** — the parsed signals will be used by Phase 43+ to influence review behavior.

</domain>

<decisions>
## Implementation Decisions

### Keyword format & detection rules
- **Case sensitivity:** Case-insensitive matching for all bracket tags (`[WIP]`, `[wip]`, `[Wip]` all match)
- **Position in title:** Bracket tags can appear anywhere in the PR title ("Fix bug [WIP]" and "[WIP] Fix bug" both work)
- **Conventional commit support:** Yes — parse conventional commit prefixes (`feat:`, `fix:`, `docs:`) from PR title and extract type
- **Breaking change detection:** Flexible matching for variations ("breaking change", "breaking changes", "this breaks", "breaking API")

### Signal hierarchy & conflict resolution
- **[no-review] behavior:** Hard block — bot skips review entirely when this tag appears in PR title
- **WIP vs "ready for review" conflict:** Claude's discretion — determine priority based on GitHub draft status and common PR workflows
- **Multiple profile keywords:** Most strict wins — when `[strict-review]` and `[minimal-review]` both appear, choose stricter profile
- **Conventional commit type impact:** Affects review focus — `feat:` triggers breaking change checks, `fix:` checks test coverage, `docs:` lighter review

### Commit message parsing scope
- **Parse all commits:** Scan every commit message in the PR for keywords
- **Commit title only:** Parse first line of commit message only — skip multi-line body parsing for footers
- **Signal aggregation:** Union strategy — if ANY commit contains a keyword, the whole PR is flagged with that signal
- **Large PR handling:** Sample strategically for 50+ commits — parse first 10, last 10, and every 5th commit in between

### Transparency & user visibility
- **Display location:** Show parsed keywords in both review summary (brief) and Review Details appendix (full breakdown)
- **Detail level:** Moderate — show what was found and where (e.g., "[WIP] in title, breaking change in commit abc123")
- **Parsing failure handling:** Log in Review Details — show "Keyword parsing: No keywords detected" in appendix if parsing fails
- **Unrecognized keywords:** Yes, show unrecognized — "Found [WIP], [security-review]; ignored [foobar]" helps users learn valid keywords

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for implementing the parsing logic.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 42-commit-message-keywords-pr-intent*
*Context gathered: 2026-02-14*
