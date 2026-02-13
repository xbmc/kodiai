# Requirements: Kodiai v0.6 Review Output Formatting & UX

**Defined:** 2026-02-13
**Core Value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.6 Requirements

### Initial Review Structure

- [ ] **FORMAT-01**: Initial PR reviews use predictable structure with clear sections
  - What changed (brief summary of PR intent from title/description)
  - Strengths (what's correct, measurably improved, well-done)
  - Observations (findings organized by impact vs preference)
  - Suggestions (optional improvements without opening debates)
  - Verdict (explicit merge recommendation)

- [ ] **FORMAT-02**: "What changed" section signals review scope with progress checklist
  - Example: "Reviewed: core logic ✅, error handling ✅, tests ✅, docs ✅"
  - Shows maintainer what the bot actually looked at
  - Built from diff analysis (files reviewed, categories covered)

### Merge Confidence & Verdict

- [ ] **FORMAT-03**: Verdict section provides explicit merge recommendation
  - If no blockers: "✅ **Ready to merge** — No blocking issues found"
  - If blockers: "⚠️ **Address before merging** — [N] blocking issue(s) found"
  - If minor only: "✅ **Ready to merge with minor items** — Optional cleanup suggestions below"

- [ ] **FORMAT-04**: Blockers vs minor issues explicitly separated
  - Blockers labeled: "🚫 BLOCKER" with severity (CRITICAL/MAJOR)
  - Minor items labeled: "💡 MINOR" or "✨ SUGGESTION"
  - Nits/preferences labeled: "🎨 STYLE" or "📝 PREFERENCE"

- [ ] **FORMAT-05**: Use ✅ checkmarks for verified positives in Strengths section
  - Example: "✅ Null checks added for all nullable returns"
  - Example: "✅ Test coverage maintained at 87%"
  - Example: "✅ Breaking changes properly documented in PR description"

### Observations & Findings Organization

- [ ] **FORMAT-06**: Separate impact (real risks) from preference (nits)
  - "Impact" subsection: correctness bugs, security issues, performance problems
  - "Preference" subsection: style nits, naming suggestions, code organization
  - Each finding tagged with severity in header: [CRITICAL], [MAJOR], [MEDIUM], [MINOR]

- [ ] **FORMAT-07**: Scope findings to PR intent (don't judge against imagined ideal)
  - If PR goal is "stop flaky CI", focus on test reliability, not code style
  - If PR goal is "performance optimization", focus on benchmarks, not documentation
  - Extract intent from PR title/description/labels

- [ ] **FORMAT-08**: Minimize churn language in findings
  - Call out "minimal impact" for low-risk changes
  - Highlight "preserves existing behavior" for refactors
  - Note "backward compatible" for API changes

### Suggestions Section

- [ ] **FORMAT-09**: Offer easy next steps without opening debates
  - Link to issues for larger improvements: "Consider [feature X] in future PR (#123)"
  - Suggest TODOs for maintainability: "Add TODO comment for [future enhancement]"
  - Propose low-friction cleanups: "Optional: extract [repeated logic] to helper function"

- [ ] **FORMAT-10**: Suggestions are optional, not blockers
  - Clearly labeled as "Optional suggestion:" or "Future consideration:"
  - Not counted against merge readiness
  - Grouped at end of Observations, separate from blockers

### Review Details Integration

- [ ] **FORMAT-11**: Embed Review Details as collapsible section in summary comment
  - Never create standalone comment with just Review Details
  - Place Review Details at bottom of summary, inside `<details>` block
  - Title: "📊 Review Details"

- [ ] **FORMAT-12**: Remove "Estimated review time saved" from Review Details
  - Do not calculate or display time-saved metrics
  - Remove formula: `(3 min x actionable) + (1 min x low-confidence) + (0.25 min x files)`
  - Keep only: files reviewed, lines changed, findings by severity

- [ ] **FORMAT-13**: Keep Review Details minimal and factual
  - Files reviewed: [N]
  - Lines changed: +[additions] -[deletions]
  - Findings: [critical], [major], [medium], [minor]
  - Review completed: [timestamp]

### Re-Review & Delta Formatting

- [ ] **FORMAT-14**: Re-reviews show delta findings only (not full structure)
  - Header: "🔄 **Re-review** — Changes since [previous review SHA]"
  - Sections: "What changed" → "New findings" → "Resolved findings" → "Still open" → "Verdict update"

- [ ] **FORMAT-15**: Delta verdict focuses on what's relevant/updated
  - If new blockers: "⚠️ **New blockers found** — Address [N] new issue(s)"
  - If blockers resolved: "✅ **Blockers resolved** — Ready to merge"
  - If no change: "✅ **Still ready** — No new issues"

- [ ] **FORMAT-16**: Show only relevant updates from initial review
  - Don't repeat unchanged findings
  - Highlight resolved issues with ✅
  - Flag new issues clearly with 🆕 badge
  - Note still-open issues with count only (expandable list)

### Tone & Language

- [ ] **FORMAT-17**: Use low-drama, high-signal language
  - Avoid: "This could potentially maybe cause issues"
  - Use: "This will cause [specific issue] when [specific condition]"
  - Avoid: "Consider refactoring"
  - Use: "Optional: Extract [method] to reduce duplication"

- [ ] **FORMAT-18**: Be specific about risk and impact
  - Tag severity: [CRITICAL], [MAJOR], [MEDIUM], [MINOR]
  - Specify condition: "when X happens" not "could happen"
  - Show consequence: "causes [crash/leak/bug]" not "might have issues"

## Future Requirements

None yet — v0.6 is focused on formatting and UX improvements only.

## Out of Scope

- Content of findings (what the LLM flags) — v0.6 is about *how* we present findings, not *what* we find
- Learning/retrieval improvements — deferred to v0.7
- Language-aware enforcement — deferred to v0.7
- Large PR intelligence — deferred to v0.7

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (To be filled by roadmapper) | | |

**Coverage:**
- v0.6 requirements: 18 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 18 ⚠️

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 after initial definition*
