CREATE INDEX IF NOT EXISTS idx_learning_memories_cluster_training_sample
  ON learning_memories (repo, outcome, created_at DESC, id DESC)
  WHERE stale = false
    AND embedding IS NOT NULL
    AND outcome IN ('accepted', 'thumbs_up', 'suppressed', 'thumbs_down');
