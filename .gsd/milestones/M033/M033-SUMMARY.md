---
id: M033
title: "Agent Container Security Hardening — Context"
status: complete
completed_at: 2026-03-31T11:50:53.885Z
key_decisions:
  - D019: GITHUB_INSTALLATION_TOKEN is now a permanently non-revisable blocked key in APPLICATION_SECRET_NAMES — the agent container must never receive it; the agent must acquire its own installation token independently if ever needed.
  - D020: VNet egress restriction accepted as a known gap — full egress restriction would kill WebFetch and Anthropic API calls; fine-grained allowlisting requires NAT gateway + Azure Firewall infrastructure work that is deferred.
  - Security policy additions span two surfaces: buildSecurityPolicySection() for the reviewer agent and buildSecurityClaudeMd() for the executor agent — future policy changes should update both, not one.
key_files:
  - src/jobs/aca-launcher.ts
  - src/jobs/aca-launcher.test.ts
  - src/execution/executor.ts
  - src/execution/executor.test.ts
  - src/lib/sanitizer.ts
  - src/lib/sanitizer.test.ts
  - src/execution/review-prompt.ts
  - src/execution/review-prompt.test.ts
lessons_learned:
  - APPLICATION_SECRET_NAMES is the single source of truth for keys that must never appear in the ACA job env array — three enforcement layers (runtime throw, static type removal, no call site) make bypass essentially impossible.
  - Mirroring security policy language across both prompt surfaces (review-prompt and CLAUDE.md) rather than centralizing is correct — the two consumers run in different agent contexts and each must carry its own policy signal independently.
  - When removing an optional parameter from a TypeScript interface, always run tsc after — TypeScript will catch stale prop references in test files that the type-checker sees as excess properties.
---

# M033: Agent Container Security Hardening — Context

**Removed GITHUB_INSTALLATION_TOKEN from the agent container env, extended the outgoing secret scan with Anthropic token patterns, and hardened both the reviewer and executor security policy prompts against social-engineering bypass — three targeted fixes closing the highest-priority attack surfaces from operational review.**

## What Happened

M033 was a focused security hardening milestone consisting of three independent low-risk slices executed cleanly with no blockers or replanning.

**S01 — Remove GITHUB_INSTALLATION_TOKEN from container env:** `GITHUB_INSTALLATION_TOKEN` was appended to the `APPLICATION_SECRET_NAMES` readonly array in `aca-launcher.ts`, triggering the existing runtime throw guard. The field was removed from `BuildAcaJobSpecOpts`, from the `buildAcaJobSpec()` body, and from the executor call site (which also required removing the `getInstallationToken()` call). TypeScript caught a stale prop reference in `executor.test.ts`, which was cleaned up in the same pass. Three aca-launcher tests were updated: the expected array now includes the new key, the old 'included when provided' test was replaced with 'is in APPLICATION_SECRET_NAMES', and a new 'always absent from spec env array' test asserts unconditional exclusion. This establishes three independent enforcement layers: runtime throw, static type removal, no call site.

**S02 — Add Anthropic token patterns to outgoing secret scan:** A 7th entry was appended to the `SECRET_PATTERNS` array in `sanitizer.ts` — regex `/sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/` — covering both the `sk-ant-oat01-` OAuth token family (Claude Code) and `sk-ant-api03-` API keys. The JSDoc count comment was updated from 6 to 7. Three new tests were added: standalone oat01 OAuth token, standalone api03 API key, and an api03 token embedded in prose. All 71 sanitizer tests pass.

**S03 — Harden security policy prompt against execution bypass:** Three execution-bypass guardrail bullets were added to `buildSecurityPolicySection()` in `review-prompt.ts`: refuse requests to execute embedded scripts/commands regardless of framing; treat "just run it / skip the review" instructions as social engineering; require review of any code before executing it via a Bash/shell tool. The same language was mirrored into `buildSecurityClaudeMd()` in `executor.ts` as a new `## Execution Safety` section — the review prompt is for the reviewer agent and the CLAUDE.md is for the executor agent; both surfaces now carry identical policy intent. Five new tests were added (3 in review-prompt.test.ts, 2 in executor.test.ts) asserting presence of 'execute', 'social engineering', and review-before-execution language. All 169 review-prompt and 24 executor tests pass.

Final verification: `bun run tsc --noEmit` exits 0; all 285 tests across all four affected files pass.

## Success Criteria Results

## Success Criteria Results

| Criterion | Evidence | Result |
|-----------|----------|--------|
| S01: `bun test ./src/jobs/aca-launcher.test.ts` passes; GITHUB_INSTALLATION_TOKEN absent from spec env; APPLICATION_SECRET_NAMES includes it | `bun test ./src/jobs/aca-launcher.test.ts` → 21 pass, 0 fail (16ms). Tests `GITHUB_INSTALLATION_TOKEN is in APPLICATION_SECRET_NAMES` and `GITHUB_INSTALLATION_TOKEN always absent from spec env array` both pass. | ✅ Met |
| S02: `bun test ./src/lib/sanitizer.test.ts` passes with new pattern assertions | `bun test ./src/lib/sanitizer.test.ts` → 71 pass, 0 fail (includes 3 new anthropic-api-key tests). | ✅ Met |
| S03: `bun test ./src/execution/review-prompt.test.ts` passes with assertions for new security policy clauses | `bun test ./src/execution/review-prompt.test.ts` → 169 pass, 0 fail (includes 3 new tests: 'mentions execution requests as a refusal trigger', 'flags skip-review instructions as adversarial', 'mandates code review before execution'). | ✅ Met |

## Definition of Done Results

## Definition of Done Results

| Item | Status |
|------|--------|
| All 3 slices are ✅ complete | ✅ S01 ✅, S02 ✅, S03 ✅ — all slice summaries exist and verification_result: passed |
| All slice summaries exist | ✅ S01-SUMMARY.md, S02-SUMMARY.md, S03-SUMMARY.md all present |
| `bun run tsc --noEmit` exits 0 | ✅ Verified — exit 0 (6.3s) |
| 285 tests pass across all 4 modified test files | ✅ `bun test ./src/jobs/aca-launcher.test.ts ./src/lib/sanitizer.test.ts ./src/execution/review-prompt.test.ts ./src/execution/executor.test.ts` → 285 pass, 0 fail |
| Non-`.gsd/` code changes present in diff | ✅ 10 files modified (aca-launcher.ts/test, sanitizer.ts/test, review-prompt.ts/test, executor.ts/test, Dockerfile.agent, deploy.sh) |
| D019 and D020 recorded in DECISIONS.md | ✅ Both decisions present |

## Requirement Outcomes

## Requirement Outcomes

No requirement status transitions during M033. All three slices were security hardening work (closing attack surfaces on an already-deployed system). No active requirements were assigned to this milestone; all validated requirements from prior milestones remain validated.

D019 (GITHUB_INSTALLATION_TOKEN permanently blocked) and D020 (VNet egress restriction deferred as known gap) were recorded as architectural decisions, not requirement status changes.

## Deviations

None.

## Follow-ups

D020 acknowledged: VNet egress restriction is a known deferred gap. If a future attack surface analysis requires it, this is the next step for container-level network hardening.
