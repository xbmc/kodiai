import { createHash } from "node:crypto";
import { $ } from "bun";
import type { Logger } from "pino";
import type { Workspace } from "../jobs/types.ts";
import { createBranchCommitAndPush, WritePolicyError, shouldUseGist, assertOriginIsFork } from "../jobs/workspace.ts";
import { buildWritePolicyRefusalMessage } from "../lib/mention-utils.ts";
import { loadRepoConfig } from "../execution/config.ts";
import type { ExecutionResult } from "../execution/types.ts";
import type { ForkManager } from "../jobs/fork-manager.ts";
import type { GistPublisher } from "../jobs/gist-publisher.ts";
import { FORK_WRITE_POLICY_INSTRUCTIONS } from "../execution/prompts.ts";

export interface SlackWriteRunnerInput {
  owner: string;
  repo: string;
  channel: string;
  threadTs: string;
  messageTs: string;
  prompt: string;
  request: string;
  keyword: "apply" | "change";
}

export interface SlackWriteCommentMirror {
  url: string;
  excerpt: string;
}

export type SlackWriteRunnerResult =
  | {
      outcome: "success";
      prUrl?: string;
      gistUrl?: string;
      responseText: string;
      retryCommand: string;
      mirrors: SlackWriteCommentMirror[];
    }
  | {
      outcome: "refusal";
      reason:
        | "write_disabled"
        | "policy"
        | "permission"
        | "unsupported_repo";
      responseText: string;
      retryCommand: string;
    }
  | {
      outcome: "failure";
      responseText: string;
      retryCommand: string;
    };

interface SlackWriteRunnerDeps {
  resolveRepoInstallationContext: (owner: string, repo: string) => Promise<{ installationId: number; defaultBranch: string } | null>;
  createWorkspace: (input: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
    depth: number;
    forkContext?: {
      forkOwner: string;
      forkRepo: string;
      botPat: string;
    };
  }) => Promise<Workspace>;
  execute: (input: {
    workspace: Workspace;
    installationId: number;
    owner: string;
    repo: string;
    prompt: string;
    triggerBody: string;
  }) => Promise<ExecutionResult>;
  createPullRequest: (input: {
    installationId: number;
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  }) => Promise<{ htmlUrl: string }>;
  loadRepoConfig?: typeof loadRepoConfig;
  commitBranchAndPush?: typeof createBranchCommitAndPush;
  /** Fork manager for fork-based write mode (Phase 127). */
  forkManager?: ForkManager;
  /** Gist publisher for patch output mode (Phase 127). */
  gistPublisher?: GistPublisher;
  /** Logger for fork/gist operations. */
  logger?: Logger;
}

function summarizeWriteRequest(request: string): string {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (normalized.length <= 72) {
    return normalized.length > 0 ? normalized : "requested update";
  }
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function isLikelyWritePermissionFailure(err: unknown): boolean {
  if (!err) {
    return false;
  }

  const status =
    typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
      ? err.status
      : undefined;

  if (status === 401 || status === 403) {
    return true;
  }

  const message = err instanceof Error ? err.message : String(err);
  const signal = message.toLowerCase();

  return (
    signal.includes("resource not accessible by integration") ||
    signal.includes("write access to repository not granted") ||
    signal.includes("permission denied") ||
    signal.includes("insufficient permission") ||
    signal.includes("forbidden") ||
    signal.includes("not permitted") ||
    signal.includes("requires write")
  );
}

function buildPermissionRefusalRetryText(retryCommand: string): string {
  return [
    "Write request refused due to missing GitHub App permissions.",
    "Minimum required permissions:",
    "- Contents: Read and write",
    "- Pull requests: Read and write",
    "- Issues: Read and write",
    "",
    `Retry command: ${retryCommand}`,
  ].join("\n");
}

function buildWriteDisabledRetryText(retryCommand: string): string {
  return [
    "Write mode is disabled for this repository.",
    "Update `.kodiai.yml`:",
    "```yml",
    "write:",
    "  enabled: true",
    "```",
    "",
    `Retry command: ${retryCommand}`,
  ].join("\n");
}

function buildUnsupportedRepoRetryText(owner: string, repo: string, retryCommand: string): string {
  return [
    `Repository ${owner}/${repo} is not accessible to this GitHub App installation.`,
    "Install the app on that repository (or choose a repo the app can access).",
    `Retry command: ${retryCommand}`,
  ].join("\n");
}

function buildFailureRetryText(reason: string, retryCommand: string): string {
  return [
    "Write request failed before PR publication completed.",
    `Reason: ${reason}`,
    `Retry command: ${retryCommand}`,
  ].join("\n");
}

function buildDeterministicBranchName(input: SlackWriteRunnerInput): string {
  const key = `${input.owner}/${input.repo}:${input.channel}:${input.threadTs}:${input.messageTs}:${input.request}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `kodiai/slack/${input.keyword}-${hash}`;
}

function collectCommentMirrors(result: ExecutionResult): SlackWriteCommentMirror[] {
  const events = result.publishEvents ?? [];
  return events
    .filter((event) => event.type === "comment")
    .map((event) => ({
      url: event.url,
      excerpt: event.excerpt,
    }));
}

export function createSlackWriteRunner(deps: SlackWriteRunnerDeps) {
  const loadConfig = deps.loadRepoConfig ?? loadRepoConfig;
  const commitBranchAndPush = deps.commitBranchAndPush ?? createBranchCommitAndPush;
  const { forkManager, gistPublisher, logger: depsLogger } = deps;

  return {
    async run(input: SlackWriteRunnerInput): Promise<SlackWriteRunnerResult> {
      const retryCommand = `${input.keyword}: ${input.request.length > 0 ? input.request : "<same request>"}`;
      const installationContext = await deps.resolveRepoInstallationContext(input.owner, input.repo);

      if (!installationContext) {
        return {
          outcome: "refusal",
          reason: "unsupported_repo",
          responseText: buildUnsupportedRepoRetryText(input.owner, input.repo, retryCommand),
          retryCommand,
        };
      }

      // Fork-based write mode: ensure fork exists and sync (Phase 127)
      let forkContext: { forkOwner: string; forkRepo: string; botPat: string } | undefined;
      if (forkManager?.enabled) {
        try {
          const fork = await forkManager.ensureFork(input.owner, input.repo);
          await forkManager.syncFork(fork.forkOwner, fork.forkRepo, installationContext.defaultBranch);
          forkContext = {
            forkOwner: fork.forkOwner,
            forkRepo: fork.forkRepo,
            botPat: forkManager.getBotPat(),
          };
          depsLogger?.info(
            { owner: input.owner, repo: input.repo, forkOwner: fork.forkOwner },
            "Fork ensured and synced for Slack write-mode",
          );
        } catch (forkErr) {
          depsLogger?.warn(
            { err: forkErr, owner: input.owner, repo: input.repo },
            "Fork setup failed for Slack write-mode; will fall back to gist or legacy mode",
          );
        }
      } else if (depsLogger) {
        depsLogger.warn(
          { owner: input.owner, repo: input.repo },
          "Slack write-mode active without BOT_USER_PAT; using legacy direct-push behavior",
        );
      }

      const workspace = await deps.createWorkspace({
        installationId: installationContext.installationId,
        owner: input.owner,
        repo: input.repo,
        ref: installationContext.defaultBranch,
        depth: 1,
        forkContext,
      });

      try {
        const { config } = await loadConfig(workspace.dir);
        if (!config.write.enabled) {
          return {
            outcome: "refusal",
            reason: "write_disabled",
            responseText: buildWriteDisabledRetryText(retryCommand),
            retryCommand,
          };
        }

        // When fork mode is active, append fork policy instructions to the agent prompt
        const effectivePrompt = forkContext
          ? `${input.prompt}\n\n${FORK_WRITE_POLICY_INSTRUCTIONS}`
          : input.prompt;

        const execution = await deps.execute({
          workspace,
          installationId: installationContext.installationId,
          owner: input.owner,
          repo: input.repo,
          prompt: effectivePrompt,
          triggerBody: input.request,
        });

        if (execution.conclusion !== "success") {
          return {
            outcome: "failure",
            responseText: buildFailureRetryText(
              execution.errorMessage ?? `execution-${execution.conclusion}`,
              retryCommand,
            ),
            retryCommand,
          };
        }

        // Output routing: determine gist vs PR (Phase 127)
        if (forkContext && gistPublisher?.enabled) {
          const changedFilesRaw = (await $`git -C ${workspace.dir} diff --name-only HEAD`.quiet().nothrow()).text().trim();
          const stagedFilesRaw = (await $`git -C ${workspace.dir} diff --cached --name-only`.quiet().nothrow()).text().trim();
          const allChangedRaw = [changedFilesRaw, stagedFilesRaw].filter(Boolean).join("\n");
          const changedFiles = [...new Set(allChangedRaw.split("\n").map((f) => f.trim()).filter(Boolean))];

          const useGist = shouldUseGist({ keyword: input.keyword }, changedFiles);

          if (useGist) {
            // Gist path
            try {
              await $`git -C ${workspace.dir} add -A`.quiet();
              const patch = (await $`git -C ${workspace.dir} diff --cached`.quiet()).text();

              if (patch.trim().length > 0) {
                const requestSummary = summarizeWriteRequest(input.request);
                const gist = await gistPublisher.createPatchGist({
                  owner: input.owner,
                  repo: input.repo,
                  summary: requestSummary,
                  patch,
                });

                const mirrors = collectCommentMirrors(execution);
                return {
                  outcome: "success",
                  gistUrl: gist.htmlUrl,
                  responseText: [
                    `Created patch gist: ${gist.htmlUrl}`,
                    "",
                    "To apply locally:",
                    `\`curl -sL ${gist.htmlUrl}.patch | git apply\``,
                  ].join("\n"),
                  retryCommand,
                  mirrors,
                };
              }
            } catch (gistErr) {
              depsLogger?.warn(
                { err: gistErr, owner: input.owner, repo: input.repo },
                "Gist creation failed; falling through to PR path",
              );
            }
          }

          // PR path with fork: commit, push to fork, create cross-fork PR
          try {
            await assertOriginIsFork(workspace.dir, forkContext.forkOwner);

            const branchName = buildDeterministicBranchName(input);
            const requestSummary = summarizeWriteRequest(input.request);
            const lower = requestSummary.toLowerCase();
            let prefix: string;
            if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
              prefix = "fix";
            } else if (/\brefactor\b/.test(lower)) {
              prefix = "refactor";
            } else {
              prefix = "feat";
            }
            const commitSubject = `${prefix}: ${requestSummary}`;
            const maxSubjectLen = 72;
            const truncatedSubject = commitSubject.length <= maxSubjectLen
              ? commitSubject
              : `${commitSubject.slice(0, maxSubjectLen - 3).trimEnd()}...`;

            const commitMessage = [
              truncatedSubject,
              "",
              `source: slack channel ${input.channel} thread ${input.threadTs}`,
              `request: ${requestSummary}`,
            ].join("\n");

            const pushed = await commitBranchAndPush({
              dir: workspace.dir,
              branchName,
              commitMessage,
              policy: {
                allowPaths: config.write.allowPaths,
                denyPaths: config.write.denyPaths,
                secretScanEnabled: config.write.secretScan.enabled,
              },
              token: forkContext.botPat,
            });

            // Cross-fork PR: head uses forkOwner:branchName format
            const crossForkHead = `${forkContext.forkOwner}:${pushed.branchName}`;
            const prTitle = `chore(slack-write): ${requestSummary}`;
            const prBody = [
              "Requested via Slack write-mode execution.",
              "",
              `Request: ${input.request}`,
              `Slack channel: ${input.channel}`,
              `Slack thread: ${input.threadTs}`,
              `Commit: ${pushed.headSha}`,
            ].join("\n");

            const createdPr = await deps.createPullRequest({
              installationId: installationContext.installationId,
              owner: input.owner,
              repo: input.repo,
              title: prTitle,
              head: crossForkHead,
              base: installationContext.defaultBranch,
              body: prBody,
            });

            const mirrors = collectCommentMirrors(execution);
            const mirrorLines = mirrors.length > 0
              ? [
                  "",
                  "Mirrored GitHub comments:",
                  ...mirrors.map((mirror) => `- ${mirror.url}\n  ${mirror.excerpt}`),
                ]
              : [];

            return {
              outcome: "success",
              prUrl: createdPr.htmlUrl,
              responseText: [`Opened PR: ${createdPr.htmlUrl}`, ...mirrorLines].join("\n"),
              retryCommand,
              mirrors,
            };
          } catch (forkPrErr) {
            depsLogger?.warn(
              { err: forkPrErr, owner: input.owner, repo: input.repo },
              "Fork-based PR creation failed; falling back to gist",
            );

            if (forkPrErr instanceof WritePolicyError) {
              return {
                outcome: "refusal",
                reason: "policy",
                responseText: `${buildWritePolicyRefusalMessage(forkPrErr, config.write.allowPaths)}\n\nRetry command: ${retryCommand}`,
                retryCommand,
              };
            }

            // Fallback: create gist with patch
            if (gistPublisher.enabled) {
              try {
                await $`git -C ${workspace.dir} add -A`.quiet();
                const patch = (await $`git -C ${workspace.dir} diff --cached`.quiet()).text();
                if (patch.trim().length > 0) {
                  const requestSummary = summarizeWriteRequest(input.request);
                  const gist = await gistPublisher.createPatchGist({
                    owner: input.owner,
                    repo: input.repo,
                    summary: requestSummary,
                    patch,
                  });
                  const mirrors = collectCommentMirrors(execution);
                  return {
                    outcome: "success",
                    gistUrl: gist.htmlUrl,
                    responseText: [
                      "Could not create PR from fork, but here is the patch as a gist:",
                      `${gist.htmlUrl}`,
                      "",
                      "To apply locally:",
                      `\`curl -sL ${gist.htmlUrl}.patch | git apply\``,
                    ].join("\n"),
                    retryCommand,
                    mirrors,
                  };
                }
              } catch (fallbackErr) {
                depsLogger?.error(
                  { err: fallbackErr },
                  "Fallback gist creation also failed in Slack write-runner",
                );
              }
            }

            // Fall through to legacy behavior
            depsLogger?.warn(
              { owner: input.owner, repo: input.repo },
              "Fork-based write mode failed completely in Slack write-runner; falling through to legacy path",
            );
          }
        }

        // Legacy path: direct push to target repo (when fork mode not available)
        const branchName = buildDeterministicBranchName(input);
        const requestSummary = summarizeWriteRequest(input.request);
        // Derive prefix from request content (same heuristic as mention handler)
        const lower = requestSummary.toLowerCase();
        let prefix: string;
        if (/\b(?:fix|bug|crash|broken|error)\b/.test(lower)) {
          prefix = "fix";
        } else if (/\brefactor\b/.test(lower)) {
          prefix = "refactor";
        } else {
          prefix = "feat";
        }
        const commitSubject = `${prefix}: ${requestSummary}`;
        const maxSubjectLen = 72;
        const truncatedSubject = commitSubject.length <= maxSubjectLen
          ? commitSubject
          : `${commitSubject.slice(0, maxSubjectLen - 3).trimEnd()}...`;

        const commitMessage = [
          truncatedSubject,
          "",
          `source: slack channel ${input.channel} thread ${input.threadTs}`,
          `request: ${requestSummary}`,
        ].join("\n");

        let pushed: { branchName: string; headSha: string };
        try {
          pushed = await commitBranchAndPush({
            dir: workspace.dir,
            branchName,
            commitMessage,
            policy: {
              allowPaths: config.write.allowPaths,
              denyPaths: config.write.denyPaths,
              secretScanEnabled: config.write.secretScan.enabled,
            },
            token: workspace.token,
          });
        } catch (err) {
          if (err instanceof WritePolicyError) {
            return {
              outcome: "refusal",
              reason: "policy",
              responseText: `${buildWritePolicyRefusalMessage(err, config.write.allowPaths)}\n\nRetry command: ${retryCommand}`,
              retryCommand,
            };
          }

          if (isLikelyWritePermissionFailure(err)) {
            return {
              outcome: "refusal",
              reason: "permission",
              responseText: buildPermissionRefusalRetryText(retryCommand),
              retryCommand,
            };
          }

          return {
            outcome: "failure",
            responseText: buildFailureRetryText(err instanceof Error ? err.message : String(err), retryCommand),
            retryCommand,
          };
        }

        const prTitle = `chore(slack-write): ${requestSummary}`;
        const prBody = [
          "Requested via Slack write-mode execution.",
          "",
          `Request: ${input.request}`,
          `Slack channel: ${input.channel}`,
          `Slack thread: ${input.threadTs}`,
          `Commit: ${pushed.headSha}`,
        ].join("\n");

        let createdPr: { htmlUrl: string };
        try {
          createdPr = await deps.createPullRequest({
            installationId: installationContext.installationId,
            owner: input.owner,
            repo: input.repo,
            title: prTitle,
            head: pushed.branchName,
            base: installationContext.defaultBranch,
            body: prBody,
          });
        } catch (err) {
          if (isLikelyWritePermissionFailure(err)) {
            return {
              outcome: "refusal",
              reason: "permission",
              responseText: buildPermissionRefusalRetryText(retryCommand),
              retryCommand,
            };
          }

          return {
            outcome: "failure",
            responseText: buildFailureRetryText(err instanceof Error ? err.message : String(err), retryCommand),
            retryCommand,
          };
        }

        const mirrors = collectCommentMirrors(execution);
        const mirrorLines = mirrors.length > 0
          ? [
              "",
              "Mirrored GitHub comments:",
              ...mirrors.map((mirror) => `- ${mirror.url}\n  ${mirror.excerpt}`),
            ]
          : [];

        return {
          outcome: "success",
          prUrl: createdPr.htmlUrl,
          responseText: [`Opened PR: ${createdPr.htmlUrl}`, ...mirrorLines].join("\n"),
          retryCommand,
          mirrors,
        };
      } finally {
        await workspace.cleanup();
      }
    },
  };
}
