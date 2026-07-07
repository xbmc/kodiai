type CleanupWorkspace = {
  cleanup: () => Promise<void>;
};

export async function cleanupReviewExecutionResources(params: {
  workspace?: CleanupWorkspace;
}): Promise<void> {
  if (params.workspace) {
    await params.workspace.cleanup();
  }
}
