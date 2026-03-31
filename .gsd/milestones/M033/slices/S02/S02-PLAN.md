# S02: Add Anthropic token patterns to outgoing secret scan

**Goal:** Add sk-ant-oat01- and sk-ant-api03- regex patterns to scanOutgoingForSecrets so any outgoing text containing an Anthropic token is blocked.
**Demo:** After this: bun test ./src/lib/sanitizer.test.ts passes with new pattern assertions.

## Tasks
