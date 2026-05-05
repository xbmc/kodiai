---
id: M066
title: "Same-PR Formatter Suggestions"
status: complete
completed_at: 2026-05-05T05:42:22.402Z
key_decisions:
  - Deliver formatter fixes as same-PR GitHub suggestion blocks in inline Pull Request Review comments, not separate PRs, branch pushes, or bot commits.
  - Compute formatter output from the PR workspace through a configured formatter command and unified-diff mapping pipeline instead of relying on Jenkins artifacts or Claude-authored hunks.
  - Keep explicit formatter-suggestion requests always available while `review.formatterSuggestions.automatic` defaults false and controls only future automatic inclusion.
  - Publish formatter suggestions as one batched Pull Request Review with an idempotency marker and all-or-nothing publication result.
  - Use `mention-format-suggestions` as the shared formatter review-output action identity from mention routing through formatter subflow logs and live verification.
key_files:
  - src/execution/config.ts
  - src/execution/types.ts
  - src/handlers/formatter-suggestion-intent.ts
  - src/execution/formatter-suggestions.ts
  - src/execution/formatter-suggestion-publisher.ts
  - src/handlers/formatter-suggestion-orchestration.ts
  - src/handlers/mention.ts
  - scripts/verify-m066-s05.ts
  - scripts/verify-m066-s05.test.ts
  - docs/runbooks/formatter-suggestions.md
  - docs/runbooks/mentions.md
  - docs/configuration.md
  - docs/smoke/m066-formatter-suggestions.md
  - package.json
  - .gsd/REQUIREMENTS.md
  - .gsd/PROJECT.md
lessons_learned:
  - A live smoke can fail before GitHub acceptance: S06 showed the deployed app acknowledged the trigger but never entered formatter intent, so proof diagnostics must separate routing, command, mapper, publisher, and GitHub acceptance boundaries.
  - PR-head formatter config matters for smoke tests when `main` intentionally lacks `review.formatterSuggestions.command`, because Kodiai loads config after checking out the PR head.
  - Outgoing formatter review bodies cannot use the inbound sanitize pipeline that strips HTML comments; idempotency markers need raw secret scanning plus targeted outgoing mention sanitization.
  - Verifier-first proof prevented false completion: S05/S06 recorded blocked/negative proof rather than fabricating `m066_s05_ok`, and S07 only validated R077/R085 after the verifier passed against live GitHub evidence.
  - The local GSD memory store was malformed/unwritable during this milestone, so durable learnings had to be preserved in slice summaries, PROJECT.md, and the final LEARNINGS artifact even when `capture_thought` failed.
---

# M066: Same-PR Formatter Suggestions

**M066 shipped explicit same-PR formatter suggestions: maintainers can request formatter suggestions on a PR, Kodiai computes safe formatter hunks itself, publishes them as GitHub committable suggestions, and live proof on PR #134 verifies GitHub accepted the output.**

## What Happened

M066 built the same-PR formatter suggestion feature in risk-ordered slices. S01 established the default-off `review.formatterSuggestions` config and pure mention-intent parser for `@kodiai format suggestions`, `@kodiai suggest formatting fixes`, and `@kodiai review & format suggestions`, passing a typed formatter request descriptor through `ExecutionContext`. S02 added the deterministic formatter command runner, conservative unified-diff parser, PR RIGHT-side commentability index, and safe suggestion mapper; unsafe, unmappable, malformed, pure insertion/deletion, path-mismatched, and capped hunks become structured diagnostics instead of guessed suggestions. S03 added `publishFormatterSuggestionReview()`, a narrow Octokit publication port that creates one same-PR Pull Request Review with batched inline GitHub suggestion blocks, idempotency markers, outgoing secret scanning, bot-mention sanitization, and all-or-nothing result statuses. S04 wired the real PR mention handler so format-only requests bypass Claude and stay read-only, while combined review-and-format requests run normal review and formatter suggestions independently. S05 created the live-proof verifier and operator docs but truthfully recorded a blocked proof state because authenticated live inputs were unavailable. S06 used an authenticated operator path to create and trigger controlled PR #134, proving the deployed path still handled the trigger as generic conversation and lacked formatter proof. S07 remediated that deployed routing/observability drift by carrying the shared `mention-format-suggestions` identity through mention routing and formatter completion logs, deployed Azure Container Apps revision `ca-kodiai--deploy-20260504-222417`, retriggered PR #134, and captured accepted proof: delivery `462ed8c0-4843-11f1-8135-1c6010084b2c`, same-PR COMMENTED Pull Request Review `4225484818`, fenced suggestion comment `3186219778`, and verifier status `m066_s05_ok`.

Code-change verification passed through milestone-scoped commit evidence because this closeout is running on `main` and the direct `merge-base(main, HEAD)..HEAD` branch diff is empty. Recent M066 task commits touch non-GSD implementation files including `src/execution/config.ts`, `src/handlers/formatter-suggestion-intent.ts`, `src/execution/types.ts`, `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestion-publisher.ts`, `src/handlers/formatter-suggestion-orchestration.ts`, `src/handlers/mention.ts`, `scripts/verify-m066-s05.ts`, tests, docs, and `package.json`; those commits also carry M066/Sxx task trailers and milestone artifacts. Fresh closeout verification then passed: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000` reported 301 pass / 0 fail; `bun run verify:m066:s05 -- --repo xbmc/kodiai --review-output-key <mention-format-suggestions key> --delivery-id 462ed8c0-4843-11f1-8135-1c6010084b2c --json` returned `success: true`, `status_code: "m066_s05_ok"`, review `4225484818`, and suggestion comment `3186219778`; and the chained `bun run tsc --noEmit` exited 0.

Decision re-evaluation: D195 remains valid and was live-proven by the same-PR suggestion review; D196 remains valid because formatter output is generated from the PR workspace rather than Jenkins artifacts; D197 remains valid because automatic inclusion remains default-off while explicit requests work; D198 remains valid because deterministic command/diff mapping produced the accepted suggestion; D199 remains valid because the publisher batches suggestions into one Pull Request Review and GitHub accepted the batch shape. The only revisit flag is future automatic-mode rollout, which must add its own deployed smoke rather than reusing explicit-request proof.

## Success Criteria Results

- PASS — Maintainers can explicitly request formatter suggestions on a PR without enabling automatic mode. Evidence: S01 config/parser tests validate `review.formatterSuggestions.automatic` defaults false while explicit formatter requests still carry a formatter request descriptor; S04/S07 show the explicit `@kodiai format suggestions` path runs.
- PASS — Kodiai computes formatter suggestions independently of Jenkins artifacts. Evidence: S02 implemented configured formatter command execution and unified-diff mapping from the checked-out PR workspace; D196 explicitly rejects Jenkins artifacts; S07 smoke used PR-head formatter config and command output.
- PASS — Formatter suggestions appear as same-PR GitHub committable suggested changes, not a new PR or bot-pushed commit. Evidence: S03 publisher uses one Pull Request Review with inline suggestion comments and no branch/commit/new-PR fallback; S07 live proof captured COMMENTED review `4225484818` and fenced suggestion comment `3186219778` on PR #134.
- PASS — A combined `@kodiai review & format suggestions` request runs both subflows with independent failure handling. Evidence: S04 mention-handler and orchestration tests prove combined requests preserve normal review routing, invoke formatter suggestions, and keep formatter/review failures independently visible.
- PASS — Unsafe or excessive formatter hunks are skipped/capped with visible and logged reasons. Evidence: S02 parser/mapper tests prove invalid/unmappable hunks are skipped and safe candidates are capped after validation; S04 surfaces command, mapping, skipped, capped, publisher, and failure statuses in visible diagnostics/logs.
- PASS — A live deployed smoke proves GitHub accepts at least one Kodiai-generated formatter suggestion. Evidence: S07 deployed revision `ca-kodiai--deploy-20260504-222417`; PR #134 accepted a same-PR COMMENTED Kodiai review with one fenced suggestion comment; fresh closeout `verify:m066:s05` returned `m066_s05_ok`.

## Definition of Done Results

- PASS — All roadmap slices S01–S07 are checked `[x]` in `.gsd/milestones/M066/M066-ROADMAP.md`.
- PASS — `gsd_milestone_status` reports milestone M066 active with 7/7 slices complete and all task counts done.
- PASS — Slice summaries exist for S01 through S07 under `.gsd/milestones/M066/slices/*/*-SUMMARY.md`; UAT files also exist for each slice.
- PASS — Cross-slice integration works: S01 request/config contracts feed S02 command/mapping; S02 payloads feed S03 publisher; S03 publisher feeds S04 orchestration; S04 explicit flow fed the S05/S07 live smoke; S07 remediated the S06 deployed routing gap and produced accepted live proof.
- PASS — Fresh deterministic tests, live verifier, and TypeScript verification passed in closeout.
- NOTE — The existing M066 validation artifact has a `needs-attention` verdict because older S05/S06 summaries intentionally preserve historical blocked-proof language and one validation row omitted an explicit UAT line. This is artifact chronology/coherence debt, not a functional failure after S07: S07 and the smoke artifact provide the accepted proof that closes the earlier gap.

## Requirement Outcomes

- R076 validated — Explicit formatter-suggestion requests are recognized; S01 parser and mention tests cover `@kodiai format suggestions` and `@kodiai suggest formatting fixes`.
- R077 validated — Same-PR committable suggestion proof exists; S07 live smoke posted COMMENTED Pull Request Review `4225484818` with fenced suggestion comment `3186219778`, and `verify:m066:s05` returned `m066_s05_ok`.
- R078 validated — Formatter execution uses repository-configured command seam and bounded/redacted command statuses from S02.
- R079 validated — Automatic formatter suggestions default off while explicit requests remain available, per S01 config and routing tests.
- R080 validated — Combined `@kodiai review & format suggestions` runs review and formatter subflows independently, per S04 tests.
- R081 validated — Publisher creates one batched Pull Request Review with inline suggestions and no standalone-comment fallback, per S03 tests.
- R082 validated — Formatter unified diffs map deterministically only to clean RIGHT-side PR ranges, per S02 parser/mapper tests.
- R083 validated — Unsafe/unmappable/capped hunks produce structured skip/cap visibility, per S02/S04 evidence.
- R084 validated — Formatter failures and combined-mode partial failures are visible without blocking independent successful subflows, per S04 evidence.
- R085 validated — Live GitHub smoke on PR #134 captured trigger, delivery id, formatter `mention-format-suggestions` reviewOutputKey, COMMENTED review, fenced suggestion comment, formatter posted logs, and `m066_s05_ok` verifier output.
- R086 remains active/future — Automatic normal-review inclusion is intentionally not enabled by this milestone.
- R087 and R088 remain deferred — Broad formatter adapters and dry-run preview remain future work.

## Deviations

The planned S05 live proof was blocked by missing credentials and S06 initially produced a bounded deployed decline rather than accepted proof. S07 was added/remediated the deployed formatter-routing/observability gap and captured accepted proof, so the milestone outcome meets the original success criteria. The milestone validation artifact remains `needs-attention` for stale cross-slice artifact language, but closeout verification found no functional completion blocker.

## Follow-ups

Future automatic-mode work should reuse the M066 formatter command/mapping/publisher/verifier seams but must add its own deployed smoke proving repo-config automatic inclusion. Future smokes should preserve PR-head formatter config setup when `main` does not configure a formatter command. Consider reconciling validation artifacts that still show historical S05/S06 blocked-proof language so readers do not miss the later S07 remediation proof.
