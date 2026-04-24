# M063: Continuation-driven review execution

**Vision:** Turn large-PR continuation from timeout-specialized recovery into the default bounded-review lifecycle: a bounded first pass can continue automatically in the background, deepen the same visible review surface with explicit revisions, and stay measurably narrower and authority-safe instead of replaying first-pass cost or letting stale work overwrite newer truth.

## Success Criteria

- A bounded large-PR first pass triggers automatic continuation without manual intervention.
- Continuation updates the same visible review surface rather than creating an additional public lifecycle comment.
- Continuation revisions are explicit and legible on that same surface rather than silent rewrites.
- Continuation prompt/context is measurably narrower than the first pass and remains sufficient-but-bounded.
- Authoritative publish-rights checks still block stale continuation from overwriting newer review state on the shipped M063 paths.

## Slices

- [x] **S01: S01** `risk:High — `src/handlers/review.ts` already contains the prototype, but it is timeout-specialized and overloaded; if we add lifecycle behavior without extracting the seam first, we risk regressions, duplicate publication paths, and an untestable continuation state model.` `depends:[]`
  > After this: A large-PR bounded first pass automatically schedules and executes continuation through the real review handler path, using an explicit continuation planner/settlement seam rather than branch-local timeout plumbing, with no manual follow-up command required.

- [x] **S02: S02** `risk:High — the current code already spans bounded partial comment plus Review Details, so continuation can easily regress into comment churn, silent rewrites, or unresolved pending state if public-surface ownership is not defined carefully.` `depends:[]`
  > After this: Continuation deepens the same visible review surface in place: no extra lifecycle comment appears, revised findings are explicitly marked on that surface, and no-meaningful-delta continuation settles the lifecycle without noisy public churn.

- [ ] **S03: S03** `risk:Medium-high — continuation only works as a product if it stays narrower than the first pass and if every final write path still respects authoritative publish rights; otherwise the feature becomes expensive replay or stale-state corruption.` `depends:[]`
  > After this: Deterministic proof shows continuation prompt/context is materially narrower than the first pass, final write paths keep last-mile publish-rights guards, and stale/superseded continuation cannot overwrite newer authoritative review state on the shipped continuation paths.

## Boundary Map

- **Internal pass identity vs public review identity:** continuation pass keys may vary, but the visible lifecycle stays anchored to the base `reviewOutputKey`.
- **First-pass truth vs continuation settlement:** M062 `normalizeReviewFirstPass(...)` remains the source of truth for bounded first-pass publication; M063 adds an adjacent continuation lifecycle/settlement contract rather than overloading that payload.
- **Publication eligibility vs publish authority:** bounded publication eligibility and `ReviewWorkCoordinator` publish authority remain separate checks and must both survive the redesign.
- **Prompt narrowing inputs vs durable state:** continuation must prefer persisted progress/remaining-scope state over replaying first-pass-wide prompt assembly.
- **Deferred boundary:** durable cross-process authority and canonical continuation telemetry model stay with M064, not M063.
