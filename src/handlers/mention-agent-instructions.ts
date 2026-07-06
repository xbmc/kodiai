import { FORK_WRITE_POLICY_INSTRUCTIONS } from "../execution/prompts.ts";

export type MentionAgentInstructions = {
  planOnlyInstructions?: string;
  writeInstructions?: string;
};

export function buildMentionAgentInstructions(input: {
  isPlanOnly: boolean;
  isWriteRequest: boolean;
  writeEnabled: boolean;
}): MentionAgentInstructions {
  const planOnlyInstructions = input.isPlanOnly
    ? [
        "Plan-only request detected (plan:).",
        "In this run:",
        "- Do NOT edit files.",
        "- Do NOT run git commands.",
        "- Do NOT propose opening a PR.",
        "- Do NOT claim any change was completed.",
        "- Do NOT ask for `apply:` / `change:` prefixes.",
        "- Never use status phrases like: 'Done', 'Implemented', 'Updated', or 'Appended'.",
        "Return a concise plan with 3-7 steps and a list of files you would touch.",
        "End by asking whether they want you to implement the plan next.",
      ].join("\n")
    : undefined;

  const writeInstructions = input.writeEnabled
    ? [
        "Write-intent request detected (apply/change).",
        "Write-mode is enabled.",
        "",
        "In this run:",
        "- Make the requested changes by editing files in the workspace.",
        "- Do NOT run git commands (no branch/commit/push).",
        "- Do NOT publish any GitHub comments/reviews; publish tools are disabled.",
        "- Keep changes minimal and focused on the request.",
        "- NEVER fabricate checksums, hashes, version numbers, download URLs, or any verifiable data. If you need a real value (e.g. a SHA512 of a download), leave a clearly-marked TODO placeholder like `SHA512=TODO_REPLACE_WITH_REAL_HASH` instead of generating a fake one.",
        "- NEVER invent API endpoints, package names, or configuration values that you have not verified exist in the codebase.",
        "- Verify completeness: if you add a new module/component, trace it through the build system and make sure it is actually wired in (e.g., find_package calls, CMakeLists.txt, imports, etc.).",
        FORK_WRITE_POLICY_INSTRUCTIONS,
      ].join("\n")
    : input.isWriteRequest
      ? [
          "Write-intent request detected (apply/change).",
          "In this run: do NOT create branches/commits/PRs and do NOT push changes.",
          "Instead, propose a concrete, minimal plan (files + steps) and ask for confirmation.",
          "Keep it concise.",
        ].join("\n")
      : undefined;

  return {
    planOnlyInstructions,
    writeInstructions,
  };
}
