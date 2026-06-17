export function getToolHandler(server: unknown, toolName: string) {
  const instance = server as {
    instance?: {
      _registeredTools?: Record<
        string,
        {
          handler: (
            input: Record<string, unknown>,
          ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
        }
      >;
    };
  };
  const tool = instance.instance?._registeredTools?.[toolName];
  if (!tool) {
    throw new Error(`tool '${toolName}' is not registered`);
  }
  return tool.handler;
}

export function hasRegisteredTool(server: unknown, toolName: string): boolean {
  const instance = server as {
    instance?: {
      _registeredTools?: Record<string, unknown>;
    };
  };
  return instance.instance?._registeredTools?.[toolName] !== undefined;
}

export function createMinimalMcpDeps(overrides: Record<string, unknown> = {}) {
  return {
    getOctokit: async () => ({} as never),
    owner: "testowner",
    repo: "testrepo",
    ...overrides,
  };
}
