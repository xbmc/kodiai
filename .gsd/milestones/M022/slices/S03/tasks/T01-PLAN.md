# T01: 108-pr-issue-linking 01

**Slice:** S03 — **Milestone:** M022

## Description

Create the two core modules for PR-issue linking: a pure regex-based reference parser and an orchestrator that resolves parsed references to issue records with semantic search fallback.

Purpose: Provide fully tested, isolated building blocks that Plan 02 will wire into the review handler. By keeping the parser pure (zero I/O) and the linker as a thin orchestrator, both are independently testable.

Output: Tested issue-reference-parser module, tested issue-linker module.

## Must-Haves

- [ ] "PR body and commit messages are parsed for explicit issue references using fixes, closes, resolves, and relates-to keywords (case-insensitive)"
- [ ] "Cross-repo references within the same org (org/repo#N) are recognized alongside same-repo (#N) patterns"
- [ ] "References inside markdown code blocks (triple-backtick sections) are excluded to prevent false positives"
- [ ] "When explicit references are found, semantic search is skipped entirely (trust the author's references)"
- [ ] "When no explicit references exist, semantic search queries IssueStore with PR title + body + diff summary as the query"
- [ ] "Semantic matches are filtered by 0.80 similarity threshold (0.20 max cosine distance) and capped at 3 results"
- [ ] "If embedding generation or vector search fails, the linker returns empty semantic matches (fail-open)"
- [ ] "Issues that don't exist in the corpus (getByNumber returns null) are silently skipped with a log warning"

## Files

- `src/lib/issue-reference-parser.ts`
- `src/lib/issue-reference-parser.test.ts`
- `src/knowledge/issue-linker.ts`
- `src/knowledge/issue-linker.test.ts`
