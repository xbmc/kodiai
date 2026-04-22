import { readFile } from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "verify:m054:s01" as const;
const QUEUE_PATH = path.resolve(import.meta.dir, "../.gsd/QUEUE.md");
const PROJECT_PATH = path.resolve(import.meta.dir, "../.gsd/PROJECT.md");
const EXPECTED_PENDING_MILESTONES = [
  "M027",
  "M028",
  "M029",
  "M031",
  "M032",
  "M053",
  "M054",
  "M055",
  "M056",
  "M057",
  "M058",
  "M059",
  "M060",
] as const;
const CLEARLY_SHIPPED_MILESTONES = [
  "M044",
  "M045",
  "M046",
  "M047",
  "M048",
  "M049",
  "M050",
  "M051",
  "M052",
] as const;

export const M054_S01_CHECK_IDS = [
  "M054-S01-PENDING-QUEUE-MEMBERSHIP",
  "M054-S01-NOT-PENDING-REDIRECT",
  "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
] as const;

export type M054S01CheckId = (typeof M054_S01_CHECK_IDS)[number];

export type Check = {
  id: M054S01CheckId;
  passed: boolean;
  skipped: boolean;
  status_code: string;
  detail?: string;
};

export type EvaluationReport = {
  command: typeof COMMAND_NAME;
  generatedAt: string;
  check_ids: readonly M054S01CheckId[];
  overallPassed: boolean;
  checks: Check[];
};

type StdWriter = {
  write: (chunk: string) => boolean | void;
};

type EvaluateOptions = {
  generatedAt?: string;
  readTextFile?: (filePath: string) => Promise<string>;
};

type BuildOptions = EvaluateOptions & {
  json?: boolean;
  stdout?: StdWriter;
  stderr?: StdWriter;
};

export async function evaluateM054S01QueueTruth(
  options: EvaluateOptions = {},
): Promise<EvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  let queueContent: string | null = null;
  let queueReadError: unknown = null;

  try {
    queueContent = await readTextFile(QUEUE_PATH);
  } catch (error) {
    queueReadError = error;
  }

  const queueMembershipCheck =
    queueContent == null
      ? failCheck(
          "M054-S01-PENDING-QUEUE-MEMBERSHIP",
          "queue_file_unreadable",
          queueReadError,
        )
      : buildPendingQueueMembershipCheck(queueContent);

  const redirectCheck =
    queueContent == null
      ? failCheck(
          "M054-S01-NOT-PENDING-REDIRECT",
          "queue_file_unreadable",
          queueReadError,
        )
      : buildNotPendingRedirectCheck(queueContent);

  const projectAlignmentCheck =
    queueContent == null
      ? failCheck(
          "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
          "queue_file_unreadable",
          queueReadError,
        )
      : await buildProjectAlignmentCheck(queueContent, readTextFile);

  const checks = [queueMembershipCheck, redirectCheck, projectAlignmentCheck];

  return {
    command: COMMAND_NAME,
    generatedAt,
    check_ids: M054_S01_CHECK_IDS,
    overallPassed: checks.every((check) => check.passed || check.skipped),
    checks,
  };
}

export function renderM054S01Report(report: EvaluationReport): string {
  const lines = [
    "M054 S01 queue truth verifier",
    `Generated at: ${report.generatedAt}`,
    `Queue truth proof surface: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
  ];

  for (const check of report.checks) {
    const verdict = check.skipped ? "SKIP" : check.passed ? "PASS" : "FAIL";
    lines.push(
      `- ${check.id} ${verdict} status_code=${check.status_code}${check.detail ? ` ${check.detail}` : ""}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function buildM054S01ProofHarness(
  options: BuildOptions = {},
): Promise<{ exitCode: number; report: EvaluationReport }> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const report = await evaluateM054S01QueueTruth(options);

  if (options.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(renderM054S01Report(report));
  }

  if (!report.overallPassed) {
    const failingCodes = report.checks
      .filter((check) => !check.passed && !check.skipped)
      .map((check) => `${check.id}:${check.status_code}`)
      .join(", ");
    stderr.write(`verify:m054:s01 failed: ${failingCodes}\n`);
  }

  return {
    exitCode: report.overallPassed ? 0 : 1,
    report,
  };
}

export function parseM054S01Args(args: readonly string[]): { json: boolean } {
  let json = false;

  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }

    throw new Error(`invalid_cli_args: Unknown argument: ${arg}`);
  }

  return { json };
}

function buildPendingQueueMembershipCheck(queueContent: string): Check {
  const pendingSection = extractSection(queueContent, "Pending Milestones", "Not Pending");

  if (pendingSection == null) {
    return failCheck(
      "M054-S01-PENDING-QUEUE-MEMBERSHIP",
      "pending_section_missing",
      "QUEUE.md is missing the '## Pending Milestones' section.",
    );
  }

  const actualMilestones = extractMilestoneIds(pendingSection);
  const expectedMilestones = [...EXPECTED_PENDING_MILESTONES];
  const missing = expectedMilestones.filter((milestone) => !actualMilestones.includes(milestone));
  const unexpected = actualMilestones.filter(
    (milestone) => !expectedMilestones.includes(milestone as (typeof EXPECTED_PENDING_MILESTONES)[number]),
  );

  if (missing.length > 0 || unexpected.length > 0) {
    return failCheck(
      "M054-S01-PENDING-QUEUE-MEMBERSHIP",
      "pending_queue_membership_mismatch",
      [
        missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
        unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  return passCheck(
    "M054-S01-PENDING-QUEUE-MEMBERSHIP",
    "pending_queue_membership_ok",
    `Pending milestones match expected set: ${expectedMilestones.join(", ")}`,
  );
}

function buildNotPendingRedirectCheck(queueContent: string): Check {
  const notPendingSection = extractSection(queueContent, "Not Pending");

  if (notPendingSection == null) {
    return failCheck(
      "M054-S01-NOT-PENDING-REDIRECT",
      "not_pending_section_missing",
      "QUEUE.md is missing the '## Not Pending' section.",
    );
  }

  if (!notPendingSection.includes(".gsd/PROJECT.md")) {
    return failCheck(
      "M054-S01-NOT-PENDING-REDIRECT",
      "not_pending_redirect_missing_project_reference",
      "Not Pending section must redirect completed-history lookups to .gsd/PROJECT.md.",
    );
  }

  return passCheck(
    "M054-S01-NOT-PENDING-REDIRECT",
    "not_pending_redirect_present",
    "Not Pending section redirects completed-history lookups to .gsd/PROJECT.md.",
  );
}

async function buildProjectAlignmentCheck(
  queueContent: string,
  readTextFile: (filePath: string) => Promise<string>,
): Promise<Check> {
  const pendingSection = extractSection(queueContent, "Pending Milestones", "Not Pending");
  if (pendingSection == null) {
    return failCheck(
      "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
      "pending_section_missing",
      "QUEUE.md is missing the '## Pending Milestones' section.",
    );
  }

  let projectContent: string;
  try {
    projectContent = await readTextFile(PROJECT_PATH);
  } catch (error) {
    return failCheck(
      "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
      "project_file_unreadable",
      error,
    );
  }

  const pendingMilestones = extractMilestoneIds(pendingSection);
  const shippedMilestones = extractProjectCompleteMilestoneIds(projectContent).filter((milestone) =>
    CLEARLY_SHIPPED_MILESTONES.includes(
      milestone as (typeof CLEARLY_SHIPPED_MILESTONES)[number],
    ),
  );
  const stalePending = pendingMilestones.filter((milestone) => shippedMilestones.includes(milestone));

  if (stalePending.length > 0) {
    return failCheck(
      "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
      "project_shipped_milestone_still_pending",
      `Pending section still lists shipped milestones: ${stalePending.join(", ")}`,
    );
  }

  return passCheck(
    "M054-S01-PROJECT-SHIPPED-MILESTONE-ALIGNMENT",
    "project_shipped_alignment_ok",
    `No clearly shipped milestones from .gsd/PROJECT.md remain in the pending queue (${shippedMilestones.length} milestones checked: ${CLEARLY_SHIPPED_MILESTONES.join(", ")}).`,
  );
}

function extractSection(content: string, heading: string, untilHeading?: string): string | null {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);

  if (startIndex === -1) {
    return null;
  }

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (untilHeading != null && line.trim() === `## ${untilHeading}`) {
      break;
    }
    collected.push(line);
  }

  return collected.join("\n").trim();
}

function extractMilestoneIds(content: string): string[] {
  return Array.from(content.matchAll(/^###\s+(M\d{3})\b/gm), (match) => match[1]).filter(
    (milestone): milestone is string => milestone != null,
  );
}

function extractProjectCompleteMilestoneIds(projectContent: string): string[] {
  const shipped = new Set<string>();
  const milestoneSequenceSection = extractSection(projectContent, "Milestone Sequence", "Queued GitHub Backlog");

  if (milestoneSequenceSection != null) {
    for (const match of milestoneSequenceSection.matchAll(/^- \[x\]\s+(M\d{3})\b/gm)) {
      const milestoneId = match[1];
      if (milestoneId != null) {
        shipped.add(milestoneId);
      }
    }
  }

  for (const line of projectContent.split(/\r?\n/)) {
    if (!/complete|shipped|merged and deployed/i.test(line)) {
      continue;
    }

    for (const match of line.matchAll(/M\d{3}/g)) {
      const milestoneId = match[0];
      if (milestoneId != null) {
        shipped.add(milestoneId);
      }
    }
  }

  return [...shipped].sort((left, right) => left.localeCompare(right));
}

function passCheck(id: M054S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: true,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function failCheck(id: M054S01CheckId, status_code: string, detail?: unknown): Check {
  return {
    id,
    passed: false,
    skipped: false,
    status_code,
    detail: detail == null ? undefined : normalizeDetail(detail),
  };
}

function normalizeDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return detail.message;
  }
  if (typeof detail === "string") {
    return detail;
  }
  return String(detail);
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

if (import.meta.main) {
  try {
    const args = parseM054S01Args(process.argv.slice(2));
    const { exitCode } = await buildM054S01ProofHarness(args);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify:m054:s01 failed: ${message}\n`);
    process.exit(1);
  }
}
