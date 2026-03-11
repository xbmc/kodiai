# T01: 53-dependency-bump-detection 01

**Slice:** S03 — **Milestone:** M009

## Description

Implement the dependency bump detection pipeline as a pure-function module with three stages: detect (DEP-01), extract (DEP-02), and classify (DEP-03).

Purpose: Enable Kodiai to identify, parse, and classify dependency bump PRs from Dependabot/Renovate so downstream review prompts can provide dependency-aware feedback.
Output: `src/lib/dep-bump-detector.ts` with three exported functions + comprehensive test file.

## Must-Haves

- [ ] "detectDepBump returns non-null for Dependabot PRs with title + bot sender signals"
- [ ] "detectDepBump returns non-null for Renovate PRs with title + branch prefix signals"
- [ ] "detectDepBump returns null for human PRs with bump-like titles but no second signal"
- [ ] "extractDepBumpDetails extracts package name, old version, new version, and ecosystem from title + branch"
- [ ] "extractDepBumpDetails marks group bumps as isGroup: true without per-package extraction"
- [ ] "classifyDepBump returns major/minor/patch for valid semver pairs and unknown for unparseable versions"
- [ ] "Non-dependency PRs produce null from detectDepBump with negligible overhead"

## Files

- `src/lib/dep-bump-detector.ts`
- `src/lib/dep-bump-detector.test.ts`
