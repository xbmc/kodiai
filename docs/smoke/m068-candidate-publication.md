# M068 Candidate Publication Smoke Evidence

## Scope

Bounded evidence for the fresh production run on `xbmc/xbmc#28172`. This file intentionally records only delivery IDs, review output keys, counts, status/mode fields, reason codes, and public GitHub artifact URLs.

## Exact-key run

- Source log extraction: `.gsd/exec/f576783f-db47-4b96-bd71-59b6a2e9fa6e.stdout`
- Detailed gate-key extraction: `.gsd/exec/54de0fff-b5b4-43c5-a497-b2a72d4b5c6f.stdout`
- GitHub-visible artifact extraction: `.gsd/exec/ed2e2643-bac3-4fac-b892-aae8ff31ad69.stdout`
- Repository / PR: `xbmc/xbmc#28172`
- Event/action: `pull_request.synchronize`
- Delivery ID: `3a63ea30-4cee-11f1-951a-db5e2665bb61`
- Review output key: `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-3a63ea30-4cee-11f1-951a-db5e2665bb61:head-1972551b75bfcabecd45d61ae3a75223f9988865`
- Runtime conclusion: `success`
- Review Details publication: `publicationMode=canonical`, `reviewDetailsPublished=true`, `hasCommentId=true`

## Runtime candidate-publication counters

| Field | Value |
|---|---:|
| approvedReferences | 1 |
| rewrittenReferences | 4 |
| candidatePublishable | 5 |
| candidatePublished | 0 |
| candidateSkipped | 5 |
| candidateBlocked | 0 |
| candidateFailed | 0 |
| candidateMalformed | 0 |
| convertedProcessedFindings | 0 |
| directAttempted | 1 |
| directPublished | 1 |
| fallbackEvidence | 1 |
| fallbackDisallowed | 1 |
| malformed | 0 |

- Runtime mode: `direct-fallback`
- Runtime reason codes: `candidate-publisher-skipped`, `direct-fallback-attempted`, `direct-fallback-published`, `direct-fallback-disallowed`
- Adapter bounded counts: `approved=1`, `input=5`, `publishable=5`, `rewritten=4`, `skipped=0`
- Candidate publication result sample count: `5`
- Adapter payload fingerprint count: `5`

## GitHub-visible artifact counters

| Artifact class | Total checked | Matching exact key |
|---|---:|---:|
| Reviews | 62 | 0 |
| Review comments | 56 | 0 |
| Issue comments | 47 | 1 |

- Matching issue comment ID: `4417527175`
- Matching issue comment URL: `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4417527175`
- Output key marker present: `true`
- Review Details marker present: `true`
- GitHub-visible candidate line: `mode=direct-fallback approved=1 rewritten=4 published=0 directFallback=1 reasons=candidate-publisher-skipped,direct-fallback-attempted,direct-fallback-published,direct-fallback-disallowed`

## Acceptance verdict

This is valid blocked/remediation evidence, not M068 completion evidence. The run reached candidate capture, reducer, adapter, candidate publication, and canonical Review Details publication gates, but the exact-key visible artifact reports `published=0` candidate-approved outputs and `directFallback=1`. S12/T03 re-ran the bounded exact-key candidate-publication verifier against delivery `3a63ea30-4cee-11f1-951a-db5e2665bb61` / issue comment `4417527175`; the fresh bounded assertion is recorded at `.gsd/exec/81a7093f-973c-4530-bd18-cc33e996c833.stdout`, and the verifier returned `status_code=m068_direct_fallback`, `candidatePublished=0`, `directFallback=1`, and `exactKeyArtifactCount=1`. The verifier and milestone validation must continue to reject this as `m068_ok` until a fresh exact-key run proves candidate-approved publication with zero direct fallback.
