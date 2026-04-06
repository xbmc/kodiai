# Requirements

This file is the explicit capability and coverage contract for the project.

Use it to track what is actively in scope, what has been validated by completed work, what is intentionally deferred, and what is explicitly out of scope.

## Active

### R039 — Contributor profile tiers must advance truthfully as contributor activity accumulates
- Class: quality-attribute
- Status: active
- Description: Stored contributor profiles must not remain stuck in a newcomer-like tier once repository activity and expertise signals justify a higher experience classification.
- Why it matters: Persistent profile state is the highest-fidelity author-context signal in the review path. If it becomes stale or structurally unable to advance, every downstream review can inherit a false premise.
- Source: user
- Primary owning slice: M042/S01
- Supporting slices: M042/S03
- Validation: mapped
- Notes: This is about truthful advancement of the stored source of record, not just patching prompt wording.

### R040 — Review output must use the corrected contributor tier and avoid mislabeling experienced contributors as newcomers
- Class: primary-user-loop
- Status: active
- Description: Kodiai review output must not describe obviously experienced contributors as first-time or new contributors when the available contributor state indicates otherwise.
- Why it matters: False author-context guidance distorts review tone, undermines trust in Kodiai's judgment, and is directly visible to maintainers and contributors.
- Source: user
- Primary owning slice: M042/S02
- Supporting slices: M042/S01, M042/S03
- Validation: mapped
- Notes: The concrete repro is CrystalP on `xbmc/xbmc#28132`.

### R041 — Author-tier cache and fallback classification must not preserve stale or contradictory contributor experience labels
- Class: failure-visibility
- Status: active
- Description: Cached author-tier data and live fallback classification must degrade safely without silently preserving stale or contradictory contributor labels once truthful profile state exists.
- Why it matters: Fixing the stored tier alone is insufficient if review-time caches or fallback logic can still override it with stale or lower-fidelity labels.
- Source: inferred
- Primary owning slice: M042/S03
- Supporting slices: M042/S02
- Validation: mapped
- Notes: This includes precedence rules between contributor profiles, author cache, and lightweight fallback classification.

### R042 — The real repro case must be mechanically reproducible and covered by regression verification
- Class: operability
- Status: active
- Description: The misclassification reported on `xbmc/xbmc#28132` must be captured in a reproducible verification path so the fix is proven against the real bug, not only synthetic examples.
- Why it matters: The project needs a trustworthy regression guard for the exact failure that triggered the work.
- Source: user
- Primary owning slice: M042/S01
- Supporting slices: M042/S03
- Validation: mapped
- Notes: Adjacent cases should also be checked so the fix does not simply special-case CrystalP.

## Validated

### R037 — Kodiai shall surface structurally-grounded impact context in reviews by combining graph blast-radius data with semantically relevant unchanged code from the canonical current-code corpus for changed symbols.
- Class: functional
- Status: validated
- Description: Kodiai shall surface structurally-grounded impact context in reviews by combining graph blast-radius data with semantically relevant unchanged code from the canonical current-code corpus for changed symbols.
- Why it matters: Diff text and historical retrieval alone cannot show who depends on a changed symbol or which unchanged code is semantically relevant right now.
- Source: execution
- Primary owning slice: M038/S02
- Supporting slices: M038/S01, M038/S03
- Validation: validated
- Notes: Validated by `verify:m038:s02` and `verify:m038:s03`.

### R038 — Breaking-change detection for exported or widely-used symbols shall be structurally grounded with caller/dependent evidence and fail open when graph or corpus context is unavailable.
- Class: correctness
- Status: validated
- Description: Breaking-change detection for exported or widely-used symbols shall be structurally grounded with caller/dependent evidence and fail open when graph or corpus context is unavailable.
- Why it matters: Heuristic breaking-change output is less trustworthy than evidence-backed structural impact, but the review pipeline must remain non-blocking when substrate data is unavailable.
- Source: execution
- Primary owning slice: M038/S03
- Supporting slices: M038/S02
- Validation: validated
- Notes: Validated by the M038 proof harnesses and clean milestone verification.

## Deferred

### R043 — Contributor expertise/tier calibration should be tuned with broader repo-wide historical sampling beyond the immediate bugfix
- Class: quality-attribute
- Status: deferred
- Description: Kodiai should eventually calibrate contributor-tier weights, thresholds, and recalculation behavior against a broader set of real repository contributors.
- Why it matters: The immediate correctness fix may still leave room for a better long-term model.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: unmapped
- Notes: Tracked separately in GitHub issue #78.

## Out of Scope

### R044 — Redesign the entire contributor-experience tone model from scratch
- Class: anti-feature
- Status: out-of-scope
- Description: M042 will not redesign the full author-experience tone model or rewrite contributor expertise modeling from first principles.
- Why it matters: This prevents the immediate correctness milestone from expanding into an open-ended product redesign.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Tracked separately in GitHub issue #79.

### R045 — General review-surface wording cleanup unrelated to contributor-tier truthfulness
- Class: anti-feature
- Status: out-of-scope
- Description: M042 does not include unrelated prompt or review-copy cleanup unless it is required to make contributor labeling truthful.
- Why it matters: This keeps the milestone focused on correctness and regression-proof behavior.
- Source: inferred
- Primary owning slice: none
- Supporting slices: none
- Validation: n/a
- Notes: Cosmetic or broader UX cleanup can be handled separately.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R039 | quality-attribute | active | M042/S01 | M042/S03 | mapped |
| R040 | primary-user-loop | active | M042/S02 | M042/S01, M042/S03 | mapped |
| R041 | failure-visibility | active | M042/S03 | M042/S02 | mapped |
| R042 | operability | active | M042/S01 | M042/S03 | mapped |
| R043 | quality-attribute | deferred | none | none | unmapped |
| R044 | anti-feature | out-of-scope | none | none | n/a |
| R045 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 4
- Mapped to slices: 4
- Validated: 2
- Unmapped active requirements: 0
