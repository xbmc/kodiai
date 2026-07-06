import type { Logger } from "pino";
import type { PromptBuildResult } from "../execution/prompt-section-metrics.ts";
import {
  buildMentionContextDetails,
  buildMentionContextFingerprint,
} from "../execution/mention-context.ts";
import type { SearchCache } from "../lib/search-cache.ts";
import { buildSearchCacheKey } from "../lib/search-cache.ts";
import type { MentionEvent } from "./mention-types.ts";
import {
  deriveMentionAdmissionPolicy,
  type MentionAdmissionConfigSource,
} from "./mention-request-classification.ts";

export type MentionDerivedContextCacheStatus = "hit" | "miss" | "degraded" | "bypass";

export type MentionDerivedContext = {
  mentionContext: string;
  mentionContextSectionMetrics: PromptBuildResult["sections"];
  mentionAdmissionPolicy: ReturnType<typeof deriveMentionAdmissionPolicy>;
  mentionDerivedContextCacheStatus: MentionDerivedContextCacheStatus;
  mentionDerivedContextCacheReason: string | null;
};

type MentionDerivedContextInput = {
  octokit: Parameters<typeof buildMentionContextFingerprint>[0];
  mention: MentionEvent;
  explicitReviewRequest: boolean;
  mentionAdmission: {
    explicitReview: MentionAdmissionConfigSource;
    conversational: MentionAdmissionConfigSource;
  };
  maxThreadChars: number;
  findingLookup: NonNullable<Parameters<typeof buildMentionContextFingerprint>[2]>["findingLookup"];
  cache: SearchCache<PromptBuildResult>;
  getCacheErrorCount: () => number;
  logger: Logger;
};

export async function buildMentionDerivedContext(
  params: MentionDerivedContextInput,
): Promise<MentionDerivedContext> {
  const mentionAdmissionPolicy = deriveMentionAdmissionPolicy({
    explicitReviewRequest: params.explicitReviewRequest,
    mentionAdmission: params.mentionAdmission,
  });

  try {
    const fingerprintResult = await buildMentionContextFingerprint(params.octokit, params.mention, {
      admissionPolicy: mentionAdmissionPolicy,
      findingLookup: params.findingLookup,
      maxThreadChars: params.maxThreadChars,
      logger: params.logger,
    });

    if (fingerprintResult.fingerprint) {
      const cacheKey = buildSearchCacheKey({
        repo: `${params.mention.owner}/${params.mention.repo}`,
        searchType: "mention-derived-context",
        query: `${params.mention.surface}:${params.mention.issueNumber}:${params.mention.commentId}`,
        extra: {
          fingerprint: fingerprintResult.fingerprint,
        },
      });
      const cacheErrorsBeforeLookup = params.getCacheErrorCount();
      let loaderExecuted = false;
      const mentionContextResult = await params.cache.getOrLoad(
        cacheKey,
        async () => {
          loaderExecuted = true;
          return await buildMentionContextDetails(params.octokit, params.mention, {
            admissionPolicy: mentionAdmissionPolicy,
            findingLookup: params.findingLookup,
            maxThreadChars: params.maxThreadChars,
          });
        },
      );
      const cacheDegraded = params.getCacheErrorCount() > cacheErrorsBeforeLookup;
      return {
        mentionContext: mentionContextResult.text,
        mentionContextSectionMetrics: mentionContextResult.sections,
        mentionAdmissionPolicy,
        mentionDerivedContextCacheStatus: cacheDegraded
          ? "degraded"
          : loaderExecuted
            ? "miss"
            : "hit",
        mentionDerivedContextCacheReason: null,
      };
    }

    const mentionContextResult = await buildMentionContextDetails(params.octokit, params.mention, {
      admissionPolicy: mentionAdmissionPolicy,
      findingLookup: params.findingLookup,
      maxThreadChars: params.maxThreadChars,
    });
    return {
      mentionContext: mentionContextResult.text,
      mentionContextSectionMetrics: mentionContextResult.sections,
      mentionAdmissionPolicy,
      mentionDerivedContextCacheStatus: "bypass",
      mentionDerivedContextCacheReason: fingerprintResult.missingSignals.join(",") || "incomplete-fingerprint",
    };
  } catch (err) {
    params.logger.warn(
      { err, surface: params.mention.surface, issueNumber: params.mention.issueNumber },
      "Failed to build mention context; proceeding with empty context",
    );
    return {
      mentionContext: "",
      mentionContextSectionMetrics: [],
      mentionAdmissionPolicy,
      mentionDerivedContextCacheStatus: "degraded",
      mentionDerivedContextCacheReason: "context-build-failed",
    };
  }
}
