# Requirements: Kodiai v0.8 Conversational Intelligence

**Defined:** 2026-02-13
**Core Value:** When a PR is opened or `@kodiai` is mentioned, the bot responds with accurate, actionable code feedback without requiring workflow setup in the target repo.

## v0.8 Requirements

Requirements for v0.8 milestone. Each maps to roadmap phases.

### Conversational Review

- [ ] **CONV-01**: User can mention @kodiai in a reply to a review finding comment
- [ ] **CONV-02**: Bot detects the reply context and loads the original finding
- [ ] **CONV-03**: Bot responds with relevant context (finding details, code snippet, reasoning)
- [ ] **CONV-04**: Conversation threads are rate-limited (max N turns per PR)
- [ ] **CONV-05**: Bot sanitizes outgoing mentions to prevent self-trigger loops
- [ ] **CONV-06**: Context budget prevents window explosion (cap at K chars per turn)

### Auto-Profile Selection

- [ ] **PROF-01**: Bot analyzes PR size (lines changed) before review
- [ ] **PROF-02**: Bot selects strict profile for small PRs (<=100 lines)
- [ ] **PROF-03**: Bot selects balanced profile for medium PRs (101-500 lines)
- [ ] **PROF-04**: Bot selects minimal profile for large PRs (>500 lines)
- [ ] **PROF-05**: Manual config profile overrides auto-selection
- [ ] **PROF-06**: Keyword-based profile overrides both auto and manual config

### Smart Finding Prioritization

- [ ] **PRIOR-01**: Bot scores findings using multi-factor algorithm (severity + file risk + category + recurrence)
- [ ] **PRIOR-02**: When exceeding max comments, bot prioritizes by score (not just severity)
- [ ] **PRIOR-03**: Scoring weights are configurable
- [ ] **PRIOR-04**: Review Details shows prioritization stats (findings scored, top score, threshold)

### Author Experience Adaptation

- [ ] **AUTH-01**: Bot detects author contributor status from `author_association` webhook field
- [ ] **AUTH-02**: Bot classifies authors into tiers (first-time / regular / core)
- [ ] **AUTH-03**: Bot adjusts review tone for first-time contributors (more explanation, gentler language)
- [ ] **AUTH-04**: Bot uses terse tone for core contributors (assumes context)
- [ ] **AUTH-05**: Classification results cached in SQLite (24-hour TTL)
- [ ] **AUTH-06**: GitHub Search API optionally enriches classification (PR count)
- [ ] **AUTH-07**: Feature is fail-open (classification errors don't block review)

### Commit Message Keywords

- [ ] **KEY-01**: Bot parses PR title for bracket tags (`[WIP]`, `[Component]`, `[security-review]`)
- [ ] **KEY-02**: Bot parses PR title for conventional commit prefixes (`fix:`, `feat:`, `docs:`)
- [ ] **KEY-03**: Bot detects "breaking change" keyword in PR body (case-insensitive)
- [ ] **KEY-04**: Keywords override auto-profile selection (e.g., `[strict-review]` forces strict mode)
- [ ] **KEY-05**: Keywords adjust review focus (e.g., `[security-review]` prioritizes security findings)
- [ ] **KEY-06**: Keywords enable skip mode (e.g., `[no-review]` skips auto-review)
- [ ] **KEY-07**: Keywords enable style suppression (e.g., `[style-ok]` suppresses formatting findings)
- [ ] **KEY-08**: Keyword parsing results logged in Review Details for transparency

## v0.9 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Enhanced Retrieval

- **RETR-01**: Multi-signal retrieval query (PR title + body + commit messages)
- **RETR-02**: Code snippet embedding for semantic code search
- **RETR-03**: Cross-repo learning (owner-level shared pool)

### Feedback Analytics

- **FEED-01**: Dashboard showing feedback trends by repo/language/category
- **FEED-02**: Pattern confidence scores visible to users
- **FEED-03**: Suppression rule recommendations based on feedback volume

### Advanced Language Patterns

- **LANG-01**: Ruby metaprogramming patterns (method_missing overuse)
- **LANG-02**: Go goroutine leak detection
- **LANG-03**: Rust lifetime complexity warnings
- **LANG-04**: Expand language-specific guidance beyond current 9 languages

### Conversation Depth

- **CONVD-01**: Multi-turn conversation history (beyond single reply)
- **CONVD-02**: Conversation summarization for long threads
- **CONVD-03**: Conversation persistence across re-reviews

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Unlimited conversation depth | Context window explosion risk, token cost escalation |
| Complex keyword syntax (nested conditions, boolean logic) | Hurts discoverability, increases user error rate |
| Author profiling from public GitHub data (followers, stars, etc.) | Privacy concerns, not relevant to code quality |
| Auto-resolve findings on force-push | Trust erosion, bypasses human judgment |
| Real-time streaming conversation UI | GitHub comments are the interface, no custom UI for v0.8 |
| ML-based auto-profile selection | Deterministic thresholds are sufficient and more predictable |
| Conversation persistence outside GitHub | GitHub is source of truth, no separate conversation database |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| KEY-01 | Phase 42 | Pending |
| KEY-02 | Phase 42 | Pending |
| KEY-03 | Phase 42 | Pending |
| KEY-04 | Phase 42 | Pending |
| KEY-05 | Phase 42 | Pending |
| KEY-06 | Phase 42 | Pending |
| KEY-07 | Phase 42 | Pending |
| KEY-08 | Phase 42 | Pending |
| PROF-01 | Phase 43 | Pending |
| PROF-02 | Phase 43 | Pending |
| PROF-03 | Phase 43 | Pending |
| PROF-04 | Phase 43 | Pending |
| PROF-05 | Phase 43 | Pending |
| PROF-06 | Phase 43 | Pending |
| PRIOR-01 | Phase 44 | Pending |
| PRIOR-02 | Phase 44 | Pending |
| PRIOR-03 | Phase 44 | Pending |
| PRIOR-04 | Phase 44 | Pending |
| AUTH-01 | Phase 45 | Pending |
| AUTH-02 | Phase 45 | Pending |
| AUTH-03 | Phase 45 | Pending |
| AUTH-04 | Phase 45 | Pending |
| AUTH-05 | Phase 45 | Pending |
| AUTH-06 | Phase 45 | Pending |
| AUTH-07 | Phase 45 | Pending |
| CONV-01 | Phase 46 | Pending |
| CONV-02 | Phase 46 | Pending |
| CONV-03 | Phase 46 | Pending |
| CONV-04 | Phase 46 | Pending |
| CONV-05 | Phase 46 | Pending |
| CONV-06 | Phase 46 | Pending |

**Coverage:**
- v0.8 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-02-13*
*Last updated: 2026-02-13 after roadmap creation (traceability populated)*
