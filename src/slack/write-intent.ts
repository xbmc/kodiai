const WRITE_PREFIX_KEYWORDS = ["apply", "change", "plan"] as const;

const HIGH_IMPACT_PATTERNS = [
  /\b(delete|remove|drop|destroy|wipe|purge|truncate)\b/i,
  /\brename\b/i,
  /\b(migrate|migration|schema|database)\b/i,
  /\b(secret|token|credential|auth|permission|security|encryption|oauth|private key)\b/i,
  /\b(all files|entire repo|whole repo|across (?:the )?repo|every file|project-wide|global)\b/i,
  /\b(force push|rewrite history|rebase)\b/i,
];

const CONVERSATIONAL_WRITE_VERB_PATTERNS = [
  /\b(fix|update|implement|add|remove|delete|rename|refactor|change|create|write|patch|migrate)\b/i,
  /\b(open|create)\s+(?:a\s+)?pr\b/i,
  /\b(comment on|post to)\s+(?:the\s+)?(?:issue|pr)\b/i,
];

const STRONG_REQUEST_PATTERNS = [
  /^(?:please\s+)?(?:fix|update|implement|add|remove|delete|rename|refactor|change|create|write|patch|migrate|open)\b/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:fix|update|implement|add|remove|delete|rename|refactor|change|create|write|patch|migrate|open)\b/i,
];

const AMBIGUITY_PATTERNS = [
  /\b(maybe|might|if needed|if possible|when you can|sometime|should we|what do you think|consider)\b/i,
];

const FILE_OR_PATH_PATTERN = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+:[0-9]+)\b/;

export const SLACK_WRITE_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1000;

export type SlackWriteKeyword = (typeof WRITE_PREFIX_KEYWORDS)[number];

type SlackWriteIntentSource = "explicit_prefix" | "medium_confidence_conversational";

export type SlackWriteIntentResolution =
  | {
      outcome: "read_only";
      request: string;
    }
  | {
      outcome: "clarification_required";
      request: string;
      quickActionText: string;
      rerunCommands: [string, string];
    }
  | {
      outcome: "write";
      request: string;
      keyword: SlackWriteKeyword;
      source: SlackWriteIntentSource;
      highImpact: boolean;
      confirmationRequired: boolean;
      confirmationTimeoutMs: number;
    };

function normalizeSlackMessage(text: string): string {
  return text.replace(/<@[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractExplicitPrefix(message: string): { keyword: SlackWriteKeyword; request: string } | undefined {
  const trimmed = message.trimStart();
  const lower = trimmed.toLowerCase();

  for (const keyword of WRITE_PREFIX_KEYWORDS) {
    const prefix = `${keyword}:`;
    if (lower.startsWith(prefix)) {
      return {
        keyword,
        request: trimmed.slice(prefix.length).trim(),
      };
    }
  }

  return undefined;
}

function hasHighImpactSignals(request: string): boolean {
  return HIGH_IMPACT_PATTERNS.some((pattern) => pattern.test(request));
}

function scoreConversationalWriteIntent(request: string): { score: number; writeCue: boolean; ambiguousCue: boolean } {
  let score = 0;
  let writeCue = false;

  if (STRONG_REQUEST_PATTERNS.some((pattern) => pattern.test(request))) {
    score += 2;
    writeCue = true;
  }

  const writeVerbMatches = CONVERSATIONAL_WRITE_VERB_PATTERNS.filter((pattern) => pattern.test(request)).length;
  if (writeVerbMatches > 0) {
    score += Math.min(writeVerbMatches, 2);
    writeCue = true;
  }

  if (FILE_OR_PATH_PATTERN.test(request)) {
    score += 1;
  }

  if (/\b(branch|commit|pull request|\bpr\b|issue comment|review comment|run tests?|build)\b/i.test(request)) {
    score += 1;
    writeCue = true;
  }

  const ambiguousCue = AMBIGUITY_PATTERNS.some((pattern) => pattern.test(request));
  return { score, writeCue, ambiguousCue };
}

function buildRerunCommands(request: string): [string, string] {
  const rerunRequest = request.length > 0 ? request : "<same request>";
  return [`apply: ${rerunRequest}`, `change: ${rerunRequest}`];
}

export function buildSlackWriteIntentQuickAction(request: string): string {
  const [applyCommand, changeCommand] = buildRerunCommands(request);

  return [
    "I kept this run read-only because your request may involve repository changes, but write intent is ambiguous.",
    "If you want write mode, rerun with exactly one of:",
    `- ${applyCommand}`,
    `- ${changeCommand}`,
  ].join("\n");
}

export function resolveSlackWriteIntent(text: string): SlackWriteIntentResolution {
  const message = normalizeSlackMessage(text);
  const explicit = extractExplicitPrefix(message);

  if (explicit) {
    const highImpact = hasHighImpactSignals(explicit.request);
    return {
      outcome: "write",
      request: explicit.request,
      keyword: explicit.keyword,
      source: "explicit_prefix",
      highImpact,
      confirmationRequired: highImpact,
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    };
  }

  const { score, writeCue, ambiguousCue } = scoreConversationalWriteIntent(message);
  const highImpact = hasHighImpactSignals(message);

  if (score >= 3 && writeCue && !ambiguousCue) {
    return {
      outcome: "write",
      request: message,
      keyword: "apply",
      source: "medium_confidence_conversational",
      highImpact,
      confirmationRequired: highImpact,
      confirmationTimeoutMs: SLACK_WRITE_CONFIRMATION_TIMEOUT_MS,
    };
  }

  if (writeCue || score > 0) {
    const rerunCommands = buildRerunCommands(message);
    return {
      outcome: "clarification_required",
      request: message,
      quickActionText: buildSlackWriteIntentQuickAction(message),
      rerunCommands,
    };
  }

  return {
    outcome: "read_only",
    request: message,
  };
}
