# T02: 05-mention-handling 02

**Slice:** S05 — **Milestone:** M001

## Description

Create the mention handler that dispatches across all four comment surfaces, posts tracking comments for progress, builds conversation context, and invokes Claude with a mention-specific prompt. Wire into the server entrypoint.

Purpose: This is the core Phase 5 deliverable. Following the handler factory pattern from Phase 4, a single handler covers issue comments, PR comments, PR review comments, and PR review bodies. The tracking comment provides immediate user feedback before the job queue processes the request.

Output: Working mention handler wired into the server, covering all MENTION-01 through MENTION-05 requirements.

## Must-Haves

- [ ] "Typing @kodiai in an issue comment produces a contextual response as a reply"
- [ ] "Typing @kodiai in a PR comment, PR review comment, or PR review body produces a contextual response"
- [ ] "A tracking comment appears within seconds showing the job is in progress, and updates when the response is ready"
- [ ] "The bot's response demonstrates awareness of conversation context (prior comments, PR diff if applicable)"
- [ ] "Comments without @kodiai mention are ignored"
- [ ] "Review bodies with null body are skipped"
- [ ] "Mention handling respects mention.enabled config"

## Files

- `src/handlers/mention.ts`
- `src/execution/config.ts`
- `src/index.ts`
