# T01: 76-success-path-status-contract-parity 01

**Slice:** S05 — **Milestone:** M013

## Description

Make issue write success output machine-checkable so producer status semantics are contract-parity with failure-path replies.

Purpose: Phase 74 locked failure-path machine-checkability, but success replies still rely on free-form text (`Opened PR`) that can drift and break downstream automation.
Output: Updated mention-handler success reply envelope with deterministic markers plus regression coverage proving success-path status contracts stay parseable.

## Must-Haves

- [ ] "Issue write success replies emit deterministic machine-checkable status markers together with PR URL details"
- [ ] "Issue write success and failure replies follow a shared status-envelope pattern that can be parsed without natural-language guessing"
- [ ] "Success-path status semantics are regression-tested so marker drift fails CI"

## Files

- `src/handlers/mention.ts`
- `src/handlers/mention.test.ts`
