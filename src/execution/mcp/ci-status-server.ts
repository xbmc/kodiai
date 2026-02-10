import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";

export function createCIStatusServer(
  getOctokit: () => Promise<Octokit>,
  owner: string,
  repo: string,
  prNumber: number,
) {
  return createSdkMcpServer({
    name: "github_ci",
    version: "0.1.0",
    tools: [
      tool(
        "get_ci_status",
        "Get CI status summary for this PR",
        {
          status: z
            .enum([
              "completed",
              "action_required",
              "cancelled",
              "failure",
              "neutral",
              "skipped",
              "stale",
              "success",
              "timed_out",
              "in_progress",
              "queued",
              "requested",
              "waiting",
              "pending",
            ])
            .optional()
            .describe("Filter workflow runs by status"),
        },
        async ({ status }) => {
          try {
            const octokit = await getOctokit();

            const pr = await octokit.rest.pulls.get({
              owner,
              repo,
              pull_number: prNumber,
            });
            const headSha = pr.data.head.sha;

            const { data: runsData } =
              await octokit.rest.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                head_sha: headSha,
                ...(status && { status }),
              });

            const runs = runsData.workflow_runs || [];
            const summary = { total_runs: runs.length, failed: 0, passed: 0, pending: 0 };

            const processedRuns = runs.map((run) => {
              if (run.status === "completed") {
                if (run.conclusion === "success") summary.passed++;
                else if (run.conclusion === "failure") summary.failed++;
              } else {
                summary.pending++;
              }

              return {
                id: run.id,
                name: run.name,
                status: run.status,
                conclusion: run.conclusion,
                html_url: run.html_url,
                created_at: run.created_at,
              };
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ summary, runs: processedRuns }),
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true,
            };
          }
        },
      ),
      tool(
        "get_workflow_run_details",
        "Get job and step details for a specific workflow run",
        {
          run_id: z.number().describe("The workflow run ID"),
        },
        async ({ run_id }) => {
          try {
            const octokit = await getOctokit();

            const { data: jobsData } =
              await octokit.rest.actions.listJobsForWorkflowRun({
                owner,
                repo,
                run_id,
              });

            const processedJobs = jobsData.jobs.map((job) => {
              const failedSteps = (job.steps || [])
                .filter((step) => step.conclusion === "failure")
                .map((step) => ({ name: step.name, number: step.number }));

              return {
                id: job.id,
                name: job.name,
                conclusion: job.conclusion,
                html_url: job.html_url,
                failed_steps: failedSteps,
              };
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ jobs: processedJobs }),
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
