# M049: Evidence-Backed Clean PR Approvals

## Draft context

Replace marker-only clean approval reviews with one short evidence-backed GitHub review body across all Kodiai approval lanes. The intended contract is: keep `Decision: APPROVE`, keep `Issues: none`, keep the review-output marker, add a short factual evidence block in the review body itself, do not create a separate clean-approval issue comment, and do not change findings publication behavior.

## Why now

Live `xbmc/kodiai` proofs showed that clean approvals can now be repo-backed and inspection-positive while still looking nearly silent on GitHub. The execution path is fixed, but the GitHub-visible trust signal is still weak.

## Planned scope

- Shared approved-review body contract in the canonical review-output helper seam
- Explicit mention approval-bridge adoption
- Automatic review clean-approval adoption
- Approve-via-comment sanitizer/publisher acceptance of the shared approval shape
- Live proof and auditability verification on `xbmc/kodiai`

## Non-goals

- No separate clean-approval PR comment
- No change to findings publication behavior
- No broad re-audit of whether a particular approval was substantively correct

## Target acceptance

A clean approval should publish one short GitHub review body that visibly explains why Kodiai approved, while preserving the current findings workflow and existing review-output marker correlation.
