# Phase 97: Multi-LLM Routing & Cost Tracking - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Every LLM call site in Kodiai becomes routable through a configurable task-type-to-model mapping via Vercel AI SDK. Agentic tasks (PR review, mentions, Slack) that currently use Claude Agent SDK are also routable — not just "non-agentic" summary/labeling tasks. Provider fallback handles unavailability, and every invocation (both AI SDK and Agent SDK) is cost-tracked in Postgres.

</domain>

<decisions>
## Implementation Decisions

### Task classification boundary
- All LLM call sites are routable, not just "non-agentic" ones — the user wants flexibility to route any task type to any model
- Task types include tool-use tasks (PR review, mention handling, Slack responses), not just generateText() calls
- Vercel AI SDK tool-use support needed for agentic task routing
- Initial routable task types: PR review (full), mention responses, Slack responses, plus the smaller tasks (pr-summary, cluster-label, staleness-evidence, and any other existing LLM call sites)
- Task type taxonomy uses dot-separated hierarchy: `review.full`, `review.summary`, `slack.response`, `mention.response`, `cluster.label`, `staleness.evidence`, etc. — enables wildcards like `review.*`

### Model config & defaults
- `.kodiai.yml` `models:` section uses direct task-type-to-model-ID mapping (no named profiles)
- Example: `models: { review.full: claude-sonnet-4-20250514, slack.response: gpt-4o-mini }`
- Per-repo overrides in `.kodiai.yml` — override behavior and default model selection are Claude's discretion
- Provider authentication approach is Claude's discretion

### Fallback behavior
- When fallback triggers, output includes a visible annotation (e.g., "Used fallback model (configured provider unavailable)")
- Rate limits (429) trigger fallback immediately — don't wait and retry, switch to fallback model
- 5xx errors and timeouts also trigger fallback
- If all models (primary + fallback) fail: degrade gracefully — skip optional signals (summaries, labels), only fail hard for core tasks like PR review
- Fallback chain design (single default vs per-task chain) is Claude's discretion

### Cost tracking granularity
- Track cost for ALL LLM calls — both Vercel AI SDK and Claude Agent SDK invocations
- Cost estimation via provider pricing APIs (not hardcoded tables)
- Full-dimensional Postgres schema: repo, task type, model, provider, token counts (input/output), estimated USD cost, timestamp — queryable along any dimension
- Cost alerting/budget limits: Claude's discretion for v1

### Claude's Discretion
- Default model selection per task category (agentic vs lightweight)
- Provider auth approach (env vars, config, or hybrid)
- Per-repo override merge semantics (merge vs replace)
- Fallback chain depth (single default vs per-task chain)
- Whether to include cost alerting/budget thresholds in v1

</decisions>

<specifics>
## Specific Ideas

- User explicitly wants Slack responses routable to other LLMs — this was the motivating example for expanding beyond "non-agentic only"
- Dot-separated hierarchy chosen to support wildcard overrides (e.g., `review.*: claude-sonnet-4-20250514`)
- Graceful degradation on total failure aligns with existing resilience patterns in the codebase (degraded retrieval contracts, etc.)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 97-multi-llm-routing-cost-tracking*
*Context gathered: 2026-02-25*
