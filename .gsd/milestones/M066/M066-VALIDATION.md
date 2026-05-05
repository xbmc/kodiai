---
verdict: needs-remediation
remediation_round: 0
---

# Milestone Validation: M066

## Success Criteria Checklist
## M066 Success Criteria

- ✅ Maintainers can explicitly request formatter suggestions on a PR without enabling automatic mode. Evidence: S01 established explicit formatter-suggestion mention intent and default-off config; S04 wired `@kodiai format suggestions` to bypass Claude and run the formatter subflow.
- ✅ Kodiai computes formatter suggestions independently of Jenkins artifacts. Evidence: S02 implemented `runFormatterCommand()`, unified diff parsing, PR commentability indexing, and mapping without Jenkins inputs.
- ✅ Formatter suggestions are designed to appear as same-PR GitHub committable suggested changes, not a new PR or bot-pushed commit. Evidence: S03 publisher tests create one Pull Request Review using inline fenced suggestion comments and no branch/commit/new-PR fallback. Deterministic tests passed fresh in this validation.
- ✅ A combined `@kodiai review & format suggestions` request runs both subflows with independent failure handling. Evidence: S04 mention/orchestration tests prove normal review routing is preserved while formatter diagnostics remain independent.
- ✅ Unsafe or excessive formatter hunks are skipped/capped with visible and logged reasons. Evidence: S02 mapper tests and S04 orchestration tests prove validation-before-capping, skip diagnostics, capped counts, and bounded visible messages.
- ❌ A live deployed smoke proves GitHub accepts at least one Kodiai-generated formatter suggestion. Evidence: S05 produced the verifier and blocked proof artifact; S06 performed authenticated PR #134 smoke but the deployed app handled `@kodiai format suggestions` as a generic formatting question. `docs/smoke/m066-formatter-suggestions.md` records no formatter `mention-format-suggestions` reviewOutputKey, no Kodiai formatter Pull Request Review, no fenced same-PR suggestion comment, and no `m066_s05_ok` verifier output.

## Slice Delivery Audit
| Slice | Claimed output | Delivered? | Evidence |
|---|---|---:|---|
| S01 | Config/default-off semantics and mention-intent handoff | ✅ | S01 summary; config and intent parser tests. |
| S02 | Formatter command/diff parser/safe suggestion mapper | ✅ | S02 summary; formatter-suggestions tests. |
| S03 | Batched same-PR Pull Request Review publisher | ✅ | S03 summary; publisher contract tests. |
| S04 | Explicit and combined orchestration | ✅ | S04 summary; mention/orchestration tests. |
| S05 | Live-proof verifier, docs, and smoke artifact | ⚠️ partial | Verifier/docs delivered; accepted live proof blocked. |
| S06 | Authenticated live-smoke retry proving accepted formatter suggestion | ❌ proof incomplete | S06 summary and smoke artifact show authenticated bounded decline, not accepted GitHub formatter suggestion proof. |

## Cross-Slice Integration
S01→S04 deterministic integration is present: explicit formatter mentions flow through config/intent parsing into command execution, mapping, publisher, and combined-mode orchestration. Fresh validation ran the deterministic M066 regression bundle (`bun test ... && bunx tsc --noEmit --pretty false && bunx eslint ...`) successfully: 189 Bun tests passed, with TypeScript and ESLint completing without emitted errors. The deployed/live integration remains incomplete: S06 shows the currently deployed mention path did not classify the live trigger into the formatter-suggestion subflow.

## Requirement Coverage
R080, R083, and R084 are already validated by deterministic S04/S02 evidence. R077 and R085 remain active/unvalidated because the same-PR committability/live-smoke proof is absent. No requirement status should be advanced during this validation failure path.

## Verification Class Compliance
Code-change verification: passed. `git diff` from merge-base `a270c47f8029e6b2e802c645589720ae43c63905` to HEAD lists non-.gsd implementation/docs files including `src/handlers/mention.ts`, `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestion-publisher.ts`, `scripts/verify-m066-s05.ts`, and docs. Deterministic regression verification: passed fresh with 189 Bun tests and silent successful TypeScript/ESLint continuation. Definition of done: failed because success criteria are not all met despite all six slices being marked complete and all slice summaries existing.


## Verdict Rationale
Milestone M066 cannot be completed because the roadmap explicitly requires live deployed proof that GitHub accepts at least one Kodiai-generated same-PR formatter suggestion, and S06 produced a bounded authenticated negative proof instead.

## Remediation Plan
Add a remediation slice to diagnose and fix why the deployed PR mention path handles `@kodiai format suggestions` as a generic conversational request instead of the explicit formatter-suggestion intent. Deploy the fix, rerun the controlled PR smoke or create a fresh controlled PR with PR-head formatter config, capture a formatter `mention-format-suggestions` reviewOutputKey, same-PR COMMENTED Kodiai Pull Request Review, associated fenced suggestion review comment, and delivery/log correlation, then rerun `bun run verify:m066:s05` until it returns `m066_s05_ok`. Only after that should R077/R085 be validated and the milestone completed.
