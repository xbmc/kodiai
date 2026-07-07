import { describe, expect, test } from "bun:test";
import { buildReviewPostExecutionTelemetryPublicationContext } from "./review-post-execution-telemetry-context.ts";

describe("buildReviewPostExecutionTelemetryPublicationContext", () => {
  test("binds post-execution telemetry publication adapters to the installation and bot handles", async () => {
    const calls: number[] = [];
    const octokit = { marker: "octokit" };

    const context = buildReviewPostExecutionTelemetryPublicationContext({
      installationId: 123,
      getInstallationOctokit: async (installationId) => {
        calls.push(installationId);
        return octokit;
      },
      appSlug: "kodiai",
    });

    await expect(context.getOctokit()).resolves.toBe(octokit);
    expect(calls).toEqual([123]);
    expect(context.botHandles).toEqual(["kodiai", "claude"]);
  });
});
