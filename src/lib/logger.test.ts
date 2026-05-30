import { describe, expect, test } from "bun:test";
import { sanitizeLogError } from "./logger.ts";

describe("sanitizeLogError", () => {
  test("drops GitHub request and response URLs from logged errors", () => {
    const err = Object.assign(new Error("GitHub API request failed"), {
      name: "RequestError",
      status: 403,
      request: {
        method: "GET",
        url: "https://api.github.com/repos/xbmc/kodiai/pulls/comments/123/reactions?per_page=100",
      },
      response: {
        status: 403,
        url: "https://api.github.com/repos/xbmc/kodiai/pulls/comments/123/reactions?per_page=100",
      },
    });

    const sanitized = sanitizeLogError(err);
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toMatchObject({
      type: "RequestError",
      message: "GitHub API request failed",
      status: 403,
    });
    expect(serialized).not.toContain("api.github.com");
    expect(serialized).not.toContain("\"request\"");
    expect(serialized).not.toContain("\"response\"");
    expect(serialized).not.toContain("\"url\"");
  });
});
