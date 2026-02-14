export type AuthorTier = "first-time" | "regular" | "core";

export type AuthorClassification = {
  tier: AuthorTier;
  authorAssociation: string;
  prCount: number | null;
  cachedAt: string | null;
};

export function classifyAuthor(params: {
  authorAssociation: string;
  prCount?: number | null;
}): AuthorClassification {
  const normalizedAssociation = (params.authorAssociation || "").toUpperCase();
  const prCount = typeof params.prCount === "number" ? params.prCount : null;

  if (normalizedAssociation === "MEMBER" || normalizedAssociation === "OWNER") {
    return {
      tier: "core",
      authorAssociation: normalizedAssociation,
      prCount,
      cachedAt: null,
    };
  }

  if (
    normalizedAssociation === "FIRST_TIMER" ||
    normalizedAssociation === "FIRST_TIME_CONTRIBUTOR"
  ) {
    return {
      tier: "first-time",
      authorAssociation: normalizedAssociation,
      prCount,
      cachedAt: null,
    };
  }

  if (prCount !== null) {
    if (prCount <= 1) {
      return {
        tier: "first-time",
        authorAssociation: normalizedAssociation,
        prCount,
        cachedAt: null,
      };
    }
    if (prCount <= 9) {
      return {
        tier: "regular",
        authorAssociation: normalizedAssociation,
        prCount,
        cachedAt: null,
      };
    }
    return {
      tier: "core",
      authorAssociation: normalizedAssociation,
      prCount,
      cachedAt: null,
    };
  }

  if (
    normalizedAssociation === "COLLABORATOR" ||
    normalizedAssociation === "CONTRIBUTOR"
  ) {
    return {
      tier: "regular",
      authorAssociation: normalizedAssociation,
      prCount,
      cachedAt: null,
    };
  }

  return {
    tier: "first-time",
    authorAssociation: normalizedAssociation,
    prCount,
    cachedAt: null,
  };
}
