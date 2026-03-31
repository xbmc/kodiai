# S02: Add Anthropic token patterns to outgoing secret scan — UAT

**Milestone:** M033
**Written:** 2026-03-31T11:42:40.527Z

## UAT: S02 — Add Anthropic token patterns to outgoing secret scan

### Preconditions
- Repository checked out with M033/S02 changes applied
- `bun` available in PATH (v1.3.8+)

---

### TC-01: Claude Code OAuth token is blocked

**Steps:**
1. Run `bun test ./src/lib/sanitizer.test.ts --filter "sk-ant-oat01"`

**Expected:**
- Test `detects anthropic-api-key (sk-ant-oat01- OAuth token)` passes
- `blocked: true`, `matchedPattern: "anthropic-api-key"`

---

### TC-02: Anthropic API key is blocked

**Steps:**
1. Run `bun test ./src/lib/sanitizer.test.ts --filter "sk-ant-api03"`

**Expected:**
- Test `detects anthropic-api-key (sk-ant-api03- API key)` passes
- `blocked: true`, `matchedPattern: "anthropic-api-key"`

---

### TC-03: Token embedded in prose is still detected

**Steps:**
1. Run `bun test ./src/lib/sanitizer.test.ts --filter "embedded in prose"`

**Expected:**
- Test `detects anthropic-api-key embedded in prose` passes
- `blocked: true`, `matchedPattern: "anthropic-api-key"` even when token appears mid-sentence

---

### TC-04: Full sanitizer test suite passes without regression

**Steps:**
1. Run `bun test ./src/lib/sanitizer.test.ts`

**Expected:**
- 71 pass, 0 fail
- All pre-existing patterns (github-pat, aws-access-key, private-key, slack-token, github-token, github-x-access-token-url) continue to pass
- 3 new anthropic-api-key cases at end of scanOutgoingForSecrets describe block

---

### TC-05: Pattern is the 7th entry and JSDoc is consistent

**Steps:**
1. Inspect `src/lib/sanitizer.ts`

**Expected:**
- JSDoc lists `Patterns included (7 total)`
- `anthropic-api-key: Anthropic API keys and OAuth tokens (sk-ant- prefix)` appears in the list
- The pattern entry `{ name: "anthropic-api-key", regex: /sk-ant-[a-z0-9]+-[A-Za-z0-9_\\-]{20,}/ }` appears after `github-x-access-token-url`

---

### TC-06: Short sk-ant- strings are NOT blocked (false positive guard)

**Steps:**
1. Verify test for `clean text returns blocked:false` still passes
2. Confirm a string like `sk-ant-x-short` (body < 20 chars) would not match by inspecting the regex minimum quantifier `{20,}`

**Expected:**
- No false positives on short synthetic strings
- `blocked: false` for clean text

