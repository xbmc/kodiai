# T02: 111-troubleshooting-agent 02

**Slice:** S02 — **Milestone:** M023

## Description

Create the full troubleshooting handler with LLM synthesis, provenance citations, comment formatting, and wire it into src/index.ts. When @kodiai is mentioned on an open issue with troubleshooting intent, the handler retrieves similar resolved issues, synthesizes guidance via generateWithFallback, formats a comment with citations and provenance disclosure, and posts it.

Purpose: This is the user-facing feature -- the troubleshooting agent that responds to @kodiai mentions with actionable guidance grounded in resolved issues.

Output: `src/handlers/troubleshooting-agent.ts` (handler + helpers), tests, and wiring in `src/index.ts`.

## Must-Haves

- [ ] "When @kodiai is mentioned on an open issue with troubleshooting intent and triage.troubleshooting.enabled is true, a comment with synthesized guidance is posted"
- [ ] "Troubleshooting responses include a citations table with issue number, title, and match score in a collapsible details section"
- [ ] "Troubleshooting responses include provenance disclosure: 'This guidance was synthesized from similar resolved issues'"
- [ ] "When triage.troubleshooting.enabled is false, the handler silently bails (no comment, no error)"
- [ ] "Comment-scoped marker dedup prevents duplicate responses for the same trigger comment ID"
- [ ] "When retrieveTroubleshootingContext returns null (no matches), handler silently bails"
- [ ] "Outgoing comment text is sanitized via sanitizeOutgoingMentions before posting"
- [ ] "The handler is registered on issue_comment.created in src/index.ts"

## Files

- `src/handlers/troubleshooting-agent.ts`
- `src/handlers/troubleshooting-agent.test.ts`
- `src/index.ts`
