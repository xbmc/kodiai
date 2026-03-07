// ---------------------------------------------------------------------------
// Slack Surface Adapter
// ---------------------------------------------------------------------------
// Handles Slack assistant responses.
// Grounding context: retrieval results, repo code context, user message.
// ---------------------------------------------------------------------------

import { extractClaims } from "../../claim-classifier.ts";
import type { SurfaceAdapter, GroundingContext } from "../types.ts";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export type SlackInput = {
  retrievalResults?: string[];
  repoContext?: string[];
  userMessage: string;
};

export type SlackOutput = string;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const slackAdapter: SurfaceAdapter<SlackInput, SlackOutput> = {
  surface: "slack",
  minContentThreshold: 5,

  extractClaims(output: SlackOutput): string[] {
    if (!output || output.trim().length === 0) return [];
    return extractClaims(output);
  },

  buildGroundingContext(input: SlackInput): GroundingContext {
    const providedContext: string[] = [];
    const contextSources: string[] = [];

    if (input.retrievalResults?.length) {
      providedContext.push(...input.retrievalResults);
      contextSources.push("retrieval");
    }

    if (input.repoContext?.length) {
      providedContext.push(...input.repoContext);
      contextSources.push("repo-code");
    }

    providedContext.push(input.userMessage);
    contextSources.push("user-message");

    return { providedContext, contextSources };
  },

  reconstructOutput(output: SlackOutput, keptClaims: string[]): SlackOutput {
    if (keptClaims.length === 0) return "";
    return keptClaims.join(" ").trim();
  },
};
