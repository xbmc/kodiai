import { describe, expect, test } from "bun:test";
import { createCandidateFindingServer } from "./candidate-finding-server.ts";
import type { ReviewCandidateFindingRecorder } from "../../review-orchestration/review-candidate-finding.ts";

function getRegisteredTool(server: ReturnType<typeof createCandidateFindingServer>, toolName: string) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      {
        description?: string;
        inputSchema?: { safeParse: (input: unknown) => { success: boolean } };
        handler: (
          input: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
      }
    >;
  };

  const tool = instance._registeredTools?.[toolName];
  if (!tool) {
    throw new Error(`tool '${toolName}' is not registered`);
  }
  return tool;
}

function parseToolResponse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const validInput = {
  filePath: "src/execution/mcp/index.ts",
  startLine: 12,
  endLine: 18,
  severity: "major",
  category: "correctness",
  title: "Candidate title",
  body: "Candidate body explaining the potential issue.",
  evidence: "Optional short evidence.",
};

describe("createCandidateFindingServer", () => {
  test("returns the candidate-preferred MCP server and model-facing tool description", () => {
    const recorder: ReviewCandidateFindingRecorder = {
      recordCandidateFinding: () => undefined,
    };

    const server = createCandidateFindingServer({
      recorder,
      repo: "acme/repo",
      pullNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
    });

    expect(server.name).toBe("review_candidate_finding");
    const tool = getRegisteredTool(server, "record_candidate_finding");
    expect(tool.description).toContain("preferred pre-publication path");
    expect(tool.description).toContain("reducer/coordinator approval before publication");
    expect(tool.description).toContain("does not publish to GitHub");
    expect(tool.description).toContain("audited fallback");
    expect(tool.description).not.toContain("shadow-only");
    expect(tool.description).not.toContain("sidecar");
    expect(tool.inputSchema?.safeParse(validInput).success).toBe(true);
  });

  test("records a valid candidate through the injected recorder and returns shadow JSON", async () => {
    const calls: unknown[] = [];
    const recorder: ReviewCandidateFindingRecorder = {
      recordCandidateFinding: (finding, context) => {
        calls.push({ finding, context });
      },
    };

    const server = createCandidateFindingServer({
      recorder,
      repo: "acme/repo",
      pullNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
    });
    const result = await getRegisteredTool(server, "record_candidate_finding").handler(validInput);

    expect(result.isError).toBeUndefined();
    expect(parseToolResponse(result)).toEqual({ recorded: true, mode: "shadow" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      finding: {
        repo: "acme/repo",
        pullNumber: 42,
        reviewOutputKey: "review-key",
        deliveryId: "delivery-1",
        filePath: "src/execution/mcp/index.ts",
        startLine: 12,
        endLine: 18,
        severity: "major",
        category: "correctness",
        title: "Candidate title",
        body: "Candidate body explaining the potential issue.",
      },
      context: {
        repo: "acme/repo",
        pullNumber: 42,
        reviewOutputKey: "review-key",
        deliveryId: "delivery-1",
      },
    });
  });

  test("returns rejected JSON for malformed input without invoking the recorder", async () => {
    const calls: unknown[] = [];
    const warnings: unknown[] = [];
    const recorder: ReviewCandidateFindingRecorder = {
      recordCandidateFinding: (...args) => {
        calls.push(args);
      },
    };
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };

    const server = createCandidateFindingServer({
      recorder,
      repo: "acme/repo",
      pullNumber: 42,
      reviewOutputKey: "review-key",
      logger: logger as never,
    });
    const result = await getRegisteredTool(server, "record_candidate_finding").handler({
      ...validInput,
      body: "",
      severity: "blocker",
    });

    expect(result.isError).toBeUndefined();
    expect(parseToolResponse(result)).toEqual({
      recorded: false,
      mode: "shadow",
      reason: "candidate-finding-rejected",
    });
    expect(calls).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain("Candidate body");
  });

  test("returns degraded JSON when the recorder is missing or fails", async () => {
    const missingRecorderServer = createCandidateFindingServer({
      repo: "acme/repo",
      pullNumber: 42,
      reviewOutputKey: "review-key",
    });
    const missingRecorderResult = await getRegisteredTool(missingRecorderServer, "record_candidate_finding").handler(validInput);

    expect(missingRecorderResult.isError).toBeUndefined();
    expect(parseToolResponse(missingRecorderResult)).toEqual({
      recorded: false,
      mode: "degraded",
      reason: "candidate-finding-recorder-unavailable",
    });

    const failingRecorder: ReviewCandidateFindingRecorder = {
      recordCandidateFinding: async () => {
        throw new Error("disk contains raw body text that must not be returned");
      },
    };
    const warnings: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };
    const failingServer = createCandidateFindingServer({
      recorder: failingRecorder,
      repo: "acme/repo",
      pullNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      logger: logger as never,
    });
    const failingResult = await getRegisteredTool(failingServer, "record_candidate_finding").handler(validInput);

    expect(failingResult.isError).toBeUndefined();
    expect(parseToolResponse(failingResult)).toEqual({
      recorded: false,
      mode: "degraded",
      reason: "candidate-finding-record-failed",
    });
    expect(JSON.stringify(failingResult)).not.toContain("raw body text");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ err: expect.any(Error) }),
      "Candidate finding recorder failed",
    ]));
    expect(JSON.stringify(warnings)).not.toContain(validInput.body);
  });

  test("logs recorder rejection and nested error recorder failures without returning raw details", async () => {
    const warnings: unknown[] = [];
    const recorder: ReviewCandidateFindingRecorder = {
      recordCandidateFinding: async () => {
        throw new Error("primary recorder raw payload should stay out of tool response");
      },
      recordCandidateFindingRejection: async () => {
        throw new Error("rejection recorder raw payload should stay out of tool response");
      },
      recordCandidateFindingError: async () => {
        throw new Error("error recorder raw payload should stay out of tool response");
      },
    };
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };
    const server = createCandidateFindingServer({
      recorder,
      repo: "acme/repo",
      pullNumber: 42,
      reviewOutputKey: "review-key",
      deliveryId: "delivery-1",
      logger: logger as never,
    });

    const rejectedResult = await getRegisteredTool(server, "record_candidate_finding").handler({
      ...validInput,
      filePath: "../outside.ts",
    });
    const failedResult = await getRegisteredTool(server, "record_candidate_finding").handler(validInput);

    expect(parseToolResponse(rejectedResult)).toEqual({
      recorded: false,
      mode: "shadow",
      reason: "candidate-finding-rejected",
    });
    expect(parseToolResponse(failedResult)).toEqual({
      recorded: false,
      mode: "degraded",
      reason: "candidate-finding-record-failed",
    });
    expect(warnings.map((entry) => (entry as unknown[])[1])).toEqual(expect.arrayContaining([
      "Candidate finding rejection recorder failed",
      "Candidate finding error recorder failed",
      "Candidate finding recorder failed",
    ]));
    expect(warnings).toEqual(expect.arrayContaining([
      expect.arrayContaining([expect.objectContaining({ err: expect.any(Error) }), "Candidate finding rejection recorder failed"]),
      expect.arrayContaining([expect.objectContaining({ err: expect.any(Error) }), "Candidate finding error recorder failed"]),
      expect.arrayContaining([expect.objectContaining({ err: expect.any(Error) }), "Candidate finding recorder failed"]),
    ]));
    expect(JSON.stringify(rejectedResult)).not.toContain("raw payload");
    expect(JSON.stringify(failedResult)).not.toContain("raw payload");
  });

  test("returns unavailable JSON when review correlation is missing", async () => {
    const calls: unknown[] = [];
    const recorder: ReviewCandidateFindingRecorder = {
      recordCandidateFinding: (...args) => {
        calls.push(args);
      },
    };

    const server = createCandidateFindingServer({
      recorder,
      repo: "acme/repo",
      pullNumber: 42,
    });
    const result = await getRegisteredTool(server, "record_candidate_finding").handler(validInput);

    expect(result.isError).toBeUndefined();
    expect(parseToolResponse(result)).toEqual({
      recorded: false,
      mode: "unavailable",
      reason: "missing-correlation",
    });
    expect(calls).toHaveLength(0);
  });
});
