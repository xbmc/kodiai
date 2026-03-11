# T01: 24-enhanced-config-fields 01

**Slice:** S03 — **Milestone:** M003

## Description

Add `allowedUsers` field to mention config and upgrade `skipPaths` matching to picomatch globs.

Purpose: CONFIG-07 (mention allowlist) and CONFIG-04 upgrade (picomatch glob matching) complete the user-facing review/mention controls.
Output: Updated config schema, mention handler with user gating, review handler with picomatch skipPaths.

## Must-Haves

- [ ] "Setting mentions.allowedUsers: ['alice'] causes Kodiai to respond only to alice's mentions and ignore everyone else's"
- [ ] "Empty allowedUsers (default) allows all users to trigger mentions"
- [ ] "Setting review.skipPaths: ['docs/**'] skips review when all changed files match the glob pattern"
- [ ] "skipPaths patterns like '*.md' match nested paths (backward-compatible with old behavior)"
- [ ] "Setting review.enabled: false causes Kodiai to skip PR auto-review entirely (already implemented at review.ts:323-336, verified by existing tests)"
- [ ] "Setting review.autoApprove controls whether Kodiai auto-approves PRs (already implemented at review.ts:542, verified by existing tests)"
- [ ] "Setting mention.enabled: false causes Kodiai to ignore all @kodiai mentions (already implemented at mention.ts:330-336, verified by existing tests)"
- [ ] "Setting write.allowPaths restricts which files write-mode can modify (already implemented at workspace.ts:310-319, verified by existing tests)"
- [ ] "Setting write.denyPaths blocks write-mode from modifying matching files (already implemented at workspace.ts:300-308, verified by existing tests)"

## Files

- `src/execution/config.ts`
- `src/execution/config.test.ts`
- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
- `src/handlers/review.ts`
- `src/handlers/review.test.ts`
- `src/jobs/workspace.test.ts  # read-only: verify pre-existing CONFIG-08/09 tests pass`
