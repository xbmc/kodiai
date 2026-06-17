import { describe, expect, test } from "bun:test";
import { loadAgentSdkQuery, loadGenerateText } from "./generate.ts";

describe("generateWithFallback module loading", () => {
  test("loads the Claude Agent SDK through an explicit lazy loader", async () => {
    let loadCount = 0;
    const query = () => ({}) as never;

    const loadedQuery = await loadAgentSdkQuery(async () => {
      loadCount++;
      return { query };
    });

    expect(loadCount).toBe(1);
    expect(loadedQuery).toBe(query);
  });

  test("loads AI SDK generateText through an explicit lazy loader", async () => {
    let loadCount = 0;
    const generateText = (() => Promise.resolve({ text: "ok" })) as never;

    const loadedGenerateText = await loadGenerateText(async () => {
      loadCount++;
      return { generateText };
    });

    expect(loadCount).toBe(1);
    expect(loadedGenerateText).toBe(generateText);
  });
});
