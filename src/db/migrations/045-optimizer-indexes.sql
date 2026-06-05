CREATE INDEX IF NOT EXISTS idx_memories_owner_repo_active
  ON learning_memories (owner, repo)
  WHERE stale = false;

CREATE INDEX IF NOT EXISTS idx_snippet_occ_hash_repo_created
  ON code_snippet_occurrences (content_hash, repo, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_graph_nodes_workspace_file_id
  ON review_graph_nodes (repo, workspace_key, file_id, id);

CREATE INDEX IF NOT EXISTS idx_review_graph_edges_workspace_file_id
  ON review_graph_edges (repo, workspace_key, file_id, id);

CREATE INDEX IF NOT EXISTS idx_feedback_reactions_repo_title_id_desc
  ON feedback_reactions (repo, title, id DESC);
