# Consolidated Review Current Audit

This branch is the active ledger for PR #195, `consolidated-review-fixes`.

The original consolidated review summary attachment is not present in this
workspace:

- `/Users/keith/.codex/attachments/25f8c8fa-d5a1-4a74-9ca8-e9dbbb26a7f3/pasted-text.txt`
- `/home/keith/.codex/attachments/25f8c8fa-d5a1-4a74-9ca8-e9dbbb26a7f3/pasted-text.txt`

Because that source document is missing, this audit is a current-state evidence
ledger from the surviving handoff notes, PR state, source scans, and tests. It
must not be treated as a substitute for the original requirement-by-requirement
audit if the attachment becomes available.

## Branch Decision

Continue via PR #195 instead of rebasing locally.

Evidence:

- `origin/main` is an ancestor of `HEAD`.
- GitHub reports PR #195 as mergeable.
- Local `HEAD` matches `origin/consolidated-review-fixes`.

## Structural Recommendations

| Recommendation | Current evidence | Status |
| --- | --- | --- |
| Reduce `review.ts` and `mention.ts` monster handlers | `review.ts` is 1525 physical lines (1526 newline-split lines) after extracting handler dependency defaults, event registration, processed-finding typing, publication context projection, retry job parameter projection, fallback publication parameter projection, timeout continuation-state side effects, retry scheduling parameter projections, timeout classification parameter projection, and bounded first-pass timeout publication state projection to focused modules; `mention.ts` is 494 physical lines (495 newline-split lines) after extracting its dependency contract to `src/handlers/mention-handler-dependencies.ts`. Both are now orchestration shells with extracted modules guarded by `src/handlers/review-structure.test.ts` and `src/handlers/mention-structure.test.ts`. | Partially satisfied. `review.ts` remains large, but executable structure guards prevent key responsibilities from drifting back into the handler. The review handler line-budget ratchet is now 1527 newline-split lines; the mention handler line-budget ratchet is now 510 lines. |
| Route every outbound body through one publication pipeline | `src/lib/github-publication-architecture.test.ts` scans production TypeScript for direct body-bearing GitHub comment/review writes and direct outgoing sanitizer usage outside the facade. Fresh source scans found no body-bearing direct publication calls outside `src/lib/github-publication.ts`. | Satisfied by current evidence. |
| Adopt `{ ok, value }` / `{ ok: false, err }` adapter result shape | `src/lib/result.ts` exists and Result is used across publication, handler recovery, validation, timeout, formatter, write-output, candidate publication adapter, candidate inline publication, published-output Review Details merge, moved-to-details Review Details merge, first-pass Review Details publication, timeout Review Details publication, bounded first-pass timeout publication orchestration, review fallback publication orchestration, explicit mention review publication orchestration, mention post-executor publication, and mention execution fallback publication boundaries. `src/lib/result-architecture.test.ts` and `src/handlers/publication-result-structure.test.ts` cover the architecture expectation. | Partially satisfied. Result boundaries now cover the high-risk adapter/publication surfaces, but they are not universal across every repo module. |
| Use shared paginated marker-comment helpers | `src/lib/github-issue-comments.ts` now covers issue comments, review comments, pull reviews, and shared scan/list helpers. `src/review-orchestration/review-output-marker-scan.ts` uses those helpers for review-output marker surfaces. | Satisfied by current evidence for marker-comment lookup paths. |
| Consolidate timeout primitives and AbortSignal plumbing | `src/lib/with-timeout.test.ts` contains production-wide architecture tests for raw timeout primitive usage. Fresh scans found no production `setTimeout`, `Promise.race`, or `new AbortController` timeout usage outside `src/lib/with-timeout.ts`. | Satisfied by current evidence. |

## Handoff Finding Coverage

The surviving handoff notes say the branch already fixes or appears to fix:

- Secret publication hardening, sanitizer `ghu_` support, zero-width-obfuscated GitHub tokens, MCP outbound publication pipeline.
- Git `quotePath` write-policy bypass.
- Slack plan read-only/no-write safeguard bypass.
- Failed write runs no longer publish dirty work.
- Knowledge corpus loss for review-thread replies, canonical-code unchanged chunk resurrection, issue-comment watermark/backfill.
- Review run crash/race recovery.
- Hybrid search stable IDs/RRF and BM25 distance contract.
- Retry stale checkpoint.
- Embedding sweep loop.
- LLM timeout/fallback/Haiku routing.
- Docker `pricing.json` image copy coverage.
- Webhook dedup/rate-limit loss.
- Slack repo override misparse.
- `/kodiai link` takeover prevention, including existing unlinked scored profiles.
- Python graph attribution/callsite and C++ include cross-file graph edges.
- Pagination/dedup helper for marker comments.
- Review-comment tombstone race.
- CI stale comment deletion.
- No-review ack dedup.
- MCP inline idempotency.
- `maxTurnsPerPr` issue-comment counting.
- Write rate limiting on gist/fork flows.
- Cluster centroid weighting and slug collision suffixing.
- Dotted repo dep-bump parsing.
- Structural-impact unavailable-cache/graph cache fixes.
- Fork lookup same-name repo protection.
- Pyproject tooling suppression.
- Readiness DB probe.
- `@claudette` substring mention matching.
- Catch-up retry backoff.
- SIGKILL/shutdown escalation.
- Thread budget clamps out-of-range distances.

These bullets require the original pasted summary, or equivalent authoritative
review text, for final requirement-by-requirement completion proof. Until then,
they should be treated as the best available reconstructed checklist.

## Current Verification Commands

Run these before changing the PR from draft to ready:

```sh
bun test src/lib/github-publication-architecture.test.ts src/lib/with-timeout.test.ts src/lib/result-architecture.test.ts src/lib/github-issue-comments.test.ts
bun test src/handlers/review-structure.test.ts src/handlers/mention-structure.test.ts
bun test src/handlers/review-candidate-inline-publication.test.ts src/handlers/publication-result-structure.test.ts src/lib/result-architecture.test.ts
bun test src/handlers/review-setup-octokit.test.ts src/handlers/mention-setup-octokit.test.ts src/handlers/review-timeout-retry-context.test.ts
bun test src/execution/mcp/comment-server.test.ts src/execution/mcp/inline-review-server.test.ts src/execution/mcp/issue-comment-server.test.ts src/execution/mcp/review-comment-thread-server.test.ts
bun test src/slack/slash-command-handler.test.ts
bun test src/knowledge/thread-assembler.test.ts src/knowledge/retrieval.test.ts src/knowledge/cluster-pipeline.test.ts
bunx tsc --noEmit
bun run lint
git diff --check
```

## Completion Limitation

Do not mark the goal complete from this ledger alone. Completion still requires
current evidence against every explicit finding and structural recommendation in
the original consolidated review summary.
