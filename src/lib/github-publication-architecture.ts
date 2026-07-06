export type GitHubPublicationArchitectureFinding = {
  file: string;
  method: string;
};

export type OutgoingPublicationSanitizerArchitectureFinding = {
  file: string;
  symbol: string;
};

type FindDirectGitHubPublicationWritesInput = {
  files: Record<string, string>;
};

const ALLOWED_DIRECT_PUBLICATION_FILES = new Set([
  "src/lib/github-publication.ts",
]);

const ALLOWED_OUTGOING_SANITIZER_FILES = new Set([
  "src/lib/github-publication.ts",
  "src/lib/sanitizer.ts",
]);

const BODY_BEARING_GITHUB_PUBLICATION_METHODS = [
  "issues.createComment",
  "issues.updateComment",
  "issues.create",
  "issues.update",
  "pulls.create",
  "pulls.createReplyForReviewComment",
  "pulls.createReviewComment",
  "pulls.createReview",
] as const;

const BODY_BEARING_GITHUB_PUBLICATION_REQUEST_METHODS = [
  "POST",
  "PATCH",
  "PUT",
] as const;

const OUTGOING_PUBLICATION_SANITIZER_SYMBOLS = [
  "prepareOutgoingBodyForPublication",
  "sanitizeOutgoingMentions",
] as const;

export function findDirectGitHubPublicationWrites(
  input: FindDirectGitHubPublicationWritesInput,
): GitHubPublicationArchitectureFinding[] {
  const findings: GitHubPublicationArchitectureFinding[] = [];

  for (const [file, source] of Object.entries(input.files)) {
    if (ALLOWED_DIRECT_PUBLICATION_FILES.has(file)) {
      continue;
    }
    const bodyBearingPayloadAliases = findBodyBearingPayloadAliases(source);

    for (const method of BODY_BEARING_GITHUB_PUBLICATION_METHODS) {
      const [namespace, name] = method.split(".") as [string, string];
      const namespaceAccess = buildPropertyAccessPattern(namespace);
      const methodAccess = buildPropertyAccessPattern(name);
      const directCallPattern = new RegExp(
        String.raw`octokit\s*\.\s*rest\s*${namespaceAccess}\s*${methodAccess}\s*\([^)]*\bbody\b`,
        "s",
      );
      const directPayloadAliasCallPattern = new RegExp(
        String.raw`octokit\s*\.\s*rest\s*${namespaceAccess}\s*${methodAccess}\s*\(\s*(${bodyBearingPayloadAliases.map(escapeRegExp).join("|")})\s*[,)]`,
        "s",
      );
      if (
        directCallPattern.test(source)
        || (bodyBearingPayloadAliases.length > 0 && directPayloadAliasCallPattern.test(source))
      ) {
        findings.push({ file, method });
      }

      const aliases = findPublicationMethodAliases(source, namespace, name);
      for (const alias of aliases) {
        const aliasCallPattern = new RegExp(String.raw`\b${escapeRegExp(alias)}\s*\([^)]*\bbody\b`, "s");
        const aliasPayloadCallPattern = new RegExp(
          String.raw`\b${escapeRegExp(alias)}\s*\(\s*(${bodyBearingPayloadAliases.map(escapeRegExp).join("|")})\s*[,)]`,
          "s",
        );
        if (
          aliasCallPattern.test(source)
          || (bodyBearingPayloadAliases.length > 0 && aliasPayloadCallPattern.test(source))
        ) {
          findings.push({ file, method });
          break;
        }
      }
    }

    const requestCallPattern = /octokit\s*\.\s*request\s*\(\s*([`"'])(POST|PATCH|PUT)\s+([^`"']*\/repos\/[^`"']*)\1\s*,\s*(\{[^)]*\bbody\b|[A-Za-z_$][\w$]*)/gs;
    for (const match of source.matchAll(requestCallPattern)) {
      const httpMethod = match[2];
      const route = match[3];
      const requestPayload = match[4];
      if (
        BODY_BEARING_GITHUB_PUBLICATION_REQUEST_METHODS.includes(
          httpMethod as (typeof BODY_BEARING_GITHUB_PUBLICATION_REQUEST_METHODS)[number],
        )
        && route
        && (
          requestPayload?.trimStart().startsWith("{")
          || bodyBearingPayloadAliases.includes(requestPayload ?? "")
        )
      ) {
        findings.push({ file, method: `request:${httpMethod} ${route}` });
      }
    }
  }

  return findings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.method.localeCompare(right.method)
  );
}

function findBodyBearingPayloadAliases(source: string): string[] {
  const aliases = new Set<string>();
  const payloadPattern = /\b(?:const|let|var)\s+(\w+)(?:\s*:[^=]+)?\s*=\s*\{[^}]*\bbody\b[^}]*\}/gs;
  for (const match of source.matchAll(payloadPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}

function findPublicationMethodAliases(source: string, namespace: string, name: string): string[] {
  const aliases = new Set<string>();
  const namespaceAccess = buildPropertyAccessPattern(namespace);
  const methodAccess = buildPropertyAccessPattern(name);
  const destructuredPattern = new RegExp(
    String.raw`\{\s*${name}(?:\s*:\s*(\w+))?\s*\}\s*=\s*octokit\s*\.\s*rest\s*${namespaceAccess}`,
    "g",
  );
  for (const match of source.matchAll(destructuredPattern)) {
    aliases.add(match[1] ?? name);
  }

  const assignmentPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*octokit\s*\.\s*rest\s*${namespaceAccess}\s*${methodAccess}`,
    "g",
  );
  for (const match of source.matchAll(assignmentPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}

function buildPropertyAccessPattern(property: string): string {
  const escaped = escapeRegExp(property);
  return String.raw`(?:\.\s*${escaped}\b|\[\s*["']${escaped}["']\s*\])`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findDirectOutgoingPublicationSanitizerUsage(
  input: FindDirectGitHubPublicationWritesInput,
): OutgoingPublicationSanitizerArchitectureFinding[] {
  const findings: OutgoingPublicationSanitizerArchitectureFinding[] = [];

  for (const [file, source] of Object.entries(input.files)) {
    if (ALLOWED_OUTGOING_SANITIZER_FILES.has(file)) {
      continue;
    }

    for (const symbol of OUTGOING_PUBLICATION_SANITIZER_SYMBOLS) {
      const callPattern = new RegExp(String.raw`\b${symbol}\s*\(`);
      if (callPattern.test(source)) {
        findings.push({ file, symbol });
        continue;
      }

      const aliases = findSymbolAliases(source, symbol);
      for (const alias of aliases) {
        const aliasCallPattern = new RegExp(String.raw`\b${escapeRegExp(alias)}\s*\(`);
        if (aliasCallPattern.test(source)) {
          findings.push({ file, symbol });
          break;
        }
      }
    }
  }

  return findings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.symbol.localeCompare(right.symbol)
  );
}

function findSymbolAliases(source: string, symbol: string): string[] {
  const aliases = new Set<string>();
  const importAliasPattern = new RegExp(String.raw`\b${symbol}\s+as\s+(\w+)`, "g");
  for (const match of source.matchAll(importAliasPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  const assignmentPattern = new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*${symbol}\b`, "g");
  for (const match of source.matchAll(assignmentPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}
