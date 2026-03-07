---
phase: 124
slug: publishing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 124 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `bun vitest run --reporter=verbose src/knowledge/wiki-publisher.test.ts` |
| **Full suite command** | `bun vitest run --reporter=verbose src/knowledge/wiki-publisher*.test.ts` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun vitest run --reporter=verbose src/knowledge/wiki-publisher.test.ts`
- **After every plan wave:** Run `bun vitest run --reporter=verbose src/knowledge/wiki-publisher*.test.ts`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 124-01-01 | 01 | 1 | PUB-04 | unit | `bun vitest run src/knowledge/wiki-publisher.test.ts -t "pre-flight"` | ❌ W0 | ⬜ pending |
| 124-01-02 | 01 | 1 | PUB-01 | unit | `bun vitest run src/knowledge/wiki-publisher.test.ts -t "issue creation"` | ❌ W0 | ⬜ pending |
| 124-01-03 | 01 | 1 | PUB-02 | unit | `bun vitest run src/knowledge/wiki-publisher.test.ts -t "comment posting"` | ❌ W0 | ⬜ pending |
| 124-01-04 | 01 | 1 | PUB-03 | unit | `bun vitest run src/knowledge/wiki-publisher.test.ts -t "rate limit"` | ❌ W0 | ⬜ pending |
| 124-02-01 | 02 | 1 | PUB-01 | integration | `bun vitest run src/knowledge/wiki-publisher.integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/knowledge/wiki-publisher.test.ts` — unit test stubs for PUB-01 through PUB-04
- [ ] `src/knowledge/wiki-publisher.integration.test.ts` — integration test stubs for full publish flow

*Existing vitest infrastructure covers all framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live GitHub issue creation | PUB-01 | Requires real GitHub App installation | Run `bun scripts/publish-wiki-updates.ts --dry-run` to verify formatting, then live run against xbmc/wiki |
| Rate limit backoff | PUB-03 | Hard to trigger real 403 in test | Verify 3s delay in logs during live run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
