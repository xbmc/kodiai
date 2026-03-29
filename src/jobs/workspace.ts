import { mkdtemp, rm, readdir, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import picomatch from "picomatch";
import type { Logger } from "pino";
import type { GitHubApp } from "../auth/github-app.ts";
import type { WorkspaceManager, Workspace, CloneOptions } from "./types.ts";

export class WritePolicyError extends Error {
  readonly code:
    | "write-policy-denied-path"
    | "write-policy-not-allowed"
    | "write-policy-secret-detected"
    | "write-policy-no-changes";

  /** Best-effort file path involved in the refusal. */
  readonly path?: string;

  /** Which policy family triggered (denyPaths, allowPaths, secretScan). */
  readonly rule?: "denyPaths" | "allowPaths" | "secretScan";

  /** Best-effort policy pattern that matched (for glob-based rules). */
  readonly pattern?: string;

  /** Best-effort secret detector identifier (for secretScan rules). */
  readonly detector?: string;

  constructor(
    code: WritePolicyError["code"],
    message: string,
    meta?: {
      path?: string;
      rule?: WritePolicyError["rule"];
      pattern?: string;
      detector?: string;
    },
  ) {
    super(message);
    this.name = "WritePolicyError";
    this.code = code;
    this.path = meta?.path;
    this.rule = meta?.rule;
    this.pattern = meta?.pattern;
    this.detector = meta?.detector;
  }
}

/**
 * Replace all occurrences of a token in a string with [REDACTED].
 * Prevents token leakage in error messages and stack traces.
 */
function redactToken(message: string, token: string): string {
  return message.replaceAll(token, "[REDACTED]");
}

/**
 * Validate a git branch name to prevent injection attacks and invalid refs.
 * Throws a descriptive Error if the branch name is invalid.
 */
export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim().length === 0) {
    throw new Error("Branch name must not be empty or whitespace-only");
  }

  if (branchName.startsWith("-")) {
    throw new Error(
      `Branch name must not start with '-' (git option injection risk): ${branchName}`,
    );
  }

  // Reject control characters
  if (/[\x00-\x1F\x7F]/.test(branchName)) {
    throw new Error(
      `Branch name must not contain control characters: ${branchName}`,
    );
  }

  // Reject special git characters: ~ ^ : ? * [ ] backslash
  if (/[~^:?*[\]\\]/.test(branchName)) {
    throw new Error(
      `Branch name must not contain special git characters (~, ^, :, ?, *, [, ], \\): ${branchName}`,
    );
  }

  // Must start with alphanumeric
  if (!/^[a-zA-Z0-9]/.test(branchName)) {
    throw new Error(
      `Branch name must start with an alphanumeric character: ${branchName}`,
    );
  }

  // After first character, allow alphanumeric, underscore, slash, dot, dash
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_/.\-]*$/.test(branchName)) {
    throw new Error(
      `Branch name contains invalid characters (allowed: alphanumeric, _, /, ., -): ${branchName}`,
    );
  }

  // Reject parent traversal
  if (branchName.includes("..")) {
    throw new Error(
      `Branch name must not contain '..' (parent traversal): ${branchName}`,
    );
  }

  // Reject .lock suffix
  if (branchName.endsWith(".lock")) {
    throw new Error(
      `Branch name must not end with '.lock': ${branchName}`,
    );
  }

  // Reject reflog syntax
  if (branchName.includes("@{")) {
    throw new Error(
      `Branch name must not contain '@{' (reflog syntax): ${branchName}`,
    );
  }

  // Reject trailing slash
  if (branchName.endsWith("/")) {
    throw new Error(
      `Branch name must not end with '/': ${branchName}`,
    );
  }

  // Reject consecutive slashes
  if (branchName.includes("//")) {
    throw new Error(
      `Branch name must not contain consecutive slashes '//': ${branchName}`,
    );
  }
}

async function getOriginTokenFromRemoteUrl(dir: string): Promise<string | undefined> {
  try {
    const url = (await $`git -C ${dir} remote get-url origin`.quiet()).text().trim();
    const match = url.match(/https:\/\/x-access-token:([^@]+)@github\.com(?:\/|$)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Given a stripped (no-credential) remote URL and an optional token, return the
 * auth-injected URL for use in a single git command.  If token is absent, the
 * stripped URL is returned unchanged so the caller can still attempt anonymous
 * or pre-configured-credential access.
 */
function makeAuthUrl(strippedUrl: string, token: string | undefined): string {
  if (!token) return strippedUrl;
  return strippedUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

/**
 * Read the stripped origin remote URL from `dir` and inject `token` into it so
 * it can be used as an ephemeral fetch remote.  Returns `'origin'` when token
 * is absent so the caller can pass the result directly as the remote argument
 * without special-casing.
 */
export async function buildAuthFetchUrl(dir: string, token: string | undefined): Promise<string> {
  if (!token) return "origin";
  const url = (await $`git -C ${dir} remote get-url origin`.quiet()).text().trim();
  return makeAuthUrl(url, token);
}

function redactTokenFromError(err: unknown, token: string | undefined): void {
  if (!(err instanceof Error)) return;

  // Prefer exact token replacement when known.
  if (token) {
    err.message = redactToken(err.message, token);
    if (err.stack) err.stack = redactToken(err.stack, token);
  }

  // Defense-in-depth: redact any x-access-token URLs even if we could not
  // parse the specific token from the origin remote.
  err.message = err.message.replace(
    /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/g,
    (_m, suffix: string) => `https://x-access-token:[REDACTED]@github.com${suffix ?? ""}`,
  );
  if (err.stack) {
    err.stack = err.stack.replace(
      /https:\/\/x-access-token:[^@]+@github\.com(\/|$)/g,
      (_m, suffix: string) => `https://x-access-token:[REDACTED]@github.com${suffix ?? ""}`,
    );
  }
}

export async function getGitStatusPorcelain(dir: string): Promise<string> {
  return (await $`git -C ${dir} status --porcelain`.quiet()).text();
}

async function getOriginTokenFromDir(dir: string): Promise<string | undefined> {
  return await getOriginTokenFromRemoteUrl(dir);
}

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

function extractAddedLines(patch: string): string[] {
  return patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

export async function enforceWritePolicy(options: {
  dir: string;
  stagedPaths: string[];
  allowPaths: string[];
  denyPaths: string[];
  secretScanEnabled: boolean;
}): Promise<void> {
  const { dir, stagedPaths, allowPaths, denyPaths, secretScanEnabled } = options;

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
    const perFilePatches = new Map<string, string>();
    for (const p of stagedPaths) {
      const patch = (await $`git -C ${dir} diff --cached -- ${p}`.quiet()).text();
      perFilePatches.set(p, patch);
    }

    for (const { name, regex } of buildSecretRegexes()) {
      let path: string | undefined;
      for (const p of stagedPaths) {
        const added = extractAddedLines(perFilePatches.get(p) ?? "").join("\n");
        if (regex.test(added)) {
          path = p;
          break;
        }
      }

      if (path) {
        throw new WritePolicyError(
          "write-policy-secret-detected",
          `Write blocked: suspected secret detected (${name}) in staged additions`,
          { path, rule: "secretScan", detector: `regex:${name}` },
        );
      }
    }

    // Best-effort entropy scan on added lines only.
    const addedLines = stagedPaths.flatMap((p) => extractAddedLines(perFilePatches.get(p) ?? ""));
    const entropyHit = findHighEntropyTokens(addedLines);
    if (entropyHit) {
      let path: string | undefined;
      for (const p of stagedPaths) {
        const perFileAdded = extractAddedLines(perFilePatches.get(p) ?? "");
        if (findHighEntropyTokens(perFileAdded)) {
          path = p;
          break;
        }
      }
      throw new WritePolicyError(
        "write-policy-secret-detected",
        `Write blocked: suspected secret detected (entropy): ${entropyHit}`,
        { path, rule: "secretScan", detector: "entropy" },
      );
    }
  }
}

export async function createBranchCommitAndPush(options: {
  dir: string;
  branchName: string;
  commitMessage: string;
  remote?: string;
  token?: string;
  policy?: {
    allowPaths?: string[];
    denyPaths?: string[];
    secretScanEnabled?: boolean;
  };
}): Promise<{ branchName: string; headSha: string }> {
  const { dir, branchName, commitMessage, remote = "origin", token } = options;

  validateBranchName(branchName);

  try {
    await $`git -C ${dir} checkout -b ${branchName}`.quiet();
    await $`git -C ${dir} add -A`.quiet();

    // Ensure there is something to commit.
    const staged = (await $`git -C ${dir} diff --cached --name-only`.quiet()).text().trim();
    if (staged.length === 0) {
      throw new WritePolicyError("write-policy-no-changes", "No staged changes to commit");
    }

    const stagedPaths = staged.split("\n").map((s) => s.trim()).filter(Boolean);
    await enforceWritePolicy({
      dir,
      stagedPaths,
      allowPaths: options.policy?.allowPaths ?? [],
      denyPaths: options.policy?.denyPaths ?? [],
      secretScanEnabled: options.policy?.secretScanEnabled ?? true,
    });

    await $`git -C ${dir} commit -m ${commitMessage}`.quiet();
    const headSha = (await $`git -C ${dir} rev-parse HEAD`.quiet()).text().trim();

    // Construct the auth URL inline; never stored — used for this push only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const pushUrl = makeAuthUrl(strippedUrl, token);
    await $`git -C ${dir} push ${pushUrl} HEAD:${branchName}`.quiet();

    return { branchName, headSha };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

export async function commitAndPushToRemoteRef(options: {
  dir: string;
  remoteRef: string;
  commitMessage: string;
  remote?: string;
  token?: string;
  policy?: {
    allowPaths?: string[];
    denyPaths?: string[];
    secretScanEnabled?: boolean;
  };
}): Promise<{ remoteRef: string; headSha: string }> {
  const { dir, remoteRef, commitMessage, remote = "origin", token } = options;

  validateBranchName(remoteRef);

  try {
    await $`git -C ${dir} add -A`.quiet();

    const staged = (await $`git -C ${dir} diff --cached --name-only`.quiet()).text().trim();
    if (staged.length === 0) {
      throw new WritePolicyError("write-policy-no-changes", "No staged changes to commit");
    }

    const stagedPaths = staged.split("\n").map((s) => s.trim()).filter(Boolean);
    await enforceWritePolicy({
      dir,
      stagedPaths,
      allowPaths: options.policy?.allowPaths ?? [],
      denyPaths: options.policy?.denyPaths ?? [],
      secretScanEnabled: options.policy?.secretScanEnabled ?? true,
    });

    await $`git -C ${dir} commit -m ${commitMessage}`.quiet();
    const headSha = (await $`git -C ${dir} rev-parse HEAD`.quiet()).text().trim();

    // Construct the auth URL inline; never stored — used for this push only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const pushUrl = makeAuthUrl(strippedUrl, token);
    await $`git -C ${dir} push ${pushUrl} HEAD:${remoteRef}`.quiet();

    return { remoteRef, headSha };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

export async function pushHeadToRemoteRef(options: {
  dir: string;
  remoteRef: string;
  remote?: string;
  token?: string;
}): Promise<{ remoteRef: string; headSha: string }> {
  const { dir, remoteRef, remote = "origin", token } = options;
  validateBranchName(remoteRef);

  try {
    const headSha = (await $`git -C ${dir} rev-parse HEAD`.quiet()).text().trim();

    // Construct the auth URL inline; never stored — used for this push only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const pushUrl = makeAuthUrl(strippedUrl, token);
    await $`git -C ${dir} push ${pushUrl} HEAD:${remoteRef}`.quiet();

    return { remoteRef, headSha };
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }
}

function validatePullRequestNumber(prNumber: number): void {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`PR number must be a positive integer: ${prNumber}`);
  }
}

/**
 * In GitHub, pull request head refs are exposed on the base repo as:
 *   refs/pull/<PR_NUMBER>/head
 *
 * Fetching and checking out that ref allows reviewing fork PRs without cloning the fork.
 */
export async function fetchAndCheckoutPullRequestHeadRef(options: {
  dir: string;
  prNumber: number;
  remote?: string;
  localBranch?: string;
  token?: string;
}): Promise<{ localBranch: string }> {
  const { dir, prNumber, remote = "origin", localBranch = "pr-review", token } = options;

  validatePullRequestNumber(prNumber);
  validateBranchName(localBranch);

  try {
    // Construct the auth URL inline; never stored — used for this fetch only.
    const strippedUrl = (await $`git -C ${dir} remote get-url ${remote}`.quiet()).text().trim();
    const fetchUrl = makeAuthUrl(strippedUrl, token);
    await $`git -C ${dir} fetch ${fetchUrl} pull/${prNumber}/head:${localBranch}`.quiet();
    await $`git -C ${dir} checkout ${localBranch}`.quiet();
  } catch (err) {
    redactTokenFromError(err, token);
    throw err;
  }

  return { localBranch };
}

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Create a workspace manager that handles ephemeral git workspace lifecycle:
 * clone with token auth, bot identity config, cleanup, and stale dir removal.
 */
export function createWorkspaceManager(
  githubApp: GitHubApp,
  logger: Logger,
): WorkspaceManager {
  return {
    async create(
      installationId: number,
      options: CloneOptions,
    ): Promise<Workspace> {
      const { owner, repo, ref, depth = 1, forkContext } = options;

      // Validate branch name before creating any resources
      validateBranchName(ref);

      // Create temp directory
      const dir = await mkdtemp(join(tmpdir(), "kodiai-"));

      let token: string | undefined;
      try {
        // Get installation token (always needed for upstream remote)
        token = await githubApp.getInstallationToken(installationId);

        if (forkContext) {
          // Fork-aware clone: clone from the bot-owned fork using bot PAT
          const forkCloneUrl = `https://x-access-token:${forkContext.botPat}@github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git`;
          await $`git clone --depth=${depth} --single-branch --branch ${ref} ${forkCloneUrl} ${dir}`.quiet();

          // Add upstream remote pointing at the original repo (using installation token)
          const upstreamUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
          await $`git -C ${dir} remote add upstream ${upstreamUrl}`.quiet();

          // Strip credentials from remotes immediately — token stays in memory only
          await $`git -C ${dir} remote set-url origin https://github.com/${forkContext.forkOwner}/${forkContext.forkRepo}.git`.quiet();
          await $`git -C ${dir} remote set-url upstream https://github.com/${owner}/${repo}.git`.quiet();
        } else {
          // Standard clone from target repo using installation token
          const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
          await $`git clone --depth=${depth} --single-branch --branch ${ref} ${cloneUrl} ${dir}`.quiet();

          // Strip credentials from remote immediately — token stays in memory only
          await $`git -C ${dir} remote set-url origin https://github.com/${owner}/${repo}.git`.quiet();
        }

        // Configure git identity as kodiai[bot]
        await $`git -C ${dir} config user.name "kodiai[bot]"`;
        await $`git -C ${dir} config user.email "kodiai[bot]@users.noreply.github.com"`;
      } catch (error: unknown) {
        // Clean up temp dir on failure; never mask the original error
        await rm(dir, { recursive: true, force: true }).catch(() => {});

        // Redact token from error messages to prevent leakage
        redactTokenFromError(error, token);
        throw error;
      }

      logger.info({ owner, repo, ref, dir, fork: !!forkContext }, "Workspace created");

      const cleanup = async (): Promise<void> => {
        await rm(dir, { recursive: true, force: true });
        logger.debug({ dir }, "Workspace cleaned up");
      };

      return { dir, cleanup, token };
    },

    async cleanupStale(): Promise<number> {
      try {
        const tmpDir = tmpdir();
        const entries = await readdir(tmpDir);
        const now = Date.now();
        let removed = 0;

        for (const entry of entries) {
          if (!entry.startsWith("kodiai-")) continue;

          const fullPath = join(tmpDir, entry);
          try {
            const stats = await stat(fullPath);
            if (now - stats.mtimeMs > STALE_THRESHOLD_MS) {
              await rm(fullPath, { recursive: true, force: true });
              removed++;
            }
          } catch {
            // Individual entry stat/rm failure is non-fatal; skip it
          }
        }

        if (removed > 0) {
          logger.info({ removed }, "Stale workspaces cleaned up");
        }

        return removed;
      } catch (error: unknown) {
        logger.warn(
          { err: error },
          "Failed to clean up stale workspaces (non-fatal)",
        );
        return 0;
      }
    },
  };
}

/**
 * Verify that origin points to the expected fork, not the upstream repo.
 * Throws if mismatch -- prevents accidental direct pushes to target repos.
 */
export async function assertOriginIsFork(dir: string, expectedForkOwner: string): Promise<void> {
  const url = (await $`git -C ${dir} remote get-url origin`.quiet()).text().trim();
  if (!url.toLowerCase().includes(`github.com/${expectedForkOwner.toLowerCase()}/`)) {
    throw new Error(
      `Push guard: origin remote points to "${url}" which does not belong to fork owner "${expectedForkOwner}". ` +
      `Direct pushes to target repos are prevented. Clone from the fork instead.`,
    );
  }
}

/**
 * Determine whether to output a gist (patch) vs a PR based on user intent and change scope.
 *
 * Routing logic:
 * - Explicit "patch" keyword -> gist
 * - Explicit "pr" keyword -> PR
 * - Single file change -> gist
 * - More than 3 files -> PR
 * - 2-3 files in same directory -> gist, else PR
 */
export function shouldUseGist(intent: { keyword?: string }, changedFiles: string[]): boolean {
  if (intent.keyword === "patch") return true;
  if (intent.keyword === "pr") return false;

  if (changedFiles.length === 0) return true; // no changes = gist (empty patch)
  if (changedFiles.length === 1) return true;
  if (changedFiles.length > 3) return false;

  // 2-3 files: check if all in same directory
  const dirs = new Set(changedFiles.map((f) => dirname(f)));
  return dirs.size === 1;
}

/**
 * Create an Azure Files-backed workspace directory for a single ACA Job execution.
 * Returns the absolute path to the created directory.
 *
 * The mount base is the path where the Azure Files share is mounted inside the
 * orchestrator container (e.g. `/mnt/kodiai-workspaces`). Each job gets its own
 * subdirectory keyed by jobId so concurrent jobs don't share state.
 */
export async function createAzureFilesWorkspaceDir(opts: {
  mountBase: string;
  jobId: string;
}): Promise<string> {
  const dir = join(opts.mountBase, opts.jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}
