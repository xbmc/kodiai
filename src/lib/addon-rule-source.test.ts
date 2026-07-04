import { describe, expect, test } from "bun:test";
import {
  ADDON_RULES_URL,
  EMBEDDED_ADDON_RULES,
  loadAddonRuleSource,
} from "./addon-rule-source.ts";

describe("loadAddonRuleSource", () => {
  test("uses bounded wiki text when fetch succeeds", async () => {
    const result = await loadAddonRuleSource({
      fetchImpl: async () => new Response("<html><body><h1>Add-on rules</h1><p>No analytics.</p></body></html>"),
    });

    expect(result.kind).toBe("wiki");
    expect(result.url).toBe(ADDON_RULES_URL);
    expect(result.text).toContain("Add-on rules");
    expect(result.text).toContain("No analytics.");
    expect(result.text).not.toContain("<html>");
  });

  test("falls back when fetch fails or returns empty content", async () => {
    const failed = await loadAddonRuleSource({
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    });
    const empty = await loadAddonRuleSource({
      fetchImpl: async () => new Response("   ", { status: 200 }),
    });

    expect(failed).toEqual({ kind: "fallback", url: ADDON_RULES_URL, text: EMBEDDED_ADDON_RULES });
    expect(empty).toEqual({ kind: "fallback", url: ADDON_RULES_URL, text: EMBEDDED_ADDON_RULES });
  });

  test("caps wiki text to the configured prompt budget", async () => {
    const result = await loadAddonRuleSource({
      maxChars: 25,
      fetchImpl: async () => new Response(`<p>${"Rule text ".repeat(20)}</p>`),
    });

    expect(result.kind).toBe("wiki");
    expect(result.text.length).toBeLessThanOrEqual(25);
  });
});
