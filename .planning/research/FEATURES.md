# Feature Research

**Domain:** PR-review assistant features for embedding-assisted learning, incremental re-review, and multi-language support (v0.5)
**Researched:** 2026-02-12
**Confidence:** MEDIUM

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist for these v0.5 capabilities. Missing these makes the system feel noisy, inconsistent, or unsafe.

| Category | Feature | Why Expected | Complexity | Notes |
|---------|---------|--------------|------------|-------|
| Embedding-assisted learning | **Repo-scoped learning memory from accepted/suppressed findings** | Teams expect "the bot should learn what we keep accepting vs ignoring" without retraining models. | MEDIUM | Store feedback signals as embeddings + metadata (`repo`, `path`, `rule`, `language`, `outcome`). Keep tenant isolation strict by default. |
| Embedding-assisted learning | **Retrieval-gated prompt augmentation** | Users expect relevant prior context to be reused, but only when confidence is high enough to reduce noise. | MEDIUM | Inject top-K similar prior findings only above threshold; hard cap token budget to avoid prompt bloat. |
| Embedding-assisted learning | **Deterministic fallback when retrieval is unavailable** | Private teams expect review never to fail because vector search degraded. | LOW | If embedding/index fails, continue review with existing deterministic context and emit telemetry warning. |
| Incremental re-review | **Re-review only changed hunks since last reviewed SHA** | Re-running full PR review after every push is perceived as spam. | HIGH | Use `pull_request.synchronize` flow and compare previous reviewed head SHA to current head SHA. |
| Incremental re-review | **Do-not-repeat behavior for unchanged prior findings** | Developers expect fixed or acknowledged items not to be re-posted verbatim. | HIGH | Track comment fingerprint (`path`, normalized code span, finding type) and suppress duplicates unless code changed materially. |
| Incremental re-review | **Resolved-thread awareness** | If a conversation is resolved and code remains unchanged, users expect the bot not to reopen the same point. | MEDIUM | Pull prior review comments/threads and map to new diff positions carefully (line mapping is fragile by nature). |
| Multi-language support | **Configurable output language (`review.outputLanguage`)** | Global teams expect comments in team language with no extra setup. | LOW | Use BCP-47 style values (`en`, `es`, `ja`, `pt-BR`) and default to repo-level setting. |
| Multi-language support | **Language-consistent severity and taxonomy** | Teams need stable categories regardless of output language for dashboards/rules. | MEDIUM | Keep canonical internal labels (`security`, `correctness`, etc.) and only localize presentation layer. |
| Multi-language support | **Code-safe localization** | Users expect translated prose, not translated identifiers/snippets. | LOW | Never translate code blocks, symbol names, file paths, or shell commands. |

### Differentiators (Competitive Advantage)

Features that materially improve signal quality and trust for private-team workflows.

| Category | Feature | Value Proposition | Complexity | Notes |
|---------|---------|-------------------|------------|-------|
| Embedding-assisted learning | **Outcome-weighted retrieval ranking** | Surfaces prior findings that were historically accepted/fixed, reducing repeated false positives. | MEDIUM | Rank by semantic similarity + recency + acceptance rate + file/path proximity. |
| Embedding-assisted learning | **Explainable learning context in comment metadata** | Builds trust: reviewers can see why a similar prior case influenced this finding. | MEDIUM | Add optional "Learned from similar accepted finding in `path/*`" footnote with minimal verbosity. |
| Incremental re-review | **Delta summary section** | Gives high-signal update: "new issues", "still open", "resolved since last review". | MEDIUM | Summary-level feature, low risk, high perceived value for busy reviewers. |
| Incremental re-review | **Regression detection on previously fixed pattern** | Catches reintroduced mistakes and proves memory is useful beyond suppression. | HIGH | Requires linking historical resolved findings to new diff and confidence thresholds. |
| Multi-language support | **Mixed-language understanding in one PR** | Handles English code comments with non-English PR descriptions and review conversations gracefully. | MEDIUM | Detect dominant language per artifact (PR body, comments) and localize response while preserving canonical tags. |
| Multi-language support | **Localized suggestion tone profiles** | Keeps comments culturally natural while preserving strictness policy. | MEDIUM | Map existing strictness modes to per-language phrasing templates; policy remains same. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look attractive but are likely to hurt v0.5 signal quality, scope, or trust.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Auto-learning from every emoji/reaction** | Feels "automatic" and zero-config. | Reaction signal is ambiguous and noisy; causes unstable behavior and hard-to-debug drift. | Learn only from explicit outcomes (accepted suggestion, explicit suppression, explicit feedback action). |
| **Cross-repo shared learning memory by default** | Teams want global learning quickly. | Data leakage and policy mismatch across repos/teams; weakens private-team trust posture. | Keep repo-scoped memory by default; add explicit opt-in org-level pools later. |
| **Machine-translation of code tokens and identifiers** | Some users ask for fully translated comments. | Translating identifiers breaks precision and can create incorrect fix advice. | Translate prose only; preserve code, paths, symbols verbatim. |
| **Full PR re-review after each push "for safety"** | Simpler implementation. | Produces duplicate noise and reviewer fatigue; directly conflicts with low-noise product goal. | Incremental pass by default, optional full re-review command for manual override. |
| **Language-specific rule engines per locale in v0.5** | Seems like best localization quality. | Explodes maintenance matrix and causes inconsistent severity outcomes across languages. | One canonical policy/rule engine, localized rendering layer only. |
| **Merge-blocking based on learned confidence alone** | Teams want automation. | False positives in learned/retrieved context can block delivery and quickly erode trust. | Keep advisory mode for v0.5; allow status signaling without hard gate. |

## Feature Dependencies

```text
[Feedback Capture Signals] (already exists)
    └──requires──> [Embedding Memory Write Path]
                          └──requires──> [Schema for outcome metadata]

[Embedding Memory Write Path]
    └──requires──> [Retrieval API + ranking]
                          └──enhances──> [Learning-informed review prompt]

[Reviewed SHA + prior comment map]
    └──requires──> [Incremental diff computation]
                          └──requires──> [Duplicate suppression fingerprinting]
                                               └──enables──> [Incremental re-review UX]

[Canonical finding taxonomy]
    └──requires──> [Output localization layer]
                          └──enables──> [Multi-language comments]

[Output localization layer]
    └──conflicts──> [Code/identifier translation]
```

### Dependency Notes

- **Embedding retrieval requires outcome metadata:** without explicit outcome labels, retrieval adds context but not quality control.
- **Incremental re-review requires prior state mapping:** last reviewed SHA + prior posted comments are mandatory to prevent duplicate spam.
- **Localization requires canonical internal taxonomy:** translated labels without canonical IDs break filtering and metrics.
- **Localization conflicts with code translation:** code/text boundary must be strict to avoid incorrect advice.

## MVP Definition

### Launch With (v0.5)

Minimum set to validate advanced learning + language support while keeping output low-noise.

- [ ] **Embedding memory from explicit outcomes** — core learning loop with controllable behavior
- [ ] **Retrieval-gated prompt context with strict threshold + token cap** — quality gains without prompt sprawl
- [ ] **Incremental re-review on new commits only** — eliminates repeated full-PR noise
- [ ] **Duplicate finding suppression across re-reviews** — preserves trust and reduces fatigue
- [ ] **Configurable output language with code-safe localization** — practical multilingual usability
- [ ] **Fail-open fallback when retrieval/localization fails** — production reliability for private teams

### Add After Validation (v0.5.x)

- [ ] **Delta summary (`new`, `resolved`, `still-open`)** — add when teams need workflow-level visibility
- [ ] **Outcome-weighted ranking (recency + acceptance bias)** — add after baseline retrieval quality is measured
- [ ] **Mixed-language artifact handling in one PR** — add when multilingual repos exceed baseline assumptions

### Future Consideration (v0.6+)

- [ ] **Org-level opt-in shared learning pools** — defer until strong tenancy controls and admin policy surface exist
- [ ] **Regression detector for previously fixed findings** — high value but needs robust historical linking/evals

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Embedding memory from explicit outcomes | HIGH | MEDIUM | P1 |
| Retrieval-gated prompt augmentation | HIGH | MEDIUM | P1 |
| Incremental diff since last reviewed SHA | HIGH | HIGH | P1 |
| Duplicate finding suppression | HIGH | HIGH | P1 |
| Configurable output language | HIGH | LOW | P1 |
| Code-safe localization guardrails | HIGH | LOW | P1 |
| Fail-open fallback behavior | HIGH | LOW | P1 |
| Delta summary in review output | MEDIUM | MEDIUM | P2 |
| Outcome-weighted retrieval ranking | MEDIUM | MEDIUM | P2 |
| Mixed-language per-artifact handling | MEDIUM | MEDIUM | P2 |
| Regression detector on reintroduced issues | HIGH | HIGH | P3 |
| Org-level shared learning memory (opt-in) | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Typical Market Pattern | Risk if Copied Naively | Kodiai v0.5 Approach |
|---------|------------------------|-------------------------|-----------------------|
| Learning from prior reviews | Mostly opaque "bot learns" behavior | Unpredictable drift and low debuggability | Explicit, auditable learning from clear outcomes |
| Re-review behavior | Some tools still over-post on re-runs | Comment fatigue and low trust | Incremental-by-default with duplicate suppression |
| Multilingual comments | Translation quality varies, often code-unsafe | Incorrect suggestions due to token translation | Prose localization + strict code preservation |
| Advanced automation | Push toward merge gating/auto actions | High blast radius when wrong | Advisory-first, high-signal, low-noise |

## Sources

- Existing Kodiai capabilities and constraints from current milestone context (HIGH confidence).
- GitHub Webhooks: pull request event model and delivery constraints (official docs): https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request (MEDIUM confidence; page is large but authoritative).
- GitHub REST API: pull request review comments (line mapping, comment identity, permissions): https://docs.github.com/en/rest/pulls/comments (HIGH confidence).
- GitHub REST API: pull request files and PR metadata endpoints: https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files (HIGH confidence).
- OpenAI Embeddings guide: embedding models, multilingual performance note, dimensions/cost tradeoff: https://platform.openai.com/docs/guides/embeddings (HIGH confidence).

---
*Feature research for: Kodiai v0.5 advanced learning and language support*
*Researched: 2026-02-12*
