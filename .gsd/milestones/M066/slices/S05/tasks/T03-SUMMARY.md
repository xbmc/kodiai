---
id: T03
parent: S05
milestone: M066
key_files:
  - docs/smoke/m066-formatter-suggestions.md
key_decisions:
  - Did not fabricate or reuse synthetic formatter-suggestion proof; the smoke artifact is explicitly marked blocked until a real same-PR Pull Request Review and fenced suggestion comment are captured.
duration: 
verification_result: mixed
completed_at: 2026-05-05T01:45:30.061Z
blocker_discovered: true
---

# T03: Recorded a blocked M066 S05 live formatter smoke proof with bounded missing-access diagnostics.

**Recorded a blocked M066 S05 live formatter smoke proof with bounded missing-access diagnostics.**

## What Happened

Activated the required GitHub, Azure Container Apps, and verification skills, then checked prior task summaries, the existing smoke proof artifact, the verifier, tests, package scripts, and formatter-suggestion runbook. The existing smoke proof was still a fillable template with no captured live delivery id, formatter reviewOutputKey, PR review URL, suggestion comment URL, deployed revision, or verifier JSON. Ambient shell inspection showed no `GITHUB_TOKEN`, no shell `GITHUB_APP_ID`, no shell `GITHUB_PRIVATE_KEY`/`GITHUB_PRIVATE_KEY_BASE64`, and no Azure CLI environment variables for deployed-revision/log capture. A local verifier probe with a synthetic formatter reviewOutputKey failed closed with `m066_s05_github_unavailable`, proving the verifier does not accept fabricated proof. I replaced `docs/smoke/m066-formatter-suggestions.md` with a bounded blocked proof record that preserves the required proof contract, lists the missing access surfaces and live identifiers, records the failed-closed verifier probe, and documents a retry path using a fresh trigger comment or new PR head commit to avoid idempotency/rate-limit noise. Because accepted live proof could not be produced from the available environment and no proof was invented, this task reports a plan-blocking access/proof gap for the live smoke requirement.

## Verification

Verified the blocked proof artifact contains the required proof terms and retry paths with `rg`. Ran the T01 verifier test suite, including negative coverage for missing reviewOutputKey, malformed keys, wrong action, delivery mismatch, repo mismatch, missing GitHub access, duplicate matching reviews, wrong review state, issue-comment-only surfaces, missing suggestion fences, malformed GitHub data, and GitHub API failures. Ran the full slice formatter-suggestion regression bundle, project typecheck, and targeted ESLint; all passed. The live verifier probe using a synthetic key exited 1 with `m066_s05_github_unavailable`, which is the expected fail-closed outcome and not accepted proof.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key kodiai-review-output:v1:inst-42:xbmc/kodiai:pr-101:action-mention-format-suggestions:delivery-delivery-101:head-head-101 --delivery-id delivery-101 --json` | 1 | ❌ fail | 1159ms |
| 2 | `rg -n "PR URL|reviewOutputKey|formatter review|suggestion comment|verify:m066:s05|m066_s05_ok|mention-format-suggestions" docs/smoke/m066-formatter-suggestions.md` | 0 | ✅ pass | 16ms |
| 3 | `bun test ./scripts/verify-m066-s05.test.ts --timeout 30000` | 0 | ✅ pass | 22300ms |
| 4 | `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000` | 0 | ✅ pass | 19800ms |
| 5 | `bunx tsc --noEmit --pretty false` | 0 | ✅ pass | 17000ms |
| 6 | `bunx eslint src/handlers/mention.ts src/handlers/formatter-suggestion-orchestration.ts src/execution/formatter-suggestions.ts src/execution/formatter-suggestion-publisher.ts scripts/verify-m066-s05.ts scripts/verify-m066-s05.test.ts` | 0 | ✅ pass | 11000ms |

## Deviations

The task plan requested accepted live formatter-suggestion proof, but this environment lacked captured live identifiers and deployed/operator access needed to produce that proof. Per the task plan, I did not invent proof and recorded the proof artifact as blocked instead.

## Known Issues

Accepted R085 live proof remains incomplete. A real operator must trigger `@kodiai format suggestions` on a controlled PR with the Kodiai GitHub App installed, capture the formatter `reviewOutputKey`, delivery id, PR review URL/id, suggestion comment URL/id, deployed revision/log fields, and rerun `bun run verify:m066:s05 -- --repo <owner/repo> --review-output-key <captured-mention-format-suggestions-key> --delivery-id <captured-delivery-id> --json` until it returns `m066_s05_ok`. GSD memory lookup also failed with `database disk image is malformed` before work began.

## Files Created/Modified

- `docs/smoke/m066-formatter-suggestions.md`
