# Add-on Model Review Completeness Design

Date: 2026-07-19  
Related issue: https://github.com/xbmc/kodiai/issues/194  
Production example: https://github.com/xbmc/repo-scripts/pull/2861#issuecomment-5017999328

## Reader and outcome

This design is for the engineer repairing Kodiai's model-backed Kodi add-on rule review. After reading it, they should be able to make the specialized review complete and evidence-backed on large Python submissions while preserving the concise `Summary`, `Findings`, and `Verdict` comment introduced by the concise add-on review work.

This design extends the concise add-on review design. It does not change the product scope, public format, deterministic rule checks, or human-approval boundary defined there.

## Problem

The contributor-facing review is now useful, but the model-backed portion can still be marked incomplete. The incomplete result is not caused by a current provider rate limit. It is the combined effect of model routing, SDK configuration, oversized semantic workloads, unstructured response parsing, and timeout classification:

- The configured Haiku identifier, `claude-haiku-4-5-20250929`, is invalid. The supported snapshot is `claude-haiku-4-5-20251001`.
- OAuth-backed requests are routed through the Claude Agent SDK, where Haiku is silently replaced with Sonnet.
- The non-agentic classifier inherits the full `claude_code` system preset even though it has no tool work to perform.
- The prompt asks for JSON in prose instead of using the SDK's native JSON-schema result.
- `maxTurns: 1` is insufficient for the SDK's structured-output exchange.
- The chunk limit counts patch characters only. It excludes the rules and metadata repeated in every prompt, and cannot split a single large file.
- SDK timeout aborts surface as `Claude Code process aborted by user`; the fallback classifier does not recognize that message as a timeout.
- The existing fallback leaves the OAuth-capable SDK path and requires an absent `ANTHROPIC_API_KEY`.
- Partial assistant prose can reach the free-text parser and be reported merely as malformed output.

On the representative PR, the three production-shaped calls ran concurrently. Two reached the 120-second abort and one returned non-JSON prose after roughly 115 seconds. A correct Haiku request with a minimal system prompt and native schema completed on a representative 9,681-character patch in roughly 66 seconds, demonstrating a viable path when the workload is bounded.

## Goals

- Use the intended Haiku model through the existing OAuth deployment.
- Obtain schema-validated structured results rather than parsing requested JSON from prose.
- Bound each model request by its complete serialized prompt size.
- Split evidence inside very large changed files without losing exact added-line coordinates.
- Treat deadline aborts as timeouts and apply a viable OAuth-aware fallback.
- Reject partial, malformed, ungrounded, or unsuccessful SDK results.
- Retain deterministic findings and the deterministic summary whenever model coverage is incomplete.
- Emit enough bounded telemetry to distinguish timeout, provider, schema, and grounding failures.
- Verify the repair locally, deploy a new Azure revision, and prove the behavior on a live add-on PR.

## Non-goals

- Adding an Anthropic API key or a second billing path.
- Expanding review scope into Python correctness, quality, architecture, or style.
- Letting the model approve, reject, or merge an add-on submission.
- Sending unchanged file contents or repository workspaces to the model.
- Publishing raw prompts, source text, model output, OAuth details, or SDK event payloads.
- Replacing deterministic checks with model judgments.
- Persisting model results across separate webhook deliveries. A later delivery may recompute the review from the current PR evidence.

## Chosen approach

Create a dedicated structured-generation mode within the existing LLM abstraction and use it for add-on rule classification. It remains backed by the Claude Agent SDK when OAuth is configured, but it has classifier-specific model, system prompt, turn count, schema, timeout normalization, and fallback behavior.

Separately, project each changed patch into line-numbered added-line evidence. Pack that evidence into chunks by measuring the complete prompt, not just the patch fragment. This representation can split a new or heavily rewritten file at any added-line boundary and provides an explicit allowlist for finding locations.

This approach is preferred over deterministic prefiltering because every changed in-scope added line remains eligible for contextual model review. It is preferred over direct Anthropic API generation because the deployed environment already authenticates through Claude OAuth and does not have an Anthropic API key.

## Structured generation

### Models and routing

The add-on classifier uses:

- Primary: `claude-haiku-4-5-20251001`.
- Fallback: the configured Sonnet model through the same Agent SDK and OAuth credential path.

The router must not replace Haiku merely because Agent SDK routing is active. Model selection is explicit and observable. Other LLM tasks retain their current model behavior unless they opt into the new structured mode.

### SDK request

The structured mode supplies:

- A minimal, task-specific system prompt stating that the model is a non-agentic Kodi add-on submission-rule classifier.
- No tools or repository access.
- The existing user prompt containing rules, repository metadata, and the current evidence chunk.
- The SDK-native `outputFormat: { type: "json_schema", schema }` contract.
- `maxTurns: 3` so the SDK can complete its structured-result exchange.
- The existing bounded request deadline unless tests establish a safer common constant.

Only a successful SDK result containing `structured_output` is accepted. Assistant text is diagnostic state, not a valid substitute for the structured result.

### Schema

The native schema mirrors the existing validated public contract:

- `summary`: a bounded string.
- `findings`: a bounded array of objects containing severity, path, line, rule, and message.

The normal domain validator remains authoritative after schema validation. It enforces path membership, exact added-line membership, severity, count, length, unsafe-text, and public-copy constraints. Schema validation improves transport reliability; it does not replace grounding validation.

## Evidence projection and chunking

### Projection

For each in-scope changed file, derive an internal evidence record from its unified patch:

- Changed path and file status.
- Addition and deletion counts from GitHub metadata.
- Every added line as an exact `{ line, text }` pair using the right-side line number from the patch.
- Relevant file-level facts already available to the deterministic checks.

Deleted and unchanged context lines are not model evidence because they cannot introduce a submission-rule violation. Their aggregate counts remain available for a factual change summary. Patch-unavailable or truncated files remain explicitly unassessed under the existing completeness rules.

Deterministic checks continue to operate on the original changed-file context. The evidence projection is exclusively the model transport format.

### Packing

The packer appends line-numbered evidence records until rendering the full candidate prompt would exceed the configured prompt-size ceiling. It then starts another chunk. A large file may therefore span multiple chunks, but a single added line is never split.

The ceiling applies to the complete serialized prompt, including:

- Rule text.
- Repository and pull-request metadata.
- Changed-path allowlist.
- Output instructions.
- Evidence payload.

If one source line alone exceeds the ceiling, it is safely truncated for transport, marked unassessed, and reflected in completeness rather than sent unbounded.

The initial ceiling should keep ordinary requests close to the successfully measured representative request, approximately 25,000 to 30,000 characters total. It must be a named constant covered by boundary tests rather than an incidental patch-character limit.

### Aggregation

Chunks run with bounded concurrency. The existing concurrency of three remains the starting point because production rate-limit telemetry reported allowed requests and the Azure app has 1.75 CPU and 3.5 GiB memory. Concurrency remains configurable or isolated behind a constant so production evidence can lower it without changing behavior.

Each chunk receives at most one retry for a classified transient timeout, transport error, or structurally rejected response. A deterministic validation failure such as an ungrounded path is not made valid by retrying identical output unless the failure category is explicitly retryable.

Successful summaries and findings are aggregated using the existing bounds and deduplication. Any exhausted chunk makes model coverage incomplete, but successful chunks and all deterministic/checker findings remain in the review.

## Timeout and fallback behavior

The timeout wrapper owns the distinction between an external cancellation and its own deadline. When its controller is aborted by the deadline, it throws or normalizes to a typed timeout error even if the Agent SDK reports `Claude Code process aborted by user`.

Fallback classification uses the normalized type, not brittle provider message text.

For structured OAuth requests:

1. Try correct Haiku with the minimal classifier configuration.
2. On a retryable provider/model failure, try configured Sonnet through the same Agent SDK configuration.
3. Do not fall through to the AI SDK when no provider API key exists.
4. Return a typed failure category after the bounded attempts are exhausted.

The outer chunk retry and inner model fallback must have a single documented attempt budget so they cannot multiply into an unbounded sequence. The implementation plan will assign ownership to one layer and test the exact call count.

## Completeness and public behavior

The existing comment format remains unchanged:

- `Summary` contains the concise grounded change description.
- `Findings` contains deterministic, checker, and successfully validated model findings with exact `path:line` locations where line evidence exists.
- `Verdict` remains advisory and derived in code.

The sentence that the model-backed rule check was incomplete appears only when at least one material evidence chunk was unassessed or exhausted its bounded attempts. Successful schema-backed coverage of every eligible chunk removes that caveat.

A model failure must never erase deterministic findings, checker findings, or a deterministic summary. A clean verdict means no violations were found in all evidence sources that completed; it does not imply human approval.

## Observability

Emit one bounded structured event per model attempt and one aggregate event per review. Allowed fields include:

- Task name and provider family.
- Requested and resolved model identifiers.
- Chunk ordinal and total count.
- Prompt character count and evidence-line count.
- Duration and attempt number.
- Completion category: success, timeout, provider error, transport error, missing structured result, schema rejection, or domain-grounding rejection.
- Finding count and whether coverage is complete.

Do not log prompt text, source lines, model prose, structured result bodies, access tokens, workspace paths, or GitHub payloads.

## Testing strategy

Implementation follows test-driven development. Tests are added before each production change and cover:

- The valid Haiku identifier is selected and is not silently replaced by Sonnet.
- Structured requests use the minimal system prompt, native JSON schema, no tools, and three turns.
- Only successful `structured_output` is accepted; partial assistant prose is rejected.
- Domain validation rejects unknown paths and line numbers not present in the added-line allowlist.
- Added-line extraction preserves right-side coordinates across multiple hunks, deletions, and `No newline at end of file` markers.
- Prompt packing measures the complete prompt and splits a single large file at line boundaries.
- Boundary behavior for an exact-size chunk, one-over-size chunk, and one oversized source line.
- Deadline-owned aborts normalize to a timeout while genuine external cancellation remains cancellation.
- OAuth fallback tries Haiku and then Sonnet through Agent SDK without requiring `ANTHROPIC_API_KEY`.
- The attempt budget is exact and bounded.
- Mixed successful and failed chunks retain validated findings and mark coverage incomplete.
- All-success chunks remove the incomplete caveat and render concrete `path:line` findings.
- Existing concise comment, deterministic checks, generic-review suppression, and canonical-comment behavior do not regress.

Verification includes targeted tests for the LLM abstraction and add-on review, TypeScript compilation, scoped linting, and the full test suite with any pre-existing unrelated failure recorded separately.

## Deployment and live acceptance

Build an immutable container image from the verified commit and create a new Azure Container Apps revision using the existing deployment process. Confirm the revision is healthy and receives 100 percent traffic before live testing.

Retrigger the explicit review response on the representative `xbmc/repo-scripts` pull request. Acceptance requires:

- Exactly one canonical Kodiai add-on review comment is updated.
- The comment retains `Summary`, `Findings`, and `Verdict`.
- The model-backed incomplete caveat is absent when all chunks complete.
- Every code finding has a validated `path:line` location.
- Deterministic findings remain present and correct.
- No generic Python code-quality review appears.
- Logs show correct Haiku routing, bounded prompt sizes, schema-backed success, and no leaked evidence.

If the live result is incomplete, preserve the deployed diagnostics, identify the exact failed category, and do not claim the repair complete. Roll back using the existing Container Apps revision procedure if the new revision regresses publication or handler health.

## Open decisions

No product decisions remain open. Exact prompt ceiling and whether retry ownership lives in the LLM layer or chunk runner are implementation details to settle from tests while preserving the bounded behavior above.
