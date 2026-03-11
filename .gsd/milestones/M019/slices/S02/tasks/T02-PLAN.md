# T02: 94-depends-pr-deep-review 02

**Slice:** S02 — **Milestone:** M019

## Description

Build the enrichment module for [depends] dependency bumps: VERSION file diff parsing, upstream changelog fetching, hash verification, and patch detection.

Purpose: Provide the factual data layer that powers the deep-review comment. Each enrichment function is deterministic and fail-open, producing structured data or graceful degradation notes.

Output: `src/lib/depends-bump-enrichment.ts` with exported enrichment functions, plus test suite.

## Must-Haves

- [ ] "VERSION file diffs are parsed into old/new version, hash, and archive fields"
- [ ] "Upstream changelog is fetched from GitHub Releases API with C/C++ library-to-repo resolution"
- [ ] "When changelog fetch fails, enrichment falls back to PR diff analysis (synthesizing highlights from version/hash/URL changes) before degrading to unavailable"
- [ ] "SHA512 hash from VERSION file can be verified against upstream tarball"
- [ ] "Patch file additions/removals are detected from PR diff"

## Files

- `src/lib/depends-bump-enrichment.ts`
- `src/lib/depends-bump-enrichment.test.ts`
