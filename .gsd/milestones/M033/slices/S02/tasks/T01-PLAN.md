---
estimated_steps: 17
estimated_files: 2
skills_used: []
---

# T01: Add anthropic-api-key pattern and test cases

Add one new pattern entry to `scanOutgoingForSecrets` in `src/lib/sanitizer.ts`, update the JSDoc comment count (6 → 7) and list, then add three test cases to the `scanOutgoingForSecrets` describe block in `src/lib/sanitizer.test.ts`.

### Steps

1. Open `src/lib/sanitizer.ts`. In `scanOutgoingForSecrets`, append a new entry after the `github-x-access-token-url` entry:
```ts
{
  name: "anthropic-api-key",
  regex: /sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/,
},
```
Pattern breakdown: `sk-ant-` (fixed prefix) + `[a-z0-9]+-` (type slug + version, e.g. `oat01-`, `api03-`) + `[A-Za-z0-9_\-]{20,}` (base64url token body, ≥20 chars to avoid false positives).

2. Update the JSDoc count comment from `Patterns included (6 total)` to `Patterns included (7 total)` and append `- anthropic-api-key: Anthropic API keys and OAuth tokens (sk-ant- prefix)` to the list.

3. Open `src/lib/sanitizer.test.ts`. Locate the `scanOutgoingForSecrets` describe block. Add three new test cases after the last existing test case:
  - Case 1: a realistic `sk-ant-oat01-` token → `blocked:true, matchedPattern:"anthropic-api-key"`
  - Case 2: a realistic `sk-ant-api03-` token → `blocked:true, matchedPattern:"anthropic-api-key"`
  - Case 3: token embedded in prose (e.g. `"Here is my token: sk-ant-api03-..."`)→ `blocked:true, matchedPattern:"anthropic-api-key"`

Use realistic token lengths (≥30 chars body) to match real tokens.

4. Run `bun test ./src/lib/sanitizer.test.ts` and confirm all tests pass.

## Inputs

- ``src/lib/sanitizer.ts` — existing `scanOutgoingForSecrets` function with 6-pattern array and JSDoc`
- ``src/lib/sanitizer.test.ts` — existing `scanOutgoingForSecrets` describe block to extend`

## Expected Output

- ``src/lib/sanitizer.ts` — updated with 7-pattern array including `anthropic-api-key` entry and updated JSDoc`
- ``src/lib/sanitizer.test.ts` — updated with 3 new test cases for `anthropic-api-key` pattern`

## Verification

bun test ./src/lib/sanitizer.test.ts
