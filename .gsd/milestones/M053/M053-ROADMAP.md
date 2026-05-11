# M053: M053: Same-PR Formatter Suggestions

**Vision:** Kodiai should independently compute formatter changes for a pull request and publish them as same-PR GitHub committable suggestions when explicitly requested, with automatic inclusion defaulting off but available by repo config.

## Success Criteria

- Maintainers can explicitly request formatter suggestions on a PR without enabling automatic mode.
- Kodiai computes formatter suggestions independently of Jenkins artifacts.
- Formatter suggestions appear as same-PR GitHub committable suggested changes, not a new PR or bot-pushed commit.
- A combined `@kodiai review & format suggestions` request runs both subflows with independent failure handling.
- Unsafe or excessive formatter hunks are skipped/capped with visible and logged reasons.
- A live deployed smoke proves GitHub accepts at least one Kodiai-generated formatter suggestion.

## Slices

- [x] **S01: S01** `risk:medium` `depends:[]`
  > After this: `@kodiai format suggestions` and `@kodiai review & format suggestions` are recognized, and config shows automatic suggestions default off while explicit requests stay allowed.

- [x] **S02: S02** `risk:high` `depends:[]`
  > After this: Fixture tests prove formatter unified diffs become safe GitHub suggestion payloads, with unmappable hunks skipped and capped.

- [x] **S03: S03** `risk:high` `depends:[]`
  > After this: A publisher can create one GitHub PR review containing multiple inline suggestion blocks, with markers/idempotency and rejection handling.

- [x] **S04: S04** `risk:medium` `depends:[]`
  > After this: `@kodiai format suggestions` runs only formatter suggestions, while `@kodiai review & format suggestions` runs normal review plus formatter suggestions without either subflow blocking the other.

- [x] **S05: S05** `risk:medium` `depends:[]`
  > After this: A deployed run posts at least one committable formatter suggestion on a real/test PR and documents how maintainers enable automatic mode later.

## Boundary Map

## Boundary Map
