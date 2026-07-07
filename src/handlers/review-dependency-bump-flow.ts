import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import type { createRetriever } from "../knowledge/retrieval.ts";
import type { DependsBumpInfo } from "../lib/depends-bump-detector.ts";
import type { DepBumpContext } from "../lib/dep-bump-detector.ts";
import type { UsageAnalysisResult } from "../lib/usage-analyzer.ts";
import { buildReviewDepBumpContext } from "./review-dep-bump-context.ts";
import {
  resolveReviewDependsFlow,
  type ReviewDependsFlowResult,
} from "./review-depends-flow.ts";

type DependsRetriever = ReturnType<typeof createRetriever>;
type ResolveReviewDependsFlow = typeof resolveReviewDependsFlow;
type BuildReviewDepBumpContext = typeof buildReviewDepBumpContext;

export type ReviewDependencyBumpFlowContext = {
  action: ReviewDependsFlowResult["action"];
  dependsBumpInfo: DependsBumpInfo | null;
  depBumpContext: DepBumpContext | null;
};

export async function resolveReviewDependencyBumpFlowContext(params: {
  prTitle: string;
  prBody: string | null;
  prLabels: string[];
  headBranch: string;
  senderLogin: string;
  changedFiles: string[];
  workspaceDir: string;
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  logger: Logger | Pick<Logger, "info" | "warn">;
  baseLog: Record<string, unknown>;
  botHandles: string[];
  canPublishVisibleOutput: (reason: string) => boolean;
  setReviewWorkPhase: (phase: "publish") => void;
  retriever?: DependsRetriever | null;
  usageAnalyzer?: (params: {
    workspaceDir: string;
    packageName: string;
    breakingChangeSnippets: string[];
    ecosystem: string;
    timeBudgetMs?: number;
  }) => Promise<UsageAnalysisResult>;
  detectScopeCoordination?: (packageNames: string[]) => Array<{ scope: string; packages: string[] }>;
  resolveDependsFlow?: ResolveReviewDependsFlow;
  buildDepBumpContext?: BuildReviewDepBumpContext;
}): Promise<ReviewDependencyBumpFlowContext> {
  const resolveDependsFlow = params.resolveDependsFlow ?? resolveReviewDependsFlow;
  const buildDepBumpContext = params.buildDepBumpContext ?? buildReviewDepBumpContext;
  const dependsFlow = await resolveDependsFlow({
    prTitle: params.prTitle,
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    prNumber: params.prNumber,
    workspaceDir: params.workspaceDir,
    logger: params.logger,
    baseLog: params.baseLog,
    botHandles: params.botHandles,
    canPublishVisibleOutput: params.canPublishVisibleOutput,
    setReviewWorkPhase: params.setReviewWorkPhase,
    retriever: params.retriever,
  });

  if (dependsFlow.action === "skip-standard-review") {
    return {
      action: dependsFlow.action,
      dependsBumpInfo: dependsFlow.dependsBumpInfo,
      depBumpContext: null,
    };
  }

  const depBumpContext = await buildDepBumpContext({
    dependsBumpInfo: dependsFlow.dependsBumpInfo,
    prTitle: params.prTitle,
    prBody: params.prBody,
    prLabels: params.prLabels,
    headBranch: params.headBranch,
    senderLogin: params.senderLogin,
    changedFiles: params.changedFiles,
    workspaceDir: params.workspaceDir,
    octokit: params.octokit,
    logger: params.logger,
    baseLog: params.baseLog,
    usageAnalyzer: params.usageAnalyzer,
    detectScopeCoordination: params.detectScopeCoordination,
  });

  return {
    action: dependsFlow.action,
    dependsBumpInfo: dependsFlow.dependsBumpInfo,
    depBumpContext,
  };
}
