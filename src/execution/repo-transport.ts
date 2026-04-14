export type BundleAllRepoTransport = {
  kind: "bundle-all";
  bundlePath: string;
  originUrl?: string;
};

export type ReviewBundleRepoTransport = {
  kind: "review-bundle";
  bundlePath: string;
  headRef: string;
  baseRef: string;
  originUrl?: string;
};

export type RepoTransport = BundleAllRepoTransport | ReviewBundleRepoTransport;

function readRequiredString(
  value: unknown,
  fieldName: string,
  kind: RepoTransport["kind"],
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid repoTransport metadata: ${kind} transport requires ${fieldName}`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function resolveRepoTransport(config: {
  repoTransport?: unknown;
  repoBundlePath?: string;
  repoOriginUrl?: string;
}): RepoTransport | undefined {
  if (config.repoTransport === undefined) {
    if (typeof config.repoBundlePath !== "string" || config.repoBundlePath.trim().length === 0) {
      return undefined;
    }
    return {
      kind: "bundle-all",
      bundlePath: config.repoBundlePath,
      ...(readOptionalString(config.repoOriginUrl) ? { originUrl: config.repoOriginUrl } : {}),
    };
  }

  if (
    !config.repoTransport ||
    typeof config.repoTransport !== "object" ||
    Array.isArray(config.repoTransport)
  ) {
    throw new Error("Invalid repoTransport metadata: expected an object");
  }

  const raw = config.repoTransport as Record<string, unknown>;
  const kind = readRequiredString(raw.kind, "kind", "bundle-all") as RepoTransport["kind"];

  if (kind === "bundle-all") {
    return {
      kind,
      bundlePath: readRequiredString(raw.bundlePath, "bundlePath", kind),
      ...(readOptionalString(raw.originUrl) ? { originUrl: readOptionalString(raw.originUrl) } : {}),
    };
  }

  if (kind === "review-bundle") {
    return {
      kind,
      bundlePath: readRequiredString(raw.bundlePath, "bundlePath", kind),
      headRef: readRequiredString(raw.headRef, "headRef", kind),
      baseRef: readRequiredString(raw.baseRef, "baseRef", kind),
      ...(readOptionalString(raw.originUrl) ? { originUrl: readOptionalString(raw.originUrl) } : {}),
    };
  }

  throw new Error(`Invalid repoTransport metadata: unsupported kind ${kind}`);
}
