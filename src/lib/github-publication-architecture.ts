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
  "pulls.updateReviewComment",
  "pulls.createReview",
] as const;

const BODY_BEARING_GITHUB_PUBLICATION_REQUEST_METHODS = [
  "POST",
  "PATCH",
  "PUT",
] as const;

const BODY_BEARING_GITHUB_GRAPHQL_MUTATIONS = [
  "addComment",
  "addPullRequestReview",
  "addPullRequestReviewComment",
  "updateIssueComment",
  "updatePullRequestReview",
  "updatePullRequestReviewComment",
] as const;

const OUTGOING_PUBLICATION_SANITIZER_SYMBOLS = [
  "prepareOutgoingBodyForPublication",
  "sanitizeOutgoingMentions",
] as const;

const OCTOKIT_RECEIVER_PATTERN = String.raw`(?:\b[A-Za-z_$][\w$]*\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*["'][A-Za-z_$][\w$]*["']\s*\])*\s*\.\s*)?octokit\b`;

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
        String.raw`${OCTOKIT_RECEIVER_PATTERN}\s*\.\s*rest\s*${namespaceAccess}\s*${methodAccess}\s*\([^)]*\bbody\b`,
        "s",
      );
      const directPayloadAliasCallPattern = new RegExp(
        String.raw`${OCTOKIT_RECEIVER_PATTERN}\s*\.\s*rest\s*${namespaceAccess}\s*${methodAccess}\s*\(\s*(?:(${bodyBearingPayloadAliases.map(escapeRegExp).join("|")})|\{\s*\.\.\.\s*(${bodyBearingPayloadAliases.map(escapeRegExp).join("|")})\s*\})\s*[,)]`,
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
          String.raw`\b${escapeRegExp(alias)}\s*\(\s*(?:(${bodyBearingPayloadAliases.map(escapeRegExp).join("|")})|\{\s*\.\.\.\s*(${bodyBearingPayloadAliases.map(escapeRegExp).join("|")})\s*\})\s*[,)]`,
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

    const requestCalleePatterns = [
      String.raw`${OCTOKIT_RECEIVER_PATTERN}\s*${buildPropertyAccessPattern("request")}`,
      ...findGitHubRequestAliases(source).map((alias) => String.raw`\b${escapeRegExp(alias)}\b`),
    ];
    for (const requestCalleePattern of requestCalleePatterns) {
      const requestCallPattern = new RegExp(
        String.raw`${requestCalleePattern}\s*\(\s*([` + "`" + String.raw`"'])(POST|PATCH|PUT)\s+([^` + "`" + String.raw`"']*\/repos\/[^` + "`" + String.raw`"']*)\1\s*,\s*(\{[^)]*(?:\bbody\b|\.\.\.\s*[A-Za-z_$][\w$]*)[^)]*\}|[A-Za-z_$][\w$]*)`,
        "gs",
      );
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
            && (
              /\bbody\b/.test(requestPayload)
              || bodyBearingPayloadAliases.some((alias) => new RegExp(String.raw`\.\.\.\s*${escapeRegExp(alias)}\b`).test(requestPayload))
            )
            || bodyBearingPayloadAliases.includes(requestPayload ?? "")
          )
        ) {
          findings.push({ file, method: `request:${httpMethod} ${route}` });
        }
      }

      const objectRequestCallPattern = new RegExp(String.raw`${requestCalleePattern}\s*\(`, "gs");
      for (const match of source.matchAll(objectRequestCallPattern)) {
        if (match.index === undefined) {
          continue;
        }

        const argumentStart = findNextNonWhitespaceIndex(source, match.index + match[0].length);
        if (argumentStart === null || source[argumentStart] !== "{") {
          continue;
        }

        const requestObject = readBalancedObjectLiteral(source, argumentStart);
        if (!requestObject) {
          continue;
        }

        const objectRequest = parseBodyBearingRequestObject(requestObject, bodyBearingPayloadAliases);
        if (objectRequest) {
          findings.push({ file, method: `request:${objectRequest.httpMethod} ${objectRequest.route}` });
        }
      }
    }

    const graphqlCalleePatterns = [
      String.raw`${OCTOKIT_RECEIVER_PATTERN}\s*${buildPropertyAccessPattern("graphql")}`,
      ...findGitHubGraphqlAliases(source).map((alias) => String.raw`\b${escapeRegExp(alias)}\b`),
    ];
    for (const graphqlCalleePattern of graphqlCalleePatterns) {
      const graphqlCallPattern = new RegExp(
        String.raw`${graphqlCalleePattern}\s*\(\s*([` + "`" + String.raw`"'])([\s\S]*?)\1\s*,\s*(\{[^)]*(?:\bbody\b|\.\.\.\s*[A-Za-z_$][\w$]*)[^)]*\}|[A-Za-z_$][\w$]*)`,
        "gs",
      );
      for (const match of source.matchAll(graphqlCallPattern)) {
        const mutation = match[2] ?? "";
        const requestPayload = match[3] ?? "";
        const mutationName = BODY_BEARING_GITHUB_GRAPHQL_MUTATIONS.find((name) =>
          new RegExp(String.raw`\b${escapeRegExp(name)}\b`).test(mutation)
        );
        if (
          mutationName
          && (
            requestPayload.trimStart().startsWith("{") && (
              /\bbody\b/.test(requestPayload)
              || bodyBearingPayloadAliases.some((alias) => new RegExp(String.raw`\.\.\.\s*${escapeRegExp(alias)}\b`).test(requestPayload))
            )
            || bodyBearingPayloadAliases.includes(requestPayload)
          )
        ) {
          findings.push({ file, method: `graphql:${mutationName}` });
        }
      }
    }
  }

  return findings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.method.localeCompare(right.method)
  );
}

function findBodyBearingPayloadAliases(source: string): string[] {
  const aliases = new Set<string>();
  const declarationPattern = /\b(?:const|let|var)\s+(\w+)(?:\s*:[^=]+)?\s*=\s*\{/g;
  for (const match of source.matchAll(declarationPattern)) {
    const alias = match[1];
    if (!alias || match.index === undefined) {
      continue;
    }

    const initializerStart = source.indexOf("{", match.index);
    if (initializerStart === -1) {
      continue;
    }

    const initializer = readBalancedObjectLiteral(source, initializerStart);
    if (initializer && /\bbody\b/.test(initializer)) {
      aliases.add(alias);
    }
  }

  return [...aliases];
}

function readBalancedObjectLiteral(source: string, openBraceIndex: number): string | null {
  let depth = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let escaped = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex, index + 1);
      }
    }
  }

  return null;
}

function findNextNonWhitespaceIndex(source: string, startIndex: number): number | null {
  for (let index = startIndex; index < source.length; index += 1) {
    if (!/\s/.test(source[index] ?? "")) {
      return index;
    }
  }
  return null;
}

function parseBodyBearingRequestObject(
  requestObject: string,
  bodyBearingPayloadAliases: string[],
): { httpMethod: string; route: string } | null {
  const methodMatch = requestObject.match(/\bmethod\s*:\s*["'](POST|PATCH|PUT)["']/);
  const routeMatch = requestObject.match(/\b(?:url|route)\s*:\s*([`"'])([^`"']*\/repos\/[^`"']*)\1/);
  if (!methodMatch?.[1] || !routeMatch?.[2]) {
    return null;
  }

  const hasBody =
    /\bbody\b/.test(requestObject)
    || bodyBearingPayloadAliases.some((alias) =>
      new RegExp(String.raw`\.\.\.\s*${escapeRegExp(alias)}\b`).test(requestObject)
    );
  if (!hasBody) {
    return null;
  }

  return { httpMethod: methodMatch[1], route: routeMatch[2] };
}

function findPublicationMethodAliases(source: string, namespace: string, name: string): string[] {
  const aliases = new Set<string>();
  const namespaceAccess = buildPropertyAccessPattern(namespace);
  const methodAccess = buildPropertyAccessPattern(name);
  const destructuredPattern = new RegExp(
    String.raw`\{([^}]*)\}\s*=\s*${OCTOKIT_RECEIVER_PATTERN}\s*\.\s*rest\s*${namespaceAccess}`,
    "g",
  );
  for (const match of source.matchAll(destructuredPattern)) {
    for (const alias of findDestructuredPropertyAliases(match[1] ?? "", name)) {
      aliases.add(alias);
    }
  }

  const assignmentPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*${OCTOKIT_RECEIVER_PATTERN}\s*\.\s*rest\s*${namespaceAccess}\s*${methodAccess}`,
    "g",
  );
  for (const match of source.matchAll(assignmentPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}

function findGitHubRequestAliases(source: string): string[] {
  const aliases = new Set<string>();
  const destructuredPattern = new RegExp(
    String.raw`\{([^}]*)\}\s*=\s*${OCTOKIT_RECEIVER_PATTERN}`,
    "g",
  );
  for (const match of source.matchAll(destructuredPattern)) {
    for (const alias of findDestructuredPropertyAliases(match[1] ?? "", "request")) {
      aliases.add(alias);
    }
  }

  const requestAccess = buildPropertyAccessPattern("request");
  const assignmentPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*${OCTOKIT_RECEIVER_PATTERN}\s*${requestAccess}`,
    "g",
  );
  for (const match of source.matchAll(assignmentPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}

function findGitHubGraphqlAliases(source: string): string[] {
  const aliases = new Set<string>();
  const destructuredPattern = new RegExp(
    String.raw`\{([^}]*)\}\s*=\s*${OCTOKIT_RECEIVER_PATTERN}`,
    "g",
  );
  for (const match of source.matchAll(destructuredPattern)) {
    for (const alias of findDestructuredPropertyAliases(match[1] ?? "", "graphql")) {
      aliases.add(alias);
    }
  }

  const graphqlAccess = buildPropertyAccessPattern("graphql");
  const assignmentPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*${OCTOKIT_RECEIVER_PATTERN}\s*${graphqlAccess}`,
    "g",
  );
  for (const match of source.matchAll(assignmentPattern)) {
    if (match[1]) {
      aliases.add(match[1]);
    }
  }

  return [...aliases];
}

function findDestructuredPropertyAliases(properties: string, property: string): string[] {
  const aliases = new Set<string>();
  const propertyPattern = new RegExp(
    String.raw`(?:^|,)\s*${escapeRegExp(property)}(?:\s*:\s*(\w+))?\s*(?=,|$)`,
    "g",
  );
  for (const match of properties.matchAll(propertyPattern)) {
    aliases.add(match[1] ?? property);
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
      const callPattern = buildSymbolCallPattern(symbol);
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

function buildSymbolCallPattern(symbol: string): RegExp {
  const escaped = escapeRegExp(symbol);
  return new RegExp(
    String.raw`(?:\b${escaped}\s*\(|(?:\.\s*${escaped}\b|\[\s*["']${escaped}["']\s*\])\s*\()`,
  );
}
