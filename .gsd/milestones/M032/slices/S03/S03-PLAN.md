# S03: Agent Job Entrypoint + Executor Refactor

**Goal:** Agent job entrypoint src/execution/agent-job.ts reads job env and calls query() with McpHttpServerConfig. Refactor createExecutor() to dispatch ACA Job instead of in-process query(). Wire timeout to jobs.stop(). ExecutionResult type and all callers (mention.ts, review.ts) unchanged.
**Demo:** After this: After S03: @kodiai mention in a GitHub PR → ACA Job appears in Azure portal executions list → job completes → GitHub comment posted with agent response. Job container env inspection (via Azure portal or job logs): only ANTHROPIC_API_KEY, MCP_BEARER_TOKEN, WORKSPACE_DIR, GITHUB_INSTALLATION_TOKEN present.

## Tasks
