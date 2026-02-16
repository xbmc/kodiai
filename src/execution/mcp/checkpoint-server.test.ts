import { describe, expect, test } from "bun:test";
import { createCheckpointServer } from "./checkpoint-server.ts";

function getToolHandler(server: ReturnType<typeof createCheckpointServer>) {
  const instance = server.instance as unknown as {
    _registeredTools?: Record<
      string,
      { handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }
    >;
  };

  const tool = instance._registeredTools?.save_review_checkpoint;
  if (!tool) {
    throw new Error("save_review_checkpoint tool is not registered");
  }
  return tool.handler;
}

describe("createCheckpointServer", () => {
  test("returns an MCP server with name", () => {
    const knowledgeStore = {};
    const server = createCheckpointServer(knowledgeStore as never, "key", "acme/repo", 1, 10);
    expect(server.name).toBe("review_checkpoint");
  });

  test("tool handler persists checkpoint data", async () => {
    const calls: unknown[] = [];
    const knowledgeStore = {
      saveCheckpoint: (data: unknown) => {
        calls.push(data);
      },
    };

    const server = createCheckpointServer(
      knowledgeStore as never,
      "review-key",
      "acme/repo",
      42,
      12,
    );
    const handler = getToolHandler(server);

    const result = await handler({
      filesReviewed: ["src/a.ts", "src/b.ts"],
      findingCount: 3,
      summaryDraft: "Draft summary",
    });

    expect(result.isError).toBeUndefined();
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({
      reviewOutputKey: "review-key",
      repo: "acme/repo",
      prNumber: 42,
      filesReviewed: ["src/a.ts", "src/b.ts"],
      findingCount: 3,
      summaryDraft: "Draft summary",
      totalFiles: 12,
    });

    const parsed = JSON.parse(result.content[0]!.text) as { saved: boolean; filesReviewed: number; totalFiles: number };
    expect(parsed.saved).toBe(true);
    expect(parsed.filesReviewed).toBe(2);
    expect(parsed.totalFiles).toBe(12);
  });

  test("gracefully degrades when checkpoint storage unavailable", async () => {
    const knowledgeStore = {};
    const server = createCheckpointServer(knowledgeStore as never, "key", "acme/repo", 1, 10);
    const handler = getToolHandler(server);

    const result = await handler({
      filesReviewed: ["src/a.ts"],
      findingCount: 0,
      summaryDraft: "",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text) as { saved: boolean; reason?: string };
    expect(parsed.saved).toBe(false);
    expect(parsed.reason).toBe("checkpoint storage unavailable");
  });
});
