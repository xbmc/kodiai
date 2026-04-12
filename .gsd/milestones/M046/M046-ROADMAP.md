# M046: Contributor Tier Calibration and Fixture Audit

## Vision
Turn contributor-tier calibration for `xbmc/xbmc` into a repeatable product proof: checked-in contributor fixtures with explicit provenance, a verifier that measures the current live incremental path against the intended full-signal model, and a final keep/retune/replace verdict that tells M047 exactly what must change.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | high — if contributor identities, exclusions, or signal provenance are wrong, every downstream calibration conclusion becomes false confidence. | — | ✅ | Run the new xbmc fixture refresh/verification entrypoint and inspect a checked-in contributor snapshot that shows normalized contributor identities, explicit bot/alias exclusions, curated coverage across clear senior/newcomer/ambiguous-middle cases, and machine-readable provenance for every retained sample. |
| S02 | S02 | highest product risk — the current runtime path may be structurally different from the intended scoring model, so a naive threshold retune could certify a mechanism kodiai does not actually run. | — | ✅ | Run the calibration verifier and get a per-contributor report showing fixture evidence, current live incremental-path outcomes, intended full-signal-path outcomes, percentile/tie instability checks, and freshness/unscored-profile findings mapped back to the M045 contract. |
| S03 | S03 | medium — without an explicit end-state, the milestone can finish with data but still leave m047 unconstrained, leading to opportunistic tuning instead of a deliberate system change contract. | — | ✅ | Run the top-level M046 verifier and receive one integrated report that composes fixture coverage and calibration findings into an explicit keep/retune/replace verdict, plus a concrete M047 change contract naming which mechanisms must stay, change, or be replaced. |
