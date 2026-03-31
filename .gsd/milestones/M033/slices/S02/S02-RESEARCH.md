# S02 Research: Add Anthropic token patterns to outgoing secret scan

## Summary

Single-file, low-risk addition. `scanOutgoingForSecrets` in `src/lib/sanitizer.ts` currently covers 6 patterns (private keys, AWS keys, GitHub tokens, Slack tokens, GitHub auth URLs). It has no coverage for `sk-ant-*` Anthropic tokens despite both `CLAUDE_CODE_OAUTH_TOKEN` (`sk-ant-oat01-...`) and `ANTHROPIC_API_KEY` (`sk-ant-api03-...`) being present in the agent container env.

## Implementation Landscape

### Files to touch
- `src/lib/sanitizer.ts` — add one new pattern entry to `scanOutgoingForSecrets`'s `patterns` array; update JSDoc comment count (6 → 7) and pattern list
- `src/lib/sanitizer.test.ts` — add test cases to the `scanOutgoingForSecrets` describe block

### Current pattern list (for context)
```ts
{ name: "private-key",                regex: /-----BEGIN (?:RSA|...) PRIVATE KEY-----/ },
{ name: "aws-access-key",             regex: /AKIA[0-9A-Z]{16}/ },
{ name: "github-pat",                 regex: /ghp_[A-Za-z0-9]{36}/ },
{ name: "slack-token",                regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
{ name: "github-token",               regex: /gh[opsu]_[A-Za-z0-9]{36,}/ },
{ name: "github-x-access-token-url",  regex: /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/ },
```

### Pattern to add

One pattern covers both token types (OAuth `sk-ant-oat01-` and API key `sk-ant-api03-`). The prefix structure is `sk-ant-` + type slug + version + `-` + token body. Using a broad `sk-ant-` prefix is safer and more future-proof than enumerating specific version strings:

```ts
{
  name: "anthropic-api-key",
  regex: /sk-ant-[a-z0-9]+-[A-Za-z0-9_\-]{20,}/,
}
```

Breakdown:
- `sk-ant-` — fixed prefix on all Anthropic tokens
- `[a-z0-9]+-` — type slug + version (e.g. `oat01-`, `api03-`)
- `[A-Za-z0-9_\-]{20,}` — token body (base64url, real tokens are 100-200+ chars; 20 minimum reduces false positives)

### Tests to add (3 cases)
1. `sk-ant-oat01-` + token body → blocked, `matchedPattern === "anthropic-api-key"`
2. `sk-ant-api03-` + token body → blocked, `matchedPattern === "anthropic-api-key"`
3. Token embedded in prose → still blocked (consistent with existing "secret embedded in prose" test)

### Verification
```
bun test ./src/lib/sanitizer.test.ts
```
All 68 existing tests + new ones must pass.

## Recommendation

One task is sufficient:
- **T01**: Add pattern + update JSDoc, add 3 test cases, run `bun test ./src/lib/sanitizer.test.ts`.

No dependency on other slices. No migration, no new files. The existing test structure in the `scanOutgoingForSecrets` describe block is the pattern to follow exactly.
