import { describe, expect, test } from "bun:test";
import * as contributorExperienceContract from "./experience-contract.ts";
import {
  projectContributorExperienceContract,
  resolveContributorExperienceRetrievalHint,
} from "./experience-contract.ts";

describe("projectContributorExperienceContract", () => {
  test("projects profile-backed guidance from contributor profile provenance", () => {
    const contract = projectContributorExperienceContract({
      source: "contributor-profile",
      tier: "established",
    });

    expect(contract.state).toBe("profile-backed");
    expect(contract.reviewBehavior).toBe("adapted-profile-backed");
    expect(contract.promptTier).toBe("established");
    expect(contract.reviewDetails.text).toBe(
      "profile-backed (using linked contributor profile guidance)",
    );
    expect((contract as any).promptPolicy).toEqual({
      kind: "profile-backed-established",
    });
  });

  test("projects coarse-fallback guidance from low-confidence fallback signals", () => {
    const contract = projectContributorExperienceContract({
      source: "github-search",
      tier: "regular",
    });

    expect(contract.state).toBe("coarse-fallback");
    expect(contract.reviewBehavior).toBe("adapted-coarse-fallback");
    expect(contract.promptTier).toBe("regular");
    expect(contract.reviewDetails.text).toBe(
      "coarse-fallback (using coarse fallback signals only)",
    );
    expect((contract as any).promptPolicy).toEqual({
      kind: "coarse-fallback",
    });
  });

  test("projects a generic unknown state when no contributor signal is available", () => {
    const contract = projectContributorExperienceContract({
      source: "none",
      tier: null,
    });

    expect(contract.state).toBe("generic-unknown");
    expect(contract.reviewBehavior).toBe("generic");
    expect(contract.promptTier).toBeNull();
    expect(contract.reviewDetails.text).toBe(
      "generic-unknown (no reliable contributor signal available)",
    );
    expect((contract as any).promptPolicy).toEqual({
      kind: "generic-unknown",
    });
  });

  test("projects a generic opt-out state ahead of otherwise profile-backed data", () => {
    const contract = projectContributorExperienceContract({
      source: "contributor-profile",
      tier: "senior",
      optedOut: true,
    });

    expect(contract.state).toBe("generic-opt-out");
    expect(contract.reviewBehavior).toBe("generic");
    expect(contract.promptTier).toBeNull();
    expect(contract.reviewDetails.text).toBe(
      "generic-opt-out (contributor-specific guidance disabled by opt-out)",
    );
    expect((contract as any).promptPolicy).toEqual({
      kind: "generic-opt-out",
    });
  });

  test("projects a generic degraded state when fallback enrichment is unavailable", () => {
    const contract = projectContributorExperienceContract({
      source: "github-search",
      tier: "regular",
      degraded: true,
      degradationPath: "search-api-rate-limit",
    });

    expect(contract.state).toBe("generic-degraded");
    expect(contract.reviewBehavior).toBe("generic");
    expect(contract.promptTier).toBeNull();
    expect(contract.degradationPath).toBe("search-api-rate-limit");
    expect(contract.reviewDetails.text).toBe(
      "generic-degraded (fallback signals unavailable: search-api-rate-limit)",
    );
    expect((contract as any).promptPolicy).toEqual({
      kind: "generic-degraded",
    });
  });
});

describe("resolveContributorExperienceRetrievalHint", () => {
  test("emits normalized hints only for adapted contract states", () => {
    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "newcomer",
        }),
      ),
    ).toBe("new contributor");

    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "developing",
        }),
      ),
    ).toBe("developing contributor");

    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "established",
        }),
      ),
    ).toBe("established contributor");

    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "senior",
        }),
      ),
    ).toBe("senior contributor");

    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "github-search",
          tier: "regular",
        }),
      ),
    ).toBe("returning contributor");
  });

  test("emits no retrieval hint for generic contract states", () => {
    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "none",
          tier: null,
        }),
      ),
    ).toBeNull();

    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "contributor-profile",
          tier: "senior",
          optedOut: true,
        }),
      ),
    ).toBeNull();

    expect(
      resolveContributorExperienceRetrievalHint(
        projectContributorExperienceContract({
          source: "github-search",
          tier: "regular",
          degraded: true,
          degradationPath: "search-api-rate-limit",
        }),
      ),
    ).toBeNull();
  });

  test("treats malformed contract inputs as generic and emits no hint", () => {
    expect(
      resolveContributorExperienceRetrievalHint({
        state: "profile-backed",
        promptTier: "mystery-tier" as never,
      }),
    ).toBeNull();

    expect(
      resolveContributorExperienceRetrievalHint({
        state: "unsupported-state" as never,
        promptTier: "senior",
      }),
    ).toBeNull();
  });
});

describe("resolveContributorExperienceSlackProfileProjection", () => {
  test("renders linked-profile Slack copy without raw tier semantics", () => {
    const projection = contributorExperienceContract
      .resolveContributorExperienceSlackProfileProjection?.({
        source: "contributor-profile",
        tier: "established",
      });

    expect(projection).toEqual({
      state: "profile-backed",
      statusLine: "Status: Linked contributor guidance is active.",
      summaryLine:
        "Kodiai can adapt review guidance using your linked contributor profile.",
      showExpertise: true,
    });
  });

  test("renders opted-out Slack copy as generic and hides expertise context", () => {
    const projection = contributorExperienceContract
      .resolveContributorExperienceSlackProfileProjection?.({
        source: "contributor-profile",
        tier: "senior",
        optedOut: true,
      });

    expect(projection).toEqual({
      state: "generic-opt-out",
      statusLine: "Status: Generic contributor guidance is active.",
      summaryLine:
        "You opted out of contributor-specific guidance. Kodiai will keep reviews generic until you opt back in.",
      showExpertise: false,
    });
  });

  test("treats malformed stored tier data as generic Slack copy", () => {
    const projection = contributorExperienceContract
      .resolveContributorExperienceSlackProfileProjection?.({
        source: "contributor-profile",
        tier: "mystery-tier",
      });

    expect(projection).toEqual({
      state: "generic-unknown",
      statusLine: "Status: Generic contributor guidance is active.",
      summaryLine:
        "Kodiai does not have a reliable contributor signal for this profile yet, so reviews stay generic.",
      showExpertise: false,
    });
  });
});
