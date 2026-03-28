---
estimated_steps: 12
estimated_files: 3
skills_used: []
---

# T01: Create addon-checker-runner module with parser, branch resolver, and subprocess runner

Build src/lib/addon-checker-runner.ts as a pure, injectable module. Export:
- ValidKodiVersions: readonly string[] — the 10 known Kodi release branch names (nexus, omega, matrix, leia, jarvis, isengard, helix, gotham, frodo, dharma)
- AddonFinding type: { level: 'ERROR' | 'WARN' | 'INFO'; addonId: string; message: string }
- AddonCheckerResult type: { findings: AddonFinding[]; timedOut: boolean; toolNotFound: boolean }
- parseCheckerOutput(raw: string, addonId: string): AddonFinding[] — strips ANSI codes with /\x1B\[[0-9;]*m/g, then for each line matches /^(ERROR|WARN|INFO): (.+)$/, attaches addonId; ignores non-matching lines
- resolveCheckerBranch(baseBranch: string): string | null — returns baseBranch if it's in ValidKodiVersions, null otherwise
- runAddonChecker(opts: { addonDir: string; branch: string; timeBudgetMs?: number; __runSubprocessForTests?: ... }): Promise<AddonCheckerResult> — spawns kodi-addon-checker with args ['--branch', branch, addonDir], captures stdout, parses with parseCheckerOutput; if subprocess ENOENT → { findings: [], timedOut: false, toolNotFound: true }; if withTimeBudget returns null → { findings: [], timedOut: true, toolNotFound: false }; non-zero exit code (but not ENOENT) is NOT an error — parse stdout regardless

The __runSubprocessForTests injection accepts the same shape as analyzePackageUsage's __runGrepForTests: (params) => Promise<{ exitCode: number; stdout: string; error?: { code?: string } }>. Use Bun's $ shell as the real implementation (same as usage-analyzer.ts uses).

Also create src/lib/addon-checker-runner.test.ts with describe blocks:
1. parseCheckerOutput — strips ANSI, classifies ERROR/WARN/INFO, ignores non-matching lines (XML schema lines, blank lines, debug output), attaches addonId
2. resolveCheckerBranch — returns branch for each known version, null for unknown (e.g. 'main', 'master', 'develop')
3. runAddonChecker — toolNotFound when subprocess returns ENOENT error, timedOut when subprocess takes longer than budget (inject a slow stub), returns parsed findings on success with exit code 1 (non-zero is not failure)

## Inputs

- `src/lib/usage-analyzer.ts`
- `src/handlers/addon-check.ts`

## Expected Output

- `src/lib/addon-checker-runner.ts`
- `src/lib/addon-checker-runner.test.ts`

## Verification

bun test src/lib/addon-checker-runner.test.ts

## Observability Impact

No runtime signals in this module itself — observability is surfaced at the handler layer in T02 using the findings returned here.
