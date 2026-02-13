# Phase 36: Verdict & Merge Confidence - Research

**Researched:** 2026-02-13
**Domain:** Prompt engineering for verdict semantics, merge recommendation logic, blocker/suggestion labeling, and sanitizer verdict validation
**Confidence:** HIGH

## Summary

Phase 36 reshapes the Verdict section and Suggestions section of the five-section review template to deliver explicit merge recommendations that are driven by the presence or absence of blockers. The core principle is simple: CRITICAL and MAJOR findings are blockers; everything else (MEDIUM, MINOR, suggestions) is non-blocking. The verdict must reflect this binary cleanly with one of three states that map to emoji+label patterns. The Suggestions section must explicitly label all items as optional or future considerations, and suggestions must never influence the verdict.

The implementation requires changes to three areas: (1) the prompt template in `review-prompt.ts` -- rewrite the Verdict section to use the three-state merge recommendation model with blocker-driven logic, rewrite the Suggestions section to enforce explicit "Optional"/"Future consideration" labeling, and add a hard requirement linking verdict state to blocker count; (2) the sanitizer in `comment-server.ts` -- update the verdict validation regex and add structural checks to ensure the verdict emoji matches the Observations content (no warning emoji when zero CRITICAL/MAJOR findings exist); and (3) prompt-level instructions that define "blocker" precisely so Claude's verdict is deterministic based on the Impact subsection content.

This phase requires zero new dependencies. All changes are prompt template rewrites and sanitizer validation updates. Phase 35's Impact/Preference split with severity-tagged findings provides the structural foundation: blockers are identified by looking for `[CRITICAL]` or `[MAJOR]` tags under `### Impact`.

**Primary recommendation:** Replace the current three verdict lines (Looks good / Needs changes / Blocker) with three merge-confidence verdict lines (Ready to merge / Ready to merge with minor items / Address before merging). Add a "Verdict Logic" prompt section that defines blocker = CRITICAL or MAJOR, and instructs Claude to count blockers from Impact to determine the verdict. Update the sanitizer to validate that the verdict emoji is consistent with the Observations content. Rewrite the Suggestions section template to require "Optional:" or "Future consideration:" prefixes on every item.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | -- | -- | All existing deps are sufficient |

This phase requires zero new dependencies. All changes are prompt engineering and sanitizer logic updates.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bun:test | existing | Test framework | For all new tests |

### Alternatives Considered

None -- this phase is purely about prompt instructions, sanitizer validation rules, and template wording changes.

## Architecture Patterns

### Current Verdict Section (Phase 35 Baseline)

The current verdict section in the prompt template (`review-prompt.ts`, lines 994-997) shows three emoji+label choices:

```markdown
## Verdict
:green_circle: **Looks good** -- <explanation> (only minor suggestions, nothing blocking)
:yellow_circle: **Needs changes** -- <count and summary of issues> (has major/medium issues)
:red_circle: **Blocker** -- <count and summary of critical issues> (has critical issues)
```

**Problems with the current approach:**
1. The labels ("Looks good", "Needs changes", "Blocker") do not provide a merge recommendation -- they describe the review outcome, not what the maintainer should do.
2. There is no explicit link between the verdict state and the presence of blockers (CRITICAL/MAJOR findings under Impact). Claude selects the verdict based on general severity level rather than a deterministic blocker count.
3. `:yellow_circle:` is ambiguous -- it covers both "has MAJOR issues" and "has MEDIUM issues", but MEDIUM issues should not block merging.
4. The SUCCESS criterion says "A PR with zero blockers never shows a warning verdict regardless of how many suggestions exist" -- but the current prompt does not enforce this.
5. The verdict labels do not match FORMAT-03's required states: "Ready to merge", "Ready to merge with minor items", "Address before merging".

### Target Verdict Section (Phase 36)

```markdown
## Verdict
:green_circle: **Ready to merge** -- No blocking issues found
:yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below (no blockers)
:red_circle: **Address before merging** -- [N] blocking issue(s) found (CRITICAL/MAJOR)
```

**Key changes from current:**
1. Labels match FORMAT-03 requirements exactly.
2. `:green_circle:` = zero findings at all (no blockers, no suggestions, no preference items).
3. `:yellow_circle:` = non-blocking findings exist (MEDIUM, MINOR, suggestions) but ZERO CRITICAL/MAJOR. This is NOT a warning verdict -- it explicitly says "Ready to merge."
4. `:red_circle:` = one or more CRITICAL or MAJOR findings exist. These are blockers. The count is included.
5. The verdict is DETERMINISTIC based on the presence of `[CRITICAL]` or `[MAJOR]` findings under `### Impact` in the Observations section. Claude does not exercise judgment on the verdict -- it counts blockers and selects the matching line.

### Current Suggestions Section (Phase 35 Baseline)

```markdown
## Suggestions
- <optional non-blocking improvement>
- <optional non-blocking improvement>
```

**Problems with the current approach:**
1. Items are not explicitly labeled as "Optional" or "Future consideration" (FORMAT-09, FORMAT-10).
2. There is no instruction preventing Claude from treating suggestions as merge blockers.
3. The current hard requirements say "list optional improvements that do not block merging" but do not require a specific labeling prefix.

### Target Suggestions Section (Phase 36)

```markdown
## Suggestions
- Optional: <low-friction cleanup or improvement>
- Future consideration: <larger improvement to address in a follow-up PR>
```

**Key changes from current:**
1. Every suggestion item must start with either "Optional:" or "Future consideration:" prefix (FORMAT-09).
2. Hard requirements explicitly state: "Suggestions are NEVER counted against merge readiness" (FORMAT-10).
3. "Future consideration:" items reference follow-up work (link to issue or propose a TODO).
4. "Optional:" items are immediate, low-friction cleanups.

### Pattern 1: Blocker-Driven Verdict Logic (Prompt Instructions)

**What:** A new prompt section that defines "blocker" and instructs Claude to determine the verdict deterministically from the Observations content.

**Prompt section to add (after the Observations/Suggestions template, before the hard requirements):**

```
## Verdict Logic

A "blocker" is any finding with severity CRITICAL or MAJOR under ### Impact.

Determining the verdict:
1. Count the number of [CRITICAL] and [MAJOR] findings under ### Impact.
2. If count > 0: use :red_circle: **Address before merging** -- [count] blocking issue(s) found
3. If count == 0 AND there are non-blocking findings (MEDIUM, MINOR, or Suggestions): use :yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below
4. If count == 0 AND there are no findings at all: use :green_circle: **Ready to merge** -- No blocking issues found

Suggestions (## Suggestions section) are NEVER counted as blockers. Even if there are 20 suggestions, the verdict is :green_circle: or :yellow_circle:, never :red_circle:.

MEDIUM and MINOR findings are NOT blockers. They produce :yellow_circle: at most.
```

**Why this matters:** The current prompt shows three verdict lines but does not tell Claude when to use each one. Claude uses general judgment, which can lead to a `:red_circle:` for MEDIUM findings or a `:yellow_circle:` when there are only suggestions. The verdict logic section makes the mapping explicit and testable.

**Where to implement:** Add as a new section in `buildReviewPrompt()`, positioned after the summary comment template but before the hard requirements. Alternatively, integrate directly into the hard requirements as additional bullet points.

### Pattern 2: Sanitizer Verdict-Observations Consistency Check

**What:** The sanitizer currently validates that the verdict follows the format `:emoji: **Label** -- explanation`. Phase 36 adds a cross-section consistency check: if the Observations section has zero CRITICAL/MAJOR findings, the verdict MUST NOT use `:red_circle:`.

**Implementation approach:**

The sanitizer already parses the Observations section (tracking severity tags via the `issueLineRe` regex). It can accumulate counts of each severity level during the Observations parsing pass. After both Observations and Verdict are validated independently, a cross-check validates consistency:

```typescript
// After Observations parsing, accumulate blocker count:
let blockerCount = 0;
// ... in the ISSUE state handler, increment blockerCount when severity is CRITICAL or MAJOR

// After Verdict format validation, extract the emoji:
const verdictEmojiMatch = verdictSection.match(
  /^:(green_circle|yellow_circle|red_circle):/m
);
const verdictEmoji = verdictEmojiMatch?.[1];

// Cross-check:
if (blockerCount === 0 && verdictEmoji === "red_circle") {
  throw new Error(
    "Invalid Kodiai review summary: Verdict uses :red_circle: but no CRITICAL or MAJOR findings exist in Observations"
  );
}
```

**Why this matters:** Without this check, Claude could output a red verdict for a PR with only MEDIUM findings. The sanitizer is the last gate before the comment is published, so it ensures the core invariant: "zero blockers never shows a warning verdict."

**Scope:** The cross-check should be a hard error (throw), not a soft warning. The verdict-blocker invariant is the core of Phase 36's success criteria #4 ("A PR with zero blockers never shows a warning verdict regardless of how many suggestions exist"). If the sanitizer allows an inconsistent verdict, the entire phase's value is undermined.

**Additional check (soft):** If blockerCount > 0 and verdictEmoji is "green_circle", log a warning but do not throw. Claude might reasonably override (e.g., the blocker is acknowledged but the maintainer already indicated they're aware). This case is unusual but not necessarily invalid.

### Pattern 3: Updated Verdict Format Regex

**What:** Update the sanitizer's `verdictLineRe` to match the new verdict labels.

**Current regex:**
```typescript
const verdictLineRe = /^:(green_circle|yellow_circle|red_circle): \*\*[^*]+\*\* -- .+$/m;
```

This regex is generic -- it matches any `**Label**` text after the emoji. This remains correct for Phase 36 because the label text changes but the format stays the same. The regex does NOT need to change for the label wording.

However, we should consider whether to enforce the specific label text:
- `:green_circle: **Ready to merge** -- ...`
- `:yellow_circle: **Ready to merge with minor items** -- ...`
- `:red_circle: **Address before merging** -- ...`

**Recommendation:** Do NOT enforce specific label text in the regex. Claude may rephrase slightly (e.g., "Ready to merge" vs "Ready to Merge"), and strict text matching would create brittle failures. The existing generic regex (`**[^*]+**`) is sufficient. The EMOJI is what matters for the consistency cross-check, and that is already captured by the existing regex.

### Pattern 4: Suggestions Section Labeling in Prompt

**What:** Update the Suggestions section template and hard requirements to enforce "Optional:" or "Future consideration:" prefixes.

**Changes to the template:**
```
"## Suggestions",
"- Optional: <low-friction cleanup or improvement>",
"- Future consideration: <larger improvement for a follow-up PR>",
```

**Changes to hard requirements:**
```
"- Under ## Suggestions, every item MUST start with 'Optional:' or 'Future consideration:' -- these are never blockers",
```

**Where to implement:** Replace the existing Suggestions template lines and update the corresponding hard requirement line.

### Pattern 5: Sanitizer Suggestions Section Validation (Optional)

**What:** Validate that items under `## Suggestions` start with "Optional:" or "Future consideration:".

**Recommendation:** Do NOT validate suggestion prefixes in the sanitizer. The prompt instructs Claude to use these prefixes, but strict sanitizer enforcement would be brittle (Claude might write "Optional suggestion:" or "Future improvement:"). The sanitizer's job is structural validation (section presence, ordering, verdict format), not content validation. The prefix requirement is prompt-driven and best enforced by the prompt instructions.

**Why not:** The sanitizer currently does not validate the content of the Strengths section (no check for `:white_check_mark:`). The Suggestions section follows the same pattern -- the prompt instructs the format, the sanitizer validates structure.

### Anti-Patterns to Avoid

- **Anti-pattern: Strict label text matching in the verdict regex.** The sanitizer should validate the emoji and the `**Label** -- explanation` format, not the exact label text. Enforcing "Ready to merge" as the only valid label would break on minor phrasing variations.

- **Anti-pattern: Making MEDIUM findings produce `:red_circle:`.** MEDIUM findings are NOT blockers. The current prompt does not enforce this distinction clearly. Phase 36 must make it explicit: only CRITICAL and MAJOR are blockers.

- **Anti-pattern: Counting Suggestions items in the verdict logic.** Suggestions are explicitly non-blocking. The verdict is determined ONLY by the Observations section's `### Impact` subsection. The presence of any number of suggestions should not influence the verdict emoji.

- **Anti-pattern: Adding a "merge confidence score" or percentage.** The phase description says "Merge Confidence", but the requirements (FORMAT-03) specify three discrete states, not a continuous score. Do not introduce a numeric confidence percentage.

- **Anti-pattern: Changing the Observations section structure.** Phase 35 established the Impact/Preference split. Phase 36 does not modify this structure -- it reads from it to determine the verdict. The Observations section is input to the verdict logic, not something Phase 36 changes.

- **Anti-pattern: Changing the `## Verdict` hard requirement line to list all three labels.** The current hard requirement says "use exactly one verdict line with emoji -- pick the one that matches the review outcome." This is correct -- it should remain as-is with the understanding that "the review outcome" is now determined by the blocker-count logic.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Blocker detection logic | Post-processing code that parses Claude's output to count blockers | Prompt instructions that tell Claude to count CRITICAL/MAJOR findings and select the verdict | Claude can count findings in its own output natively |
| Merge confidence scoring | Custom scoring algorithm | Three discrete verdict states (FORMAT-03) | Requirements specify three states, not a continuous metric |
| Suggestion categorization | Classification function for suggestion types | Prompt-level prefix instructions ("Optional:" / "Future consideration:") | Claude understands categorization natively from instructions |

**Key insight:** All of Phase 36's requirements are prompt template changes + one sanitizer cross-check. The "merge confidence" is not a computed value -- it is one of three human-readable verdict strings determined by the presence or absence of CRITICAL/MAJOR findings.

## Common Pitfalls

### Pitfall 1: Claude Selecting `:red_circle:` for MEDIUM Findings

**What goes wrong:** Claude outputs `:red_circle: **Address before merging** -- 2 medium issues found` even though MEDIUM findings are not blockers.
**Why it happens:** The current prompt shows `:yellow_circle:` for "major/medium issues" and `:red_circle:` for "critical issues", which creates ambiguity about where MEDIUM findings fall. Claude may err on the side of caution.
**How to avoid:** The Verdict Logic prompt section explicitly states: "MEDIUM and MINOR findings are NOT blockers. They produce :yellow_circle: at most." The deterministic counting rule (step 1-4) removes all ambiguity.
**Warning signs:** Reviews with only MEDIUM findings showing a red verdict.

### Pitfall 2: Claude Counting Suggestions as Blockers

**What goes wrong:** Claude outputs `:red_circle:` because there are many suggestions, even though zero CRITICAL/MAJOR findings exist.
**Why it happens:** Claude's default behavior treats a long list of suggestions as "there are many problems" and escalates the verdict.
**How to avoid:** The Verdict Logic section explicitly states: "Suggestions are NEVER counted as blockers." The hard requirements reinforce this. The sanitizer cross-check catches the case where `:red_circle:` appears without CRITICAL/MAJOR findings.
**Warning signs:** Green verdict expected but yellow/red delivered. The sanitizer will reject the `:red_circle:` case.

### Pitfall 3: Sanitizer Cross-Check Being Too Strict

**What goes wrong:** The sanitizer throws an error when Claude legitimately uses `:red_circle:` but the blocker is described in prose rather than as a severity-tagged finding line.
**Why it happens:** The blocker count is derived from the Observations section's parsed severity tags. If Claude describes a critical issue in prose without using the `[CRITICAL] path (lines): title` format, the sanitizer counts zero blockers.
**How to avoid:** The Observations section already requires severity-tagged finding lines (Phase 35). If Claude puts a finding in prose instead of the tagged format, the Phase 35 sanitizer validation will reject it before Phase 36's cross-check runs. The two validations work in concert: Phase 35 ensures findings are tagged, Phase 36 ensures the verdict matches the tags.
**Warning signs:** Cross-check errors that seem contradictory ("no blockers found but verdict is red"). This would indicate a Phase 35 sanitizer gap, not a Phase 36 bug.

### Pitfall 4: Breaking the "Summary Only Posted When Issues Exist" Invariant

**What goes wrong:** The `:green_circle: **Ready to merge**` verdict is included in the summary comment, but the system design says "only post a summary comment when there are actionable issues to report."
**Why it happens:** If the review finds zero issues, no summary comment is posted -- silent approval is handled by the handler (`autoApprove`). But the `:green_circle:` option exists in the template, creating a contradiction.
**How to avoid:** The current hard requirement already says: "Since this summary is only posted when issues exist, the verdict will typically be :yellow_circle: or :red_circle:." This is still correct. The `:green_circle:` verdict would only appear in practice if there are Preference findings (no blockers, no suggestions) -- i.e., the reviewer found something worth mentioning but nothing that blocks merging. In this case, `:yellow_circle: **Ready to merge with minor items**` is more appropriate. The `:green_circle:` option exists as a safety valve but will rarely appear in standard mode.
**Warning signs:** `:green_circle:` appearing in summaries frequently (unlikely given the "only post when issues exist" rule).

### Pitfall 5: Verdict Label Changes Breaking Existing Tests

**What goes wrong:** Existing sanitizer tests assert on "Looks good", "Needs changes", or "Block" in the verdict line, but Phase 36 changes these labels.
**Why it happens:** The test data uses the old verdict labels.
**How to avoid:** Update all test data to use the new labels: "Ready to merge", "Ready to merge with minor items", "Address before merging". Run the full test suite to catch all instances.
**Warning signs:** Test failures on verdict format validation after label changes.

## Code Examples

### Example 1: Updated Verdict Section in Prompt Template

```typescript
// In buildReviewPrompt(), replace the Verdict section template:

// OLD:
"## Verdict",
":green_circle: **Looks good** -- <explanation> (only minor suggestions, nothing blocking)",
":yellow_circle: **Needs changes** -- <count and summary of issues> (has major/medium issues)",
":red_circle: **Blocker** -- <count and summary of critical issues> (has critical issues)",

// NEW:
"## Verdict",
":green_circle: **Ready to merge** -- No blocking issues found",
":yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below (no blockers)",
":red_circle: **Address before merging** -- [N] blocking issue(s) found (CRITICAL/MAJOR)",
```

### Example 2: Verdict Logic Prompt Section

```typescript
export function buildVerdictLogicSection(): string {
  return [
    "## Verdict Logic",
    "",
    'A "blocker" is any finding with severity CRITICAL or MAJOR under ### Impact.',
    "",
    "Determining the verdict:",
    "1. Count the number of [CRITICAL] and [MAJOR] findings under ### Impact.",
    "2. If count > 0: use :red_circle: **Address before merging** -- [count] blocking issue(s) found",
    "3. If count == 0 AND there are non-blocking findings (MEDIUM, MINOR, Preference items, or Suggestions): use :yellow_circle: **Ready to merge with minor items** -- Optional cleanup suggestions below",
    "4. If count == 0 AND there are no findings at all: use :green_circle: **Ready to merge** -- No blocking issues found",
    "",
    "Suggestions (## Suggestions section) are NEVER counted as blockers.",
    "MEDIUM and MINOR findings are NOT blockers. They produce :yellow_circle: at most.",
  ].join("\n");
}
```

### Example 3: Updated Suggestions Section Template

```typescript
// In buildReviewPrompt(), replace the Suggestions section template:

// OLD:
"## Suggestions",
"- <optional non-blocking improvement>",
"- <optional non-blocking improvement>",

// NEW:
"## Suggestions",
"- Optional: <low-friction cleanup or improvement>",
"- Future consideration: <larger improvement for a follow-up PR>",
```

### Example 4: Updated Hard Requirements

```typescript
// Replace or update relevant hard requirement lines:

// OLD:
"- Under ## Suggestions, list optional improvements that do not block merging -- omit this section if you have no suggestions",
"- Under ## Verdict, use exactly one verdict line with emoji -- pick the one that matches the review outcome",
"- Since this summary is only posted when issues exist, the verdict will typically be :yellow_circle: or :red_circle:",

// NEW:
"- Under ## Suggestions, every item MUST start with 'Optional:' or 'Future consideration:' -- suggestions are NEVER counted against merge readiness",
"- Under ## Verdict, use exactly one verdict line with emoji -- determine which one using the Verdict Logic rules above",
"- A blocker is any [CRITICAL] or [MAJOR] finding under ### Impact. Zero blockers = :green_circle: or :yellow_circle: verdict. Never :red_circle: without blockers",
"- Since this summary is only posted when issues exist, the verdict will typically be :yellow_circle: or :red_circle:. Use :green_circle: only when all findings are in ### Preference with no Impact findings",
```

### Example 5: Sanitizer Verdict-Observations Cross-Check

```typescript
// In sanitizeKodiaiReviewSummary(), after the existing Observations loop and Verdict format check:

// Track blocker count during Observations parsing (add to existing ISSUE state handler):
let blockerCount = 0;
// In the ISSUE state handler, after extracting severity:
if (severityMatch) {
  const sev = severityMatch[1];
  if (sev === "CRITICAL" || sev === "MAJOR") {
    if (currentSubsection === "### Impact") {
      blockerCount++;
    }
  }
}

// After verdict format validation (after the verdictLineRe test):
const verdictEmojiMatch = verdictSection.match(
  /^:(green_circle|yellow_circle|red_circle):/m
);
const verdictEmoji = verdictEmojiMatch?.[1];

// Hard check: zero blockers must not use red verdict
if (blockerCount === 0 && verdictEmoji === "red_circle") {
  throw new Error(
    "Invalid Kodiai review summary: Verdict uses :red_circle: but no CRITICAL or MAJOR findings exist under ### Impact"
  );
}

// Soft check: blockers exist but verdict is green (log warning, don't throw)
if (blockerCount > 0 && verdictEmoji === "green_circle") {
  console.warn(
    `Verdict uses :green_circle: but ${blockerCount} blocker(s) (CRITICAL/MAJOR) exist under ### Impact`
  );
}
```

### Example 6: Updated Test Data for Sanitizer

```typescript
// All existing test bodies with old verdict labels need updating:

// OLD:
"## Verdict",
":yellow_circle: **Needs changes** -- 1 critical issue requires attention before merge.",

// NEW:
"## Verdict",
":red_circle: **Address before merging** -- 1 blocking issue found (CRITICAL)",

// OLD:
"## Verdict",
":green_circle: **Approve** -- No issues found.",

// NEW:
"## Verdict",
":green_circle: **Ready to merge** -- No blocking issues found",
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Generic verdict labels | "Looks good" / "Needs changes" / "Blocker" | Phase 34 (shipped) | Verdict gives a subjective assessment |
| No blocker/suggestion separation | Severity sub-headings, then Impact/Preference split | Phase 35 (shipped) | Findings now have severity tags AND type classification |
| Suggestions not labeled | Template shows "optional non-blocking improvement" | Phase 34 (shipped) | No explicit "Optional:" prefix required |
| No verdict-blocker consistency check | Sanitizer validates verdict format only (emoji + label + explanation) | Phase 34/35 (shipped) | Verdict can disagree with findings |

**What changes with Phase 36:**
- Verdict labels become merge recommendations ("Ready to merge" / "Ready to merge with minor items" / "Address before merging")
- Verdict is deterministic: count CRITICAL/MAJOR under Impact, select the matching line
- Sanitizer enforces verdict-observations consistency (no red verdict without blockers)
- Suggestions require "Optional:" or "Future consideration:" prefix
- Suggestions are explicitly excluded from merge readiness calculation

## Open Questions

1. **Should the sanitizer also check that `:yellow_circle:` is not used when there are CRITICAL/MAJOR findings?**
   - What we know: FORMAT-03 says "If blockers: Address before merging." The `:yellow_circle:` verdict says "Ready to merge with minor items" which implies no blockers. If Claude uses `:yellow_circle:` despite blockers existing, that's incorrect.
   - What's unclear: Whether to make this a hard error or soft warning.
   - Recommendation: Make it a soft warning (log, don't throw). Claude might legitimately downgrade a finding's severity in its reasoning. The prompt instructs `:red_circle:` for blockers, and the `:red_circle:` without blockers check is the more critical invariant. Adding the `:yellow_circle:` with blockers check as a hard error could reject valid edge cases.

2. **Should `:green_circle:` ever appear in practice given the "only post summary when issues exist" rule?**
   - What we know: If the review finds zero issues, no summary comment is posted (silent approval). `:green_circle:` would only appear if there are some findings but no blockers and no suggestions -- meaning only Preference items exist.
   - What's unclear: Whether to remove `:green_circle:` from the template entirely.
   - Recommendation: Keep `:green_circle:` in the template. A review might find only Preference-level items (e.g., naming suggestions under `### Preference`). In that case, `:green_circle: **Ready to merge**` is the correct verdict. It is rare but valid.

3. **Should Phase 36 also update the "After review" section to reference the new verdict labels?**
   - What we know: The "After review" section says "If you found issues: post the summary comment first, then post inline comments." It does not reference verdict labels.
   - What's unclear: Whether to add verdict-specific guidance to the "After review" section.
   - Recommendation: No. The "After review" section describes workflow (post summary, then inline). The verdict label selection is handled by the Verdict Logic section. Mixing the two would create redundancy.

## Sources

### Primary (HIGH confidence)
- Source code: `src/execution/review-prompt.ts` -- current verdict template (lines 994-997), suggestions template (lines 990-992), hard requirements (lines 1001-1016), summary comment section structure
- Source code: `src/execution/mcp/comment-server.ts` -- current `sanitizeKodiaiReviewSummary()` with verdict format validation (lines 166-175), Observations parsing with severity tag tracking (lines 179-337)
- Source code: `src/execution/mcp/comment-server.test.ts` -- 32 existing sanitizer test cases including verdict format and Observations structure tests
- Source code: `src/execution/review-prompt.test.ts` -- 80 existing prompt builder tests including Phase 35 Impact/Preference tests
- Source code: `src/handlers/review.ts` -- review handler showing auto-approve logic (lines 1823-1895), finding extraction and processing

### Secondary (MEDIUM confidence)
- Phase 35 research and plans: `.planning/phases/35-findings-organization-and-tone/35-RESEARCH.md`, `35-01-PLAN.md`, `35-02-PLAN.md`, `35-VERIFICATION.md` -- established Impact/Preference structure, severity-tagged finding lines, sanitizer state machine
- Requirements: `.planning/REQUIREMENTS.md` -- FORMAT-03 (verdict section merge recommendation), FORMAT-04 (blockers vs minor separation), FORMAT-09 (easy next steps), FORMAT-10 (suggestions not blockers)
- Roadmap: `.planning/ROADMAP.md` -- Phase 36 description, success criteria, dependency on Phase 35

### Tertiary (LOW confidence)
- None -- all findings are from direct source code analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, all changes are in existing files
- Architecture: HIGH -- the Phase 35 foundation (Impact/Preference, severity tags, sanitizer state machine) is well-understood; the changes are incremental modifications to the verdict/suggestions template and one sanitizer cross-check
- Pitfalls: HIGH -- identified from direct analysis of the current verdict behavior, prompt structure, and sanitizer validation logic
- Code examples: HIGH -- based on actual current code patterns and function signatures

**Research date:** 2026-02-13
**Valid until:** 2026-03-15 (stable -- no external dependencies to go stale)
