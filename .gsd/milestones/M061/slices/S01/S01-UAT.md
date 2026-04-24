# S01: Token Accounting Baseline and Reporting Repair — UAT

**Milestone:** M061
**Written:** 2026-04-24T01:04:51.722Z

# UAT — M061/S01 Token Accounting Baseline and Reporting Repair

## Preconditions
- Run from the repository root.
- Bun dependencies are installed.
- For live-data checks, `DATABASE_URL` or `TEST_DATABASE_URL` points at the current Postgres telemetry schema.
- If live DB access is unavailable, the fail-open checks below still must report the access state explicitly without falling back to SQLite.

## Test Case 1 — Slice verification suite stays green
1. Run `bun test src/telemetry/store.test.ts src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts scripts/usage-report.test.ts scripts/phase72-telemetry-follow-through.test.ts scripts/phase75-live-ops-verification-closure.test.ts`.
   - Expected: all targeted suites pass; `src/telemetry/store.test.ts` may report environment-gated skips when DB test credentials are absent, but no failures occur.
2. Run `bun run lint`.
   - Expected: ESLint exits 0 for `src/` and `scripts/`.

## Test Case 2 — Fail-open operator reporting when no live DB is available
1. Start a shell with `DATABASE_URL` and `TEST_DATABASE_URL` unset.
2. Execute `bun --eval 'import { runUsageReportCli, renderUsageReportText } from "./scripts/usage-report.ts"; const { report } = await runUsageReportCli([], {}); console.log(renderUsageReportText(report)); process.exit(0);'`.
   - Expected: output begins with `Kodiai Telemetry Usage Report`, reports `Database access: missing`, includes the explicit preflight detail, and states that no live telemetry data is available instead of mentioning SQLite.
3. Execute `bun --eval 'import { runM061S01BaselineProofCli, renderM061S01BaselineProof } from "./scripts/verify-m061-s01.ts"; const { report } = await runM061S01BaselineProofCli([], {}); console.log(renderM061S01BaselineProof(report)); process.exit(0);'`.
   - Expected: output begins with `M061 S01 baseline telemetry proof`, reports `Database access: missing`, and explains that the proof command fails open so operators can see access state before rerunning with Postgres access.

## Test Case 3 — Live usage report shows task-path, delivery, prompt-section, and cache evidence
1. Ensure representative telemetry exists for `review.full`, `mention.response`, and `slack.response` in the live Postgres tables.
2. Run `bun run report --since=30d`.
   - Expected: the report shows Summary, Task-path attribution, Delivery breakdown, Prompt-section summaries, and Cache effectiveness sections.
3. Inspect the task-path rows.
   - Expected: separate rows exist for `review.full`, `mention.response`, and `slack.response` with token/cost/cache figures.
4. Inspect prompt-section summaries.
   - Expected: named prompt sections are shown for at least review and mention task paths; no raw prompt text is printed.
5. Inspect delivery breakdown rows.
   - Expected: delivery IDs, task type, prompt kinds, section counts, and token/cost figures are visible per delivery.

## Test Case 4 — Live baseline proof verifies the slice contract
1. With live Postgres access configured, run `bun run verify:m061:s01 --since=30d`.
   - Expected: the proof prints check rows for preflight, task-path attribution, prompt sections, delivery breakdown, and cache evidence.
2. Inspect the final verdict.
   - Expected: verdict is `PASS` only when `review.full`, `mention.response`, and `slack.response` are all represented, review + mention prompt-section telemetry is present, delivery breakdown rows exist, and cache evidence exists.
3. Re-run with a repo filter if needed: `bun run verify:m061:s01 --repo <owner/repo> --since=30d`.
   - Expected: the same checks evaluate against the filtered telemetry set without switching data sources.

## Test Case 5 — Mention and review builders emit text-free prompt-section metrics
1. Run `bun test src/execution/mention-context.test.ts src/execution/mention-prompt.test.ts src/execution/review-prompt.test.ts`.
   - Expected: tests pass and confirm that the builders emit deterministic named section metrics.
2. Review a representative persisted prompt-section row in Postgres or fixture-backed test output.
   - Expected: stored fields include task path, prompt kind, section name/order, char counts, estimated tokens, and truncation markers only; raw prompt bodies are absent.

## Edge Cases
- If Postgres credentials are absent or invalid, the usage report and baseline proof must return `databaseAccess: missing` or `databaseAccess: unavailable` with actionable preflight detail and no SQLite fallback.
- If telemetry exists for review and mention but not Slack, `verify:m061:s01` must fail the task-path attribution check rather than silently passing partial evidence.
- If prompt-section rows exist but contain no review or mention task paths, the baseline proof must fail the prompt-section check explicitly.
- If cache rows are absent, the baseline proof must fail `M061-S01-CACHE-EVIDENCE` rather than implying cache effectiveness from token totals alone.
