# T01: 54-security-advisory-changelog 01

**Slice:** S04 — **Milestone:** M009

## Description

Create the dep-bump-enrichment module with security advisory lookup, changelog fetching, package-to-repo resolution, and breaking change detection using TDD.

Purpose: This module provides the core enrichment logic that Phase 54 success criteria depend on -- SEC-01/02/03 and CLOG-01/02/03. All functions are pure async with defined I/O, making them ideal TDD candidates.
Output: Fully tested `dep-bump-enrichment.ts` module plus extended `DepBumpContext` type.

## Must-Haves

- [ ] "Advisory lookup returns CVE/GHSA data for a known-vulnerable package+version"
- [ ] "Security-motivated bumps are distinguished from routine bumps"
- [ ] "Changelog fetches release notes between old and new versions"
- [ ] "Breaking changes are extracted from release note content"
- [ ] "Enrichment fails open -- null returned on any error"
- [ ] "Group bumps are skipped (no enrichment attempted)"
- [ ] "Changelog output is bounded to character budget"

## Files

- `src/lib/dep-bump-enrichment.ts`
- `src/lib/dep-bump-enrichment.test.ts`
- `src/lib/dep-bump-detector.ts`
