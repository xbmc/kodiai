# Phase 126: Global Anti-Hallucination Guardrails - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

System-wide framework for detecting and preventing fabricated content across all Kodiai output surfaces. Extends the existing PR review claim classifier and output filter into a unified pipeline that every surface uses. Does not add new output surfaces or change what Kodiai responds to — only how responses are verified before publishing.

</domain>

<decisions>
## Implementation Decisions

### Surface coverage
- All output surfaces get post-generation claim filtering: PR reviews, @mentions (issues + PRs), Slack assistant, triage validation, troubleshooting agent, wiki update suggestions
- Surfaces without a diff use context-grounded evidence model — anything provided in the prompt context (issue body, PR description, code snippets, wiki chunks, retrieval results) is fair game; claims beyond provided context are flagged
- Wiki update grounding folds into the unified pipeline (no separate system)
- All surfaces use the shared `buildEpistemicBoundarySection` prompt builder — one source of truth for epistemic instructions

### Pipeline architecture
- Single classify→filter pipeline with surface adapters — each surface provides an adapter that extracts claims and context from its output format
- Post-generation, pre-publish placement: LLM generates → guardrail classifies + filters → surface publishes
- Global default configuration with per-surface overrides (e.g., Slack could be more lenient for conversational tone)
- Basic strictness toggle exposed in `.kodiai.yml` (strict/standard/lenient) for repo owners

### Detection granularity
- Rule-based classifier with LLM fallback — keep fast regex rules for obvious patterns (version claims, release dates, external-knowledge signals); add Haiku LLM classification for ambiguous cases rules can't catch
- Sentence-level classification on all surfaces — split response into sentences, classify each against available context; allows surgical removal while keeping the rest
- General programming knowledge allowlisted — maintain categories always allowed (language semantics, common patterns, well-known algorithms), extending the current PR review exception to all surfaces
- LLM fallback uses Haiku (fast/cheap model) — good enough for binary grounded/ungrounded decisions, keeps guardrail overhead minimal

### Failure behavior
- Silent removal — remove hallucinated sentences without footnotes or notices; matches current epistemic rule "silently omit what you cannot verify"
- Suppress entirely if response falls below minimum useful threshold after filtering — better no response than a gutted one (current PR approach: 10 words minimum)
- Log all classification and filter actions to Postgres — enables analysis of false positive rates, which surfaces hallucinate most, and classifier accuracy over time
- Fail-open on classifier error — if classifier crashes or times out, let content through; current classifier already defaults to diff-grounded on no signal

### Claude's Discretion
- Per-surface minimum-content thresholds (extending the current 10-word minimum)
- Surface adapter implementation details (how to extract claims from each output format)
- Haiku prompt design for LLM fallback classification
- Database schema for guardrail audit logging
- Allowlist category structure for general programming knowledge

</decisions>

<specifics>
## Specific Ideas

- Current `buildEpistemicBoundarySection` in `review-prompt.ts` is already shared by PR reviews, @mentions, and Slack — but triage and troubleshooting agent don't use it
- Current claim classifier (`claim-classifier.ts`) and output filter (`output-filter.ts`) only run on PR review findings via `review.ts` — need surface adapters for other formats
- Wiki grounding in `wiki-update-generator.ts` uses PR citation verification — this should become one instance of the shared pipeline
- The `.kodiai.yml` strictness toggle should be simple (strict/standard/lenient) — not expose individual classifier thresholds

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/claim-classifier.ts`: Rule-based claim classification (diff-grounded / external-knowledge / inferential) — core of the unified pipeline
- `src/lib/output-filter.ts`: Post-generation filtering with rewrite/suppress actions — extend to all surfaces
- `src/execution/review-prompt.ts:buildEpistemicBoundarySection()`: Shared epistemic prompt builder — already used by reviews, mentions, Slack
- `src/lib/severity-demoter.ts`: Severity adjustment based on claim classification — may integrate with unified pipeline

### Established Patterns
- Claim classifier uses `DiffContext` (rawPatch, addedLines, removedLines, contextLines) — needs generalization to non-diff context
- Output filter works on `FilterableFinding` objects — needs surface adapters for markdown responses, wiki suggestions, etc.
- Fail-open design: classifier defaults to "diff-grounded" when no external-knowledge signal detected
- Wiki grounding: `wiki-update-generator.ts` checks for PR citations in generated suggestions — separate mechanism that should fold in

### Integration Points
- `src/handlers/review.ts`: Currently the only consumer of claim classifier + output filter
- `src/execution/mention-prompt.ts`: Uses epistemic prompt but no post-gen filtering
- `src/slack/assistant-handler.ts`: Uses epistemic prompt but no post-gen filtering
- `src/handlers/troubleshooting-agent.ts`: No epistemic guardrails at all
- `src/knowledge/wiki-update-generator.ts`: Has its own grounding verification
- `src/config.ts` / `.kodiai.yml`: Where strictness toggle would be configured

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 126-global-anti-hallucination-guardrails*
*Context gathered: 2026-03-07*
