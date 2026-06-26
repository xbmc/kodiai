import { describe, expect, test } from "bun:test";
import {
  KODIAI_MCP_AUTH_HEADER,
  KODIAI_MCP_TOKEN_QUERY_PARAM,
  buildMcpServerAuthConfig,
  extractMcpAuthToken,
} from "./auth.ts";

describe("MCP auth helpers", () => {
  test("builds a single client auth config with bearer headers and query fallback", () => {
    const config = buildMcpServerAuthConfig({
      baseUrl: "https://api.example.com/",
      serverName: "github_comment",
      token: "tok value",
    });

    expect(config.url).toBe(
      `https://api.example.com/internal/mcp/github_comment?${KODIAI_MCP_TOKEN_QUERY_PARAM}=tok%20value`,
    );
    expect(config.headers).toEqual({
      Authorization: "Bearer tok value",
      [KODIAI_MCP_AUTH_HEADER]: "Bearer tok value",
    });
  });

  test("does not duplicate the MCP path when the base URL already includes it", () => {
    const config = buildMcpServerAuthConfig({
      baseUrl: "https://api.example.com/internal/mcp",
      serverName: "candidate",
      token: "bearer-tok",
    });

    expect(config.url).toBe(
      `https://api.example.com/internal/mcp/candidate?${KODIAI_MCP_TOKEN_QUERY_PARAM}=bearer-tok`,
    );
  });

  test("extracts tokens from the primary header, fallback header, or query fallback", () => {
    expect(
      extractMcpAuthToken({
        header: (name) => name === "Authorization" ? "Bearer primary" : undefined,
        query: () => undefined,
      }),
    ).toBe("primary");

    expect(
      extractMcpAuthToken({
        header: (name) => name === KODIAI_MCP_AUTH_HEADER ? "Bearer fallback" : undefined,
        query: () => undefined,
      }),
    ).toBe("fallback");

    expect(
      extractMcpAuthToken({
        header: () => undefined,
        query: (name) => name === KODIAI_MCP_TOKEN_QUERY_PARAM ? "query-token" : undefined,
      }),
    ).toBe("query-token");
  });
});
