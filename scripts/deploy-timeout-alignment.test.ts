import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

function extractNumber(source: string, pattern: RegExp, label: string): number {
  const match = source.match(pattern);
  expect(match, `Expected ${label} in source`).not.toBeNull();
  return Number(match![1]);
}

function extractString(source: string, pattern: RegExp, label: string): string {
  const match = source.match(pattern);
  expect(match, `Expected ${label} in source`).not.toBeNull();
  return match![1]!;
}

describe("deploy timeout alignment", () => {
  test("ACA job replica timeout exceeds the maximum repo execution timeout with safety buffer", async () => {
    const [deployScript, executionConfig] = await Promise.all([
      readFile("deploy.sh", "utf8"),
      readFile("src/execution/config.ts", "utf8"),
    ]);

    const maxConfigTimeoutSeconds = extractNumber(
      executionConfig,
      /timeoutSeconds:\s*z\.number\(\)\.min\(30\)\.max\((\d+)\)\.default\(600\)/,
      "timeoutSeconds max",
    );
    const replicaTimeoutVariableName = extractString(
      deployScript,
      /replicaTimeout:\s*\$\{([A-Z0-9_]+)\}/,
      "YAML replicaTimeout variable reference",
    );
    const replicaTimeoutVariableValue = extractNumber(
      deployScript,
      new RegExp(`${replicaTimeoutVariableName}=(\\d+)`),
      `${replicaTimeoutVariableName} assignment`,
    );
    const cliReplicaTimeoutVariableName = extractString(
      deployScript,
      /--replica-timeout\s+"\$([A-Z0-9_]+)"/,
      "CLI replica timeout variable reference",
    );

    const requiredMinimumSeconds = maxConfigTimeoutSeconds + 60;

    expect(cliReplicaTimeoutVariableName).toBe(replicaTimeoutVariableName);
    expect(replicaTimeoutVariableValue).toBeGreaterThanOrEqual(requiredMinimumSeconds);
  });
});
