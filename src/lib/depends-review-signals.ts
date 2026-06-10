import type { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { mapWithConcurrency } from "./concurrency.ts";
import type { DependsBumpInfo } from "./depends-bump-detector.ts";
import {
  detectPatchChanges,
  fetchDependsChangelog,
  parsePackageListDiff,
  parseVersionFileDiff,
  verifyHash,
} from "./depends-bump-enrichment.ts";
import { checkTransitiveDependencies, findDependencyConsumers } from "./depends-impact-analyzer.ts";
import type { DependsReviewData } from "./depends-review-builder.ts";

export type DependsReviewFile = {
  filename: string;
  status?: string;
  patch?: string;
};

export type DependsReviewSignalSet = {
  info: DependsBumpInfo;
  versionDiffs: DependsReviewData["versionDiffs"];
  changelogs: DependsReviewData["changelogs"];
  hashResults: DependsReviewData["hashResults"];
  patchChanges: DependsReviewData["patchChanges"];
  impact: DependsReviewData["impact"];
  transitive: DependsReviewData["transitive"];
  platform: string | null;
};

export type DependsReviewSignals = {
  prFiles: DependsReviewFile[];
  signals: DependsReviewSignalSet;
  hasSourceChanges: boolean;
};

export type DependsReviewSignalOptions = {
  info: DependsBumpInfo;
  prFiles: DependsReviewFile[];
  octokit: Octokit;
  owner: string;
  repo: string;
  workspaceDir?: string | null;
  logger: Logger;
  baseLog: Record<string, unknown>;
};

export type DependsReviewSignalDependencies = {
  fetchDependsChangelog: typeof fetchDependsChangelog;
  verifyHash: typeof verifyHash;
  detectPatchChanges: typeof detectPatchChanges;
  findDependencyConsumers: typeof findDependencyConsumers;
  checkTransitiveDependencies: typeof checkTransitiveDependencies;
};

const DEFAULT_DEPENDS_REVIEW_SIGNAL_DEPENDENCIES: DependsReviewSignalDependencies = {
  fetchDependsChangelog,
  verifyHash,
  detectPatchChanges,
  findDependencyConsumers,
  checkTransitiveDependencies,
};

const DEPENDS_BUILD_CONFIG_PATHS = [
  "tools/depends/",
  "cmake/modules/",
  "project/BuildDependencies/",
  "project/cmake/",
];

export function hasNonDependsSourceChanges(prFiles: DependsReviewFile[]): boolean {
  return prFiles.some((file) =>
    !DEPENDS_BUILD_CONFIG_PATHS.some((prefix) => file.filename.startsWith(prefix))
    && !file.filename.toUpperCase().includes("VERSION")
    && !file.filename.endsWith(".patch")
  );
}

export function buildDependsVersionDiffs(
  info: DependsBumpInfo,
  prFiles: DependsReviewFile[],
  logger: Logger,
  baseLog: Record<string, unknown>,
): DependsReviewData["versionDiffs"] {
  const packageListEntriesByName = new Map<string, ReturnType<typeof parsePackageListDiff>[number]>();
  for (const listFile of prFiles) {
    if (!listFile.patch || !listFile.filename.toLowerCase().includes("0_package.target")) {
      continue;
    }
    for (const entry of parsePackageListDiff(listFile.patch)) {
      packageListEntriesByName.set(entry.name.toLowerCase(), entry);
    }
  }

  const normalizedVersionFiles = prFiles
    .map((file) => ({
      file,
      lowerFilename: file.filename.toLowerCase(),
      upperFilename: file.filename.toUpperCase(),
    }))
    .filter(({ upperFilename }) => upperFilename.includes("VERSION"));

  const versionDiffs = info.packages.map((pkg) => {
    const packageName = pkg.name.toLowerCase();
    const versionFile = normalizedVersionFiles.find(({ lowerFilename }) =>
      lowerFilename.includes(packageName)
    );
    const versionFileDiff = versionFile?.file.patch ? parseVersionFileDiff(versionFile.file.patch) : null;
    return {
      packageName: pkg.name,
      oldVersion: versionFileDiff?.oldVersion ?? pkg.oldVersion ?? null,
      newVersion: versionFileDiff?.newVersion ?? pkg.newVersion ?? null,
      versionFileDiff,
    };
  });

  for (const versionDiff of versionDiffs) {
    if (versionDiff.oldVersion || versionDiff.newVersion) continue;
    const packageListEntry = packageListEntriesByName.get(versionDiff.packageName.toLowerCase());
    if (!packageListEntry) continue;

    versionDiff.oldVersion = packageListEntry.oldVersion;
    versionDiff.newVersion = packageListEntry.newVersion;
    logger.info(
      { ...baseLog, gate: "depends-list-fallback", packageName: versionDiff.packageName },
      "[depends] extracted version from .list file for " + versionDiff.packageName,
    );
  }

  return versionDiffs;
}

export function buildDependsReviewData(
  signals: DependsReviewSignalSet,
  context: Pick<DependsReviewData, "retrievalContext" | "contextSummary">,
): DependsReviewData {
  return {
    ...signals,
    retrievalContext: context.retrievalContext,
    contextSummary: context.contextSummary,
  };
}

export function createDependsReviewSignalCollector(
  dependencyOverrides: Partial<DependsReviewSignalDependencies> = {},
): (opts: DependsReviewSignalOptions) => Promise<DependsReviewSignals> {
  const dependencies = {
    ...DEFAULT_DEPENDS_REVIEW_SIGNAL_DEPENDENCIES,
    ...dependencyOverrides,
  };

  return async function collectDependsReviewSignalsWithDependencies(
    opts: DependsReviewSignalOptions,
  ): Promise<DependsReviewSignals> {
    const { info, prFiles, octokit, owner, repo, workspaceDir, logger, baseLog } = opts;
    const versionDiffs = buildDependsVersionDiffs(info, prFiles, logger, baseLog);
    const versionDiffByPackage = new Map(versionDiffs.map((versionDiff) => [
      versionDiff.packageName.toLowerCase(),
      versionDiff,
    ]));

    const collectChangelogs = () => mapWithConcurrency(info.packages, 4, async (pkg) => {
      const versionDiff = versionDiffByPackage.get(pkg.name.toLowerCase());
      const changelog = await dependencies.fetchDependsChangelog({
        libraryName: pkg.name,
        oldVersion: versionDiff?.oldVersion ?? pkg.oldVersion ?? "",
        newVersion: versionDiff?.newVersion ?? pkg.newVersion ?? "",
        octokit,
        timeoutMs: 4000,
        versionFileDiff: versionDiff?.versionFileDiff ?? null,
      });
      return { packageName: pkg.name, changelog };
    });

    const collectHashResults = () => mapWithConcurrency(versionDiffs, 4, async (versionDiff) => {
      if (!versionDiff.versionFileDiff?.newSha512) {
        return {
          packageName: versionDiff.packageName,
          result: { status: "skipped" as const, detail: "No hash in VERSION file" },
        };
      }

      const archiveUrl = versionDiff.versionFileDiff.newBaseUrl && versionDiff.versionFileDiff.newArchive
        ? `${versionDiff.versionFileDiff.newBaseUrl}/${versionDiff.versionFileDiff.newArchive}`
        : null;
      if (!archiveUrl) {
        return {
          packageName: versionDiff.packageName,
          result: { status: "skipped" as const, detail: "Cannot construct download URL" },
        };
      }

      return {
        packageName: versionDiff.packageName,
        result: await dependencies.verifyHash({
          url: archiveUrl,
          expectedSha512: versionDiff.versionFileDiff.newSha512,
          timeoutMs: 5000,
        }),
      };
    });

    const collectImpactSignals = async (): Promise<Pick<DependsReviewSignalSet, "impact" | "transitive">> => {
      const primaryPackage = info.packages[0];
      if (!workspaceDir || !primaryPackage) {
        return { impact: null, transitive: null };
      }
      try {
        const [impact, transitive] = await Promise.all([
          dependencies.findDependencyConsumers({
            workspaceDir,
            libraryName: primaryPackage.name,
            octokit,
            owner,
            repo,
            timeBudgetMs: 3000,
          }),
          dependencies.checkTransitiveDependencies({
            libraryName: primaryPackage.name,
            octokit,
            owner,
            repo,
          }),
        ]);
        return { impact, transitive };
      } catch (err) {
        logger.warn({ ...baseLog, err, gate: "depends-impact" }, "Impact analysis failed (fail-open)");
        return { impact: null, transitive: null };
      }
    };

    const [changelogs, hashResults, patchChanges, impactSignals] = await Promise.all([
      collectChangelogs(),
      collectHashResults(),
      Promise.resolve(dependencies.detectPatchChanges(
        prFiles.filter((file): file is DependsReviewFile & { status: string } => !!file.status),
      )),
      collectImpactSignals(),
    ]);

    return {
      prFiles,
      signals: {
        info,
        versionDiffs,
        changelogs,
        hashResults,
        patchChanges,
        impact: impactSignals.impact,
        transitive: impactSignals.transitive,
        platform: info.platform,
      },
      hasSourceChanges: hasNonDependsSourceChanges(prFiles),
    };
  };
}

export const collectDependsReviewSignals = createDependsReviewSignalCollector();
