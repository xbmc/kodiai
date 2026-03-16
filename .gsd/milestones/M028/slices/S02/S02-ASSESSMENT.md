# S02 Roadmap Assessment

**Result: Roadmap is fine. No changes needed.**

## Risk Retirement

S02 retired its assigned risk fully. The proof strategy said: *"Retrofit behavior is operationally risky → retire in S02 by proving the publisher can deterministically identify prior wiki comments, preview supersession actions, and target stable comment identities."*

All three proofs are in place:
- HTML identity marker (`<!-- kodiai:wiki-modification:{pageId} -->`) enables deterministic comment scanning
- `upsertWikiPageComment()` provides the scan-update-or-create contract
- `retrofitPreview` branch previews planned actions without mutating GitHub
- `published_comment_id BIGINT` column gives O(1) DB-side comment linkage

The live supersession proof (actual GitHub writes against `xbmc/wiki`) is intentionally deferred to S03, exactly as planned.

## Success Criterion Coverage

- `Wiki generation entrypoint produces modification-only persisted artifacts with explicit scope, no WHY: prose` → ✅ proven in S01; S03/S04 maintain regression coverage
- `Wiki publish flow renders modification-only tracking-issue comments with only minimal metadata` → **S03, S04** (live proof still needed)
- `Pipeline deterministically chooses section vs page replacement, visible in artifacts and previews` → ✅ proven in S01; **S03, S04** exercise in live context
- `Operators can deterministically identify and supersede already-published suggestion-style comments` → **S03, S04** (identity infrastructure from S02 is ready; live supersession is S03)
- `Regression checks fail on reintroduced WHY: blocks or suggestion-oriented prose` → **S04** (full regression suite)

All criteria have at least one remaining owning slice. Coverage check passes.

## Boundary Map Accuracy

S02 → S03 boundary is accurate. S02 produced everything the map required:
- Durable comment linkage (`published_comment_id` column + upsert path writing it)
- Retrofit preview/report contract (`--retrofit-preview` CLI, `RetrofitPreviewResult` type)
- Idempotent supersession behavior (upsert scan re-uses the same marker for reruns)

S03 consumes these directly. No gap.

## Forward Intelligence for S03

These S02 findings are already documented in S02-SUMMARY.md but are worth emphasizing for S03 planning:

1. **`published_comment_id=0` sentinel rows** — 21 legacy rows exist. S03 should treat `0` as "unknown identity, re-publish via upsert to get a real comment ID" rather than as a linked comment. Consider a `WHERE published_comment_id > 0` guard in any logic assuming a real live comment ID.
2. **CRLF line endings in GitHub API bodies** — The current marker scan uses `includes` on a windowed substring. Confirm this is robust against CRLF in real GitHub API response bodies before running live mutations.
3. **`retrofitPreview` before live publish** — Call `retrofitPreview` first (read-only scan), inspect the action table, then run full publish. They share the same scan logic; sequential invocation is correct.
4. **Silent empty result on scan 404** — If `issueNumber` is wrong or the GitHub API returns a pagination error, `retrofitPreview` returns an empty result without surfacing a diagnostic. S03 should add an operator-visible signal for this case.

## Requirement Coverage

- **R028** (Existing published suggestion-style comments can be retrofitted/superseded): identity infrastructure from S02 is complete; R028 reaches `validated` status upon S03 live execution. No change needed to requirement ownership or status.
- **R025, R026, R027, R029**: unchanged. S03/S04 remain the owners of their respective live-proof and regression obligations.

## Conclusion

S03 and S04 are correctly scoped. No slice reordering, merging, or splitting is warranted. The boundary map, proof strategy, and requirement ownership are all accurate as written.
