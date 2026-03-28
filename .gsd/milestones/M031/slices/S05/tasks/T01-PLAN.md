---
estimated_steps: 46
estimated_files: 3
skills_used: []
---

# T01: Write verify-m031 harness, test suite, and register package.json entry

Write scripts/verify-m031.ts implementing five pure-code proof checks covering all M031 security controls, write scripts/verify-m031.test.ts with full coverage, and add verify:m031 to package.json scripts.

All five checks are pure-code — no DB or GitHub gating. overallPassed = conjunction of all five.

Check details:
1. M031-ENV-ALLOWLIST: Set process.env.DATABASE_URL = 'postgres://secret', call buildAgentEnv(), assert DATABASE_URL absent. Also assert ANTHROPIC_API_KEY present when set in env.
2. M031-GIT-URL-CLEAN: Call buildAuthFetchUrl('', undefined) — the token-absent fast-return path returns 'origin' without reading the filesystem. Assert result === 'origin' and !result.includes('x-access-token').
3. M031-OUTGOING-SCAN-BLOCKS: Call scanOutgoingForSecrets('ghp_abc123AAABBBCCC') assert { blocked: true, matchedPattern: 'github-pat' }.
4. M031-PROMPT-HAS-SECURITY: Call buildMentionPrompt with the minimal MentionEvent params below, assert result includes '## Security Policy' and "I can't help with that".
5. M031-CLAUDEMD-HAS-SECURITY: Call buildSecurityClaudeMd(), assert result includes '# Security Policy' and "I can't help with that".

Minimal MentionEvent for check 4:
```ts
{
  surface: 'pr_comment',
  owner: 'xbmc',
  repo: 'kodiai',
  issueNumber: 3,
  prNumber: 3,
  commentId: 123,
  commentBody: '@kodiai help',
  commentAuthor: 'alice',
  commentCreatedAt: '2026-01-01T00:00:00Z',
  headRef: 'main',
  baseRef: 'main',
  headRepoOwner: 'xbmc',
  headRepoName: 'kodiai',
  diffHunk: undefined,
  filePath: undefined,
  fileLine: undefined,
  inReplyToId: undefined,
  issueBody: 'body',
  issueTitle: 'title',
}
```

Harness structure (follow scripts/verify-m029-s04.ts as the canonical template):
- Export M031_CHECK_IDS tuple, Check type, EvaluationReport type
- One async runXxx() function per check — returns { id, passed, skipped, status_code, detail? }
- evaluateM031(opts?) — runs all five in Promise.all, overallPassed = non-skipped all-pass, returns report
- buildM031ProofHarness(opts?) — renders output, returns { exitCode }
- if (import.meta.main) CLI entry point

Test suite structure:
- describe per check: pass case + fail case using _fn override pattern where applicable
- describe('envelope'): check_ids length, overallPassed semantics
- describe('buildM031ProofHarness'): stdout output, JSON mode, exit codes
- Process.env isolation for M031-ENV-ALLOWLIST check: save/restore in beforeEach/afterEach

NOTE: buildAuthFetchUrl is async — the harness runner function must await it.
NOTE: JSDoc block comments must NOT contain bare :emoji: colon notation (Bun parser bug — see KNOWLEDGE.md). Use plain text.
NOTE: S04 confirmed refusal phrase is "I can't help with that", not "refuse" — use this exact string in assertions.

## Inputs

- `src/execution/env.ts`
- `src/jobs/workspace.ts`
- `src/lib/sanitizer.ts`
- `src/execution/mention-prompt.ts`
- `src/execution/executor.ts`
- `src/execution/mention-prompt.test.ts`
- `scripts/verify-m029-s04.ts`
- `package.json`

## Expected Output

- `scripts/verify-m031.ts`
- `scripts/verify-m031.test.ts`
- `package.json`

## Verification

bun test scripts/verify-m031.test.ts && bun run verify:m031
