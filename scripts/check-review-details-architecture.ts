import { readFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..");

export const CHECK_REVIEW_DETAILS_ARCHITECTURE_IDS = [
  "CANDIDATE-FORMATTER-OWNERSHIP",
  "TYPED-CANDIDATE-PUBLICATION",
  "SECTION-ORIENTED-ASSEMBLY",
] as const;

export type ReviewDetailsArchitectureCheckId = typeof CHECK_REVIEW_DETAILS_ARCHITECTURE_IDS[number];

export type ReviewDetailsArchitectureCheck = {
  id: ReviewDetailsArchitectureCheckId;
  passed: boolean;
  status_code: string;
  detail: string;
};

export type ReviewDetailsArchitectureReport = {
  command: "check-review-details-architecture";
  generatedAt: string;
  check_ids: readonly ReviewDetailsArchitectureCheckId[];
  overallPassed: boolean;
  checks: ReviewDetailsArchitectureCheck[];
};

type ReviewDetailsArchitectureSources = {
  "src/lib/review-details-candidate-formatting.ts": string;
  "src/lib/review-details-candidate-publication-formatting.ts": string;
  "src/lib/review-details-formatting.ts": string;
};

type EvaluateOptions = {
  generatedAt?: string;
  files: ReviewDetailsArchitectureSources;
};

const OWNED_CANDIDATE_FORMATTERS = [
  "review-details-candidate-finding-formatting.ts",
  "review-details-candidate-publication-formatting.ts",
  "review-details-candidate-bridge-formatting.ts",
  "review-details-candidate-verification-formatting.ts",
] as const;

const SECTION_HELPERS = [
  "formatPublicationDiagnosticsSection",
  "formatCoreReviewDetailsSection",
  "formatLargePrTriageSection",
] as const;

export function evaluateReviewDetailsArchitecture(
  options: EvaluateOptions,
): ReviewDetailsArchitectureReport {
  const { files } = options;
  const checks = [
    checkCandidateFormatterOwnership(files["src/lib/review-details-candidate-formatting.ts"]),
    checkTypedCandidatePublication(files["src/lib/review-details-candidate-publication-formatting.ts"]),
    checkSectionOrientedAssembly(files["src/lib/review-details-formatting.ts"]),
  ];

  return {
    command: "check-review-details-architecture",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    check_ids: CHECK_REVIEW_DETAILS_ARCHITECTURE_IDS,
    overallPassed: checks.every((check) => check.passed),
    checks,
  };
}

export async function evaluateReviewDetailsArchitectureFromDisk(
  generatedAt = new Date().toISOString(),
): Promise<ReviewDetailsArchitectureReport> {
  const files: ReviewDetailsArchitectureSources = {
    "src/lib/review-details-candidate-formatting.ts": await readRepoFile("src/lib/review-details-candidate-formatting.ts"),
    "src/lib/review-details-candidate-publication-formatting.ts": await readRepoFile("src/lib/review-details-candidate-publication-formatting.ts"),
    "src/lib/review-details-formatting.ts": await readRepoFile("src/lib/review-details-formatting.ts"),
  };
  return evaluateReviewDetailsArchitecture({ generatedAt, files });
}

export function renderReviewDetailsArchitectureReport(
  report: ReviewDetailsArchitectureReport,
): string {
  return [
    "Review Details architecture gate",
    `Generated at: ${report.generatedAt}`,
    `Review Details architecture gate: ${report.overallPassed ? "PASS" : "FAIL"}`,
    "Checks:",
    ...report.checks.map((check) => `- ${check.id} ${check.passed ? "PASS" : "FAIL"} status_code=${check.status_code} ${check.detail}`),
    "",
  ].join("\n");
}

function checkCandidateFormatterOwnership(source: string): ReviewDetailsArchitectureCheck {
  const hasOwnedModules = OWNED_CANDIDATE_FORMATTERS.every((modulePath) => source.includes(modulePath));
  const hasCollapsedFormatterLogic = /function\s+formatCandidate(?:PublicationBridge|VerificationPublicationEvidence)Line/.test(source)
    || /function\s+formatReviewCandidate(?:Finding|Publication)DetailsLine/.test(source);

  if (!hasOwnedModules || hasCollapsedFormatterLogic) {
    return failCheck(
      "CANDIDATE-FORMATTER-OWNERSHIP",
      "candidate_formatter_ownership_collapsed",
      "Candidate Review Details formatting must stay split by finding, publication, bridge, and verification ownership.",
    );
  }

  return passCheck(
    "CANDIDATE-FORMATTER-OWNERSHIP",
    "candidate_formatter_ownership_ok",
    "Candidate formatter barrel delegates to focused ownership modules.",
  );
}

function checkTypedCandidatePublication(source: string): ReviewDetailsArchitectureCheck {
  const consumesTypedSummary = /ReviewCandidatePublicationRuntimeDetailsSummary/.test(source);
  const hasLooseBoundary = /\bRecord<|\bas\s+Record|\bas\s+unknown\b|:\s*unknown\b|<[^>\n]*\bunknown\b/.test(source);

  if (!consumesTypedSummary || hasLooseBoundary) {
    return failCheck(
      "TYPED-CANDIDATE-PUBLICATION",
      "candidate_publication_boundary_loose",
      "Candidate publication formatting must consume the typed public runtime summary without local Record/unknown recasting.",
    );
  }

  return passCheck(
    "TYPED-CANDIDATE-PUBLICATION",
    "candidate_publication_boundary_typed",
    "Candidate publication formatter consumes the typed public runtime summary directly.",
  );
}

function checkSectionOrientedAssembly(source: string): ReviewDetailsArchitectureCheck {
  const hasSectionHelpers = SECTION_HELPERS.every((helper) => source.includes(helper));
  const hasInlineLargePrBranch = source.includes("largePRTriage.mentionOnlyFiles.length");

  if (!hasSectionHelpers || hasInlineLargePrBranch) {
    return failCheck(
      "SECTION-ORIENTED-ASSEMBLY",
      "review_details_assembly_spaghetti",
      "formatReviewDetailsSummary must remain section orchestration, with bulky branches behind focused section helpers.",
    );
  }

  return passCheck(
    "SECTION-ORIENTED-ASSEMBLY",
    "review_details_assembly_section_oriented",
    "Review Details final assembly delegates to focused section helpers.",
  );
}

function passCheck(
  id: ReviewDetailsArchitectureCheckId,
  statusCode: string,
  detail: string,
): ReviewDetailsArchitectureCheck {
  return { id, passed: true, status_code: statusCode, detail };
}

function failCheck(
  id: ReviewDetailsArchitectureCheckId,
  statusCode: string,
  detail: string,
): ReviewDetailsArchitectureCheck {
  return { id, passed: false, status_code: statusCode, detail };
}

async function readRepoFile(repoPath: keyof ReviewDetailsArchitectureSources): Promise<string> {
  return readFile(path.resolve(REPO_ROOT, repoPath), "utf8");
}

if (import.meta.main) {
  const report = await evaluateReviewDetailsArchitectureFromDisk();
  process.stdout.write(renderReviewDetailsArchitectureReport(report));
  process.exit(report.overallPassed ? 0 : 1);
}
