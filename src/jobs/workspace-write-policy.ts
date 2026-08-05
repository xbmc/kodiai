import picomatch from "picomatch";
import {
  runCommandWithCappedLines,
  runCommandWithCappedOutput,
  type CappedProcessResult,
} from "../lib/capped-process.ts";
import { WritePolicyError } from "../lib/write-policy-error.ts";

export { WritePolicyError } from "../lib/write-policy-error.ts";

export const STAGED_SECRET_SCAN_MAX_BYTES = 8 * 1024 * 1024;
export const STAGED_PATHS_MAX_BYTES = 1024 * 1024;
export const STAGED_PATHS_MAX_FILES = 10_000;
export const STAGED_GIT_TIMEOUT_MS = 30_000;
export const STAGED_GIT_CONTROL_MAX_BYTES = 64 * 1024;

function normalizeGlobPattern(pattern: string): string {
  const p = pattern.trim();
  if (p.endsWith("/")) {
    // Git diffs only contain file paths (no directory entries).
    // Keep backward-compatible semantics: "foo/" matches everything under "foo/".
    return `${p}**`;
  }
  return p;
}

function firstMatchingPattern(path: string, patterns: string[]): string | undefined {
  for (const raw of patterns) {
    const p = normalizeGlobPattern(raw);
    if (p.length === 0) continue;
    const m = picomatch(p, { dot: true });
    if (m(path)) return raw;
  }
  return undefined;
}

function compileGlobMatchers(patterns: string[]): Array<(path: string) => boolean> {
  return patterns
    .map((p) => normalizeGlobPattern(p))
    .filter((p) => p.length > 0)
    .map((p) => picomatch(p, { dot: true }));
}

function matchesAny(path: string, matchers: Array<(path: string) => boolean>): boolean {
  return matchers.some((m) => m(path));
}

function buildSecretRegexes(): Array<{ name: string; regex: RegExp }> {
  return [
    { name: "private-key", regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP)? ?PRIVATE KEY-----/ },
    { name: "aws-access-key", regex: /AKIA[0-9A-Z]{16}/ },
    { name: "github-pat", regex: /ghp_[A-Za-z0-9]{36}/ },
    { name: "slack-token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
    { name: "github-token", regex: /gh[opsu]_[A-Za-z0-9]{36,}/ },
    { name: "github-x-access-token-url", regex: /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/ },
  ];
}

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let ent = 0;
  for (const [, count] of freq) {
    const p = count / s.length;
    ent -= p * Math.log2(p);
  }
  return ent;
}

function findHighEntropyTokens(addedLines: string[]): string | undefined {
  // Include base64-ish characters (+,/ and =) since real secrets often use them.
  const tokenRe = /[A-Za-z0-9_\-=+/\/]{32,}/g;
  for (const line of addedLines) {
    const matches = line.match(tokenRe) ?? [];
    for (const m of matches) {
      // Reduce false positives for common non-secret identifiers.
      // NOTE: this is intentionally conservative; we still rely on explicit token regexes first.
      if (/^[0-9a-f]{32}$/i.test(m) || /^[0-9a-f]{40}$/i.test(m) || /^[0-9a-f]{64}$/i.test(m)) {
        continue; // hex hash-like
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m)) {
        continue; // UUID
      }

      const hasLetter = /[A-Za-z]/.test(m);
      const hasDigit = /\d/.test(m);
      if (!hasLetter || !hasDigit) continue;

      if (m.length < 32) continue;

      const ent = shannonEntropy(m);
      if (ent >= 4.5) {
        return `High-entropy token-like string detected (entropy=${ent.toFixed(2)}, length=${m.length})`;
      }
    }
  }
  return undefined;
}

type RunStagedDiffLines = (
  params: Parameters<typeof runCommandWithCappedLines>[0],
) => ReturnType<typeof runCommandWithCappedLines>;

type RunStagedPathCommand = (
  params: Parameters<typeof runCommandWithCappedOutput>[0],
) => ReturnType<typeof runCommandWithCappedOutput>;

type RunGitControlCommand = RunStagedPathCommand;

const GIT_NO_REPLACE_OBJECTS_ENV = { GIT_NO_REPLACE_OBJECTS: "1" };

export type StagedSnapshot = {
  parentOid: string;
  treeOid: string;
};

function incompleteStagedScan(maxBytes: number): WritePolicyError {
  return new WritePolicyError(
    "write-policy-secret-scan-incomplete",
    "Write blocked: staged secret scan was incomplete",
    { rule: "secretScan", maxBytes },
  );
}

function processResultIsIncomplete(result: CappedProcessResult): boolean {
  return result.timedOut
    || result.exitCode !== 0
    || result.stdoutTruncated
    || result.stderrTruncated;
}

function isGitOid(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function assertStagedSnapshot(snapshot: StagedSnapshot, maxBytes: number): void {
  if (!isGitOid(snapshot.parentOid) || !isGitOid(snapshot.treeOid)) {
    throw incompleteStagedScan(maxBytes);
  }
}

function parseGitOidOutput(stdout: string): string | undefined {
  const match = /^((?:[0-9a-f]{40}|[0-9a-f]{64}))\r?\n?$/.exec(stdout);
  return match?.[1];
}

async function runGitControl(options: {
  dir: string;
  args: string[];
  runGitControlCommand: RunGitControlCommand;
}): Promise<CappedProcessResult> {
  let result: CappedProcessResult;
  try {
    result = await options.runGitControlCommand({
      command: "git",
      args: options.args,
      cwd: options.dir,
      env: GIT_NO_REPLACE_OBJECTS_ENV,
      timeoutMs: STAGED_GIT_TIMEOUT_MS,
      maxStdoutBytes: STAGED_GIT_CONTROL_MAX_BYTES,
    });
  } catch {
    throw incompleteStagedScan(STAGED_GIT_CONTROL_MAX_BYTES);
  }
  if (processResultIsIncomplete(result)) {
    throw incompleteStagedScan(STAGED_GIT_CONTROL_MAX_BYTES);
  }
  return result;
}

export async function captureStagedSnapshot(options: {
  dir: string;
  runGitControlCommand?: RunGitControlCommand;
}): Promise<StagedSnapshot> {
  const runner = options.runGitControlCommand ?? runCommandWithCappedOutput;
  const parentResult = await runGitControl({
    dir: options.dir,
    args: ["rev-parse", "--verify", "HEAD^{commit}"],
    runGitControlCommand: runner,
  });
  const treeResult = await runGitControl({
    dir: options.dir,
    args: ["write-tree"],
    runGitControlCommand: runner,
  });
  const parentOid = parseGitOidOutput(parentResult.stdout);
  const treeOid = parseGitOidOutput(treeResult.stdout);
  if (!parentOid || !treeOid) {
    throw incompleteStagedScan(STAGED_GIT_CONTROL_MAX_BYTES);
  }
  return { parentOid, treeOid };
}

export async function commitStagedSnapshot(options: StagedSnapshot & {
  dir: string;
  commitMessage: string;
  runGitControlCommand?: RunGitControlCommand;
}): Promise<string> {
  assertStagedSnapshot(options, STAGED_GIT_CONTROL_MAX_BYTES);
  const runner = options.runGitControlCommand ?? runCommandWithCappedOutput;
  const commitResult = await runGitControl({
    dir: options.dir,
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "commit-tree",
      options.treeOid,
      "-p",
      options.parentOid,
      "-m",
      options.commitMessage,
    ],
    runGitControlCommand: runner,
  });
  const commitOid = parseGitOidOutput(commitResult.stdout);
  if (!commitOid) throw incompleteStagedScan(STAGED_GIT_CONTROL_MAX_BYTES);

  await runGitControl({
    dir: options.dir,
    args: [
      "-c",
      "core.hooksPath=/dev/null",
      "update-ref",
      "HEAD",
      commitOid,
      options.parentOid,
    ],
    runGitControlCommand: runner,
  });

  const headResult = await runGitControl({
    dir: options.dir,
    args: ["rev-parse", "--verify", "HEAD"],
    runGitControlCommand: runner,
  });
  if (parseGitOidOutput(headResult.stdout) !== commitOid) {
    throw incompleteStagedScan(STAGED_GIT_CONTROL_MAX_BYTES);
  }
  return commitOid;
}

export async function getBoundedStagedPaths(options: StagedSnapshot & {
  dir: string;
  runStagedPathCommand?: RunStagedPathCommand;
}): Promise<string[]> {
  assertStagedSnapshot(options, STAGED_PATHS_MAX_BYTES);
  const runStagedPathCommand = options.runStagedPathCommand ?? runCommandWithCappedOutput;
  let result: CappedProcessResult;
  try {
    result = await runStagedPathCommand({
      command: "git",
      args: [
        "-c",
        "core.quotePath=false",
        "diff",
        options.parentOid,
        options.treeOid,
        "--name-only",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--",
      ],
      cwd: options.dir,
      env: GIT_NO_REPLACE_OBJECTS_ENV,
      timeoutMs: STAGED_GIT_TIMEOUT_MS,
      maxStdoutBytes: STAGED_PATHS_MAX_BYTES,
      stdoutDecoderOptions: { fatal: true, ignoreBOM: true },
    });
  } catch {
    throw incompleteStagedScan(STAGED_PATHS_MAX_BYTES);
  }

  if (processResultIsIncomplete(result)) {
    throw incompleteStagedScan(STAGED_PATHS_MAX_BYTES);
  }

  if (result.stdout.length === 0) return [];
  if (
    !result.stdout.endsWith("\0")
    || new TextEncoder().encode(result.stdout).byteLength > STAGED_PATHS_MAX_BYTES
  ) {
    throw incompleteStagedScan(STAGED_PATHS_MAX_BYTES);
  }

  const paths = result.stdout.slice(0, -1).split("\0");
  if (
    paths.length > STAGED_PATHS_MAX_FILES
    || paths.some((path) => path.length === 0)
    || new Set(paths).size !== paths.length
  ) {
    throw incompleteStagedScan(STAGED_PATHS_MAX_BYTES);
  }

  return paths;
}

function bestEffortDiffPath(line: string, stagedPaths: Set<string>): string | undefined {
  const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  const candidate = header?.[2];
  return candidate && stagedPaths.has(candidate) ? candidate : undefined;
}

function isRegularDiffMetadata(line: string): boolean {
  return line.length === 0
    || line.startsWith("index ")
    || line.startsWith("old mode ")
    || line.startsWith("new mode ")
    || line.startsWith("new file mode ")
    || line.startsWith("deleted file mode ")
    || line.startsWith("similarity index ")
    || line.startsWith("dissimilarity index ")
    || line.startsWith("rename from ")
    || line.startsWith("rename to ")
    || line.startsWith("copy from ")
    || line.startsWith("copy to ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ");
}

export async function enforceWritePolicy(options: StagedSnapshot & {
  dir: string;
  stagedPaths: string[];
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
  runStagedPathCommand?: RunStagedPathCommand;
  runStagedDiffLines?: RunStagedDiffLines;
}): Promise<void> {
  const {
    dir,
    stagedPaths,
    allowPaths,
    denyPaths,
    secretScanEnabled,
    runStagedDiffLines = runCommandWithCappedLines,
  } = options;

  assertStagedSnapshot(options, STAGED_SECRET_SCAN_MAX_BYTES);
  const verifiedStagedPaths = await getBoundedStagedPaths({
    dir,
    parentOid: options.parentOid,
    treeOid: options.treeOid,
    runStagedPathCommand: options.runStagedPathCommand,
  });
  if (
    verifiedStagedPaths.length !== stagedPaths.length
    || verifiedStagedPaths.some((path, index) => path !== stagedPaths[index])
  ) {
    throw incompleteStagedScan(STAGED_PATHS_MAX_BYTES);
  }

  let denyMatchers: Array<(path: string) => boolean>;
  try {
    denyMatchers = compileGlobMatchers(denyPaths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WritePolicyError(
      "write-policy-not-allowed",
      `Write blocked: invalid denyPaths pattern: ${message}`,
      { rule: "denyPaths" },
    );
  }

  let allowMatchers: Array<(path: string) => boolean> = [];
  try {
    allowMatchers = compileGlobMatchers(allowPaths);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WritePolicyError(
      "write-policy-not-allowed",
      `Write blocked: invalid allowPaths pattern: ${message}`,
      { rule: "allowPaths" },
    );
  }

  for (const path of stagedPaths) {
    if (matchesAny(path, denyMatchers)) {
      const pattern = firstMatchingPattern(path, denyPaths);
      throw new WritePolicyError(
        "write-policy-denied-path",
        `Write blocked: denied path staged: ${path}`,
        { path, rule: "denyPaths", pattern },
      );
    }
  }

  if (allowPaths.length > 0) {
    for (const path of stagedPaths) {
      if (!matchesAny(path, allowMatchers)) {
        throw new WritePolicyError(
          "write-policy-not-allowed",
          `Write blocked: path is not allowlisted: ${path}`,
          { path, rule: "allowPaths" },
        );
      }
    }
  }

  if (secretScanEnabled) {
    const stagedPathSet = new Set(stagedPaths);
    const regexDetectors = buildSecretRegexes();
    const regexHits = new Map<string, { path?: string }>();
    let entropyHit: { message: string; path?: string } | undefined;
    let currentPath: string | undefined;
    let currentFileAddedLines: string[] = [];
    let sawRegularDiff = false;
    let insideHunk = false;
    let oldLinesRemaining = 0;
    let newLinesRemaining = 0;
    let canAcceptNoNewlineMarker = false;
    let parseIncomplete = false;
    const flushCurrentFileRegexes = (): void => {
      if (currentFileAddedLines.length === 0) return;
      const addedText = currentFileAddedLines.join("\n");
      for (const { name, regex } of regexDetectors) {
        if (!regexHits.has(name) && regex.test(addedText)) {
          regexHits.set(name, { path: currentPath });
        }
      }
      currentFileAddedLines = [];
    };
    let scanResult: Awaited<ReturnType<RunStagedDiffLines>>;
    try {
      scanResult = await runStagedDiffLines({
        command: "git",
        args: [
          "diff",
          options.parentOid,
          options.treeOid,
          "--no-renames",
          "--no-ext-diff",
          "--no-textconv",
          "--",
        ],
        cwd: dir,
        env: GIT_NO_REPLACE_OBJECTS_ENV,
        timeoutMs: STAGED_GIT_TIMEOUT_MS,
        maxStdoutBytes: STAGED_SECRET_SCAN_MAX_BYTES,
        onStdoutLine: (line) => {
          if (line === "\\ No newline at end of file") {
            if (!canAcceptNoNewlineMarker) parseIncomplete = true;
            canAcceptNoNewlineMarker = false;
            return;
          }
          canAcceptNoNewlineMarker = false;

          if (line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
            parseIncomplete = true;
            return;
          }

          if (line.startsWith("diff --git ")) {
            if (insideHunk) parseIncomplete = true;
            flushCurrentFileRegexes();
            sawRegularDiff = true;
            currentPath = bestEffortDiffPath(line, stagedPathSet);
            insideHunk = false;
            oldLinesRemaining = 0;
            newLinesRemaining = 0;
            return;
          }

          if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
            parseIncomplete = true;
            return;
          }

          if (line.startsWith("@@@")) {
            parseIncomplete = true;
            return;
          }

          if (line.startsWith("@@")) {
            if (!sawRegularDiff || insideHunk) {
              parseIncomplete = true;
              return;
            }
            const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
            if (!hunk) {
              parseIncomplete = true;
              return;
            }
            oldLinesRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
            newLinesRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
            insideHunk = true;
            if (oldLinesRemaining === 0 && newLinesRemaining === 0) {
              insideHunk = false;
            }
            return;
          }

          if (!insideHunk) {
            if (!isRegularDiffMetadata(line)) parseIncomplete = true;
            return;
          }

          let addedLine: string | undefined;
          if (line.startsWith("+")) {
            newLinesRemaining -= 1;
            addedLine = line.slice(1);
          } else if (line.startsWith("-")) {
            oldLinesRemaining -= 1;
          } else if (line.startsWith(" ")) {
            oldLinesRemaining -= 1;
            newLinesRemaining -= 1;
          } else {
            parseIncomplete = true;
            return;
          }

          if (oldLinesRemaining < 0 || newLinesRemaining < 0) {
            parseIncomplete = true;
            return;
          }

          canAcceptNoNewlineMarker = true;
          if (addedLine !== undefined) {
            currentFileAddedLines.push(addedLine);
            if (!entropyHit) {
              const message = findHighEntropyTokens([addedLine]);
              if (message) entropyHit = { message, path: currentPath };
            }
          }

          if (oldLinesRemaining === 0 && newLinesRemaining === 0) {
            insideHunk = false;
          }
        },
      });
    } catch {
      throw incompleteStagedScan(STAGED_SECRET_SCAN_MAX_BYTES);
    }

    flushCurrentFileRegexes();

    if (
      processResultIsIncomplete(scanResult)
      || parseIncomplete
      || insideHunk
    ) {
      throw incompleteStagedScan(STAGED_SECRET_SCAN_MAX_BYTES);
    }

    for (const { name } of regexDetectors) {
      const hit = regexHits.get(name);
      if (hit) {
        throw new WritePolicyError(
          "write-policy-secret-detected",
          `Write blocked: suspected secret detected (${name}) in staged additions`,
          { path: hit.path, rule: "secretScan", detector: `regex:${name}` },
        );
      }
    }

    if (entropyHit) {
      throw new WritePolicyError(
        "write-policy-secret-detected",
        `Write blocked: suspected secret detected (entropy): ${entropyHit.message}`,
        { path: entropyHit.path, rule: "secretScan", detector: "entropy" },
      );
    }
  }
}
