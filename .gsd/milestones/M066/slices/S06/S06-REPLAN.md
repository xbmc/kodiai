# S06 Replan

**Milestone:** M066
**Slice:** S06
**Blocker Task:** T01
**Created:** 2026-05-05T03:07:42.323Z

## Blocker Description

T01 discovered that auto-mode has no authenticated GitHub operator/write path: M066_S05_* inputs and GitHub credentials are unset, no project MCP integration is configured, the github-bot token helper failed with exit 127, and the default public fallback repo has no safe open PR. Therefore the previous remaining plan, which assumed a trigger had already produced repo/PR/reviewOutputKey/delivery evidence, cannot execute as-is.

## What Changed

Rewrote the remaining S06 plan from assuming captured live evidence to first establishing a credentialed smoke gate and controlled PR, then triggering the smoke only after authenticated access exists, then verifying GitHub acceptance, and finally recording proof/revalidating. Completed T01 is preserved unchanged. T02 and T03 are rewritten, and T04/T05 are added to keep credential gating, triggering, verifier proof, and documentation/revalidation as separate executable tasks. No incomplete tasks are removed.
