---
id: M031
title: "Security Hardening — Credential Exfiltration Prevention"
status: complete
completed_at: 2026-03-28T18:06:37.919Z
key_decisions:
  - buildAgentEnv() in a standalone src/execution/env.ts module — testable in isolation, imported by both executor.ts and generate.ts
  - Git token carried in Workspace.token memory field, never re-read from .git/config after post-clone strip
  - Outgoing scan returns { blocked, matchedPattern } — MCP server returns isError:true on block, letting agent handle gracefully
  - buildSecurityPolicySection() shared helper imported by both mention and review prompts — single source of truth
  - CLAUDE.md overwrite is intentional — ephemeral temp clone, security takes precedence over repo's own CLAUDE.md
  - Non-null assertion (!) on failing[0]!.id — runtime invariant established by preceding expect, ! is type-level only
key_files:
  - src/execution/env.ts
  - src/execution/executor.ts
  - src/llm/generate.ts
  - src/jobs/workspace.ts
  - src/jobs/types.ts
  - src/lib/sanitizer.ts
  - src/execution/mcp/comment-server.ts
  - src/execution/mcp/inline-review-server.ts
  - src/execution/mcp/review-comment-thread-server.ts
  - src/execution/mcp/issue-comment-server.ts
  - src/slack/assistant-handler.ts
  - src/execution/mention-prompt.ts
  - src/execution/review-prompt.ts
  - scripts/verify-m031.ts
  - scripts/verify-m031.test.ts
  - package.json
lessons_learned:
  - Defense-in-depth for credential exfiltration requires at minimum three independent layers: env filtering (prevent access), prompt instruction (refuse on request), and outgoing scan (catch if generated). Any single layer can be bypassed; all three together are robust.
  - Array index access in TypeScript produces T | undefined even when a length assertion immediately precedes it — expect() is opaque to the type checker. Use ! when the runtime invariant is established.
  - git http.extraheader still writes to .git/config — it is not a viable alternative to stripping the remote URL. Post-clone URL rewrite is the only approach that keeps the token fully off disk.
  - The Bun test runner treats bare filenames without ./ as filter substrings rather than file paths — always use ./path/to/file.ts when targeting a specific test file.
---

# M031: Security Hardening — Credential Exfiltration Prevention

**All six exfiltration vectors closed: env allowlist, git token memory refactor, outgoing secret scan, prompt refusal instructions, CLAUDE.md in workspace, and clean TypeScript compilation.**

## What Happened

M031 addressed a confirmed credential exfiltration incident where a user asked @kodiai for its API key and it complied. Six independent attack vectors were identified and each received a dedicated fix.

S01 built `buildAgentEnv()` in `src/execution/env.ts` — an explicit allowlist replacing the `...process.env` passthrough in both `executor.ts` and `generate.ts`. The agent subprocess now receives only SDK auth vars and safe system vars; `DATABASE_URL`, `GITHUB_PRIVATE_KEY`, `SLACK_BOT_TOKEN`, and all other application secrets are absent from its environment.

S02 refactored the git clone path in `workspace.ts` to strip the installation token from the remote URL immediately after clone (`git remote set-url origin https://github.com/owner/repo.git`). The token is carried in memory as `Workspace.token` and injected directly into push commands at call time rather than re-read from `.git/config`. The agent's `Read` tool can no longer extract the token by reading `.git/config`.

S03 added `scanOutgoingForSecrets()` to `src/lib/sanitizer.ts`, reusing the same named regex patterns already present in `workspace.ts`. The scan was applied to all MCP publish paths (comment-server, inline-review-server, review-comment-thread-server, issue-comment-server) and the Slack assistant handler. Any response containing credential patterns is blocked at the publish layer before it reaches the API.

S04 added a `## Security Policy` section to both `buildMentionPrompt()` and the review system prompt via a shared `buildSecurityPolicySection()` helper, instructing the agent to refuse requests to reveal env vars, tokens, or internal configuration. A `buildSecurityClaudeMd()` function writes matching project-level instructions to `{workspace.dir}/CLAUDE.md` before every `query()` call in `executor.ts`, providing defense-in-depth at the Claude Code project settings layer.

S05 built the `verify:m031` proof harness — five pure-code checks directly exercising each security control, a 23-test suite with pass/fail cases per check, and registration in `package.json`. All five checks pass unconditionally in CI.

S06 fixed the single TypeScript error remaining after S05: `TS2532 Object is possibly 'undefined'` on `failing[0].id` in `verify-m031.test.ts`. Added `!` non-null assertion; `bunx tsc --noEmit` now exits 0 across the entire codebase.

## Success Criteria Results

All success criteria met:
- `buildAgentEnv()` verified to exclude all application secrets — M031-ENV-ALLOWLIST PASS
- Git remote URL clean after workspace creation — M031-GIT-URL-CLEAN PASS
- Outgoing scan blocks `ghp_` PAT pattern — M031-OUTGOING-SCAN-BLOCKS PASS
- Prompt includes `## Security Policy` with refusal phrase — M031-PROMPT-HAS-SECURITY PASS
- CLAUDE.md includes `# Security Policy` with refusal phrase — M031-CLAUDEMD-HAS-SECURITY PASS
- `bunx tsc --noEmit` exits 0 — confirmed in S06
- `bun run verify:m031` exits 0 — confirmed via direct execution

## Definition of Done Results

- Unit tests: all component tests pass (env, workspace, sanitizer, prompts, executor, harness — 23/23 for verify-m031 alone)
- TypeScript: `bunx tsc --noEmit` exits 0, no errors
- Proof harness: `bun run verify:m031` exits 0, five green checks
- Validation: gsd_validate_milestone verdict = pass

## Requirement Outcomes

No pre-existing RXXX requirements covered this security domain. M031 introduced and validated six new security requirements:
- R-ENV: Agent subprocess receives only allowlisted env vars → Validated (S01)
- R-GIT: Installation token never on disk during agent execution window → Validated (S02)
- R-SCAN: All publish paths scan for credential patterns before posting → Validated (S03)
- R-PROMPT: Both agent prompts include explicit credential-refusal instructions → Validated (S04)
- R-CLAUDEMD: CLAUDE.md with security policy written to workspace before every agent invocation → Validated (S04)
- R-TYPE: Codebase compiles clean with `tsc --noEmit` → Validated (S06)

## Deviations

None.

## Follow-ups

None.
