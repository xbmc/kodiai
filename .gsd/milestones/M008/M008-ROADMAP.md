# M008: Conversational Intelligence

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Commit Message Keywords Pr Intent** `risk:medium` `depends:[]`
  > After this: Implement the PR intent parser as a pure function with comprehensive test coverage using TDD.
- [x] **S02: Auto Profile Selection** `risk:medium` `depends:[S01]`
  > After this: Create a deterministic auto-profile resolver with TDD so PR size-to-profile selection and precedence behavior are predictable and safe.
- [x] **S03: Smart Finding Prioritization** `risk:medium` `depends:[S02]`
  > After this: Build a pure, deterministic finding prioritization engine with TDD so Phase 44 can enforce multi-factor ranking independent of model output order.
- [x] **S04: Author Experience Adaptation** `risk:medium` `depends:[S03]`
  > After this: TDD: Implement the deterministic author classification logic and prompt tone section builder.
- [x] **S05: Conversational Review** `risk:medium` `depends:[S04]`
  > After this: Add thread-aware context building and finding lookup for conversational review.
- [x] **S06: V0 8 Verification Backfill** `risk:medium` `depends:[S05]`
  > After this: unit tests prove v0-8-verification-backfill works
- [x] **S07: Conversational Fail Open Hardening** `risk:medium` `depends:[S06]`
  > After this: unit tests prove conversational-fail-open-hardening works
- [x] **S08: Verification Artifacts For Phases 47 48** `risk:medium` `depends:[S07]`
  > After this: Create the missing phase-level verification artifacts for phases 47 and 48 using existing v0.
- [x] **S09: Publish Path Mention Sanitization Completion** `risk:medium` `depends:[S08]`
  > After this: Introduce `botHandles` field on `ExecutionContext`, thread it through `buildMcpServers` to all three MCP server constructors, and apply `sanitizeOutgoingMentions` at every outbound publish point in MCP servers and the review handler.
