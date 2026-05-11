export type M068CandidatePublicationProofInput = {
  reviewOutputKey?: unknown;
  deliveryId?: unknown;
  mode?: unknown;
  candidatePublished?: unknown;
  directFallback?: unknown;
  directPublished?: unknown;
  candidateLine?: unknown;
  artifactCounts?: {
    reviews?: unknown;
    reviewComments?: unknown;
    issueComments?: unknown;
  };
  url?: unknown;
};

export type M068CandidatePublicationProofReport = {
  success: boolean;
  status_code: "m068_ok" | "m068_direct_fallback" | "m068_missing_candidate_publication" | "m068_malformed_evidence";
  reviewOutputKey: string | null;
  deliveryId: string | null;
  mode: string | null;
  candidatePublished: number;
  directFallback: number;
  exactKeyArtifactCount: number;
  url: string | null;
  issues: string[];
};

export function evaluateM068CandidatePublicationProof(
  input: M068CandidatePublicationProofInput,
): M068CandidatePublicationProofReport {
  const issues: string[] = [];
  const reviewOutputKey = normalizeToken(input.reviewOutputKey);
  const deliveryId = normalizeToken(input.deliveryId);
  const parsedLine = parseCandidateLine(normalizeText(input.candidateLine));
  const mode = normalizeToken(input.mode) ?? parsedLine.mode;
  const candidatePublished = normalizeCount(input.candidatePublished ?? parsedLine.published);
  const directFallback = normalizeCount(input.directFallback ?? input.directPublished ?? parsedLine.directFallback);
  const exactKeyArtifactCount = normalizeCount(input.artifactCounts?.reviews)
    + normalizeCount(input.artifactCounts?.reviewComments)
    + normalizeCount(input.artifactCounts?.issueComments);
  const url = normalizeUrl(input.url);

  if (!reviewOutputKey?.startsWith("kodiai-review-output:v1:")) {
    issues.push("Missing or malformed review output key.");
  }
  if (!deliveryId) {
    issues.push("Missing delivery id.");
  }
  if (!mode) {
    issues.push("Missing candidate publication mode.");
  }
  if (exactKeyArtifactCount !== 1) {
    issues.push(`Expected exactly one bounded exact-key visible artifact; found ${exactKeyArtifactCount}.`);
  }
  if (directFallback > 0 || mode === "direct-fallback") {
    issues.push("Direct fallback evidence is present and cannot count as candidate-approved publication.");
  }
  if (candidatePublished <= 0 || mode !== "candidate-approved") {
    issues.push("Candidate-approved publication was not proven.");
  }

  let statusCode: M068CandidatePublicationProofReport["status_code"] = "m068_ok";
  if (issues.some((issue) => issue.includes("Missing") || issue.includes("malformed") || issue.includes("exactly one"))) {
    statusCode = "m068_malformed_evidence";
  }
  if (issues.some((issue) => issue.includes("Direct fallback"))) {
    statusCode = "m068_direct_fallback";
  } else if (issues.some((issue) => issue.includes("Candidate-approved"))) {
    statusCode = "m068_missing_candidate_publication";
  }

  return {
    success: issues.length === 0,
    status_code: statusCode,
    reviewOutputKey,
    deliveryId,
    mode,
    candidatePublished,
    directFallback,
    exactKeyArtifactCount,
    url,
    issues,
  };
}

export function parseCandidateLine(line: string | null): { mode: string | null; published: number | null; directFallback: number | null } {
  if (!line) return { mode: null, published: null, directFallback: null };
  return {
    mode: line.match(/\bmode=([a-z0-9-]+)/i)?.[1] ?? null,
    published: parseMatchedCount(line.match(/\bpublished=(\d+)/i)),
    directFallback: parseMatchedCount(line.match(/\bdirectFallback=(\d+)/i)),
  };
}

function parseMatchedCount(match: RegExpMatchArray | null): number | null {
  return match ? normalizeCount(match[1]) : null;
}

function normalizeCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:\/-]+$/.test(trimmed) ? trimmed : null;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 500) : null;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^https:\/\/github\.com\/[^\s]+$/.test(value) ? value : null;
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).json() as M068CandidatePublicationProofInput;
  const report = evaluateM068CandidatePublicationProof(input);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}
