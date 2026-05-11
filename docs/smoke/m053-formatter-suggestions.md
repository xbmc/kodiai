# M053/S05 Formatter Suggestions Proof Alignment

Status: **Accepted by existing live proof.** M053/S05/R085 is satisfied by the stronger accepted formatter-suggestion smoke recorded in [`m066-formatter-suggestions.md`](m066-formatter-suggestions.md), especially the final `xbmc/xbmc#28259` default-command combined-trigger smoke.

This note is intentionally thin: it does not create a duplicate verifier, does not mint an `m053_s05_ok` status code, and does not claim a fresh M053 smoke run. The canonical accepted verifier surface remains `verify:m066:s05` with `status_code: "m066_s05_ok"`.

## Accepted proof mapped to M053/S05/R085

The accepted `xbmc/xbmc#28259` proof demonstrates the exact M053 acceptance surface:

| Proof attribute | Accepted evidence |
|---|---|
| Repository / PR | `xbmc/xbmc#28259` |
| Trigger | `@kodiai review format suggestions` |
| Formatter action | `mention-format-suggestions` |
| Publication surface | Same-PR Pull Request Review in `COMMENTED` state |
| Suggestion surface | Fenced GitHub `suggestion` review comments on the PR |
| Correlation | GitHub delivery id plus formatter `reviewOutputKey` in the accepted M066 proof record |
| Verifier | `verify:m066:s05` |
| Accepted status code | `status_code: "m066_s05_ok"` |

The accepted M066 smoke record also captures the deployed revision, Pull Request Review URL/id, suggestion comment URLs, posted count, and delivery/log correlation needed for future operator inspection without including secrets.

## Accepted rerun command

When GitHub App credentials are present, operators can rerun the accepted verifier against the canonical `xbmc/xbmc#28259` proof:

```sh
bun run verify:m066:s05 -- --repo xbmc/xbmc --review-output-key "kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28259:action-mention-format-suggestions:delivery-febb39b0-485c-11f1-8ae6-ceef51a675f1:head-0be61fc701a277c11991f6a8c5cff2bf9e4c35e2" --delivery-id "febb39b0-485c-11f1-8ae6-ceef51a675f1" --json
```

Expected accepted result from the proof record: `success: true` with `status_code: "m066_s05_ok"`, a matching `COMMENTED` Pull Request Review, and fenced GitHub `suggestion` review comments.

## Explicit exclusions

This M053/S05 alignment does **not** prove or broaden any of the following:

- issue comments as formatter-suggestion proof;
- fallback-only output as satisfying R085;
- normal automatic PR review formatter suggestions;
- `review.formatterSuggestions.automatic` runtime publication.

Automatic PR review formatter suggestions remain off/reserved until future runtime wiring explicitly enables and verifies that mode. Current accepted proof is limited to explicit formatter requests that publish same-PR Pull Request Review suggestions.

## Proof hygiene

Keep this note and the linked proof secret-free. Public PR, review, comment, delivery, and `reviewOutputKey` identifiers are acceptable for correlation; GitHub App private key material, tokens, raw formatter stdout, and unbounded stderr are not.
