import { createHash } from "node:crypto";
import type { Workspace } from "../jobs/types.ts";
import { createBranchCommitAndPush, WritePolicyError } from "../jobs/workspace.ts";
import { buildWritePolicyRefusalMessage } from "../handlers/mention.ts";
import { loadRepoConfig } from "../execution/config.ts";
import type { ExecutionResult } from "../execution/types.ts";

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
      prUrl: string;
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

      const workspace = await deps.createWorkspace({
        installationId: installationContext.installationId,
        owner: input.owner,
        repo: input.repo,
        ref: installationContext.defaultBranch,
        depth: 1,
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

        const execution = await deps.execute({
          workspace,
          installationId: installationContext.installationId,
          owner: input.owner,
          repo: input.repo,
          prompt: input.prompt,
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

        const branchName = buildDeterministicBranchName(input);
        const requestSummary = summarizeWriteRequest(input.request);
        const commitMessage = [
          `kodiai: apply slack write request`,
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
