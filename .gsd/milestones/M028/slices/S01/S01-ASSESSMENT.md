# S01 Post-Slice Roadmap Assessment

**Result: Roadmap confirmed. No changes needed.**

## Risks Retired

S01 retired both risks it owned:

- **Suggestion-shaped pipeline end to end** → retired. Types (`replacementContent`, `modificationMode`), parser (`parseModificationContent`), storage (`storeSuggestion` writing new columns), renderer (`formatPageComment` with no `**Why:**` or `:warning:`), and verifier (negative guards as required tests) all operate on the modification-only contract.
- **Hybrid granularity not modeled explicitly** → retired. `modificationMode: 'section' | 'page'` is first-class in types, DB schema, generator, publisher, and verifier. Deterministic threshold rule (`>= pageModeThreshold` → page mode) is tested and machine-checkable via `M028-S01-MODE-FIELD`.

## Success Criteria Coverage

All five success criteria have at least one remaining owning slice:

- Persisted artifacts are replacement-text-only with explicit scope and no WHY:/rationale → S01 proved the contract; S03, S04 prove real entrypoint behavior end-to-end
- Published comments contain only replacement content plus minimal metadata → S03, S04
- Pipeline deterministically chooses section vs page mode; choice is visible → S01 proved mode-selection; S03, S04 prove it in live previews
- Operators can identify and supersede already-published suggestion-style comments → S02, S03, S04
- Regression checks fail on reintroduced WHY:/suggestion prose → S01 proved render-layer guards; S04 proves full integrated regression path

## Boundary Contracts

The S01 → S02 boundary is accurate. S02 consumes exactly what S01 produced:
- `modification_mode` and `replacement_content` are first-class DB columns
- `storeSuggestion` DELETE+INSERT key is `(page_id, modification_mode, COALESCE(section_heading, ''))` — S02 comment identity must account for this compound key (noted in S01 Forward Intelligence)
- `formatPageComment` canonical render output is ready for retrofit logic to target

## Requirement Coverage

- R025 (Wiki outputs are modification-only) — substantially advanced; primary owner delivered
- R026 (Published comments contain only modification content plus minimal metadata) — supported; primary owner (S03) still correctly scoped
- R027 (Wiki modification artifacts support hybrid granularity) — primary owner delivered; type, DB, generator, publisher, and verifier all carry explicit mode
- R028 (Existing suggestion comments can be retrofitted/superseded) — primary owner S02 still correctly scoped; S01 Forward Intelligence provides the DB key contract S02 needs
- R029 (Regression checks prevent opinion-style publishing from returning) — render-layer guards proved; full integrated proof remains with S04

## Known Limitation (no roadmap impact)

`buildGroundedSectionPrompt` still instructs the LLM to `Begin with "WHY: "`. This is intentional for S01 — `parseModificationContent` strips it as a model drift guard. The prompt should be updated in S02 or S03 once the modification-only pipeline is fully validated end-to-end. No slice scope change required; the guard causes no harm until then.

## Conclusion

S02, S03, and S04 are correctly ordered and scoped. No changes to the roadmap.
