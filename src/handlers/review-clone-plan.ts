export type ReviewClonePlanHeadRepo = {
  full_name: string;
  owner: { login: string };
  name: string;
} | null | undefined;

export type ReviewClonePlan = {
  cloneOwner: string;
  cloneRepo: string;
  cloneRef: string;
  isFork: boolean;
  isDeletedFork: boolean;
  usesPrRef: boolean;
  workspaceStrategy: "base-clone+pull-ref-fetch" | "direct-head-branch-clone";
};

export function resolveReviewClonePlan(params: {
  apiOwner: string;
  apiRepo: string;
  repositoryFullName: string;
  baseRef: string;
  headRef: string;
  headRepo: ReviewClonePlanHeadRepo;
}): ReviewClonePlan {
  const isDeletedFork = !params.headRepo;
  const isFork = Boolean(params.headRepo && params.headRepo.full_name !== params.repositoryFullName);

  if (isFork || isDeletedFork) {
    return {
      cloneOwner: params.apiOwner,
      cloneRepo: params.apiRepo,
      cloneRef: params.baseRef,
      isFork,
      isDeletedFork,
      usesPrRef: true,
      workspaceStrategy: "base-clone+pull-ref-fetch",
    };
  }

  const headRepo = params.headRepo;
  if (!headRepo) {
    throw new Error("Review clone plan invariant violated: missing head repo for direct clone");
  }

  return {
    cloneOwner: headRepo.owner.login,
    cloneRepo: headRepo.name,
    cloneRef: params.headRef,
    isFork,
    isDeletedFork,
    usesPrRef: false,
    workspaceStrategy: "direct-head-branch-clone",
  };
}
