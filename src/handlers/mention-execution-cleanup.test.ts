import { describe, expect, test } from "bun:test";
import { cleanupMentionExecutionResources } from "./mention-execution-cleanup.ts";

describe("cleanupMentionExecutionResources", () => {
  test("releases an acquired write key and cleans up the workspace", async () => {
    const releasedKeys: string[] = [];
    let cleaned = false;

    await cleanupMentionExecutionResources({
      acquiredWriteKey: "write-key",
      releaseWriteKey: (key) => releasedKeys.push(key),
      workspace: {
        cleanup: async () => {
          cleaned = true;
        },
      },
    });

    expect(releasedKeys).toEqual(["write-key"]);
    expect(cleaned).toBe(true);
  });

  test("skips absent resources", async () => {
    const releasedKeys: string[] = [];

    await cleanupMentionExecutionResources({
      releaseWriteKey: (key) => releasedKeys.push(key),
    });

    expect(releasedKeys).toEqual([]);
  });
});
