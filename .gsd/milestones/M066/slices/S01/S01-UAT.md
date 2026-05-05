# S01: Formatter suggestion config and mention intent — UAT

**Milestone:** M066
**Written:** 2026-05-05T00:17:17.269Z

## UAT: Formatter suggestion config and mention intent

### Preconditions

- The codebase includes the S01 changes in `src/execution/config.ts`, `src/handlers/formatter-suggestion-intent.ts`, `src/execution/types.ts`, and `src/handlers/mention.ts`.
- No live GitHub publisher or formatter command runner is expected in this slice; S01 only proves config and routing contracts.
- Run commands from the repository root.

### Test Case 1 — Default config keeps automatic formatter suggestions off

1. Run `bun test ./src/execution/config.test.ts --timeout 30000`.
2. Inspect the passing config tests named `defaults review.formatterSuggestions when no config exists` and `defaults review.formatterSuggestions when review block omits it`.
3. Expected outcome: parsed config includes `review.formatterSuggestions.automatic === false`, no required `command`, and `maxSuggestions === 10`.
4. Expected outcome: there is no `enabled` gate that would disable explicit formatter-suggestion requests.

### Test Case 2 — Configured formatter suggestion settings parse without enabling write mode

1. In the same config suite, inspect `parses review.formatterSuggestions from YAML without requiring write mode`.
2. Expected outcome: configured `automatic`, `command`, and `maxSuggestions` values parse under `review.formatterSuggestions` while `write.enabled: false` remains independent.
3. Expected outcome: invalid nested formatter-suggestion values fall back through the existing review-section fallback behavior rather than breaking unrelated config parsing.

### Test Case 3 — Explicit format-only mentions produce a descriptor

1. Run `bun test ./src/handlers/formatter-suggestion-intent.test.ts --timeout 30000`.
2. Confirm phrases `format suggestions`, `formatting suggestions`, `suggest formatting fixes`, and `suggest formatting changes` pass.
3. Expected outcome: each phrase returns a serializable descriptor with `requested: true`, `mode: "format-only"`, `source: "explicit-mention"`, and a normalized request string.

### Test Case 4 — Combined review+format mentions produce combined mode

1. In `formatter-suggestion-intent.test.ts`, confirm phrases `review & format suggestions`, `review and format suggestions`, `review + format suggestions`, and `review with format suggestions` pass, including polite prefixes.
2. Expected outcome: each phrase returns `mode: "review-and-format"` so later orchestration can run normal review and formatter suggestions independently.

### Test Case 5 — Broad write-like formatting wording is not classified as suggestions

1. In `formatter-suggestion-intent.test.ts`, confirm non-suggestion cases such as `format this PR`, `please format this PR`, and `can you please format this PR` pass as unmatched.
2. Expected outcome: these broad commands do not produce a formatter-suggestion descriptor and are left to existing write-intent semantics.

### Test Case 6 — Format-only mention stays read-only through full mention handling

1. Run `bun test ./src/handlers/mention.test.ts --timeout 30000`.
2. Confirm `@kodiai format suggestions carries a read-only formatter descriptor when automatic suggestions are off` passes.
3. Expected outcome: executor context includes `formatterSuggestionRequest.mode === "format-only"`, `writeMode` is not enabled, and automatic formatter suggestions being off does not suppress the explicit request.

### Test Case 7 — Explicit suggestion request works without configured formatter command

1. In `mention.test.ts`, confirm `@kodiai suggest formatting fixes works without a configured formatter command` passes.
2. Expected outcome: mention handling still carries `formatterSuggestionRequest` even when config has no formatter command; downstream S02/S04 will decide how to surface missing command execution behavior.

### Test Case 8 — Combined mention preserves normal review routing

1. In `mention.test.ts`, confirm `@kodiai review & format suggestions preserves review routing and carries formatter descriptor` passes.
2. Expected outcome: executor context keeps review `taskType`, `reviewOutputKey`, and `enableInlineTools` semantics while also carrying `formatterSuggestionRequest.mode === "review-and-format"`.

### Final Acceptance Command

Run the slice command:

```sh
bun test ./src/execution/config.test.ts ./src/handlers/formatter-suggestion-intent.test.ts ./src/handlers/mention.test.ts --timeout 30000
```

Expected outcome: all three suites pass. Current final evidence: 245 pass, 0 fail, 1172 expect() calls.
