# M051: Manual rereview trigger truthfulness

## Vision
Retire the gap between the manual rereview path Kodiai documents and the one that actually works, then clean the remaining operator/verifier truthfulness debt exposed while closing M050-era review work.

## Slice Overview
| ID | Slice | Risk | Depends | Done | After this |
|----|-------|------|---------|------|------------|
| S01 | S01 | high | — | ⬜ | After this slice, we have hard evidence for whether `ai-review` / `aireview` is a real Kodiai rereview path or whether the supported manual trigger must remain `@kodiai review`. |
| S02 | Manual rereview contract implementation | medium | S01 | ⬜ | After this slice, the supported manual rereview path works as documented, and any unsupported path is gone from code/config/docs/tests. |
| S03 | Residual operator truthfulness cleanup | medium | S02 | ⬜ | After this slice, the remaining operator/verifier truthfulness debt from PR #87 is either fixed or explicitly deferred with tracked rationale, not stranded in a closed PR review. |
