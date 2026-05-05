---
verdict: needs-remediation
remediation_round: 0
---

# Milestone Validation: M066

## Success Criteria Checklist
- ✅ Maintainers can explicitly request formatter suggestions on a PR without enabling automatic mode — S01 parser/config work and S04 mention-handler tests prove `@kodiai format suggestions` / `@kodiai suggest formatting fixes` route to formatter suggestions while `automatic` defaults false.
- ✅ Kodiai computes formatter suggestions independently of Jenkins artifacts — S02 command/diff pipeline tests prove repository-configured commands generate unified diffs and suggestion payloads without Jenkins artifacts.
- ❌ Formatter suggestions appear as same-PR GitHub committable suggested changes, not a new PR or bot-pushed commit — unit/contract tests prove the intended same-PR Pull Request Review payload shape, but the required live GitHub acceptance proof is missing; S05 and `docs/smoke/m066-formatter-suggestions.md` explicitly mark accepted live proof blocked.
- ✅ A combined `@kodiai review & format suggestions` request runs both subflows with independent failure handling — S04 mention/orchestration tests prove normal review and formatter subflow outcomes are independently reported.
- ✅ Unsafe or excessive formatter hunks are skipped/capped with visible and logged reasons — S02 mapper tests and S04 diagnostics prove skip/cap counts and reasons are returned visibly.
- ❌ A live deployed smoke proves GitHub accepts at least one Kodiai-generated formatter suggestion — not met. `docs/smoke/m066-formatter-suggestions.md` has status `blocked`, no PR review URL, no suggestion comment URL, no `m066_s05_ok` verifier output, and ambient `M066_S05_REPO`, `M066_S05_REVIEW_OUTPUT_KEY`, `GITHUB_APP_ID`, and GitHub private-key variables are unset.

## Slice Delivery Audit
| Slice | Claimed output | Delivered evidence | Verdict |
|---|---|---|---|
| S01 | Config and mention intent | Summary plus regression tests for config parser, formatter intent parser, and mention context handoff | ✅ Delivered |
| S02 | Formatter command runner and diff-to-suggestion mapper | Summary plus formatter-suggestions tests for command execution, conservative diff parsing, RIGHT-side mapping, skips, and caps | ✅ Delivered |
| S03 | Batched same-PR publisher | Summary plus publisher contract tests for one `pulls.createReview` call with inline GitHub suggestion blocks, idempotency, secret scanning, and rejection handling | ✅ Delivered as deterministic contract, not live proof |
| S04 | Explicit/combined orchestration | Summary plus mention/orchestration tests for format-only short-circuit and combined independent subflows | ✅ Delivered |
| S05 | Live smoke proof and docs | Verifier, docs, and blocked proof artifact delivered; accepted live GitHub proof not captured | ❌ Live proof portion not delivered |

## Cross-Slice Integration
The implementation seams integrate through `ExecutionContext.formatterSuggestionRequest`, the S02 formatter mapper, the S03 publisher, and the S04 orchestration helper. Fresh deterministic verification passed: `bun test ./src/handlers/mention.test.ts ./src/handlers/formatter-suggestion-orchestration.test.ts ./src/execution/formatter-suggestions.test.ts ./src/execution/formatter-suggestion-publisher.test.ts ./scripts/verify-m066-s05.test.ts --timeout 30000 && bunx tsc --noEmit --pretty false && bunx eslint ...` completed with 189 tests passing and no TypeScript/ESLint errors. The remaining mismatch is external/live: no authenticated deployed smoke evidence proves GitHub accepted a committable same-PR formatter suggestion.

## Requirement Coverage
R076, R078, R079, R080, R081, R082, R083, and R084 have deterministic fixture/contract evidence. R077 remains active because its validation text requires live smoke proof that GitHub renders Kodiai output as same-PR committable suggestions. R085 remains active/blocked because the required live GitHub smoke proof is absent; S05 explicitly states no `m066_s05_ok` output exists.

## Verification Class Compliance
- Code-change evidence: ✅ branch diff from merge-base `a270c47f8029e6b2e802c645589720ae43c63905` to HEAD includes non-`.gsd/` implementation/docs files including `src/execution/formatter-suggestions.ts`, `src/execution/formatter-suggestion-publisher.ts`, `src/handlers/formatter-suggestion-orchestration.ts`, `scripts/verify-m066-s05.ts`, and docs.
- Deterministic tests/type/lint: ✅ 189 focused tests passed, TypeScript exited 0, and targeted ESLint exited 0.
- Definition of done: ❌ all slices are complete and summaries exist, but milestone-level success criteria are not all satisfied because the live GitHub acceptance smoke is missing.
- Live operational proof: ❌ not available; proof artifact is explicitly blocked.


## Verdict Rationale
Milestone completion is blocked by the roadmap's live committability proof criteria. The code, tests, docs, and verifier exist, but the milestone promised a live deployed smoke showing GitHub accepts at least one Kodiai-generated formatter suggestion; S05 records that proof as blocked rather than accepted.

## Remediation Plan
From an authenticated deployed/operator environment, trigger `@kodiai format suggestions` on a controlled PR with a formatting-only diff, capture the same-PR Pull Request Review URL/id, associated fenced suggestion review comment URL/id, `reviewOutputKey` for `mention-format-suggestions`, delivery id, deployed revision/log correlation, and run `bun run verify:m066:s05 -- --repo "$M066_S05_REPO" --review-output-key "$M066_S05_REVIEW_OUTPUT_KEY" --delivery-id "$M066_S05_DELIVERY_ID" --json` until it returns `success: true` and `status_code: "m066_s05_ok"`. Update `docs/smoke/m066-formatter-suggestions.md` with the real proof, then re-run milestone verification and only then complete M066/update R077/R085.
