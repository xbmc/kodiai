# M068 Candidate Publication Smoke Evidence

## Scope

Bounded evidence for live production runs on `xbmc/xbmc#28172`. This file intentionally records only delivery IDs, review output keys, counts, status/mode fields, reason codes, and public GitHub artifact URLs.

## Accepted exact-key candidate-approved run

- Trigger comment: `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423917332`
- Repository / PR: `xbmc/xbmc#28172`
- Event/action: `issue_comment.created` explicit `@kodiai review`
- Delivery ID: `e15d3ee0-4d6b-11f1-9d31-9ef027295c6d`
- Review output key: `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-mention-review:delivery-e15d3ee0-4d6b-11f1-9d31-9ef027295c6d:head-kodiai-review-validation-20260411`
- Review Details issue comment: `https://github.com/xbmc/xbmc/pull/28172#issuecomment-4423943241`
- Inline candidate comments:
  - `https://github.com/xbmc/xbmc/pull/28172#discussion_r3221441431`
  - `https://github.com/xbmc/xbmc/pull/28172#discussion_r3221441565`
  - `https://github.com/xbmc/xbmc/pull/28172#discussion_r3221441869`
  - `https://github.com/xbmc/xbmc/pull/28172#discussion_r3221442017`

## Accepted proof counters

| Field | Value |
|---|---:|
| mode | candidate-approved |
| candidatePublished | 4 |
| directFallback | 0 |
| Review Details artifacts | 1 |
| Inline candidate review comments | 4 |
| Pull Request Review artifacts | 0 |

## Accepted verifier result

Bounded fixture: `scripts/fixtures/m068-candidate-approved-proof.json`

Verification command:

```bash
bun run verify:m068:candidate-publication --expect-status m068_ok scripts/fixtures/m068-candidate-approved-proof.json
```

Result: `success=true`, `status_code=m068_ok`, `candidatePublished=4`, `directFallback=0`, and `exactKeyArtifactCount=5`. The verifier now treats this as valid because the milestone contract requires exactly one bounded Review Details artifact plus candidate-approved inline publication; inline candidate comments are expected candidate publication artifacts, not duplicate Review Details artifacts.

## Prior blocked direct-fallback run

- Source log extraction: `.gsd/exec/f576783f-db47-4b96-bd71-59b6a2e9fa6e.stdout`
- Detailed gate-key extraction: `.gsd/exec/54de0fff-b5b4-43c5-a497-b2a72d4b5c6f.stdout`
- GitHub-visible artifact extraction: `.gsd/exec/ed2e2643-bac3-4fac-b892-aae8ff31ad69.stdout`
- Repository / PR: `xbmc/xbmc#28172`
- Event/action: `pull_request.synchronize`
- Delivery ID: `3a63ea30-4cee-11f1-951a-db5e2665bb61`
- Review output key: `kodiai-review-output:v1:inst-109141824:xbmc/xbmc:pr-28172:action-synchronize:delivery-3a63ea30-4cee-11f1-951a-db5e2665bb61:head-1972551b75bfcabecd45d61ae3a75223f9988865`
- Runtime conclusion: `success`
- Review Details publication: `publicationMode=canonical`, `reviewDetailsPublished=true`, `hasCommentId=true`

### Runtime candidate-publication counters

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

### GitHub-visible artifact counters

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

### Prior blocked verdict

This remains valid blocked/remediation evidence, not M068 completion evidence. The run reached candidate capture, reducer, adapter, candidate publication, and canonical Review Details publication gates, but the exact-key visible artifact reports `published=0` candidate-approved outputs and `directFallback=1`. The verifier must continue to reject this fixture as `m068_direct_fallback`.
