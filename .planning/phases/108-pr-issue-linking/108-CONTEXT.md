# Phase 108: PR-Issue Linking - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

PRs are linked to related issues via explicit references and semantic search, enriching review context. This phase adds reference parsing, semantic issue matching, and review prompt enrichment. It does not add new review capabilities or change review output format beyond the linked issues section.

</domain>

<decisions>
## Implementation Decisions

### Linked issues presentation
- Embedded in the review comment (not a separate bot comment)
- Each issue shown as compact: #42 (open) -- "Login fails on mobile" (title + status + link)
- Two separate sections: "Referenced Issues" for explicit refs, "Possibly Related" for semantic matches
- If no linked issues found (no explicit refs, no semantic matches above threshold), omit the section entirely -- zero noise

### Semantic match behavior
- Surface top 3 candidates maximum
- Conservative / high threshold (80%+ similarity) -- fewer suggestions, higher confidence
- Skip semantic search entirely if explicit refs are found -- trust the author's references
- Search query built from PR title + body + diff summary for richer context matching

### Review prompt enrichment
- Inject linked issue context as: title + status + description summary
- Explicit refs framed as "this PR addresses these issues" (primary context)
- Semantic matches framed as "possibly related" (secondary context)
- Reviewer should include a coverage assessment: whether linked issues appear addressed, partially addressed, or unrelated to the changes
- Closed issues still included in prompt -- useful for understanding prior work, follow-ups, regressions

### Reference pattern handling
- Recognize GitHub standard keywords: fixes, closes, resolves (all case-insensitive)
- Also recognize: relates-to (non-closing reference, case-insensitive)
- Extract references from PR body + commit messages
- Support cross-repo references within the same org (org/repo#N patterns)
- Case-insensitive matching for all patterns

### Claude's Discretion
- Exact regex patterns for reference extraction
- Description summary truncation length
- How diff summary is generated for semantic search input
- Handling of references to issues that don't exist or can't be fetched (404s)

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 108-pr-issue-linking*
*Context gathered: 2026-02-27*
