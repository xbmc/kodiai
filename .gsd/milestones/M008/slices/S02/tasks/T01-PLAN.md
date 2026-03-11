# T01: 43-auto-profile-selection 01

**Slice:** S02 — **Milestone:** M008

## Description

Create a deterministic auto-profile resolver with TDD so PR size-to-profile selection and precedence behavior are predictable and safe.

Purpose: Phase 43 must make review depth adaptive without breaking user intent. This requires one pure function that encodes threshold rules and precedence (keyword > manual config > auto).

Output: `src/lib/auto-profile.ts` with exported resolver and `src/lib/auto-profile.test.ts` with complete red/green coverage.

## Must-Haves

- [ ] "PRs with <=100 changed lines resolve to strict profile"
- [ ] "PRs with 101-500 changed lines resolve to balanced profile"
- [ ] "PRs with >500 changed lines resolve to minimal profile"
- [ ] "Manual config profile overrides auto-profile selection"
- [ ] "Keyword profile override supersedes both manual config and auto-profile"
- [ ] "Resolver emits a machine-readable reason for selected profile"

## Files

- `src/lib/auto-profile.ts`
- `src/lib/auto-profile.test.ts`
