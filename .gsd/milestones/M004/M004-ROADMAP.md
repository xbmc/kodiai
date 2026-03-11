# M004: Intelligent Review System

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Review Mode Severity Control** `risk:medium` `depends:[]`
  > After this: Extend the `.
- [x] **S02: Context Aware Reviews** `risk:medium` `depends:[S01]`
  > After this: Add config schema fields for path-scoped instructions, profile presets, and file category overrides.
- [x] **S03: Knowledge Store Explicit Learning** `risk:medium` `depends:[S02]`
  > After this: Create the SQLite-backed knowledge store that persists review findings, metrics, and suppression history.
- [x] **S04: Feedback Capture** `risk:medium` `depends:[S03]`
  > After this: Add the storage and correlation foundation for LEARN-05 so reaction feedback can be tied back to exact Kodiai findings deterministically.
