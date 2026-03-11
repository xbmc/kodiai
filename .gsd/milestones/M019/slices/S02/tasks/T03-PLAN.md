# T03: 94-depends-pr-deep-review 03

**Slice:** S02 — **Milestone:** M019

## Description

Build the impact analysis module for [depends] dependency bumps: #include tracing, cmake dependency parsing, and transitive dependency detection.

Purpose: Determine which parts of the Kodi codebase consume a bumped dependency and whether the bump introduces new transitive dependencies or version conflicts. This data powers the "Impact Assessment" section of the deep-review comment.

Output: `src/lib/depends-impact-analyzer.ts` with exported analysis functions, plus test suite.

## Must-Haves

- [ ] "Files that #include a given library's headers and cmake files that target_link_libraries the library are found via git grep"
- [ ] "One level of transitive includes is traced (if A includes B and B includes target, A is listed)"
- [ ] "cmake Find modules are parsed to detect transitive dependency relationships"
- [ ] "New transitive dependencies introduced by a bump are flagged"
- [ ] "Analysis times out gracefully rather than blocking the review pipeline"

## Files

- `src/lib/depends-impact-analyzer.ts`
- `src/lib/depends-impact-analyzer.test.ts`
