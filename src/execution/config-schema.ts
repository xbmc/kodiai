/**
 * Zod schema definitions for `.kodiai.yml`.
 *
 * Kept apart from the loader so the declarative shape of repo configuration --
 * which is the part contributors actually read when adding a setting -- is not
 * buried above several hundred lines of parsing, sanitization, and fail-open
 * warning logic.
 */
import { z } from "zod";
import {
  REPO_DOCTRINE_CATEGORIES,
  REPO_DOCTRINE_CONTRACT_TYPES,
  REPO_DOCTRINE_LIMITS,
  REPO_DOCTRINE_SEVERITIES,
} from "../repo-doctrine/contracts.ts";

export const MAX_REPO_CONFIG_BYTES = 256 * 1024;

const writeSecretScanSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({ enabled: true });

export const writeSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** If set, every changed path must match at least one allowPaths pattern. */
    allowPaths: z.array(z.string()).default([]),
    /** Changed paths matching any denyPaths pattern are blocked. Deny wins over allow. */
    denyPaths: z
      .array(z.string())
      .default([
        ".github/",
        ".git/",
        ".planning/",
        ".kodiai.yml",
        ".env",
        ".env.*",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
        "**/*credentials*",
        "**/*secret*",
      ]),
    /** Basic rate limit for write-mode requests. 0 = no limit. */
    minIntervalSeconds: z.number().min(0).max(86400).default(0),
    secretScan: writeSecretScanSchema,
  })
  .default({
    enabled: false,
    allowPaths: [],
    denyPaths: [
      ".github/",
      ".git/",
      ".planning/",
      ".kodiai.yml",
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/*credentials*",
      "**/*secret*",
    ],
    minIntervalSeconds: 0,
    secretScan: { enabled: true },
  });

const reviewTriggersSchema = z
  .object({
    onOpened: z.boolean().default(true),
    onReadyForReview: z.boolean().default(true),
    onReviewRequested: z.boolean().default(true),
    onSynchronize: z.boolean().default(false),
  })
  .default({
    onOpened: true,
    onReadyForReview: true,
    onReviewRequested: true,
    onSynchronize: false,
  });

const pathInstructionSchema = z.object({
  path: z.union([z.string(), z.array(z.string())]),
  instructions: z.string(),
});

const suppressionPatternSchema = z.object({
  pattern: z.string().min(1),
  severity: z
    .array(z.enum(["critical", "major", "medium", "minor"]))
    .optional(),
  category: z
    .array(
      z.enum([
        "security",
        "correctness",
        "performance",
        "style",
        "documentation",
      ]),
    )
    .optional(),
  paths: z.array(z.string()).optional(),
});

const findingPrioritizationWeightsSchema = z
  .object({
    severity: z.number().min(0).max(1).default(0.45),
    fileRisk: z.number().min(0).max(1).default(0.3),
    category: z.number().min(0).max(1).default(0.15),
    recurrence: z.number().min(0).max(1).default(0.1),
  })
  .default({
    severity: 0.45,
    fileRisk: 0.3,
    category: 0.15,
    recurrence: 0.1,
  });

const DEFAULT_FORMATTER_SUGGESTION_COMMAND = "git clang-format --diff origin/{baseRef} HEAD";

const formatterSuggestionsSchema = z
  .object({
    /** Enable automatic formatter-suggestion reviews. Explicit mention requests are handled separately. */
    automatic: z.boolean().default(false),
    /** Repo-controlled formatter command used by downstream suggestion generation. */
    command: z.string().min(1).default(DEFAULT_FORMATTER_SUGGESTION_COMMAND),
    /** Maximum formatter suggestions to surface for a request. */
    maxSuggestions: z.number().min(1).max(100).default(10),
  })
  .default({
    automatic: false,
    command: DEFAULT_FORMATTER_SUGGESTION_COMMAND,
    maxSuggestions: 10,
  });

const graphValidationSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({ enabled: false });

const semanticGroundingSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({ enabled: false });

const repoDoctrineContractSchema = z.object({
  id: z.string().trim().min(1).max(REPO_DOCTRINE_LIMITS.maxIdLength),
  type: z.enum(REPO_DOCTRINE_CONTRACT_TYPES),
  paths: z.array(
    z.string().trim().min(1).max(REPO_DOCTRINE_LIMITS.maxGlobLength),
  ).min(1).max(REPO_DOCTRINE_LIMITS.maxPathGlobsPerContract),
  severity: z.enum(REPO_DOCTRINE_SEVERITIES).default("medium"),
  category: z.enum(REPO_DOCTRINE_CATEGORIES).default("correctness"),
  instructions: z.string().min(1).max(REPO_DOCTRINE_LIMITS.maxInstructionLength),
  evidence: z.string().min(1).max(REPO_DOCTRINE_LIMITS.maxEvidenceLength),
});

export const repoDoctrineSchema = z
  .object({
    enabled: z.boolean().default(false),
    contracts: z.array(repoDoctrineContractSchema)
      .max(REPO_DOCTRINE_LIMITS.maxContracts)
      .default([]),
  })
  .default({ enabled: false, contracts: [] });

export const reviewSchema = z
  .object({
    enabled: z.boolean().default(true),
    triggers: reviewTriggersSchema,
    autoApprove: z.boolean().default(false),
    prompt: z.string().optional(),
    skipAuthors: z.array(z.string()).default([]),
    skipPaths: z.array(z.string()).default([]),
    /** Review mode: standard preserves current behavior, enhanced adds structured YAML metadata per comment. */
    mode: z.enum(["standard", "enhanced"]).default("standard"),
    /** Severity filtering: only report findings at or above this level. */
    severity: z
      .object({
        minLevel: z
          .enum(["critical", "major", "medium", "minor"])
          .default("minor"),
      })
      .default({ minLevel: "minor" }),
    /** Focus area targeting: concentrate review on these categories. Empty = all categories. */
    focusAreas: z
      .array(
        z.enum([
          "security",
          "correctness",
          "performance",
          "style",
          "documentation",
        ]),
      )
      .default([]),
    /** Explicit exclude list: skip these categories unless finding is CRITICAL. */
    ignoredAreas: z
      .array(
        z.enum([
          "security",
          "correctness",
          "performance",
          "style",
          "documentation",
        ]),
      )
      .default([]),
    /** Maximum inline comments per review. Range 1-25, default 7. */
    maxComments: z.number().min(1).max(25).default(7),
    suppressions: z
      .array(z.union([z.string().min(1), suppressionPatternSchema]))
      .default([]),
    minConfidence: z.number().min(0).max(100).default(0),
    prioritization: findingPrioritizationWeightsSchema,
    formatterSuggestions: formatterSuggestionsSchema,
    graphValidation: graphValidationSchema,
    semanticGrounding: semanticGroundingSchema,
    doctrine: repoDoctrineSchema,
    pathInstructions: z.array(pathInstructionSchema).default([]),
    profile: z.enum(["strict", "balanced", "minimal"]).optional(),
    /** Output language for review prose. Free-form string (ISO code or full name). Default: "en". */
    outputLanguage: z.string().default("en"),
    fileCategories: z
      .object({
        source: z.array(z.string()).optional(),
        test: z.array(z.string()).optional(),
        config: z.array(z.string()).optional(),
        docs: z.array(z.string()).optional(),
        infra: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .default({
    enabled: true,
    triggers: {
      onOpened: true,
      onReadyForReview: true,
      onReviewRequested: true,
      onSynchronize: false,
    },
    autoApprove: false,
    skipAuthors: [],
    skipPaths: [],
    mode: "standard",
    severity: { minLevel: "minor" },
    focusAreas: [],
    ignoredAreas: [],
    maxComments: 7,
    suppressions: [],
    minConfidence: 0,
    prioritization: {
      severity: 0.45,
      fileRisk: 0.3,
      category: 0.15,
      recurrence: 0.1,
    },
    formatterSuggestions: {
      automatic: false,
      command: DEFAULT_FORMATTER_SUGGESTION_COMMAND,
      maxSuggestions: 10,
    },
    graphValidation: { enabled: false },
    semanticGrounding: { enabled: false },
    doctrine: { enabled: false, contracts: [] },
    pathInstructions: [],
    outputLanguage: "en",
  });

const conversationSchema = z
  .object({
    maxTurnsPerPr: z.number().min(1).max(50).default(10),
    contextBudgetChars: z.number().min(1000).max(50000).default(8000),
  })
  .default({ maxTurnsPerPr: 10, contextBudgetChars: 8000 });

const mentionAdmissionRuleSchema = z
  .object({
    includeConversationHistory: z.boolean().default(false),
    includePrMetadata: z.boolean().default(false),
    includeReviewThread: z.boolean().default(false),
    includeInlineReviewContext: z.boolean().default(false),
  });

const mentionAdmissionSchema = z
  .object({
    conversational: mentionAdmissionRuleSchema.default({
      includeConversationHistory: false,
      includePrMetadata: false,
      includeReviewThread: false,
      includeInlineReviewContext: false,
    }),
    explicitReview: mentionAdmissionRuleSchema.default({
      includeConversationHistory: true,
      includePrMetadata: true,
      includeReviewThread: true,
      includeInlineReviewContext: true,
    }),
  })
  .default({
    conversational: {
      includeConversationHistory: false,
      includePrMetadata: false,
      includeReviewThread: false,
      includeInlineReviewContext: false,
    },
    explicitReview: {
      includeConversationHistory: true,
      includePrMetadata: true,
      includeReviewThread: true,
      includeInlineReviewContext: true,
    },
  });

export const mentionSchema = z
  .object({
    enabled: z.boolean().default(true),
    acceptClaudeAlias: z.boolean().default(true),
    /** If non-empty, only these GitHub users can trigger @kodiai mentions. Empty = all users allowed. */
    allowedUsers: z.array(z.string()).default([]),
    prompt: z.string().optional(),
    conversation: conversationSchema,
    admission: mentionAdmissionSchema,
  })
  .default({
    enabled: true,
    acceptClaudeAlias: true,
    allowedUsers: [],
    conversation: { maxTurnsPerPr: 10, contextBudgetChars: 8000 },
    admission: {
      conversational: {
        includeConversationHistory: false,
        includePrMetadata: false,
        includeReviewThread: false,
        includeInlineReviewContext: false,
      },
      explicitReview: {
        includeConversationHistory: true,
        includePrMetadata: true,
        includeReviewThread: true,
        includeInlineReviewContext: true,
      },
    },
  });

export const telemetrySchema = z
  .object({
    /** If false, skip telemetry recording for this repo. Default: true. */
    enabled: z.boolean().default(true),
    /** If set and > 0, warn when execution cost exceeds this USD threshold. 0 = no warning. */
    costWarningUsd: z.number().min(0).default(0),
  })
  .default({ enabled: true, costWarningUsd: 0 });

const embeddingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    model: z.string().default("voyage-4"),
    dimensions: z.number().min(256).max(2048).default(1024),
  })
  .default({ enabled: true, model: "voyage-4", dimensions: 1024 });

const sharingSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({ enabled: false });

const hunkEmbeddingSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxHunksPerPr: z.number().min(1).max(1000).default(100),
    minChangedLines: z.number().min(1).max(50).default(3),
    excludePatterns: z.array(z.string()).default([
      "*.lock",
      "vendor/**",
      "generated/**",
      "*.generated.*",
      "*.min.js",
      "*.min.css",
      "dist/**",
      "build/**",
      "node_modules/**",
    ]),
  })
  .default({
    enabled: true,
    maxHunksPerPr: 100,
    minChangedLines: 3,
    excludePatterns: [
      "*.lock", "vendor/**", "generated/**", "*.generated.*",
      "*.min.js", "*.min.css", "dist/**", "build/**", "node_modules/**",
    ],
  });

const retrievalSchema = z
  .object({
    enabled: z.boolean().default(true),
    topK: z.number().min(1).max(20).default(5),
    distanceThreshold: z.number().min(0).max(2).default(0.3),
    adaptive: z.boolean().default(true),
    maxContextChars: z.number().min(0).max(5000).default(2000),
    /** Hunk-level PR diff embedding configuration. */
    hunkEmbedding: hunkEmbeddingSchema,
  })
  .default({
    enabled: true,
    topK: 5,
    distanceThreshold: 0.3,
    adaptive: true,
    maxContextChars: 2000,
    hunkEmbedding: {
      enabled: true,
      maxHunksPerPr: 100,
      minChangedLines: 3,
      excludePatterns: [
        "*.lock", "vendor/**", "generated/**", "*.generated.*",
        "*.min.js", "*.min.css", "dist/**", "build/**", "node_modules/**",
      ],
    },
  });

export const knowledgeSchema = z
  .object({
    /**
     * Global knowledge sharing is opt-in only.
     * false = repository-scoped writes only.
     * @deprecated Use sharing.enabled instead.
     */
    shareGlobal: z.boolean().default(false),
    /** Owner-level sharing configuration. */
    sharing: sharingSchema,
    /** Embedding generation configuration. */
    embeddings: embeddingsSchema,
    /** Retrieval configuration for context-aware reviews. */
    retrieval: retrievalSchema,
  })
  .default({
    shareGlobal: false,
    sharing: { enabled: false },
    embeddings: { enabled: true, model: "voyage-4", dimensions: 1024 },
    retrieval: {
      enabled: true,
      topK: 5,
      distanceThreshold: 0.3,
      adaptive: true,
      maxContextChars: 2000,
      hunkEmbedding: {
        enabled: true,
        maxHunksPerPr: 100,
        minChangedLines: 3,
        excludePatterns: [
          "*.lock", "vendor/**", "generated/**", "*.generated.*",
          "*.min.js", "*.min.css", "dist/**", "build/**", "node_modules/**",
        ],
      },
    },
  });

const severityFloorOverrideSchema = z.object({
  pattern: z.string().min(1),
  language: z.string().optional(),
  minSeverity: z.enum(["critical", "major", "medium", "minor"]),
  skipTestFiles: z.boolean().default(true),
});

const toolingOverrideSchema = z.object({
  language: z.string(),
  suppressFormatting: z.boolean().default(true),
  suppressImportOrder: z.boolean().default(true),
  configFiles: z.array(z.string()).optional(),
});

export const languageRulesSchema = z
  .object({
    severityFloors: z.array(severityFloorOverrideSchema).default([]),
    toolingOverrides: z.array(toolingOverrideSchema).default([]),
    disableBuiltinFloors: z.boolean().default(false),
  })
  .default({
    severityFloors: [],
    toolingOverrides: [],
    disableBuiltinFloors: false,
  });

const riskWeightsSchema = z
  .object({
    linesChanged: z.number().min(0).max(1).default(0.3),
    pathRisk: z.number().min(0).max(1).default(0.3),
    fileCategory: z.number().min(0).max(1).default(0.2),
    languageRisk: z.number().min(0).max(1).default(0.1),
    fileExtension: z.number().min(0).max(1).default(0.1),
  })
  .default({
    linesChanged: 0.3,
    pathRisk: 0.3,
    fileCategory: 0.2,
    languageRisk: 0.1,
    fileExtension: 0.1,
  });

export const largePRSchema = z
  .object({
    /** Number of files that triggers large PR triage. Default 50. */
    fileThreshold: z.number().min(10).max(1000).default(50),
    /** Number of files to review at full depth. Default 30. */
    fullReviewCount: z.number().min(5).max(200).default(30),
    /** Number of files to review at abbreviated depth (critical/major only). Default 20. */
    abbreviatedCount: z.number().min(0).max(200).default(20),
    /** Risk scoring weights. Normalized at runtime so they need not sum to exactly 1.0. */
    riskWeights: riskWeightsSchema,
  })
  .default({
    fileThreshold: 50,
    fullReviewCount: 30,
    abbreviatedCount: 20,
    riskWeights: {
      linesChanged: 0.3,
      pathRisk: 0.3,
      fileCategory: 0.2,
      languageRisk: 0.1,
      fileExtension: 0.1,
    },
  });

export const timeoutSchema = z
  .object({
    dynamicScaling: z.boolean().default(true),
    autoReduceScope: z.boolean().default(true),
  })
  .default({ dynamicScaling: true, autoReduceScope: true });

const feedbackAutoSuppressThresholdsSchema = z
  .object({
    minThumbsDown: z.number().min(1).max(50).default(3),
    minDistinctReactors: z.number().min(1).max(50).default(3),
    minDistinctPRs: z.number().min(1).max(50).default(2),
  })
  .default({
    minThumbsDown: 3,
    minDistinctReactors: 3,
    minDistinctPRs: 2,
  });

const feedbackAutoSuppressSchema = z
  .object({
    enabled: z.boolean().default(false),
    thresholds: feedbackAutoSuppressThresholdsSchema,
  })
  .default({
    enabled: false,
    thresholds: {
      minThumbsDown: 3,
      minDistinctReactors: 3,
      minDistinctPRs: 2,
    },
  });

export const feedbackSchema = z
  .object({
    autoSuppress: feedbackAutoSuppressSchema,
  })
  .default({
    autoSuppress: {
      enabled: false,
      thresholds: {
        minThumbsDown: 3,
        minDistinctReactors: 3,
        minDistinctPRs: 2,
      },
    },
  });

export const triageSchema = z
  .object({
    /** Master switch for triage tools. Default: false (opt-in). */
    enabled: z.boolean().default(false),
    /** Auto-triage new issues on `issues.opened` webhook. Default: false (opt-in). */
    autoTriageOnOpen: z.boolean().default(false),
    /** Similarity percentage cutoff for duplicate detection. 75 = 0.25 cosine distance. */
    duplicateThreshold: z.number().min(0).max(100).default(75),
    /** Maximum duplicate candidates to show in triage comment. */
    maxDuplicateCandidates: z.number().min(1).max(10).default(3),
    /** Label to apply when duplicate candidates are found. */
    duplicateLabel: z.string().default("possible-duplicate"),
    label: z
      .object({
        enabled: z.boolean().default(true),
      })
      .default({ enabled: true }),
    comment: z
      .object({
        enabled: z.boolean().default(true),
      })
      .default({ enabled: true }),
    /** Allowed label patterns for convention-based triage labels. Empty = allow all. */
    labelAllowlist: z.array(z.string()).default([]),
    /** Per-issue cooldown in minutes before re-triaging. 0 = no cooldown. Default: 30. */
    cooldownMinutes: z.number().min(0).max(1440).default(30),
    /** Troubleshooting retrieval config for resolved-issue guidance. */
    troubleshooting: z.object({
      enabled: z.boolean().default(false),
      similarityThreshold: z.number().min(0).max(1).default(0.65),
      maxResults: z.number().min(1).max(10).default(3),
      totalBudgetChars: z.number().min(1000).max(50000).default(12000),
    }).default({
      enabled: false,
      similarityThreshold: 0.65,
      maxResults: 3,
      totalBudgetChars: 12000,
    }),
  })
  .default({
    enabled: false,
    autoTriageOnOpen: false,
    duplicateThreshold: 75,
    maxDuplicateCandidates: 3,
    duplicateLabel: "possible-duplicate",
    label: { enabled: true },
    comment: { enabled: true },
    labelAllowlist: [],
    cooldownMinutes: 30,
    troubleshooting: {
      enabled: false,
      similarityThreshold: 0.65,
      maxResults: 3,
      totalBudgetChars: 12000,
    },
  });

export const guardrailsSchema = z
  .object({
    strictness: z.enum(["strict", "standard", "lenient"]).default("standard"),
  })
  .default({ strictness: "standard" });

export const modelsSchema = z
  .record(z.string(), z.string())
  .default({});

export const repoConfigSchema = z.object({
  model: z.string().default("claude-sonnet-5"),
  maxTurns: z.number().min(1).max(100).default(40),
  timeoutSeconds: z.number().min(30).max(1800).default(600),
  systemPromptAppend: z.string().optional(),
  /** Per-task-type model overrides (e.g., "review.full": "gpt-4o-mini"). */
  models: modelsSchema,
  /** Global default model for task routing. */
  defaultModel: z.string().optional(),
  /** Default fallback model for when primary model fails. */
  defaultFallbackModel: z.string().optional(),
  /**
   * Write-mode gates mention-driven code modifications (branch/commit/push).
   * This is deny-by-default. Enabling this does not affect review-only behavior.
   */
  write: writeSchema,
  review: reviewSchema,
  mention: mentionSchema,
  telemetry: telemetrySchema,
  knowledge: knowledgeSchema,
  languageRules: languageRulesSchema,
  largePR: largePRSchema,
  feedback: feedbackSchema,
  timeout: timeoutSchema,
  triage: triageSchema,
  guardrails: guardrailsSchema,
});

