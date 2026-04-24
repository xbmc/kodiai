---
phase: milestone-complete
phase_name: Large-PR truth baseline
project: Kodiai
generated: 2026-04-24T05:11:30Z
counts:
  decisions: 3
  lessons: 3
  patterns: 3
  surprises: 2
missing_artifacts: []
---

### Decisions
- Chose a hybrid large-PR review contract: publish a useful bounded first pass now and allow deeper follow-up review later, instead of framing constrained runs as all-or-nothing success or failure.
  Source: M062-ROADMAP.md/Vision
- Introduced one normalized bounded first-pass state for timeout, large-PR boundedness, and checkpoint-backed `max_turns` outcomes, reserving hard failure for zero-evidence runs.
  Source: S01-SUMMARY.md/What Happened
- Reused the S01 scenario matrix inside the milestone verifier and checked semantic parity on production renderers instead of snapshotting proof-only prose.
  Source: S03-SUMMARY.md/What Happened

### Lessons
- The workspace TypeScript gate had to be treated as slice-closeout scope, not background noise; leaving unrelated compile regressions unresolved would have made the bounded-review proof unreliable.
  Source: S01-SUMMARY.md/What Happened
- Retry metadata must remain additive to first-pass state. When retry-merge math was allowed to act like a second coverage source, reviewed totals drifted into double-counting.
  Source: S02-SUMMARY.md/What Happened
- Deterministic fixture-based verifiers were sufficient and preferable here because the milestone needed stable proof of review truthfulness before later live continuation redesign work.
  Source: S03-SUMMARY.md/Known Limitations

### Patterns
- Normalize constrained large-PR outcomes into one machine-checkable payload before formatting or publishing any user-visible surface.
  Source: S01-SUMMARY.md/Patterns Established
- Keep public bounded comments and Review Details on one shared wording contract, and degrade toward explicit uncertainty instead of inferring exhaustive coverage.
  Source: S02-SUMMARY.md/Patterns Established
- Build milestone verifiers by exercising production formatter seams and checking semantic parity keys such as reason, covered scope, remaining scope, and continuation state.
  Source: S03-SUMMARY.md/Patterns Established

### Surprises
- The prior attempt at completing the milestone failed because the completion artifact was never written to disk even though verification commands had already been run.
  Source: M062-VALIDATION.md/Verdict Rationale
- Cross-session memory capture was unreliable during the milestone; repeated `capture_thought` attempts failed at the tool layer, so durable decisions had to remain documented in slice summaries until closeout.
  Source: S01-SUMMARY.md/Known Limitations
