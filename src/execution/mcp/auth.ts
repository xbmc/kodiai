export const KODIAI_MCP_AUTH_HEADER = "X-Kodiai-MCP-Authorization";
export const KODIAI_MCP_TOKEN_QUERY_PARAM = "kodiai_mcp_token";

export type McpAuthConfig = {
  url: string;
  headers: Record<string, string>;
};

export type McpAuthRequest = {
  header(name: string): string | undefined;
  query(name: string): string | undefined;
};

function buildMcpServerUrl(baseUrl: string, serverName: string): string {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (trimmedBaseUrl.endsWith("/internal/mcp")) {
    return `${trimmedBaseUrl}/${serverName}`;
  }
  return `${trimmedBaseUrl}/internal/mcp/${serverName}`;
}

function appendMcpTokenQuery(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${KODIAI_MCP_TOKEN_QUERY_PARAM}=${encodeURIComponent(token)}`;
}

/**
 * Builds the auth shape consumed by the agent SDK's HTTP MCP transport.
 *
 * Azure Container Apps can preserve the internal MCP path/query while upstream
 * SDK and ingress layers may not consistently preserve authorization headers.
 * The query fallback is scoped to the per-job, TTL-bound MCP token and exists
 * only for those internal callback URLs. Do not log raw URLs or raw tokens;
 * server-side auth logs must use the registry token fingerprint/log id.
 */
export function buildMcpServerAuthConfig(args: {
  baseUrl: string;
  serverName: string;
  token: string;
}): McpAuthConfig {
  const url = appendMcpTokenQuery(
    buildMcpServerUrl(args.baseUrl, args.serverName),
    args.token,
  );
  const bearerToken = `Bearer ${args.token}`;

  return {
    url,
    headers: {
      Authorization: bearerToken,
      [KODIAI_MCP_AUTH_HEADER]: bearerToken,
    },
  };
}

export function extractMcpAuthToken(request: McpAuthRequest): string | undefined {
  const authHeader =
    request.header("Authorization") ?? request.header(KODIAI_MCP_AUTH_HEADER);
  const headerToken = authHeader?.replace(/^Bearer /, "");
  return headerToken || request.query(KODIAI_MCP_TOKEN_QUERY_PARAM) || undefined;
}
