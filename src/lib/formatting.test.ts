import { test, expect, describe } from "bun:test";
import { wrapInDetails } from "./formatting.ts";

describe("wrapInDetails", () => {
  test("short body (under 500 chars) returns unchanged", () => {
    const body = "This is a short response.";
    expect(wrapInDetails(body)).toBe(body);
  });

  test("body of exactly 500 chars is NOT wrapped", () => {
    const body = "x".repeat(500);
    expect(wrapInDetails(body)).toBe(body);
  });

  test("body of 501 chars IS wrapped", () => {
    const body = "x".repeat(501);
    const result = wrapInDetails(body);
    expect(result).toStartWith("<details>");
    expect(result).toContain("<summary>");
    expect(result).toEndWith("</details>");
  });

  test("long body gets wrapped in <details> tags with default summary", () => {
    const body = "A".repeat(600);
    const result = wrapInDetails(body);
    expect(result).toBe(
      `<details>\n<summary>Kodiai response (600 characters)</summary>\n\n${body}\n\n</details>`,
    );
  });

  test("custom summary text is used when provided", () => {
    const body = "B".repeat(600);
    const result = wrapInDetails(body, "My custom summary");
    expect(result).toContain("<summary>My custom summary</summary>");
    expect(result).not.toContain("characters");
  });

  test("default summary includes character count", () => {
    const body = "C".repeat(750);
    const result = wrapInDetails(body);
    expect(result).toContain("750 characters");
  });

  test("body already starting with <details> is NOT double-wrapped", () => {
    const body = `<details>\n<summary>Existing</summary>\n\n${"D".repeat(600)}\n\n</details>`;
    expect(wrapInDetails(body)).toBe(body);
  });

  test("body starting with whitespace then <details> is NOT double-wrapped", () => {
    const body = `  <details>\n<summary>Existing</summary>\n\n${"E".repeat(600)}\n\n</details>`;
    expect(wrapInDetails(body)).toBe(body);
  });
});
