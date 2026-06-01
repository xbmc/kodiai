import type { MentionContextAdmissionPolicy } from "../execution/mention-context.ts";

export function stripIssueIntentWrappers(userQuestion: string): string {
  let normalized = userQuestion.trim().replace(/\s+/g, " ");

  for (let i = 0; i < 4; i++) {
    const before = normalized;
    normalized = normalized
      .replace(/^(?:>+\s*)+/, "")
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/^\/[a-z0-9._:-]+(?:\s+|$)/i, "")
      .replace(/^https?:\/\/\S+(?:\s+|$)/i, "")
      .replace(/^[`'"([{]+/, "")
      .replace(/^[,.;:!?\-\s]+/, "")
      .replace(/^(?:hey|hi|hello|quick question|question|fyi|context)[,\-:]\s+/i, "")
      .trim();
    if (normalized === before || normalized.length === 0) break;
  }

  return normalized;
}

export function isImplementationRequestWithoutPrefix(userQuestion: string): boolean {
  const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase();
  if (normalized.length === 0) return false;

  const implementationVerb =
    "(?:fix|update|change|refactor|add|remove|implement|create|rename|rewrite|patch|write|open|submit|send)";
  const rewriteVerb = "(?:improve|tweak|clean\\s*up|cleanup|clarify)";
  const codeTarget =
    "(?:code|logic|behavior|copy|text|wording|message|handler|prompt|response|implementation|flow|gating|function|test(?:s)?|readme|docs?|config|types?)";
  const styleOutcome = "(?:clear(?:er)?|better|safer|faster|consistent|more\\s+readable)";

  const directCommand = new RegExp(`^${implementationVerb}\\b`);
  const politeCommand = new RegExp(`^(?:please\\s+)?${implementationVerb}\\b`);
  const explicitAsk = new RegExp(
    `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:help\\s+me\\s+)?${implementationVerb}\\b`,
  );
  const rewriteCommand = new RegExp(
    `^(?:please\\s+)?${rewriteVerb}\\b(?:.{0,80})\\b${codeTarget}\\b`,
  );
  const rewriteAsk = new RegExp(
    `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:help\\s+me\\s+)?${rewriteVerb}\\b(?:.{0,80})\\b${codeTarget}\\b`,
  );
  const makeStyleCommand = new RegExp(
    `^(?:please\\s+)?make\\b(?:.{0,120})\\b${styleOutcome}\\b(?:.{0,120})\\b${codeTarget}\\b`,
  );
  const makeStyleAsk = new RegExp(
    `^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?(?:help\\s+me\\s+)?make\\b(?:.{0,120})\\b${styleOutcome}\\b(?:.{0,120})\\b${codeTarget}\\b`,
  );

  return (
    directCommand.test(normalized) ||
    politeCommand.test(normalized) ||
    explicitAsk.test(normalized) ||
    rewriteCommand.test(normalized) ||
    rewriteAsk.test(normalized) ||
    makeStyleCommand.test(normalized) ||
    makeStyleAsk.test(normalized)
  );
}

export function isConversationalConfirmation(text: string): boolean {
  const normalized = stripIssueIntentWrappers(text).toLowerCase();
  if (normalized.length === 0) return false;

  const actionSignal =
    /(?:\bwrite\b|\bdo\s+it\b|\bgo\s+ahead\b|\bproceed\b|\bpr\b|\bimplement\b|\bfix\b|\bopen\b|\bsubmit\b|\bsend\b|\bmake\b|\bcreate\b)/;

  const confirmationAction = /^(?:yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely)\b/;
  const sentimentAction =
    /^(?:sounds?\s+good|looks?\s+good|that(?:'s|\s+is)\s+(?:good|great|perfect|fine)|perfect|great)\b/;
  const standaloneAction =
    /^(?:(?:please\s+)?go\s+ahead|(?:please\s+)?do\s+it|(?:please\s+)?proceed)\b/;

  if (standaloneAction.test(normalized)) return true;
  if ((confirmationAction.test(normalized) || sentimentAction.test(normalized)) && actionSignal.test(normalized))
    return true;

  return false;
}

export function isReviewRequest(userQuestion: string): boolean {
  const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase().trim();
  if (normalized.length === 0) return false;

  const reviewCommand =
    "(?:do\\s+(?:a\\s+)?(?:full\\s+)?review|review|(?:retry|rerun|re-run)\\s+(?:the\\s+)?(?:full\\s+)?review)";

  const reviewDirect = new RegExp(`^(?:please\\s+)?${reviewCommand}\\b`);
  const reviewAsk = new RegExp(`^(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?${reviewCommand}\\b`);
  const reviewFollowUp = /^(?:(?:is\s+)?(?:it\s+)?better\s+now|(?:is\s+)?(?:it\s+)?fixed\s+now|(?:how\s+about|what\s+about)\s+now|(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:check|look|take\s+a\s+look)\s+again)\??$/;

  return reviewDirect.test(normalized) || reviewAsk.test(normalized) || reviewFollowUp.test(normalized);
}

export type MentionAdmissionConfigSource = {
  includeConversationHistory: boolean;
  includePrMetadata: boolean;
  includeReviewThread: boolean;
  includeInlineReviewContext: boolean;
};

export function deriveMentionAdmissionPolicy(params: {
  explicitReviewRequest: boolean;
  mentionAdmission: {
    explicitReview: MentionAdmissionConfigSource;
    conversational: MentionAdmissionConfigSource;
  };
}): MentionContextAdmissionPolicy {
  const source = params.explicitReviewRequest
    ? params.mentionAdmission.explicitReview
    : params.mentionAdmission.conversational;

  return {
    includeConversationHistory: source.includeConversationHistory,
    includePrMetadata: source.includePrMetadata,
    includeReviewThread: params.explicitReviewRequest ? source.includeReviewThread : false,
    includeInlineReviewContext: source.includeInlineReviewContext,
  };
}

export function isCodeSeekingMentionRequest(question: string): boolean {
  const normalized = stripIssueIntentWrappers(question).toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const directCodeIntent = /\b(where\s+is|which\s+file|what\s+file|show\s+me|point\s+me|find|locate|trace|walk\s+me\s+through|inspect|debug|look\s+at)\b/;
  const codeSubject = /\b(code|implementation|logic|handler|function|module|class|component|query|workflow|prompt|diff|stack|error|bug|regression|test|file|path|line|symbol|readme|docs?)\b/;
  const fileReference = /\b[a-z0-9._/-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|sql|py|rb|go|rs|java|kt|swift|cpp|cc|c|h)\b/;
  const codeSyntax = /[`/]|::|->|\bsrc\//;

  if (directCodeIntent.test(normalized) && (codeSubject.test(normalized) || fileReference.test(normalized) || codeSyntax.test(normalized))) {
    return true;
  }

  const implementationQuestion = /\b(how\s+does|why\s+does|what\s+does)\b/;
  if (implementationQuestion.test(normalized) && (codeSubject.test(normalized) || fileReference.test(normalized) || codeSyntax.test(normalized))) {
    return true;
  }

  const locationQuestion = /\b(file|path|line|symbol|function|module|class|component)\b/;
  if (locationQuestion.test(normalized) && /\b(where|which|show|find|locate)\b/.test(normalized)) {
    return true;
  }

  return false;
}

export function isDiffSeekingMentionRequest(question: string): boolean {
  const normalized = stripIssueIntentWrappers(question).toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const diffNoun = /\b(diff|patch|changes|changed files|delta|hunk|stat|files changed)\b/;
  const diffVerb = /\b(show|inspect|review|analyze|walk\s+through|summarize|explain|compare|check)\b/;
  const comparePhrase = /\bwhat\s+changed\b/;

  return comparePhrase.test(normalized) || (diffNoun.test(normalized) && diffVerb.test(normalized));
}

export function buildMentionRetrievalBody(params: {
  userQuestion: string;
  mentionContext: string;
  allowHeavyContext: boolean;
  allowDiffContext: boolean;
  explicitReviewRequest: boolean;
}): string {
  if (params.explicitReviewRequest) {
    return params.mentionContext;
  }

  const summaryLines = [params.userQuestion.trim()];
  if (params.allowHeavyContext && params.mentionContext.trim().length > 0) {
    summaryLines.push(params.mentionContext.trim());
  } else if (params.allowDiffContext) {
    summaryLines.push("diff-inspection request");
  }

  return summaryLines.filter((line) => line.length > 0).join("\n\n");
}

export function detectImplicitIssueIntent(userQuestion: string): "apply" | "plan" | undefined {
  const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase();
  if (normalized.length === 0) return undefined;

  const planDirect = /^(?:please\s+)?(?:plan|draft|outline|propose)\b/;
  const planAsk =
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:help\s+me\s+)?(?:plan|draft|outline|propose)\b/;
  const planPhrase = /(?:\bwork\s+up\b|\bput\s+together\b)(?:.{0,30})\bplan\b/;

  if (planDirect.test(normalized) || planAsk.test(normalized) || planPhrase.test(normalized)) {
    return "plan";
  }

  if (isImplementationRequestWithoutPrefix(normalized)) {
    return "apply";
  }

  if (isConversationalConfirmation(normalized)) {
    return "apply";
  }

  return undefined;
}

export function detectImplicitPrPatchIntent(userQuestion: string): "apply" | undefined {
  const normalized = stripIssueIntentWrappers(userQuestion).toLowerCase();
  if (normalized.length === 0) return undefined;

  const patchDirect = /^(?:please\s+)?(?:create|make|open|submit)\s+(?:a\s+)?patch\b/;
  const patchThis = /^(?:please\s+)?patch\s+(?:this|the|that)\b/;
  const patchAsk = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:create|make|open|submit)\s+(?:a\s+)?patch\b/;
  const patchThisAsk = /^(?:can|could|would|will)\s+you\s+(?:please\s+)?patch\s+(?:this|the|that)\b/;
  const patchContextual = /(?:apply|implement)\s+(?:the\s+)?(?:earlier|previous|above|suggested)\s+(?:change|suggestion|fix).*(?:as\s+)?(?:a\s+)?(?:patch|pr)\b/;

  if (
    patchDirect.test(normalized) ||
    patchThis.test(normalized) ||
    patchAsk.test(normalized) ||
    patchThisAsk.test(normalized) ||
    patchContextual.test(normalized)
  ) {
    return "apply";
  }

  if (isImplementationRequestWithoutPrefix(normalized)) {
    return "apply";
  }

  if (isConversationalConfirmation(normalized)) {
    return "apply";
  }

  return undefined;
}
