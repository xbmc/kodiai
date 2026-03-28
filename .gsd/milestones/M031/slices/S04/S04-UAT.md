# S04: Prompt Security Policy + CLAUDE.md in Workspace — UAT

**Milestone:** M031
**Written:** 2026-03-28T17:49:56.510Z

## UAT: S04 — Prompt Security Policy + CLAUDE.md in Workspace

### Preconditions

- Repository checked out with M031/S04 changes applied
- Bun installed and `bun install` completed
- No external services required — all checks are pure code / filesystem

---

### Test Case 1: buildSecurityPolicySection() content contract

**Goal:** Verify the function returns a correctly structured security policy block.

**Steps:**
1. Run `bun test src/execution/review-prompt.test.ts --test-name-pattern "buildSecurityPolicySection"`
2. Observe: 7 tests pass, 0 fail
3. Confirm: output includes passes for heading, refuse instructions, credential mention, file-read mention, env-probe mention, override-resistance claim, non-empty return

**Expected outcome:** All 7 `buildSecurityPolicySection` tests pass with exit 0.

---

### Test Case 2: buildReviewPrompt() includes security policy

**Goal:** Verify the full review prompt contains the security section.

**Steps:**
1. Run `bun test src/execution/review-prompt.test.ts --test-name-pattern "buildReviewPrompt includes security policy"`
2. Observe: 2 tests pass — one for `## Security Policy` heading presence, one for refuse instruction presence

**Expected outcome:** Both integration tests pass. The security section appears after the epistemic boundary section in the assembled prompt.

---

### Test Case 3: buildMentionPrompt() includes security policy

**Goal:** Verify the mention prompt also carries the security policy.

**Steps:**
1. Run `bun test src/execution/mention-prompt.test.ts --test-name-pattern "epistemic guardrails"`
2. Observe: Tests `includes ## Security Policy section` and `includes refuse instruction in security policy` both pass

**Expected outcome:** 2 security-related mention-prompt tests pass. Security policy present on both PR and issue mention surfaces.

---

### Test Case 4: buildSecurityClaudeMd() content contract

**Goal:** Verify the CLAUDE.md builder returns correctly structured markdown.

**Steps:**
1. Run `bun test src/execution/executor.test.ts`
2. Observe: 8 tests pass including:
   - `returns string containing '## Security Policy'`
   - `result contains refusal response wording`
   - `result contains 'Do NOT'`
   - `result mentions credential protection`
   - `result mentions environment variables`
   - `result contains override-resistance statement`

**Expected outcome:** All 6 content tests pass. CLAUDE.md includes `# Security Policy` heading, `## Credential and Environment Protection` subsection, and five `Do NOT` bullets.

---

### Test Case 5: CLAUDE.md write round-trip

**Goal:** Verify the CLAUDE.md is written to disk correctly and readable back.

**Steps:**
1. Run `bun test src/execution/executor.test.ts --test-name-pattern "CLAUDE.md"`
2. Observe: 2 file-write tests pass:
   - `writing buildSecurityClaudeMd() to CLAUDE.md round-trips correctly`
   - `CLAUDE.md content includes all three Do NOT directives`

**Expected outcome:** Both tests pass. A tmpdir is created, `buildSecurityClaudeMd()` is written to `CLAUDE.md`, read back, and asserted to include the security content. tmpdir cleaned up in afterAll.

---

### Test Case 6: Full slice verification

**Goal:** All three test files pass together with no regressions.

**Steps:**
1. Run `bun test src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts src/execution/executor.test.ts`
2. Observe: 198 pass, 0 fail, ~514 expect() calls, exits 0

**Expected outcome:** Exact counts: 198 pass, 0 fail. No test in any file regresses due to the new security sections.

---

### Test Case 7: Refusal phrasing consistency check

**Goal:** Confirm CLAUDE.md and prompt use consistent, spec-compliant refusal language.

**Steps:**
1. Run: `grep -r "I can't help with that" src/execution/`
2. Run: `grep -r "this falls outside the security policy" src/execution/`

**Expected outcome:** Both strings appear in `executor.ts` (CLAUDE.md content) and `review-prompt.ts` (security policy section). The exact phrasing is: `"I can't help with that — this falls outside the security policy for this assistant."`

---

### Test Case 8: Security section placement in review prompt

**Goal:** Verify security section follows epistemic section in buildReviewPrompt.

**Steps:**
1. Run a quick Node/Bun eval:
   ```bash
   cd /path/to/repo
   bun -e "import { buildReviewPrompt } from './src/execution/review-prompt.ts'; const r = buildReviewPrompt({diff: 'x', repoContext: {owner:'o', repo:'r', prNumber: 1, title: 't', author: 'a', headBranch: 'b', baseBranch: 'main', isFork: false, prBody: ''}, addonRepos:[]}); const ei = r.indexOf('Epistemic Boundaries'); const si = r.indexOf('## Security Policy'); console.log('epistemic at', ei, 'security at', si, 'order correct:', ei < si && si > 0);"
   ```
2. Observe: `order correct: true`

**Expected outcome:** Security policy appears after the epistemic section. Both are present at positive indices.

---

### Edge Cases

- **Repo that already has CLAUDE.md:** The executor overwrites it. This is by design — the ephemeral workspace CLAUDE.md never touches the real repo on GitHub.
- **CLAUDE.md with no writeFile error path:** If `writeFile` throws (e.g., workspace dir doesn't exist), the error propagates and the job fails before `query()` is called — no agent runs without the security policy in place.
- **Agent receives prompt with no retrieval context:** Both `buildMentionPrompt` and `buildReviewPrompt` include the security section regardless of other optional fields (retrieval context, diff analysis, etc.).
