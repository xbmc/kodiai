import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { EvaluationReport } from "./verify-m055-s03.ts";
import {
  M055_S03_CHECK_IDS,
  buildM055S03ProofHarness,
  evaluateM055S03DocsTruth,
  parseM055S03Args,
  renderM055S03Report,
} from "./verify-m055-s03.ts";

const EXPECTED_CHECK_IDS = [
  "M055-S03-DOCS-INDEX-INVENTORY",
  "M055-S03-REQUIRED-RUNBOOKS-PRESENT",
  "M055-S03-RUNBOOK-COMMAND-REFERENCES",
  "M055-S03-PACKAGE-WIRING",
] as const;

const DOC_PATHS = [
  "docs/INDEX.md",
  "docs/architecture.md",
  "docs/configuration.md",
  "docs/deployment.md",
  "docs/GRACEFUL-RESTART-RUNBOOK.md",
  "docs/guardrails.md",
  "docs/issue-intelligence.md",
  "docs/knowledge-system.md",
  "docs/m029-s04-ops-runbook.md",
  "docs/operations/embedding-integrity.md",
  "docs/README.md",
  "docs/runbooks/aca-job-debugging.md",
  "docs/runbooks/deploy-rollback.md",
  "docs/runbooks/key-rotation.md",
  "docs/runbooks/mentions.md",
  "docs/runbooks/nightly-sync-failures.md",
  "docs/runbooks/recent-review-audit.md",
  "docs/runbooks/review-requested-debug.md",
  "docs/runbooks/scale.md",
  "docs/runbooks/slack-integration.md",
  "docs/runbooks/xbmc-cutover.md",
  "docs/runbooks/xbmc-ops.md",
  "docs/smoke/phase27-uat-notes.md",
  "docs/smoke/phase72-telemetry-follow-through.md",
  "docs/smoke/phase74-reliability-regression-gate.md",
  "docs/smoke/phase75-live-ops-verification-closure.md",
  "docs/smoke/phase80-slack-operator-hardening.md",
  "docs/smoke/xbmc-kodiai-write-flow.md",
  "docs/smoke/xbmc-xbmc-write-flow.md",
] as const;

const REQUIRED_RUNBOOKS = [
  "docs/runbooks/deploy-rollback.md",
  "docs/runbooks/key-rotation.md",
  "docs/runbooks/aca-job-debugging.md",
  "docs/runbooks/nightly-sync-failures.md",
] as const;

const PASSING_INDEX = `# Documentation Index

This file is the canonical inventory for the checked-in \`docs/\` tree.

## Inventory

- [\`docs/INDEX.md\`](INDEX.md)
- [\`docs/architecture.md\`](architecture.md)
- [\`docs/configuration.md\`](configuration.md)
- [\`docs/deployment.md\`](deployment.md)
- [\`docs/GRACEFUL-RESTART-RUNBOOK.md\`](GRACEFUL-RESTART-RUNBOOK.md)
- [\`docs/guardrails.md\`](guardrails.md)
- [\`docs/issue-intelligence.md\`](issue-intelligence.md)
- [\`docs/knowledge-system.md\`](knowledge-system.md)
- [\`docs/m029-s04-ops-runbook.md\`](m029-s04-ops-runbook.md)
- [\`docs/operations/embedding-integrity.md\`](operations/embedding-integrity.md)
- [\`docs/README.md\`](README.md)
- [\`docs/runbooks/aca-job-debugging.md\`](runbooks/aca-job-debugging.md)
- [\`docs/runbooks/deploy-rollback.md\`](runbooks/deploy-rollback.md)
- [\`docs/runbooks/key-rotation.md\`](runbooks/key-rotation.md)
- [\`docs/runbooks/mentions.md\`](runbooks/mentions.md)
- [\`docs/runbooks/nightly-sync-failures.md\`](runbooks/nightly-sync-failures.md)
- [\`docs/runbooks/recent-review-audit.md\`](runbooks/recent-review-audit.md)
- [\`docs/runbooks/review-requested-debug.md\`](runbooks/review-requested-debug.md)
- [\`docs/runbooks/scale.md\`](runbooks/scale.md)
- [\`docs/runbooks/slack-integration.md\`](runbooks/slack-integration.md)
- [\`docs/runbooks/xbmc-cutover.md\`](runbooks/xbmc-cutover.md)
- [\`docs/runbooks/xbmc-ops.md\`](runbooks/xbmc-ops.md)
- [\`docs/smoke/phase27-uat-notes.md\`](smoke/phase27-uat-notes.md)
- [\`docs/smoke/phase72-telemetry-follow-through.md\`](smoke/phase72-telemetry-follow-through.md)
- [\`docs/smoke/phase74-reliability-regression-gate.md\`](smoke/phase74-reliability-regression-gate.md)
- [\`docs/smoke/phase75-live-ops-verification-closure.md\`](smoke/phase75-live-ops-verification-closure.md)
- [\`docs/smoke/phase80-slack-operator-hardening.md\`](smoke/phase80-slack-operator-hardening.md)
- [\`docs/smoke/xbmc-kodiai-write-flow.md\`](smoke/xbmc-kodiai-write-flow.md)
- [\`docs/smoke/xbmc-xbmc-write-flow.md\`](smoke/xbmc-xbmc-write-flow.md)
`;

const PASSING_DEPLOY_ROLLBACK = `# Deploy and Rollback Runbook

Use \`az containerapp revision list\` to inspect revisions.
Use \`az containerapp ingress traffic set\` to move traffic.
Use \`bun run src/db/migrate.ts down <version>\` for bounded DB rollback.
Use \`bun run verify:m055:s03\` as the docs proof command.
`;

const PASSING_KEY_ROTATION = `# Key Rotation Runbook

Redeploy with \`./deploy.sh\`.
Inspect app state with \`az containerapp show\` and job state with \`az containerapp job show\`.
Use \`gh workflow run nightly-issue-sync.yml\` after rotating workflow secrets.
Confirm embedding surfaces with \`bun run audit:embeddings --json\` and \`bun run repair:embeddings -- --status --corpus review_comments --json\`.
`;

const PASSING_ACA_JOB_DEBUGGING = `# ACA Job Debugging Runbook

Read the mounted workspace with \`ls -la /mnt/kodiai-workspaces/<job-dir>\` and \`cat /mnt/kodiai-workspaces/<job-dir>/result.json\`.
Use \`bun run scripts/test-aca-job.ts --live\` for the live smoke proof.
Inspect executions with \`az containerapp job execution list\`, \`az containerapp job execution show\`, and the pure-code contract check \`bun run scripts/test-aca-job.ts\`.
`;

const PASSING_NIGHTLY_SYNC_FAILURES = `# Nightly Sync Failures Runbook

Issue sync runs \`bun scripts/backfill-issues.ts --sync\`.
Reaction sync runs \`bun scripts/sync-triage-reactions.ts\`.
Manual reruns use \`gh workflow run nightly-issue-sync.yml\` and \`gh workflow run nightly-reaction-sync.yml\`.
Follow-up commands include \`bun run repair:embeddings -- --corpus issues --status --json\`, \`bun run repair:embeddings -- --corpus issue_comments --status --json\`, and \`bun scripts/sync-triage-reactions.ts --days 7 --dry-run\`.
`;

const PASSING_PACKAGE_JSON = JSON.stringify(
  {
    name: "kodiai",
    scripts: {
      "audit:embeddings": "bun scripts/embedding-audit.ts",
      "repair:embeddings": "bun scripts/embedding-repair.ts",
      "verify:m055:s03": "bun scripts/verify-m055-s03.ts",
    },
  },
  null,
  2,
);

describe("verify m055 s03 docs/runbooks verifier", () => {
  test("exports stable check ids and cli parsing", () => {
    expect(M055_S03_CHECK_IDS).toEqual(EXPECTED_CHECK_IDS);
    expect(parseM055S03Args([])).toEqual({ json: false });
    expect(parseM055S03Args(["--json"])).toEqual({ json: true });
    expect(() => parseM055S03Args(["--wat"])).toThrow(/invalid_cli_args/i);
  });

  test("passes for the current docs inventory and runbook command contract", async () => {
    const report = await evaluateM055S03DocsTruth({
      generatedAt: "2026-04-21T08:00:00.000Z",
      readTextFile: async (filePath: string) => {
        const normalized = normalize(filePath);
        if (normalized === "docs/INDEX.md") return PASSING_INDEX;
        if (normalized === "docs/runbooks/deploy-rollback.md") return PASSING_DEPLOY_ROLLBACK;
        if (normalized === "docs/runbooks/key-rotation.md") return PASSING_KEY_ROTATION;
        if (normalized === "docs/runbooks/aca-job-debugging.md") return PASSING_ACA_JOB_DEBUGGING;
        if (normalized === "docs/runbooks/nightly-sync-failures.md") return PASSING_NIGHTLY_SYNC_FAILURES;
        if (normalized === "package.json") return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listDocsPaths: async () => [...DOC_PATHS],
      fileExists: async (filePath: string) => {
        const normalized = normalize(filePath);
        return [
          "src/db/migrate.ts",
          "scripts/backfill-issues.ts",
          "scripts/sync-triage-reactions.ts",
          "scripts/test-aca-job.ts",
        ].includes(normalized);
      },
    });

    expect(report.command).toBe("verify:m055:s03");
    expect(report.check_ids).toEqual(EXPECTED_CHECK_IDS);
    expect(report.overallPassed).toBe(true);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M055-S03-DOCS-INDEX-INVENTORY",
        passed: true,
        status_code: "docs_index_inventory_ok",
      }),
      expect.objectContaining({
        id: "M055-S03-REQUIRED-RUNBOOKS-PRESENT",
        passed: true,
        status_code: "required_runbooks_present",
      }),
      expect.objectContaining({
        id: "M055-S03-RUNBOOK-COMMAND-REFERENCES",
        passed: true,
        status_code: "runbook_command_references_ok",
      }),
      expect.objectContaining({
        id: "M055-S03-PACKAGE-WIRING",
        passed: true,
        status_code: "package_wiring_ok",
      }),
    ]);

    const rendered = renderM055S03Report(report);
    expect(rendered).toContain("Docs/runbooks proof surface: PASS");
    expect(rendered).toContain("M055-S03-DOCS-INDEX-INVENTORY PASS");
    expect(rendered).toContain("M055-S03-REQUIRED-RUNBOOKS-PRESENT PASS");
    expect(rendered).toContain("M055-S03-RUNBOOK-COMMAND-REFERENCES PASS");
    expect(rendered).toContain("M055-S03-PACKAGE-WIRING PASS");
  });

  test("fails with stable status codes for inventory drift, missing runbooks, unresolved commands, and missing wiring", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await buildM055S03ProofHarness({
      json: true,
      stdout: { write: (chunk: string) => void stdout.push(chunk) },
      stderr: { write: (chunk: string) => void stderr.push(chunk) },
      readTextFile: async (filePath: string) => {
        const normalized = normalize(filePath);
        if (normalized === "docs/INDEX.md") {
          return PASSING_INDEX.replace(
            "- [`docs/runbooks/nightly-sync-failures.md`](runbooks/nightly-sync-failures.md)\n",
            "",
          );
        }
        if (normalized === "docs/runbooks/deploy-rollback.md") {
          return PASSING_DEPLOY_ROLLBACK.replace(
            "`bun run verify:m055:s03`",
            "`bun run verify:m055:s99`",
          );
        }
        if (normalized === "docs/runbooks/key-rotation.md") {
          return PASSING_KEY_ROTATION.replace(
            "`gh workflow run nightly-issue-sync.yml`",
            "`bun scripts/missing-command.ts`",
          );
        }
        if (normalized === "docs/runbooks/aca-job-debugging.md") {
          return PASSING_ACA_JOB_DEBUGGING;
        }
        if (normalized === "docs/runbooks/nightly-sync-failures.md") {
          throw new Error("ENOENT: docs/runbooks/nightly-sync-failures.md");
        }
        if (normalized === "package.json") {
          return JSON.stringify({ name: "kodiai", scripts: {} });
        }
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listDocsPaths: async () => [...DOC_PATHS],
      fileExists: async () => false,
    });

    const report = JSON.parse(stdout.join("")) as EvaluationReport;

    expect(result.exitCode).toBe(1);
    expect(report.overallPassed).toBe(false);
    expect(report.checks).toEqual([
      expect.objectContaining({
        id: "M055-S03-DOCS-INDEX-INVENTORY",
        passed: false,
        status_code: "docs_index_inventory_missing_entries",
      }),
      expect.objectContaining({
        id: "M055-S03-REQUIRED-RUNBOOKS-PRESENT",
        passed: false,
        status_code: "required_runbooks_missing",
      }),
      expect.objectContaining({
        id: "M055-S03-RUNBOOK-COMMAND-REFERENCES",
        passed: false,
        status_code: "runbook_command_references_unresolved",
      }),
      expect.objectContaining({
        id: "M055-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_wiring_missing",
      }),
    ]);
    expect(report.checks[0]?.detail).toContain("docs/runbooks/nightly-sync-failures.md");
    expect(report.checks[1]?.detail).toContain("docs/runbooks/nightly-sync-failures.md");
    expect(report.checks[2]?.detail).toContain("verify:m055:s99");
    expect(report.checks[2]?.detail).toContain("scripts/missing-command.ts");
    expect(report.checks[3]?.detail).toContain("verify:m055:s03");
    expect(stderr.join(" ")).toContain("docs_index_inventory_missing_entries");
    expect(stderr.join(" ")).toContain("required_runbooks_missing");
    expect(stderr.join(" ")).toContain("runbook_command_references_unresolved");
    expect(stderr.join(" ")).toContain("package_wiring_missing");
  });

  test("surfaces stable malformed-input and unreadable-file failures", async () => {
    const malformed = await evaluateM055S03DocsTruth({
      readTextFile: async (filePath: string) => {
        const normalized = normalize(filePath);
        if (normalized === "docs/INDEX.md") return "# Documentation Index\n\nNo inventory here.\n";
        if (normalized === "docs/runbooks/deploy-rollback.md") return PASSING_DEPLOY_ROLLBACK;
        if (normalized === "docs/runbooks/key-rotation.md") return PASSING_KEY_ROTATION;
        if (normalized === "docs/runbooks/aca-job-debugging.md") return PASSING_ACA_JOB_DEBUGGING;
        if (normalized === "docs/runbooks/nightly-sync-failures.md") return PASSING_NIGHTLY_SYNC_FAILURES;
        if (normalized === "package.json") return "{ not valid json";
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listDocsPaths: async () => [...DOC_PATHS],
      fileExists: async (filePath: string) =>
        [
          "src/db/migrate.ts",
          "scripts/backfill-issues.ts",
          "scripts/sync-triage-reactions.ts",
          "scripts/test-aca-job.ts",
        ].includes(normalize(filePath)),
    });

    expect(malformed.checks[0]).toEqual(
      expect.objectContaining({
        id: "M055-S03-DOCS-INDEX-INVENTORY",
        passed: false,
        status_code: "docs_index_inventory_missing_entries",
      }),
    );
    expect(malformed.checks[3]).toEqual(
      expect.objectContaining({
        id: "M055-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_json_invalid",
      }),
    );

    const unreadableIndex = await evaluateM055S03DocsTruth({
      readTextFile: async (filePath: string) => {
        const normalized = normalize(filePath);
        if (normalized === "docs/INDEX.md") throw new Error("EACCES: docs/INDEX.md");
        if (normalized === "docs/runbooks/deploy-rollback.md") return PASSING_DEPLOY_ROLLBACK;
        if (normalized === "docs/runbooks/key-rotation.md") return PASSING_KEY_ROTATION;
        if (normalized === "docs/runbooks/aca-job-debugging.md") return PASSING_ACA_JOB_DEBUGGING;
        if (normalized === "docs/runbooks/nightly-sync-failures.md") return PASSING_NIGHTLY_SYNC_FAILURES;
        if (normalized === "package.json") return PASSING_PACKAGE_JSON;
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listDocsPaths: async () => [...DOC_PATHS],
      fileExists: async (filePath: string) =>
        [
          "src/db/migrate.ts",
          "scripts/backfill-issues.ts",
          "scripts/sync-triage-reactions.ts",
          "scripts/test-aca-job.ts",
        ].includes(normalize(filePath)),
    });

    expect(unreadableIndex.checks[0]).toEqual(
      expect.objectContaining({
        id: "M055-S03-DOCS-INDEX-INVENTORY",
        passed: false,
        status_code: "docs_index_unreadable",
      }),
    );

    const unreadablePackage = await evaluateM055S03DocsTruth({
      readTextFile: async (filePath: string) => {
        const normalized = normalize(filePath);
        if (normalized === "docs/INDEX.md") return PASSING_INDEX;
        if (normalized === "docs/runbooks/deploy-rollback.md") return PASSING_DEPLOY_ROLLBACK;
        if (normalized === "docs/runbooks/key-rotation.md") return PASSING_KEY_ROTATION;
        if (normalized === "docs/runbooks/aca-job-debugging.md") return PASSING_ACA_JOB_DEBUGGING;
        if (normalized === "docs/runbooks/nightly-sync-failures.md") return PASSING_NIGHTLY_SYNC_FAILURES;
        if (normalized === "package.json") throw new Error("EACCES: package.json");
        throw new Error(`Unexpected path: ${filePath}`);
      },
      listDocsPaths: async () => [...DOC_PATHS],
      fileExists: async (filePath: string) =>
        [
          "src/db/migrate.ts",
          "scripts/backfill-issues.ts",
          "scripts/sync-triage-reactions.ts",
          "scripts/test-aca-job.ts",
        ].includes(normalize(filePath)),
    });

    expect(unreadablePackage.checks[3]).toEqual(
      expect.objectContaining({
        id: "M055-S03-PACKAGE-WIRING",
        passed: false,
        status_code: "package_file_unreadable",
      }),
    );
  });

  test("wires the canonical package script", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["verify:m055:s03"]).toBe(
      "bun scripts/verify-m055-s03.ts",
    );
  });
});

function normalize(filePath: string): string {
  return filePath.split(path.sep).join("/").replace(/^.*\/((docs|package\.json|scripts|src)\/?.*)$/, "$1");
}
