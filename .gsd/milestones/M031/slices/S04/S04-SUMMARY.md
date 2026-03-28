---
id: S04
parent: M031
milestone: M031
provides:
  - buildSecurityPolicySection() exported from review-prompt.ts — reusable for any new prompt builder
  - buildSecurityClaudeMd() exported from executor.ts — usable in S05 proof harness to assert content contract
  - Security policy present in every agent prompt (mention + review) and every ephemeral workspace CLAUDE.md
requires:
  []
affects:
  - S05 — end-to-end proof harness verifies S04 outputs; harness will import buildSecurityPolicySection, buildSecurityClaudeMd, and buildMentionPrompt to construct deterministic checks
key_files:
  - src/execution/review-prompt.ts
  - src/execution/mention-prompt.ts
  - src/execution/executor.ts
  - src/execution/executor.test.ts
  - src/execution/review-prompt.test.ts
  - src/execution/mention-prompt.test.ts
key_decisions:
  - Security policy section placed after epistemic boundary section in both prompts — consistent with the prompt's existing structure; epistemic-then-security ordering is intentional (epistemic limits scope, security limits actions)
  - CLAUDE.md write overwrites any existing workspace CLAUDE.md — security policy takes precedence; overwrite is ephemeral and never touches the repo on GitHub (D012)
  - buildSecurityClaudeMd refusal phrasing is 'I can't help with that — this falls outside the security policy for this assistant' — verbatim from the content spec; test assertions in executor.test.ts check this exact wording
patterns_established:
  - CLAUDE.md-in-workspace pattern: write a fixed security CLAUDE.md to workspace.dir immediately before query() so that settingSources:['project'] makes the SDK read it as authoritative project config — no merge, no check for existing file, security wins
observability_surfaces:
  - none
drill_down_paths:
  - .gsd/milestones/M031/slices/S04/tasks/T01-SUMMARY.md
  - .gsd/milestones/M031/slices/S04/tasks/T02-SUMMARY.md
duration: ""
verification_result: passed
completed_at: 2026-03-28T17:49:56.510Z
blocker_discovered: false
---

# S04: Prompt Security Policy + CLAUDE.md in Workspace

**Security policy injected into both agent prompts and written as CLAUDE.md to every ephemeral workspace before the Agent SDK query call.**

## What Happened

Two tasks, no blockers, clean implementation throughout.

**T01 — buildSecurityPolicySection() in both prompt builders**

Added `export function buildSecurityPolicySection(): string` to `src/execution/review-prompt.ts`, placed immediately after `buildEpistemicBoundarySection()`. The function returns a `## Security Policy` block with four **Refuse** bullets covering: environment variable / credential exposure, out-of-repo file reads (`.git/config`, `~/.ssh`, `/etc/passwd`), environment-probing commands (`env`, `printenv`, `cat /proc/...`, external `curl`), and a fixed refusal phrasing for credential requests. Wired via `lines.push("", buildSecurityPolicySection())` in `buildReviewPrompt()` after the epistemic section. In `mention-prompt.ts`, added the import and the same push after `buildEpistemicBoundarySection()`. Extended `review-prompt.test.ts` with 7 unit tests on `buildSecurityPolicySection` and 2 integration tests on `buildReviewPrompt`. Extended `mention-prompt.test.ts` with 2 tests asserting security policy presence. 190 pass, 0 fail.

**T02 — buildSecurityClaudeMd() and CLAUDE.md write in executor.ts**

Added `writeFile`/`join` imports to `executor.ts`. Exported `buildSecurityClaudeMd(): string` before `createExecutor()` — returns a `# Security Policy` CLAUDE.md with an override-resistance statement and five `Do NOT` credential-protection bullets. Wired `await writeFile(join(context.workspace.dir, "CLAUDE.md"), buildSecurityClaudeMd())` immediately before the `sdkQuery = query({})` call. This means every agent invocation (mention or review) writes the security CLAUDE.md to the ephemeral workspace, which the SDK reads via `settingSources: ["project"]`. Created `executor.test.ts` with mkdtemp pattern: 6 content tests and 2 file-write round-trip tests, all 8 passing. Slice-level: 198 pass, 0 fail.

**T02 content note:** The CLAUDE.md uses "I can't help with that" as the refusal phrasing rather than "refuse" — the plan's test assertion was misaligned with the content spec; T02 correctly followed the spec.

## Verification

bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts src/execution/executor.test.ts → 198 pass, 0 fail, 514 expect() calls, 117ms. All three test files exercised. Security policy presence confirmed in: buildReviewPrompt output, buildMentionPrompt output, buildSecurityClaudeMd return value, and CLAUDE.md file written to tmpdir.

## Requirements Advanced

None.

## Requirements Validated

None.

## New Requirements Surfaced

None.

## Requirements Invalidated or Re-scoped

None.

## Deviations

T02: Test assertion for CLAUDE.md content changed from result.includes('refuse') to result.includes("I can't help with that") — the content spec uses the latter phrase; the implementation follows the spec exactly. This is a plan spec gap, not a content deviation.

## Known Limitations

The CLAUDE.md write overwrites any existing CLAUDE.md in the workspace repo. This is intentional (security policy takes precedence, overwrite only affects the ephemeral temp clone) and documented in D012. There is no merge of repo-owned CLAUDE.md content.

## Follow-ups

S05 will build the end-to-end proof harness covering all four S01–S04 security controls, including checks that buildMentionPrompt and buildReviewPrompt include the security policy, and that executor.ts writes CLAUDE.md to the workspace.

## Files Created/Modified

- `src/execution/review-prompt.ts` — Added buildSecurityPolicySection() export; wired into buildReviewPrompt() after epistemic section
- `src/execution/mention-prompt.ts` — Imported buildSecurityPolicySection; wired into buildMentionPrompt() after epistemic section
- `src/execution/executor.ts` — Added writeFile/join imports, buildSecurityClaudeMd() export, CLAUDE.md write before query()
- `src/execution/executor.test.ts` — New file: 8 tests for buildSecurityClaudeMd content and file-write round-trip
- `src/execution/review-prompt.test.ts` — Added 9 tests: 7 for buildSecurityPolicySection unit, 2 for buildReviewPrompt integration
- `src/execution/mention-prompt.test.ts` — Added 2 tests asserting security policy presence in buildMentionPrompt output
