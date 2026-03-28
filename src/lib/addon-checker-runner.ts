import { $ } from "bun";
import { withTimeBudget } from "./usage-analyzer.ts";

/**
 * The 10 known Kodi release branch names used for --branch validation.
 */
export const ValidKodiVersions: readonly string[] = [
  "nexus",
  "omega",
  "matrix",
  "leia",
  "jarvis",
  "isengard",
  "helix",
  "gotham",
  "frodo",
  "dharma",
] as const;

export type AddonFinding = {
  level: "ERROR" | "WARN" | "INFO";
  addonId: string;
  message: string;
};

export type AddonCheckerResult = {
  findings: AddonFinding[];
  timedOut: boolean;
  toolNotFound: boolean;
};

type SubprocessResult = {
  exitCode: number;
  stdout: string;
  error?: { code?: string };
};

type RunSubprocess = (params: { addonDir: string; branch: string }) => Promise<SubprocessResult>;

/**
 * Strip ANSI escape codes and parse kodi-addon-checker output into structured findings.
 * Only lines matching /^(ERROR|WARN|INFO): (.+)$/ after stripping are included.
 */
export function parseCheckerOutput(raw: string, addonId: string): AddonFinding[] {
  const stripped = raw.replace(/\x1B\[[0-9;]*m/g, "");
  const findings: AddonFinding[] = [];

  for (const line of stripped.split("\n")) {
    const match = line.match(/^(ERROR|WARN|INFO): (.+)$/);
    if (!match) continue;

    findings.push({
      level: match[1] as "ERROR" | "WARN" | "INFO",
      addonId,
      message: match[2]!.trim(),
    });
  }

  return findings;
}

/**
 * Resolve a PR base branch to a Kodi version string.
 * Returns the branch name if it's in ValidKodiVersions, null otherwise.
 */
export function resolveCheckerBranch(baseBranch: string): string | null {
  return (ValidKodiVersions as readonly string[]).includes(baseBranch) ? baseBranch : null;
}

/**
 * Run kodi-addon-checker as a subprocess against a single addon directory.
 *
 * - Non-zero exit codes are not treated as errors — the tool reports findings via stdout
 *   and exits non-zero when it finds problems.
 * - ENOENT means the tool is not installed → toolNotFound: true
 * - Timeout → timedOut: true
 */
export async function runAddonChecker(opts: {
  addonDir: string;
  branch: string;
  timeBudgetMs?: number;
  /** Test-only: inject a subprocess implementation to avoid spawning real processes. */
  __runSubprocessForTests?: RunSubprocess;
}): Promise<AddonCheckerResult> {
  const { addonDir, branch, timeBudgetMs = 120_000, __runSubprocessForTests } = opts;

  const runSubprocess: RunSubprocess =
    __runSubprocessForTests ??
    (async (p: { addonDir: string; branch: string }) => {
      const result = await $`kodi-addon-checker --branch ${p.branch} ${p.addonDir}`
        .quiet()
        .nothrow();
      return {
        exitCode: result.exitCode,
        stdout: result.stdout?.toString() ?? "",
      };
    });

  try {
    const subprocessPromise = runSubprocess({ addonDir, branch });
    const result = await withTimeBudget(subprocessPromise, timeBudgetMs);

    if (result === null) {
      return { findings: [], timedOut: true, toolNotFound: false };
    }

    const findings = parseCheckerOutput(result.stdout, addonDir.split("/").pop() ?? addonDir);
    return { findings, timedOut: false, toolNotFound: false };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      return { findings: [], timedOut: false, toolNotFound: true };
    }
    // Any other error: return empty findings, not a crash
    return { findings: [], timedOut: false, toolNotFound: false };
  }
}
