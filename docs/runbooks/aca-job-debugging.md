# ACA Job Debugging

## Trust model

- MCP HTTP auth, token lifecycle, and ingress assumptions: [MCP ingress trust model](./mcp-ingress-trust.md)
- Formatter command shell execution trust boundary: [Formatter suggestions](./formatter-suggestions.md#trust-model-repo-controlled-shell)

## When to use
Use this when an Azure Container Apps job fails, stalls, or times out.

## Signals
- `result.json` is missing or reports failure
- `agent-diagnostics.log` shows the last remote diagnostics
- `Last remote diagnostics:` appears in the surfaced timeout/failure output
- GitHub Actions workflow run status or review proof surfaces show timeout-related failures

## Commands
- `bun run verify:m048:s03`
- `bun run verify:m055:s03`

## Owning milestone
- M048 for timeout/review proof surfaces
- M055 for the runbook inventory contract
