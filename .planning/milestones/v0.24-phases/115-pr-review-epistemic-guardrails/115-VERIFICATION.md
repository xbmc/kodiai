---
phase: 115-pr-review-epistemic-guardrails
status: passed
verified: 2026-03-02
requirements_verified: [PROMPT-01, PROMPT-02, PROMPT-03]
---

# Phase 115: PR Review Epistemic Guardrails — Verification

## Goal Verification

**Phase Goal:** PR review prompt explicitly teaches the LLM to distinguish what it can see in the diff from what it would need external knowledge to assert.

**Status: PASSED**

## Success Criteria Verification

### 1. Review prompt contains explicit epistemic boundary rules separating diff-visible facts from external knowledge claims
**PASSED** — `buildEpistemicBoundarySection()` at line 238 of `src/execution/review-prompt.ts` contains:
- Three-tier knowledge classification (Diff-visible, System-provided enrichment, External knowledge)
- Allowlist for what CAN be asserted (diff-visible items, system enrichment with citations)
- Denylist for what MUST NOT be asserted (library behavior, API changes, release dates, CVE details not from advisory data)
- Common hallucination patterns denylist with specific examples

### 2. When reviewing a dependency bump PR, the bot does not assert specific version numbers, API release dates, or library behavior unless those values appear in the diff
**PASSED** — Multiple layers enforce this:
- `buildEpistemicBoundarySection()` explicitly lists "Specific version numbers not present in the diff or enrichment data" in hallucination denylist
- `buildDepBumpSection()` focus lists rewritten to reference only diff-visible items (lockfile changes, import/export changes, test changes, configuration changes)
- Epistemic reinforcement text added: "Do not assert what this version update contains, fixes, or changes"
- Old external-knowledge-triggering phrases removed: "Breaking API changes in the updated dependency", "Deprecated features that may have been removed", "Migration requirements or compatibility issues"

### 3. Findings about external dependencies reference only what the diff shows
**PASSED** — Dep-bump section instructs to focus on:
- Major bumps: lockfile changes, import/export changes, test file changes, configuration changes (all diff-visible)
- Minor/patch bumps: lockfile consistency, dependency tree changes, import changes (all diff-visible)
- System-provided enrichment (security advisories, changelogs) must be cited with footnote URLs
- Unenriched dep-bumps explicitly note: "No changelog or advisory data available for this update. Review based on diff contents only."

### 4. The "Do NOT use hedged or vague language" instruction is scoped to diff-visible facts only
**PASSED** — The blanket "Do NOT use hedged or vague language" has been completely removed and replaced with:
- Epistemic principle: "Assert what you can verify from the diff and system-provided enrichment. Silently omit what you cannot verify."
- External knowledge claims are not hedged — they are silently omitted entirely
- Stabilizing language grounded in diff evidence ("Test assertions are unchanged, indicating preserved behavior")

## Requirement Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| PROMPT-01 | Verified | `buildEpistemicBoundarySection()` contains three-tier classification with explicit allowlist and denylist |
| PROMPT-02 | Verified | Hallucination denylist includes version numbers, API dates, library behavior; dep-bump epistemic reinforcement prevents assertions |
| PROMPT-03 | Verified | Dep-bump focus lists reference only diff-visible items; enrichment requires footnote citations |

## Must-Haves Verification

| Must-Have | Status |
|-----------|--------|
| Review prompt contains explicit epistemic boundary rules | PASSED |
| buildEpistemicBoundarySection() exists as exported helper | PASSED |
| Epistemic section placed BEFORE conventional commit context | PASSED |
| buildToneGuidelinesSection() no longer contains blanket anti-hedging | PASSED |
| buildDepBumpSection() focus lists rewritten to be diff-grounded | PASSED |
| buildSecuritySection() and buildChangelogSection() output footnote citations | PASSED |
| Conventional commit typeGuidance strings rewritten to be diff-grounded | PASSED |
| General programming knowledge explicitly allowed | PASSED |

## Test Results

```
155 pass, 0 fail, 377 expect() calls
```

25 new tests added covering:
- Epistemic boundary section content and structure (7 tests)
- Tone guidelines rewrite (3 tests)
- Epistemic section placement (2 tests)
- Dep-bump epistemic rewrites (7 tests)
- Security section footnote citations (1 test)
- Changelog section footnote citations (1 test)
- Conventional commit type guidance (4 tests)

3 existing tests updated to reflect new behavior.

---
*Verified: 2026-03-02*
