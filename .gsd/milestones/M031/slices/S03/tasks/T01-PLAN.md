---
estimated_steps: 18
estimated_files: 2
skills_used: []
---

# T01: Add scanOutgoingForSecrets() to sanitizer.ts with full unit tests

Add the SecretScanResult interface and scanOutgoingForSecrets() function to src/lib/sanitizer.ts. Add a describe("scanOutgoingForSecrets") block to src/lib/sanitizer.test.ts.

Steps:
1. In src/lib/sanitizer.ts, after sanitizeOutgoingMentions, add:
   - Export interface SecretScanResult { blocked: boolean; matchedPattern: string | undefined; }
   - Export function scanOutgoingForSecrets(text: string): SecretScanResult that iterates 6 named regex patterns and returns { blocked: true, matchedPattern: name } on first match, { blocked: false, matchedPattern: undefined } if none match.
   - Patterns: private-key (/-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/), aws-access-key (/AKIA[0-9A-Z]{16}/), github-pat (/ghp_[A-Za-z0-9]{36}/), slack-token (/xox[baprs]-[A-Za-z0-9-]{10,}/), github-token (/gh[opsu]_[A-Za-z0-9]{36,}/), github-x-access-token-url (/https:\/\/x-access-token:[^@]+@github\.com(\/|$)/).
   - Do NOT include findHighEntropyTokens — false positive risk too high for outgoing text.
2. In src/lib/sanitizer.test.ts, import scanOutgoingForSecrets. Add describe("scanOutgoingForSecrets", () => { ... }) with tests:
   - Each of the 6 named patterns: construct a matching string, assert blocked:true and matchedPattern === name.
   - github-pat: text = "ghp_" + "A".repeat(36); expect result.blocked === true; expect result.matchedPattern === "github-pat".
   - aws-access-key: text = "AKIAIOSFODNN7EXAMPLE" (20 chars); ensure test string is 4+16=20 chars matching /AKIA[0-9A-Z]{16}/.
   - private-key: text = "-----BEGIN RSA PRIVATE KEY-----".
   - slack-token: text = "xoxb-abc1234567890".
   - github-token: text = "ghu_" + "A".repeat(36).
   - github-x-access-token-url: text = "https://x-access-token:secret@github.com/".
   - Clean text (no match): assert blocked:false, matchedPattern:undefined.
   - Mixed text (secret embedded in prose): text = "Here is the key: ghp_" + "A".repeat(36) + " end"; assert blocked:true.
3. Run bun test src/lib/sanitizer.test.ts and confirm all pass.

## Inputs

- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`

## Expected Output

- `src/lib/sanitizer.ts`
- `src/lib/sanitizer.test.ts`

## Verification

bun test src/lib/sanitizer.test.ts
