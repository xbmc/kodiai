# S01: Formatter suggestion config and mention intent

**Goal:** Add the formatter-suggestion configuration and explicit mention-intent contract so `@kodiai format suggestions`, `@kodiai suggest formatting fixes`, and `@kodiai review & format suggestions` are recognized without enabling automatic formatter mode or write mode.
**Demo:** `@kodiai format suggestions` and `@kodiai review & format suggestions` are recognized, and config shows automatic suggestions default off while explicit requests stay allowed.

## Must-Haves

- `review.formatterSuggestions` exists in the repo config shape with `automatic: false` by default, optional `command`, and bounded `maxSuggestions`.
- Explicit formatter-suggestion mentions are parsed by a pure, tested intent function into a serializable descriptor with `format-only` or `review-and-format` mode.
- Mention handling passes the descriptor through `ExecutionContext` for later slices while keeping format-only requests read-only and preserving explicit-review behavior for combined requests.
- The full S01 test command passes: `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000`.

## Proof Level

- This slice proves: Contract + integration proof. The slice proves the config and mention-routing contracts through tracked Bun test files and a full mention-handler fixture path; it does not run the downstream formatter command or GitHub suggestion publisher, which are owned by later slices.

## Integration Closure

Upstream surfaces consumed: `src/execution/config.ts`, `src/handlers/mention.ts`, `src/handlers/mention-types.ts`, and `src/execution/types.ts`. New wiring introduced: mention routing computes a formatter-suggestion descriptor after mention stripping and passes it to `executor.execute(...)` in `ExecutionContext`. Remaining end-to-end work: S02 maps formatter diffs to suggestion payloads, S03 publishes same-PR suggestions, and S04 orchestrates execution for explicit and combined requests.

## Verification

- `bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000`
- Executor-context fixture assertions expose `formatterSuggestionRequest`, `writeMode`, `taskType`, `reviewOutputKey`, and `enableInlineTools` for each mention mode; no formatter command output or secrets are introduced in this slice.

## Tasks

- [x] **T01: Add formatter suggestion config defaults and parsing** `est:45m`
  Add the `review.formatterSuggestions` config contract in the Zod schema using test-first changes. Start with failing tests in `src/execution/config.test.ts` that assert defaults (`automatic: false`, optional `command`, and `maxSuggestions: 10`), configured parsing for all fields, and the ability to set `automatic: true` without implying an `enabled` gate. Then implement the minimal schema in `src/execution/config.ts`, nested under `reviewSchema`, preserving the existing section-level fallback behavior for invalid review config. Keep the field semantics aligned with D197: `automatic` controls only automatic inclusion; explicit requests remain allowed even when it is false.
  - Files: `src/execution/config.ts`, `src/execution/config.test.ts`
  - Verify: bun test ./src/execution/config.test.ts --timeout 30000

- [ ] **T02: Create pure formatter suggestion mention intent parser** `est:1h`
  Create a small pure parser module for formatter-suggestion mentions so downstream slices can consume a stable descriptor without depending on the large mention handler. Write tests first in `src/handlers/formatter-suggestion-intent.test.ts` for format-only phrases (`format suggestions`, `formatting suggestions`, `suggest formatting fixes`, `suggest formatting changes`) and combined phrases (`review & format suggestions`, `review and format suggestions`, `review + format suggestions`, `review with format suggestions`), including polite prefixes. Implement `src/handlers/formatter-suggestion-intent.ts` with a serializable descriptor type containing `requested: true`, `mode: "format-only" | "review-and-format"`, `source: "explicit-mention"`, and `normalizedRequest`. Keep matching conservative: do not classify broad write-like commands such as `format this PR` unless they are suggestion-oriented.
  - Files: `src/handlers/formatter-suggestion-intent.ts`, `src/handlers/formatter-suggestion-intent.test.ts`
  - Verify: bun test ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000

- [ ] **T03: Wire formatter intent through mention execution context** `est:1h30m`
  Propagate the formatter-suggestion descriptor through the real PR mention path while preserving existing explicit-review and write-mode semantics. First extend `ExecutionContext` in `src/execution/types.ts` with optional `formatterSuggestionRequest?: FormatterSuggestionRequest` using a type-only import from the new parser module. In `src/handlers/mention.ts`, compute the descriptor after `stripMention(...)`; treat combined `review-and-format` as an explicit review request; add formatter-intent to the PR write-intent guard so format-only requests do not become write requests; pass the descriptor to `executor.execute(...)`. Add full-handler fixture tests in `src/handlers/mention.test.ts` proving `@kodiai format suggestions` stays read-only with automatic config false, `@kodiai suggest formatting fixes` works even when `command` is absent, and `@kodiai review & format suggestions` preserves review task type/review output key/inline tools while carrying `mode: "review-and-format"`.
  - Files: `src/execution/types.ts`, `src/handlers/mention.ts`, `src/handlers/mention.test.ts`, `src/handlers/formatter-suggestion-intent.ts`
  - Verify: bun test ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000 && bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000

## Files Likely Touched

- src/execution/config.ts
- src/execution/config.test.ts
- src/handlers/formatter-suggestion-intent.ts
- src/handlers/formatter-suggestion-intent.test.ts
- src/execution/types.ts
- src/handlers/mention.ts
- src/handlers/mention.test.ts
