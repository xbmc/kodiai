import picomatch from "picomatch";

export const REPO_DOCTRINE_CONTRACT_TYPES = [
  "api-compatibility",
  "migration",
  "performance-budget",
  "forbidden-pattern",
  "tracing",
  "feature-flag",
  "docs-update",
] as const;

export const REPO_DOCTRINE_SEVERITIES = [
  "critical",
  "major",
  "medium",
  "minor",
] as const;

export const REPO_DOCTRINE_CATEGORIES = [
  "security",
  "correctness",
  "performance",
  "style",
  "documentation",
  "operability",
] as const;

export const REPO_DOCTRINE_LIMITS = {
  maxContracts: 25,
  maxIdLength: 64,
  maxPathGlobsPerContract: 8,
  maxGlobLength: 160,
  maxInstructionLength: 500,
  maxEvidenceLength: 500,
  maxMatchedPathCandidates: 20,
  maxReasonCodes: 25,
} as const;

export type RepoDoctrineContractType = typeof REPO_DOCTRINE_CONTRACT_TYPES[number];
export type RepoDoctrineSeverity = typeof REPO_DOCTRINE_SEVERITIES[number];
export type RepoDoctrineCategory = typeof REPO_DOCTRINE_CATEGORIES[number];

export interface RepoDoctrineContract {
  id: string;
  type: RepoDoctrineContractType;
  paths: string[];
  severity: RepoDoctrineSeverity;
  category: RepoDoctrineCategory;
  instructions: string;
  evidence: string;
}

export interface RepoDoctrineConfig {
  enabled: boolean;
  contracts: RepoDoctrineContract[];
}

export type RepoDoctrineReasonCode =
  | "disabled"
  | "no-contracts"
  | "too-many-contracts"
  | "duplicate-id"
  | "empty-id"
  | "oversized-id"
  | "oversized-instruction"
  | "oversized-evidence"
  | "too-many-globs"
  | "empty-glob"
  | "oversized-glob"
  | "invalid-glob"
  | "unmatched-paths"
  | "matched-path-candidates-truncated"
  | "redaction-applied";

export interface RedactionResult {
  text: string;
  redacted: boolean;
  reasonCodes: RepoDoctrineReasonCode[];
}

export interface RepoDoctrineContractProjection {
  id: string;
  type: RepoDoctrineContractType;
  severity: RepoDoctrineSeverity;
  category: RepoDoctrineCategory;
  pathGlobCount: number;
  matchedPathCandidateCount: number;
}

export interface RepoDoctrineProjection {
  enabled: boolean;
  status: "disabled" | "empty" | "active";
  contractCount: number;
  consumedContractCount: number;
  omittedContractCount: number;
  typeCoverage: Partial<Record<RepoDoctrineContractType, number>>;
  matchedPathCandidates: string[];
  matchedPathCandidateCount: number;
  omittedMatchedPathCandidateCount: number;
  contracts: RepoDoctrineContractProjection[];
  reasonCodes: RepoDoctrineReasonCode[];
}

const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

function pushReason(reasons: RepoDoctrineReasonCode[], reason: RepoDoctrineReasonCode): void {
  if (reasons.includes(reason)) {
    return;
  }
  if (reasons.length < REPO_DOCTRINE_LIMITS.maxReasonCodes) {
    reasons.push(reason);
  }
}

export function redactDoctrineText(value: string): RedactionResult {
  let text = value;
  let redacted = false;

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      redacted = true;
      return "[redacted]";
    });
  }

  return {
    text,
    redacted,
    reasonCodes: redacted ? ["redaction-applied"] : [],
  };
}

function hasRedactionCanary(contract: RepoDoctrineContract): boolean {
  return redactDoctrineText(`${contract.id}\n${contract.instructions}\n${contract.evidence}`).redacted;
}

function isSafeGlob(glob: string): boolean {
  if (glob.trim().length === 0) {
    return false;
  }
  if (glob.length > REPO_DOCTRINE_LIMITS.maxGlobLength) {
    return false;
  }
  return !glob.includes("\0");
}

export function normalizeRepoDoctrineProjection(
  doctrine: RepoDoctrineConfig,
  changedPaths: string[] = [],
): RepoDoctrineProjection {
  const reasonCodes: RepoDoctrineReasonCode[] = [];
  const typeCoverage: Partial<Record<RepoDoctrineContractType, number>> = {};
  const contracts: RepoDoctrineContractProjection[] = [];
  const matchedPathCandidates: string[] = [];
  const seenIds = new Set<string>();
  let omittedContractCount = 0;
  let omittedMatchedPathCandidateCount = 0;

  if (!doctrine.enabled) {
    pushReason(reasonCodes, "disabled");
    return {
      enabled: false,
      status: "disabled",
      contractCount: 0,
      consumedContractCount: 0,
      omittedContractCount: 0,
      typeCoverage,
      matchedPathCandidates: [],
      matchedPathCandidateCount: 0,
      omittedMatchedPathCandidateCount: 0,
      contracts: [],
      reasonCodes,
    };
  }

  if (doctrine.contracts.length === 0) {
    pushReason(reasonCodes, "no-contracts");
  }

  const boundedContracts = doctrine.contracts.slice(0, REPO_DOCTRINE_LIMITS.maxContracts);
  if (doctrine.contracts.length > boundedContracts.length) {
    omittedContractCount += doctrine.contracts.length - boundedContracts.length;
    pushReason(reasonCodes, "too-many-contracts");
  }

  for (const contract of boundedContracts) {
    const id = contract.id.trim();
    if (id.length === 0) {
      omittedContractCount++;
      pushReason(reasonCodes, "empty-id");
      continue;
    }
    if (id.length > REPO_DOCTRINE_LIMITS.maxIdLength) {
      omittedContractCount++;
      pushReason(reasonCodes, "oversized-id");
      continue;
    }
    if (seenIds.has(id)) {
      omittedContractCount++;
      pushReason(reasonCodes, "duplicate-id");
      continue;
    }
    if (contract.instructions.length > REPO_DOCTRINE_LIMITS.maxInstructionLength) {
      omittedContractCount++;
      pushReason(reasonCodes, "oversized-instruction");
      continue;
    }
    if (contract.evidence.length > REPO_DOCTRINE_LIMITS.maxEvidenceLength) {
      omittedContractCount++;
      pushReason(reasonCodes, "oversized-evidence");
      continue;
    }
    if (hasRedactionCanary(contract)) {
      pushReason(reasonCodes, "redaction-applied");
    }

    const boundedGlobs = contract.paths.slice(0, REPO_DOCTRINE_LIMITS.maxPathGlobsPerContract);
    if (contract.paths.length > boundedGlobs.length) {
      pushReason(reasonCodes, "too-many-globs");
    }

    const safeGlobs = boundedGlobs.filter((glob) => {
      if (glob.trim().length === 0) {
        pushReason(reasonCodes, "empty-glob");
        return false;
      }
      if (glob.length > REPO_DOCTRINE_LIMITS.maxGlobLength) {
        pushReason(reasonCodes, "oversized-glob");
        return false;
      }
      if (!isSafeGlob(glob)) {
        pushReason(reasonCodes, "invalid-glob");
        return false;
      }
      return true;
    });

    if (safeGlobs.length === 0) {
      omittedContractCount++;
      pushReason(reasonCodes, "invalid-glob");
      continue;
    }

    const matchers = safeGlobs.map((glob) => picomatch(glob, { dot: true }));
    const matched = changedPaths.filter((path) => matchers.some((matches) => matches(path)));
    if (changedPaths.length > 0 && matched.length === 0) {
      pushReason(reasonCodes, "unmatched-paths");
    }

    for (const path of matched) {
      if (matchedPathCandidates.includes(path)) {
        continue;
      }
      if (matchedPathCandidates.length >= REPO_DOCTRINE_LIMITS.maxMatchedPathCandidates) {
        omittedMatchedPathCandidateCount++;
        pushReason(reasonCodes, "matched-path-candidates-truncated");
        continue;
      }
      matchedPathCandidates.push(path);
    }

    seenIds.add(id);
    typeCoverage[contract.type] = (typeCoverage[contract.type] ?? 0) + 1;
    contracts.push({
      id,
      type: contract.type,
      severity: contract.severity,
      category: contract.category,
      pathGlobCount: safeGlobs.length,
      matchedPathCandidateCount: matched.length,
    });
  }

  return {
    enabled: true,
    status: contracts.length === 0 ? "empty" : "active",
    contractCount: doctrine.contracts.length,
    consumedContractCount: contracts.length,
    omittedContractCount,
    typeCoverage,
    matchedPathCandidates,
    matchedPathCandidateCount: matchedPathCandidates.length,
    omittedMatchedPathCandidateCount,
    contracts,
    reasonCodes,
  };
}
