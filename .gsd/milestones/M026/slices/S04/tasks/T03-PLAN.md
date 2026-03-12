---
estimated_steps: 3
estimated_files: 1
---

# T03: Update docs/README.md index and verify all links

**Slice:** S04 — Knowledge System & Feature Docs
**Milestone:** M026

## Description

Replace the "Coming soon" placeholder in docs/README.md with real links to the three new documentation files. Verify all cross-links between docs resolve and run all slice verification checks.

## Steps

1. Replace the Knowledge System section in `docs/README.md`: remove the "Coming soon" blockquote and add linked entries for knowledge-system.md, issue-intelligence.md, and guardrails.md with one-line descriptions matching the S03 pattern
2. Verify all forward links resolve: architecture.md → knowledge-system.md, README.md → all three new docs, each new doc → architecture.md and configuration.md
3. Run all 12 slice verification checks and confirm they pass

## Must-Haves

- [ ] "Coming soon" placeholder removed from docs/README.md
- [ ] Links to all three new docs added to Knowledge System section
- [ ] All cross-links between docs resolve (no broken forward links)
- [ ] All 12 slice verification checks pass

## Verification

- `grep -c 'Coming soon' docs/README.md` returns 0
- `grep -l 'knowledge-system.md' docs/README.md` — link present
- `grep -l 'issue-intelligence.md' docs/README.md` — link present
- `grep -l 'guardrails.md' docs/README.md` — link present
- All 12 slice-level verification checks pass

## Observability Impact

- Signals added/changed: None
- How a future agent inspects this: Check docs/README.md for complete index
- Failure state exposed: None

## Inputs

- `docs/README.md` — current index with "Coming soon" placeholder
- `docs/knowledge-system.md` — created by T01
- `docs/issue-intelligence.md` — created by T02
- `docs/guardrails.md` — created by T02

## Expected Output

- `docs/README.md` — updated index with links to all three new feature docs, no placeholder text
