# M010: Advanced Signals

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Foundation Layer** `risk:medium` `depends:[]`
  > After this: Add an additive knowledge-store table and a dedicated merge event handler so Kodiai can record dependency bump merge history for later trend analysis (DEP-05).
- [x] **S02: Analysis Layer** `risk:medium` `depends:[S01]`
  > After this: Create the usage analyzer and scope coordinator pure-function modules.
- [x] **S03: Intelligence Layer** `risk:medium` `depends:[S02]`
  > After this: Create the adaptive distance threshold computation module using TDD.
- [x] **S04: Resilience Layer** `risk:medium` `depends:[S03]`
  > After this: Build the checkpoint accumulation infrastructure: a knowledge store table for persisting checkpoint data, and an MCP tool that Claude invokes during review execution to report progress.
