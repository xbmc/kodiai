/**
 * Minimal allowlisted environment for Claude Code agent subprocesses.
 *
 * The agent subprocess must NOT receive application secrets (GITHUB_PRIVATE_KEY,
 * DATABASE_URL, SLACK_BOT_TOKEN, etc.). This module exports an explicit allowlist
 * and a builder function that constructs a clean env from it.
 *
 * Callers add CLAUDE_CODE_ENTRYPOINT on top of the returned object — this module
 * deliberately does NOT include it so callers can set the correct value per call site.
 */

/**
 * Exact set of env var names the agent subprocess is permitted to receive.
 *
 * Includes:
 *   - SDK auth: CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY
 *   - POSIX system: HOME, PATH, TMPDIR, TEMP, TMP, USER, USERNAME, LOGNAME
 *   - Locale / terminal: LANG, LC_ALL, LC_CTYPE, LC_MESSAGES, LC_NUMERIC, LC_TIME, TERM, SHELL
 *   - Git identity: GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL
 *   - Runtime paths: BUN_INSTALL, NODE_PATH
 */
export const AGENT_ENV_ALLOWLIST: readonly string[] = [
  // SDK auth
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  // POSIX system
  "HOME",
  "PATH",
  "TMPDIR",
  "TEMP",
  "TMP",
  "USER",
  "USERNAME",
  "LOGNAME",
  // Locale / terminal
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_NUMERIC",
  "LC_TIME",
  "TERM",
  "SHELL",
  // Git identity
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  // Runtime paths
  "BUN_INSTALL",
  "NODE_PATH",
];

/**
 * Build a minimal subprocess environment by picking only allowlisted keys from
 * process.env. Keys absent from process.env are omitted (not set to undefined).
 *
 * Does NOT include CLAUDE_CODE_ENTRYPOINT — callers must add that on top so each
 * call site can set the correct value.
 */
export function buildAgentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of AGENT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
