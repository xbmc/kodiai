# M001: MVP

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Webhook Foundation** `risk:medium` `depends:[]`
  > After this: Initialize the Kodiai project, create the Hono HTTP server, implement webhook signature verification, delivery deduplication, health/readiness endpoints, and fail-fast configuration validation.
- [x] **S02: Job Infrastructure** `risk:medium` `depends:[S01]`
  > After this: Create the job queue module with per-installation concurrency control and extend GitHubApp with raw token access.
- [x] **S03: Execution Engine** `risk:medium` `depends:[S02]`
  > After this: Define the execution type system and config loader for Phase 3.
- [x] **S04: Pr Auto Review** `risk:medium` `depends:[S03]`
  > After this: Extend the repo config schema with review-specific fields (skipAuthors, skipPaths, custom prompt) and create a dedicated review prompt builder that instructs Claude to post inline comments with suggestion blocks for issues and do nothing for clean PRs.
- [x] **S05: Mention Handling** `risk:medium` `depends:[S04]`
  > After this: Create the building blocks for mention handling: MCP write tool extension, MentionEvent types with normalizers for all four comment surfaces, conversation context builder, and mention-specific prompt.
- [x] **S06: Content Safety** `risk:medium` `depends:[S05]`
  > After this: Create the content sanitizer module and TOCTOU comment filter as a standalone library.
- [x] **S07: Operational Resilience** `risk:medium` `depends:[S06]`
  > After this: Create the error handling foundation and timeout enforcement for Phase 7: Operational Resilience.
- [x] **S08: Deployment** `risk:medium` `depends:[S07]`
  > After this: Create the Dockerfile and .
- [x] **S09: Review Request Reliability** `risk:medium` `depends:[S08]`
  > After this: Debug and harden production handling of `pull_request.
