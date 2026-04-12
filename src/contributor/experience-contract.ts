import type { AuthorTier } from "../lib/author-classifier.ts";

export type ContributorExperienceSource =
  | "contributor-profile"
  | "author-cache"
  | "github-search"
  | "author-association"
  | "none";

export type ContributorExperienceContractState =
  | "profile-backed"
  | "coarse-fallback"
  | "generic-unknown"
  | "generic-opt-out"
  | "generic-degraded";

export type ContributorExperienceReviewBehavior =
  | "adapted-profile-backed"
  | "adapted-coarse-fallback"
  | "generic";

export type ContributorExperienceReviewDetailsProjection = {
  state: ContributorExperienceContractState;
  text: string;
};

export type ContributorExperienceSlackProfileProjection = {
  state: ContributorExperienceContractState;
  statusLine: string;
  summaryLine: string;
  showExpertise: boolean;
};

export type ContributorExperiencePromptPolicyKind =
  | "profile-backed-newcomer"
  | "profile-backed-developing"
  | "profile-backed-established"
  | "profile-backed-senior"
  | "coarse-fallback"
  | "generic-unknown"
  | "generic-opt-out"
  | "generic-degraded";

export type ContributorExperiencePromptPolicy = {
  kind: ContributorExperiencePromptPolicyKind;
};

export type ContributorExperienceContract = {
  state: ContributorExperienceContractState;
  source: ContributorExperienceSource;
  reviewBehavior: ContributorExperienceReviewBehavior;
  promptTier: AuthorTier | null;
  promptPolicy: ContributorExperiencePromptPolicy;
  degraded: boolean;
  degradationPath: string | null;
  reviewDetails: ContributorExperienceReviewDetailsProjection;
};

function normalizeProfileBackedPromptPolicyKind(
  tier: AuthorTier | null | undefined,
): ContributorExperiencePromptPolicyKind | null {
  switch (tier ?? null) {
    case "first-time":
    case "newcomer":
      return "profile-backed-newcomer";
    case "regular":
    case "developing":
      return "profile-backed-developing";
    case "established":
      return "profile-backed-established";
    case "core":
    case "senior":
      return "profile-backed-senior";
    default:
      return null;
  }
}

function isPromptPolicyKind(
  value: unknown,
): value is ContributorExperiencePromptPolicyKind {
  return [
    "profile-backed-newcomer",
    "profile-backed-developing",
    "profile-backed-established",
    "profile-backed-senior",
    "coarse-fallback",
    "generic-unknown",
    "generic-opt-out",
    "generic-degraded",
  ].includes(value as ContributorExperiencePromptPolicyKind);
}

function isProfileBackedPromptPolicyKind(
  value: unknown,
): value is Extract<
  ContributorExperiencePromptPolicyKind,
  | "profile-backed-newcomer"
  | "profile-backed-developing"
  | "profile-backed-established"
  | "profile-backed-senior"
> {
  return [
    "profile-backed-newcomer",
    "profile-backed-developing",
    "profile-backed-established",
    "profile-backed-senior",
  ].includes(value as ContributorExperiencePromptPolicyKind);
}

function resolveProfileBackedRetrievalHint(
  contract?: Partial<
    Pick<ContributorExperienceContract, "promptPolicy" | "promptTier">
  > | null,
): string | null {
  const promptPolicyKind = isProfileBackedPromptPolicyKind(
    contract?.promptPolicy?.kind,
  )
    ? contract.promptPolicy.kind
    : normalizeProfileBackedPromptPolicyKind(contract?.promptTier);

  switch (promptPolicyKind) {
    case "profile-backed-newcomer":
      return "new contributor";
    case "profile-backed-developing":
      return "developing contributor";
    case "profile-backed-established":
      return "established contributor";
    case "profile-backed-senior":
      return "senior contributor";
    default:
      return null;
  }
}

export function resolveContributorExperienceRetrievalHint(
  contract?: Partial<
    Pick<ContributorExperienceContract, "state" | "promptPolicy" | "promptTier">
  > | null,
): string | null {
  switch (contract?.state) {
    case "profile-backed":
      return resolveProfileBackedRetrievalHint(contract);
    case "coarse-fallback":
      return "returning contributor";
    case "generic-opt-out":
    case "generic-degraded":
    case "generic-unknown":
    default:
      return null;
  }
}

export function resolveContributorExperiencePromptPolicy(
  contract?: Partial<
    Pick<
      ContributorExperienceContract,
      "state" | "promptPolicy" | "promptTier" | "reviewBehavior"
    >
  > | null,
): ContributorExperiencePromptPolicy {
  if (contract?.promptPolicy && isPromptPolicyKind(contract.promptPolicy.kind)) {
    return { kind: contract.promptPolicy.kind };
  }

  switch (contract?.state) {
    case "profile-backed": {
      const normalizedKind = normalizeProfileBackedPromptPolicyKind(
        contract.promptTier,
      );
      return normalizedKind
        ? { kind: normalizedKind }
        : { kind: "generic-unknown" };
    }
    case "coarse-fallback":
      return { kind: "coarse-fallback" };
    case "generic-opt-out":
      return { kind: "generic-opt-out" };
    case "generic-degraded":
      return { kind: "generic-degraded" };
    case "generic-unknown":
    default:
      return { kind: "generic-unknown" };
  }
}

function buildGenericPromptSection(params: {
  contractLine: string;
  intro: string;
}): string {
  return [
    "## Author Experience Context",
    "",
    params.contractLine,
    params.intro,
    "",
    "- Keep the tone neutral and professional",
    "- Explain non-obvious issues briefly, but do not switch into newcomer coaching",
    "- Do not assume deep codebase familiarity or repository-specific expertise",
    "- Avoid contributor-specific framing that depends on inferred experience",
  ].join("\n");
}

export function buildContributorExperiencePromptSection(params: {
  contract?: Partial<
    Pick<
      ContributorExperienceContract,
      "state" | "promptPolicy" | "promptTier" | "degradationPath"
    >
  > | null;
  authorLogin: string;
  areaExpertise?: { dimension: string; topic: string; score: number }[];
}): string {
  const { authorLogin, areaExpertise } = params;
  const promptPolicy = resolveContributorExperiencePromptPolicy(params.contract);

  switch (promptPolicy.kind) {
    case "profile-backed-newcomer":
      return [
        "## Author Experience Context",
        "",
        "Contributor-experience contract: profile-backed.",
        `The PR author (${authorLogin}) appears to be a first-time or new contributor to this repository.`,
        "",
        "Adapt your review tone accordingly:",
        "- Use encouraging, welcoming language",
        "- Explain WHY each finding matters, not just WHAT is wrong",
        "- Link to relevant documentation or examples when suggesting fixes",
        "- Frame suggestions as learning opportunities rather than corrections",
        "- Acknowledge what was done well before noting issues",
        '- Use phrases like "A common pattern here is..." instead of "You should..."',
        "- For MINOR findings, prefer a brief explanation over terse labels",
        "- When suggesting fixes, include a brief code example if the pattern might be unfamiliar",
      ].join("\n");
    case "profile-backed-developing":
      return [
        "## Author Experience Context",
        "",
        "Contributor-experience contract: profile-backed.",
        `The PR author (${authorLogin}) is a developing contributor with growing familiarity in this area.`,
        "",
        "- Provide moderate explanation — mention WHY for non-obvious issues, skip for basic ones",
        "- Include doc links for project-specific patterns but not general language features",
        "- Use a balanced, collaborative tone",
        "- Comment on both style concerns and substantive issues",
      ].join("\n");
    case "profile-backed-established":
      return [
        "## Author Experience Context",
        "",
        "Contributor-experience contract: profile-backed.",
        `The PR author (${authorLogin}) is an established contributor.`,
        "",
        "- Keep explanations brief — one sentence on WHY, then the suggestion",
        "- Skip style-only nitpicks unless they violate project conventions",
        "- Focus on correctness and maintainability over pedagogy",
      ].join("\n");
    case "profile-backed-senior": {
      const lines = [
        "## Author Experience Context",
        "",
        "Contributor-experience contract: profile-backed.",
        `The PR author (${authorLogin}) is a core/senior contributor of this repository.`,
        "",
        "Adapt your review tone accordingly:",
        "- Be concise and assume familiarity with the codebase",
        "- Skip explanations of well-known patterns; focus on the specific issue",
        "- Use terse finding descriptions (issue + consequence only)",
        "- Omit links to basic documentation",
        "- For MINOR findings, a one-liner is sufficient",
        "- Focus on architecture and design, not syntax or style",
        "- Use peer-to-peer tone: direct, brief, no hedging",
      ];

      if (areaExpertise && areaExpertise.length > 0) {
        const strongAreas = areaExpertise.filter((entry) => entry.score >= 0.7);
        if (strongAreas.length > 0) {
          const topics = strongAreas.map((entry) => entry.topic).join(", ");
          lines.push(
            `- The author has deep expertise in ${topics}. Only flag issues you're highly confident about.`,
          );
        }
      }

      return lines.join("\n");
    }
    case "coarse-fallback":
      return [
        "## Author Experience Context",
        "",
        "Contributor-experience contract: coarse-fallback.",
        `The PR author (${authorLogin}) is being reviewed with only coarse fallback signals for this repository.`,
        "",
        "- Use a balanced, neutral tone",
        "- Explain non-obvious issues briefly, but avoid patronizing beginner framing",
        "- Do not assume deep codebase ownership or senior-context shorthand",
        "- Keep guidance practical and specific to the changed code",
      ].join("\n");
    case "generic-opt-out":
      return buildGenericPromptSection({
        contractLine: "Contributor-experience contract: generic-opt-out.",
        intro: `Contributor-specific guidance is disabled by opt-out for the PR author (${authorLogin}).`,
      });
    case "generic-degraded":
      return buildGenericPromptSection({
        contractLine: "Contributor-experience contract: generic-degraded.",
        intro: `Fallback contributor signals are unavailable for the PR author (${authorLogin})${params.contract?.degradationPath ? ` (${params.contract.degradationPath})` : ""}.`,
      });
    case "generic-unknown":
    default:
      return buildGenericPromptSection({
        contractLine: "Contributor-experience contract: generic-unknown.",
        intro: `No reliable contributor signal is available for the PR author (${authorLogin}).`,
      });
  }
}

function normalizeContributorExperienceTier(tier: unknown): AuthorTier | null {
  switch (tier) {
    case "first-time":
    case "newcomer":
      return "newcomer";
    case "regular":
    case "developing":
      return "developing";
    case "established":
      return "established";
    case "core":
    case "senior":
      return "senior";
    default:
      return null;
  }
}

export function resolveContributorExperienceSlackProfileProjection(params: {
  source: ContributorExperienceSource;
  tier?: unknown;
  optedOut?: boolean;
  degraded?: boolean;
  degradationPath?: string | null;
}): ContributorExperienceSlackProfileProjection {
  const contract = projectContributorExperienceContract({
    source: params.source,
    tier: normalizeContributorExperienceTier(params.tier),
    optedOut: params.optedOut,
    degraded: params.degraded,
    degradationPath: params.degradationPath,
  });

  switch (contract.state) {
    case "profile-backed":
      return {
        state: contract.state,
        statusLine: "Status: Linked contributor guidance is active.",
        summaryLine:
          "Kodiai can adapt review guidance using your linked contributor profile.",
        showExpertise: true,
      };
    case "coarse-fallback":
      return {
        state: contract.state,
        statusLine: "Status: Fallback contributor guidance is active.",
        summaryLine:
          "Kodiai can use limited contributor signals when a linked profile is unavailable.",
        showExpertise: true,
      };
    case "generic-opt-out":
      return {
        state: contract.state,
        statusLine: "Status: Generic contributor guidance is active.",
        summaryLine:
          "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
        showExpertise: false,
      };
    case "generic-degraded":
      return {
        state: contract.state,
        statusLine: "Status: Generic contributor guidance is active.",
        summaryLine:
          "Contributor-specific fallback signals are unavailable right now, so Kodiai is using generic guidance.",
        showExpertise: false,
      };
    case "generic-unknown":
    default:
      return {
        state: contract.state,
        statusLine: "Status: Generic contributor guidance is active.",
        summaryLine:
          "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
        showExpertise: false,
      };
  }
}

export function projectLegacyContributorExperienceContract(
  tier: AuthorTier,
): ContributorExperienceContract {
  return projectContributorExperienceContract({
    source: "contributor-profile",
    tier: normalizeContributorExperienceTier(tier) ?? "newcomer",
  });
}

export function projectContributorExperienceContract(params: {
  source: ContributorExperienceSource;
  tier?: AuthorTier | null;
  optedOut?: boolean;
  degraded?: boolean;
  degradationPath?: string | null;
}): ContributorExperienceContract {
  const tier = params.tier ?? null;
  const degradationPath = params.degradationPath ?? null;

  if (params.optedOut) {
    return {
      state: "generic-opt-out",
      source: params.source,
      reviewBehavior: "generic",
      promptTier: null,
      promptPolicy: {
        kind: "generic-opt-out",
      },
      degraded: false,
      degradationPath,
      reviewDetails: {
        state: "generic-opt-out",
        text: "generic-opt-out (contributor-specific guidance disabled by opt-out)",
      },
    };
  }

  if (params.degraded) {
    return {
      state: "generic-degraded",
      source: params.source,
      reviewBehavior: "generic",
      promptTier: null,
      promptPolicy: {
        kind: "generic-degraded",
      },
      degraded: true,
      degradationPath,
      reviewDetails: {
        state: "generic-degraded",
        text: `generic-degraded (fallback signals unavailable: ${degradationPath ?? "unknown"})`,
      },
    };
  }

  if (params.source === "contributor-profile" && tier) {
    return {
      state: "profile-backed",
      source: params.source,
      reviewBehavior: "adapted-profile-backed",
      promptTier: tier,
      promptPolicy: {
        kind: normalizeProfileBackedPromptPolicyKind(tier) ?? "generic-unknown",
      },
      degraded: false,
      degradationPath,
      reviewDetails: {
        state: "profile-backed",
        text: "profile-backed (using linked contributor profile guidance)",
      },
    };
  }

  if (
    (params.source === "author-cache" ||
      params.source === "github-search" ||
      params.source === "author-association") &&
    tier
  ) {
    return {
      state: "coarse-fallback",
      source: params.source,
      reviewBehavior: "adapted-coarse-fallback",
      promptTier: tier,
      promptPolicy: {
        kind: "coarse-fallback",
      },
      degraded: false,
      degradationPath,
      reviewDetails: {
        state: "coarse-fallback",
        text: "coarse-fallback (using coarse fallback signals only)",
      },
    };
  }

  return {
    state: "generic-unknown",
    source: "none",
    reviewBehavior: "generic",
    promptTier: null,
    promptPolicy: {
      kind: "generic-unknown",
    },
    degraded: false,
    degradationPath,
    reviewDetails: {
      state: "generic-unknown",
      text: "generic-unknown (no reliable contributor signal available)",
    },
  };
}
