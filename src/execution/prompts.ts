/**
 * Shared prompt fragments for agent execution.
 *
 * Centralizes instruction text so both the GitHub @mention handler and the
 * Slack write-runner inject the same constraints.
 */

/**
 * Fork-only branch and push policy instructions for write-mode agents.
 *
 * These instructions complement the code-level guard in workspace.ts that
 * routes all pushes through the fork. The dual enforcement ensures the agent
 * never even *attempts* to create branches directly in a target repository.
 */
export const FORK_WRITE_POLICY_INSTRUCTIONS = [
  "",
  "IMPORTANT: Branch and push policy:",
  '- You are operating in a fork of the target repository. Your git remote "origin" points to the fork, NOT the target repo.',
  "- Do NOT attempt to create branches directly in the target repository.",
  "- Do NOT attempt to push directly to the target repository.",
  "- All your git operations (checkout -b, commit, push) go through the fork automatically.",
  "- When creating pull requests, they will be cross-fork PRs from the fork to the upstream repository -- this is handled by the system, not by you.",
  "- If you need to share a patch without a PR, the system will create a gist automatically based on the nature of the change.",
].join("\n");
