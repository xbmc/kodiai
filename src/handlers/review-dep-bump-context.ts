import type { Logger } from "pino";
import type { Octokit } from "@octokit/rest";
import type { DependsBumpInfo } from "../lib/depends-bump-detector.ts";
import type { ChangelogContext, SecurityContext } from "../lib/dep-bump-enrichment.ts";
import type { UsageAnalysisResult } from "../lib/usage-analyzer.ts";
import {
  classifyDepBump,
  detectDepBump,
  extractDepBumpDetails,
  type DepBumpContext,
} from "../lib/dep-bump-detector.ts";
import {
  fetchChangelog as fetchChangelogDefault,
  fetchSecurityAdvisories as fetchSecurityAdvisoriesDefault,
} from "../lib/dep-bump-enrichment.ts";
import { analyzePackageUsage as analyzePackageUsageDefault } from "../lib/usage-analyzer.ts";
import { detectScopeCoordination as detectScopeCoordinationDefault } from "../lib/scope-coordinator.ts";
import { computeMergeConfidence } from "../lib/merge-confidence.ts";

export async function buildReviewDepBumpContext(params: {
  dependsBumpInfo: DependsBumpInfo | null;
  prTitle: string;
  prBody: string | null;
  prLabels: string[];
  headBranch: string;
  senderLogin: string;
  changedFiles: string[];
  workspaceDir: string;
  octokit: Octokit;
  logger: Pick<Logger, "info" | "warn">;
  baseLog: Record<string, unknown>;
  usageAnalyzer?: (params: {
    workspaceDir: string;
    packageName: string;
    breakingChangeSnippets: string[];
    ecosystem: string;
    timeBudgetMs?: number;
  }) => Promise<UsageAnalysisResult>;
  fetchSecurityAdvisories?: (params: {
    packageName: string;
    ecosystem: string;
    oldVersion: string | null;
    newVersion: string | null;
    octokit: Octokit;
    timeoutMs?: number;
  }) => Promise<SecurityContext | null>;
  fetchChangelog?: (params: {
    packageName: string;
    ecosystem: string;
    oldVersion: string | null;
    newVersion: string | null;
    octokit: Octokit;
    timeoutMs?: number;
  }) => Promise<ChangelogContext | null>;
  detectScopeCoordination?: (packageNames: string[]) => Array<{ scope: string; packages: string[] }>;
}): Promise<DepBumpContext | null> {
  if (params.dependsBumpInfo) {
    return null;
  }

  let depBumpContext: DepBumpContext | null = null;
  try {
    const detection = detectDepBump({
      prTitle: params.prTitle,
      prLabels: params.prLabels,
      headBranch: params.headBranch,
      senderLogin: params.senderLogin,
    });
    if (detection) {
      const details = extractDepBumpDetails({
        detection,
        prTitle: params.prTitle,
        prBody: params.prBody,
        changedFiles: params.changedFiles,
        headBranch: params.headBranch,
      });
      const classification = classifyDepBump({
        oldVersion: details.oldVersion,
        newVersion: details.newVersion,
      });
      depBumpContext = { detection, details, classification };
      params.logger.info(
        {
          ...params.baseLog,
          gate: "dep-bump-detect",
          source: detection.source,
          signals: detection.signals,
          packageName: details.packageName,
          ecosystem: details.ecosystem,
          bumpType: classification.bumpType,
          isGroup: details.isGroup,
        },
        "Dependency bump detected",
      );
    }
  } catch (err) {
    params.logger.warn({ ...params.baseLog, err }, "Dep bump detection failed (fail-open)");
  }

  if (depBumpContext && depBumpContext.details.packageName && !depBumpContext.details.isGroup) {
    try {
      const fetchSecurityAdvisories = params.fetchSecurityAdvisories ?? fetchSecurityAdvisoriesDefault;
      const fetchChangelog = params.fetchChangelog ?? fetchChangelogDefault;
      const [secResult, clogResult] = await Promise.allSettled([
        fetchSecurityAdvisories({
          packageName: depBumpContext.details.packageName,
          ecosystem: depBumpContext.details.ecosystem ?? "npm",
          oldVersion: depBumpContext.details.oldVersion,
          newVersion: depBumpContext.details.newVersion,
          octokit: params.octokit,
          timeoutMs: 4000,
        }),
        fetchChangelog({
          packageName: depBumpContext.details.packageName,
          ecosystem: depBumpContext.details.ecosystem ?? "npm",
          oldVersion: depBumpContext.details.oldVersion,
          newVersion: depBumpContext.details.newVersion,
          octokit: params.octokit,
          timeoutMs: 4000,
        }),
      ]);
      depBumpContext.security = secResult.status === "fulfilled" ? secResult.value : null;
      depBumpContext.changelog = clogResult.status === "fulfilled" ? clogResult.value : null;

      params.logger.info({
        ...params.baseLog,
        gate: "dep-bump-enrich",
        hasAdvisories: (depBumpContext.security?.advisories?.length ?? 0) > 0,
        isSecurityBump: depBumpContext.security?.isSecurityBump ?? false,
        changelogSource: depBumpContext.changelog?.source ?? null,
        breakingChanges: depBumpContext.changelog?.breakingChanges?.length ?? 0,
      }, "Dep bump enrichment complete");
    } catch (err) {
      params.logger.warn({ ...params.baseLog, err, gate: "dep-bump-enrich" }, "Dep bump enrichment failed (fail-open)");
    }
  }

  if (depBumpContext) {
    depBumpContext.mergeConfidence = computeMergeConfidence(depBumpContext);
    params.logger.info({
      ...params.baseLog,
      gate: "merge-confidence",
      level: depBumpContext.mergeConfidence.level,
      rationale: depBumpContext.mergeConfidence.rationale,
    }, "Merge confidence computed");
  }

  if (
    depBumpContext &&
    depBumpContext.details.packageName &&
    !depBumpContext.details.isGroup &&
    (depBumpContext.changelog?.breakingChanges?.length ?? 0) > 0
  ) {
    depBumpContext.usageEvidence = null;
    const packageName = depBumpContext.details.packageName;
    const breakingChangeSnippets = depBumpContext.changelog?.breakingChanges ?? [];

    try {
      const analyzer = params.usageAnalyzer ?? analyzePackageUsageDefault;
      const result = await analyzer({
        workspaceDir: params.workspaceDir,
        packageName,
        breakingChangeSnippets,
        ecosystem: depBumpContext.details.ecosystem ?? "npm",
        timeBudgetMs: 3000,
      });

      depBumpContext.usageEvidence = result;

      params.logger.info(
        {
          ...params.baseLog,
          gate: "usage-analysis",
          evidenceCount: result.evidence.length,
          timedOut: result.timedOut,
          searchTerms: result.searchTerms,
        },
        "Workspace usage analysis complete",
      );
    } catch (err) {
      depBumpContext.usageEvidence = null;
      params.logger.warn(
        { ...params.baseLog, gate: "usage-analysis", err },
        "Workspace usage analysis failed (fail-open)",
      );
    }
  }

  if (depBumpContext && depBumpContext.details.isGroup) {
    depBumpContext.scopeGroups = null;

    try {
      const matches = (params.prBody ?? "").match(/@[\w-]+\/[\w.-]+/g) ?? [];
      const packageNames = Array.from(new Set(matches));

      if (packageNames.length > 0) {
        const coordinator = params.detectScopeCoordination ?? detectScopeCoordinationDefault;
        const groups = coordinator(packageNames);
        if (groups.length > 0) {
          depBumpContext.scopeGroups = groups;
          params.logger.info(
            {
              ...params.baseLog,
              gate: "scope-coordination",
              groupCount: groups.length,
            },
            "Scope coordination groups detected",
          );
        }
      }
    } catch (err) {
      depBumpContext.scopeGroups = null;
      params.logger.warn(
        { ...params.baseLog, gate: "scope-coordination", err },
        "Scope coordination detection failed (fail-open)",
      );
    }
  }

  return depBumpContext;
}
