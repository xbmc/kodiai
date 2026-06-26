CREATE INDEX IF NOT EXISTS idx_review_clusters_active_repo_member_count
  ON review_clusters (repo, member_count DESC)
  WHERE retired = false;

CREATE INDEX IF NOT EXISTS idx_review_cluster_assignments_cluster_probability
  ON review_cluster_assignments (cluster_id, probability DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_repair_candidates_page_chunk
  ON wiki_pages (page_id, chunk_index, id)
  WHERE deleted = false
    AND (
      embedding IS NULL
      OR stale = true
      OR embedding_model IS DISTINCT FROM 'voyage-4'
    );
