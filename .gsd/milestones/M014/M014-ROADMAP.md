# M014: Slack Integration

**Vision:** Kodiai is an installable GitHub App that provides AI-powered PR auto-reviews, conversational code assistance via `@kodiai` mentions, and a Slack assistant (`@kodiai` in `#kodiai`) for read-only code questions and write-mode PR creation.

## Success Criteria


## Slices

- [x] **S01: Slack Ingress Safety Rails** `risk:medium` `depends:[]`
  > After this: Add a secure Slack ingress endpoint that validates request signatures and timestamps before any event processing.
- [x] **S02: Slack Thread Session Semantics** `risk:medium` `depends:[S01]`
  > After this: Implement Slack thread session semantics so @kodiai bootstrap starts a thread session and later thread replies in that session are treated as addressed without re-mentioning.
- [x] **S03: Slack Read Only Assistant Routing** `risk:medium` `depends:[S02]`
  > After this: Build the core Slack assistant domain logic: deterministic repo-context resolution and a read-only handler that executes only when context is unambiguous.
- [x] **S04: Slack Operator Hardening** `risk:medium` `depends:[S03]`
  > After this: Ship a deterministic Slack v1 smoke verifier that operators can run to prove the core safety behavior in one repeatable command.
