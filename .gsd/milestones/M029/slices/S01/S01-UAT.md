# S01 UAT — Prompt Fix + Content Filter

**Milestone:** M029  
**Slice:** S01  
**Date:** 2026-03-21  
**Verification class:** Unit tests (deterministic, no external deps)

---

## Preconditions

- Working directory: `/home/keith/src/kodiai/.gsd/worktrees/M029`
- Bun runtime available (`bun --version`)
- No DB or LLM connection required

---

## Test Cases

### TC-01: isReasoningProse — five banned starters each return true

**Purpose:** Verify all five starters from the spec trigger the filter.

```
bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "returns true"
```

**Expected:** 5 tests pass. Each starter (`I'll`, `Let me`, `I will`, `Looking at`, `I need to`) individually returns `true`.

---

### TC-02: isReasoningProse — valid wiki content returns false

**Purpose:** Verify that real MediaWiki content with PR citation is not rejected.

```
bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "returns false for valid wiki content"
```

**Expected:** 1 test passes. A string like `"The [[Xbox 360]] was released..."` with a PR citation returns `false`.

---

### TC-03: isReasoningProse — edge cases do not false-positive

**Purpose:** Verify empty string and mid-text occurrences are safe.

```
bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "returns false"
```

**Expected:** All "returns false" tests pass:
- Empty string → false
- Mid-text occurrence (e.g. `"The section I'll describe..."`) → false

---

### TC-04: isReasoningProse — case-insensitive match

**Purpose:** Verify `i` flag in the regex is active.

```
bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "case insensitive"
```

**Expected:** 1 test passes. A lowercase variant (e.g. `"i'll analyze..."`) returns `true`.

---

### TC-05: generateWithVoicePreservation drops reasoning-prose suggestions

**Purpose:** Verify the pipeline short-circuit fires and produces the correct observable failure shape.

```
bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "drops suggestion"
```

**Expected:** 1 test passes. When `generateFn` returns `"I'll analyze the evidence from PR #27909..."`:
- `suggestion` is `""`
- `voiceMismatchWarning` is `false`
- `validationResult.passed` is `false`
- `validationResult.feedback` is `"Reasoning prose detected: suggestion dropped"`

No LLM validation calls are made.

---

### TC-06: buildVoicePreservingPrompt contains Output Contract section

**Purpose:** Verify the prompt instructs the LLM to avoid reasoning starters.

```
bun test src/knowledge/wiki-voice-analyzer.test.ts --test-name-pattern "Output Contract"
```

**Expected:** 1 test passes. The string returned by `buildVoicePreservingPrompt` with minimal inputs:
- Contains `"## Output Contract"`
- Contains `"Do NOT"`
- Contains `"I'll"` (the banned starter listed verbatim in the contract)

---

### TC-07: Full test suite passes — no regressions

**Purpose:** Confirm all 30+32 tests pass with no existing tests broken.

```
bun test src/knowledge/wiki-voice-validator.test.ts src/knowledge/wiki-voice-analyzer.test.ts
```

**Expected:**
- `wiki-voice-validator.test.ts`: 30 pass, 0 fail
- `wiki-voice-analyzer.test.ts`: 32 pass, 0 fail
- Total: 62 tests, 0 failures

---

### TC-08: Implementation is present in source files

**Purpose:** Confirm the code artifacts exist (grep sanity check).

```bash
grep -q "export function isReasoningProse" src/knowledge/wiki-voice-validator.ts && echo "PASS: isReasoningProse exported"
grep -q "Output Contract" src/knowledge/wiki-voice-analyzer.ts && echo "PASS: Output Contract in prompt"
grep -q "isReasoningProse(suggestion)" src/knowledge/wiki-voice-validator.ts && echo "PASS: gate wired in generateWithVoicePreservation"
```

**Expected:** All three lines print `PASS:`.

---

### TC-09: Drop fires before LLM calls (observability verification)

**Purpose:** Confirm reasoning-prose drops are observable and do not incur LLM cost.

Run the isolated test:

```
bun test src/knowledge/wiki-voice-validator.test.ts --test-name-pattern "drops suggestion"
```

Check the test structure — the mock `generateFn` returns reasoning prose synchronously; there is no `validateVoiceMatch` call in the test. The return value is inspected without any LLM stub needed.

**Expected:** Test passes. No `validateVoiceMatch` mock is needed, confirming the short-circuit fires before voice validation.

---

## Edge Cases

| Input | isReasoningProse result | Why |
|-------|------------------------|-----|
| `""` (empty) | `false` | Empty string never matches anchored regex |
| `"   I'll start writing"` (leading whitespace) | `true` | `trim()` removes whitespace before matching |
| `"The section I'll cover..."` | `false` | Anchor (`^`) prevents mid-text match |
| `"i need to update this"` (lowercase) | `true` | `i` flag covers case variants |
| `"I'll"` (starter only, no continuation) | `true` | Minimal match still triggers |
| Valid MediaWiki with `[[Links]]` and `{{Templates}}` | `false` | Not a reasoning starter |

---

## Definition of Done for S01

All of the following must be true:

- [ ] `bun test src/knowledge/wiki-voice-validator.test.ts` exits 0 with 30 tests passing
- [ ] `bun test src/knowledge/wiki-voice-analyzer.test.ts` exits 0 with 32 tests passing
- [ ] `grep -q "export function isReasoningProse" src/knowledge/wiki-voice-validator.ts` exits 0
- [ ] `grep -q "Output Contract" src/knowledge/wiki-voice-analyzer.ts` exits 0
- [ ] `grep -q "isReasoningProse(suggestion)" src/knowledge/wiki-voice-validator.ts` exits 0
