export type ContributorTier = "newcomer" | "developing" | "established" | "senior";

export type ExpertiseDimension = "language" | "file_area";

export type ContributorProfile = {
  id: number;
  githubUsername: string;
  slackUserId: string | null;
  displayName: string | null;
  overallTier: ContributorTier;
  overallScore: number;
  optedOut: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastScoredAt: Date | null;
};

export type ContributorExpertise = {
  id: number;
  profileId: number;
  dimension: ExpertiseDimension;
  topic: string;
  score: number;
  rawSignals: number;
  lastActive: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface ContributorProfileStore {
  getByGithubUsername(username: string): Promise<ContributorProfile | null>;
  getBySlackUserId(slackUserId: string): Promise<ContributorProfile | null>;
  linkIdentity(params: {
    slackUserId: string;
    githubUsername: string;
    displayName: string;
  }): Promise<ContributorProfile>;
  unlinkSlack(githubUsername: string): Promise<void>;
  setOptedOut(githubUsername: string, optedOut: boolean): Promise<void>;
  getExpertise(profileId: number): Promise<ContributorExpertise[]>;
  upsertExpertise(params: {
    profileId: number;
    dimension: ExpertiseDimension;
    topic: string;
    score: number;
    rawSignals: number;
    lastActive: Date;
  }): Promise<void>;
  updateTier(
    profileId: number,
    tier: ContributorTier,
    overallScore: number,
  ): Promise<void>;
  getOrCreateByGithubUsername(username: string): Promise<ContributorProfile>;
  getAllScores(): Promise<{ profileId: number; overallScore: number }[]>;
}
