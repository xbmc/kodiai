---
estimated_steps: 6
estimated_files: 4
skills_used:
  - test-driven-development
  - test
---

# T03: Wire formatter intent through mention execution context

**Slice:** S01 — Formatter suggestion config and mention intent
**Milestone:** M066

## Description

Propagate the formatter-suggestion descriptor through the real PR mention path while preserving existing explicit-review and write-mode semantics. This task proves explicit formatter requests stay available with `automatic: false`, format-only requests do not trigger write mode, and combined requests keep the review lane plus carry the formatter descriptor for S04.

## Failure Modes

| Dependency | On error | On timeout | On malformed response |
|------------|----------|------------|------------------------|
| GitHub fixture/octokit mocks in `src/handlers/mention.test.ts` | Test should fail with the exact missing mocked endpoint or assertion mismatch. | Bun test timeout fails the task verification command. | Captured executor context assertions should fail rather than allowing silent success. |
| `executor.execute(...)` context contract | TypeScript/Bun test failure should identify missing or mis-typed `formatterSuggestionRequest`. | Not applicable; executor is mocked in these tests. | Descriptor mode/source assertions should fail if malformed. |

## Load Profile

- **Shared resources**: Existing mention queue/coordinator and executor dispatch path; no new external API calls are added in S01.
- **Per-operation cost**: One pure parser call per accepted mention plus an optional field in the executor context; cost is trivial.
- **10x breakpoint**: Existing mention-handler fixture/runtime cost dominates; parser work should not materially affect throughput.

## Negative Tests

- **Malformed inputs**: No-command config still recognizes explicit `suggest formatting fixes`; unsupported formatter wording does not enable write mode.
- **Error paths**: Format-only request with `automatic: false` must not be refused as disabled automatic mode and must not enter write permission failure handling.
- **Boundary conditions**: Combined `review & format suggestions` must preserve explicit review fields (`taskType`, `reviewOutputKey`, `enableInlineTools`) while carrying `mode: "review-and-format"`.

## Steps

1. Add a type-only import for `FormatterSuggestionRequest` in `src/execution/types.ts` and extend `ExecutionContext` with optional `formatterSuggestionRequest?: FormatterSuggestionRequest`.
2. In `src/handlers/mention.ts`, call `detectFormatterSuggestionRequest(userQuestion)` after `stripMention(...)` in both provisional and execution-time paths where explicit review classification is computed.
3. Treat `formatterSuggestionRequest?.mode === "review-and-format"` as an explicit review request so queue lane/review coordination and review prompt behavior are preserved.
4. Include formatter intent in the PR write-intent guard so format-only requests cannot fall through to implicit patch/write detection.
5. Pass `formatterSuggestionRequest` into `executor.execute(...)` and keep `writeMode` false for format-only requests.
6. Add full-handler fixture tests in `src/handlers/mention.test.ts` for format-only with automatic false, no-command explicit request, and combined review+format; run the targeted then full S01 verification commands.

## Must-Haves

- [ ] `ExecutionContext` carries an optional formatter request descriptor.
- [ ] `@kodiai format suggestions` is recognized and `writeMode !== true`.
- [ ] `@kodiai suggest formatting fixes` is recognized even when `review.formatterSuggestions.command` is absent.
- [ ] `@kodiai review & format suggestions` keeps review routing fields and carries `mode: "review-and-format"`.
- [ ] Existing explicit review behavior is not regressed.

## Verification

- `bun test ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000`
- `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000`

## Observability Impact

- Signals added/changed: The executor context now includes `formatterSuggestionRequest` for recognized formatter-suggestion mentions.
- How a future agent inspects this: Use the mention handler fixture tests to inspect captured executor context fields.
- Failure state exposed: Misclassification appears as missing descriptor, wrong descriptor mode, accidental `writeMode`, or missing explicit-review fields in tests.

## Inputs

- `src/execution/types.ts` — execution context contract for passing the descriptor downstream.
- `src/handlers/mention.ts` — mention routing, explicit review detection, write-intent guard, and executor invocation.
- `src/handlers/mention.test.ts` — existing full handler fixture patterns for executor context assertions.
- `src/handlers/formatter-suggestion-intent.ts` — descriptor and parser produced by T02.

## Expected Output

- `src/execution/types.ts` — adds optional `formatterSuggestionRequest` to `ExecutionContext`.
- `src/handlers/mention.ts` — detects formatter requests and passes descriptors without enabling write mode.
- `src/handlers/mention.test.ts` — adds integration tests for format-only, no-command explicit request, and combined review+format mentions.
- `src/handlers/formatter-suggestion-intent.ts` — remains the single source of formatter intent parsing used by mention wiring.
