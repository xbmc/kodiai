# T08: 75-live-ops-verification-closure 08

**Slice:** S04 — **Milestone:** M013

## Description

Update the stale smoke procedure document to match the corrected Phase 75 verifier CLI after plan 75-07 removed mention-lane support.

Purpose: The smoke doc still documents `--mention` flags, `OPS75-CACHE-02`, and 6-identity invocation that the verifier no longer accepts. Because the verifier uses `strict: true` argument parsing, an operator following the current doc would get `unexpected argument '--mention'` immediately. This is a blocker for operability.

Output: A corrected `docs/smoke/phase75-live-ops-verification-closure.md` that matches the review-only verifier CLI.

## Must-Haves

- [ ] "Smoke procedure documents review-only verifier with 3-identity cache matrix (no mention lane)"
- [ ] "Command section uses only --review, --review-accepted, --degraded, --failopen flags (no --mention)"
- [ ] "OPS75-CACHE-02 does not appear anywhere in the smoke document"
- [ ] "Latest Live Capture and Plan 75-06 sections are removed or replaced with a note referencing the runbook"

## Files

- `docs/smoke/phase75-live-ops-verification-closure.md`
