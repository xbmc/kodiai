import { describe, expect, test } from "bun:test";
import { createCIStatusServer } from "./ci-status-server.ts";

function getToolHandler(
  server: ReturnType<typeof createCIStatusServer>,
  name: "get_ci_status" | "get_workflow_run_details",
) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      {
        handler: (
          input: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
      }
    >;
  };

  const tool = instance._registeredTools?.[name];
  if (!tool) {
    throw new Error(`${name} tool is not registered`);
  }
  return tool.handler;
}

describe("createCIStatusServer", () => {
  test("get_ci_status paginates workflow runs for the PR head SHA", async () => {
    const workflowRunCalls: Array<{ page?: number; per_page?: number; head_sha?: string }> = [];
    const octokit = {
      rest: {
        pulls: {
          get: async () => ({ data: { head: { sha: "head-sha-123" } } }),
        },
        actions: {
          listWorkflowRunsForRepo: async (params: {
            page?: number;
            per_page?: number;
            head_sha?: string;
          }) => {
            workflowRunCalls.push(params);
            return {
              data: {
                workflow_runs: params.page === 1
                  ? Array.from({ length: 100 }, (_, index) => ({
                      id: index + 1,
                      name: `page-one-${index}`,
                      status: "completed",
                      conclusion: "success",
                      html_url: `https://example.test/runs/${index + 1}`,
                      created_at: "2026-07-01T00:00:00.000Z",
                    }))
                  : [
                      {
                        id: 101,
                        name: "second-page-failure",
                        status: "completed",
                        conclusion: "failure",
                        html_url: "https://example.test/runs/101",
                        created_at: "2026-07-01T00:01:00.000Z",
                      },
                    ],
              },
            };
          },
        },
      },
    };

    const server = createCIStatusServer(async () => octokit as never, "acme", "repo", 42);
    const handler = getToolHandler(server, "get_ci_status");

    const result = await handler({});
    const parsed = JSON.parse(result.content[0]!.text);

    expect(workflowRunCalls.map((call) => call.page)).toEqual([1, 2]);
    expect(workflowRunCalls.every((call) => call.per_page === 100)).toBe(true);
    expect(workflowRunCalls.every((call) => call.head_sha === "head-sha-123")).toBe(true);
    expect(parsed.summary).toEqual({ total_runs: 101, failed: 1, passed: 100, pending: 0 });
    expect(parsed.runs.at(-1)).toMatchObject({
      id: 101,
      name: "second-page-failure",
      conclusion: "failure",
    });
  });

  test("get_workflow_run_details paginates workflow jobs", async () => {
    const jobCalls: Array<{ page?: number; per_page?: number; run_id?: number }> = [];
    const octokit = {
      rest: {
        actions: {
          listJobsForWorkflowRun: async (params: {
            page?: number;
            per_page?: number;
            run_id?: number;
          }) => {
            jobCalls.push(params);
            return {
              data: {
                jobs: params.page === 1
                  ? Array.from({ length: 100 }, (_, index) => ({
                      id: index + 1,
                      name: `page-one-job-${index}`,
                      conclusion: "success",
                      html_url: `https://example.test/jobs/${index + 1}`,
                      steps: [],
                    }))
                  : [
                      {
                        id: 101,
                        name: "second-page-job",
                        conclusion: "failure",
                        html_url: "https://example.test/jobs/101",
                        steps: [{ name: "test", number: 3, conclusion: "failure" }],
                      },
                    ],
              },
            };
          },
        },
      },
    };

    const server = createCIStatusServer(async () => octokit as never, "acme", "repo", 42);
    const handler = getToolHandler(server, "get_workflow_run_details");

    const result = await handler({ run_id: 9001 });
    const parsed = JSON.parse(result.content[0]!.text);

    expect(jobCalls.map((call) => call.page)).toEqual([1, 2]);
    expect(jobCalls.every((call) => call.per_page === 100)).toBe(true);
    expect(jobCalls.every((call) => call.run_id === 9001)).toBe(true);
    expect(parsed.jobs).toHaveLength(101);
    expect(parsed.jobs.at(-1)).toEqual({
      id: 101,
      name: "second-page-job",
      conclusion: "failure",
      html_url: "https://example.test/jobs/101",
      failed_steps: [{ name: "test", number: 3 }],
    });
  });

  test("returns bounded partial results with a truncation flag when pagination never terminates", async () => {
    let calls = 0;
    const octokit = {
      rest: {
        pulls: { get: async () => ({ data: { head: { sha: "head-sha" } } }) },
        actions: {
          listWorkflowRunsForRepo: async () => {
            calls++;
            return { data: { workflow_runs: Array.from({ length: 100 }, (_, id) => ({ id, status: "queued" })) } };
          },
        },
      },
    };
    const server = createCIStatusServer(async () => octokit as never, "acme", "repo", 42);
    const handler = getToolHandler(server, "get_ci_status");

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.summary.truncated).toBe(true);
    expect(parsed.summary.total_runs).toBe(10_000);
    expect(parsed.runs).toHaveLength(10_000);
    expect(calls).toBe(100);
  });
});
