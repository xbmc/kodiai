# T02: 13-xbmc-cutover 02

**Slice:** S03 — **Milestone:** M002

## Description

Turn off the old @claude GitHub Actions workflows and validate Kodiai provides at least equivalent developer experience.

Purpose: Eliminate sandbox-posting failures and consolidate to a single system.
Output: Old workflows removed and smoke-tested parity.

## Must-Haves

- [ ] "Claude GitHub Actions workflows are disabled/removed from xbmc/xbmc"
- [ ] "Kodiai is configured to review on opened, ready_for_review, and review_requested"
- [ ] "@claude triggers are handled by Kodiai without duplicate responders"
