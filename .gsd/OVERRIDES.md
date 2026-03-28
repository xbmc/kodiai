# GSD Overrides

User-issued overrides that supersede plan document content.

---
## Override: 2026-03-18T15:23:45.705Z

**Change:** we need to a bugfix asap, new branch, and a PR: https://github.com/xbmc/xbmc/pull/27402#issuecomment-4082944207 you oepned a PR for a review?? and buried the comment?? why did you open a PR. fix it.
**Scope:** resolved
**Applied-at:** M029/none/none
**Resolved-at:** 2026-03-21 — Hotfix merged to main (2026-03-18) before this rewrite unit ran. D006 added to DECISIONS.md, R030 added to REQUIREMENTS.md (validated), hotfix entry added to PROJECT.md milestone sequence and Current State. Root cause: `please` was in the `confirmationAction` list causing "please do a full review" to be treated as write intent; fixed via `isReviewRequest()` guard + removal of `please` from confirmation signals; PR #28043 on xbmc/xbmc closed.

---
