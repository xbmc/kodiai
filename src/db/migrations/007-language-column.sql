-- 007-language-column.sql
-- Add language classification columns to learning_memories and wiki_pages.

-- ============================================================================
-- learning_memories: add nullable language column with index
-- ============================================================================

ALTER TABLE learning_memories ADD COLUMN IF NOT EXISTS language TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_language ON learning_memories(language);

-- ============================================================================
-- wiki_pages: add language_tags array column with GIN index
-- ============================================================================

ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS language_tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_wiki_pages_language_tags ON wiki_pages USING gin(language_tags);

-- ============================================================================
-- Backfill learning_memories language from file_path extension
-- ============================================================================

UPDATE learning_memories SET language = CASE
  WHEN language IS NOT NULL THEN language  -- idempotent: skip already-classified
  WHEN file_path LIKE '%.ts' OR file_path LIKE '%.tsx' OR file_path LIKE '%.mts' OR file_path LIKE '%.cts' THEN 'typescript'
  WHEN file_path LIKE '%.js' OR file_path LIKE '%.jsx' OR file_path LIKE '%.mjs' OR file_path LIKE '%.cjs' THEN 'javascript'
  WHEN file_path LIKE '%.py' OR file_path LIKE '%.pyw' THEN 'python'
  WHEN file_path LIKE '%.go' THEN 'go'
  WHEN file_path LIKE '%.rs' THEN 'rust'
  WHEN file_path LIKE '%.java' THEN 'java'
  WHEN file_path LIKE '%.kt' OR file_path LIKE '%.kts' THEN 'kotlin'
  WHEN file_path LIKE '%.swift' THEN 'swift'
  WHEN file_path LIKE '%.cs' THEN 'csharp'
  WHEN file_path LIKE '%.cpp' OR file_path LIKE '%.cc' OR file_path LIKE '%.cxx' OR file_path LIKE '%.hpp' OR file_path LIKE '%.hxx' THEN 'cpp'
  WHEN file_path LIKE '%.c' THEN 'c'
  WHEN file_path LIKE '%.h' THEN 'c'  -- default to C for .h in backfill; context-aware on new writes
  WHEN file_path LIKE '%.rb' THEN 'ruby'
  WHEN file_path LIKE '%.php' THEN 'php'
  WHEN file_path LIKE '%.scala' THEN 'scala'
  WHEN file_path LIKE '%.sh' OR file_path LIKE '%.bash' OR file_path LIKE '%.zsh' THEN 'shell'
  WHEN file_path LIKE '%.sql' THEN 'sql'
  WHEN file_path LIKE '%.dart' THEN 'dart'
  WHEN file_path LIKE '%.lua' THEN 'lua'
  WHEN file_path LIKE '%.ex' OR file_path LIKE '%.exs' THEN 'elixir'
  WHEN file_path LIKE '%.zig' THEN 'zig'
  WHEN file_path LIKE '%.r' OR file_path LIKE '%.R' THEN 'r'
  WHEN file_path LIKE '%.m' THEN 'objectivec'
  WHEN file_path LIKE '%.mm' THEN 'objectivecpp'
  WHEN file_path LIKE '%.pl' OR file_path LIKE '%.pm' THEN 'perl'
  WHEN file_path LIKE '%.clj' OR file_path LIKE '%.cljs' OR file_path LIKE '%.cljc' THEN 'clojure'
  WHEN file_path LIKE '%.erl' OR file_path LIKE '%.hrl' THEN 'erlang'
  WHEN file_path LIKE '%.hs' THEN 'haskell'
  WHEN file_path LIKE '%.ml' OR file_path LIKE '%.mli' THEN 'ocaml'
  WHEN file_path LIKE '%.fs' OR file_path LIKE '%.fsx' OR file_path LIKE '%.fsi' THEN 'fsharp'
  WHEN file_path LIKE '%.jl' THEN 'julia'
  WHEN file_path LIKE '%.groovy' OR file_path LIKE '%.gvy' THEN 'groovy'
  WHEN file_path LIKE '%.v' OR file_path LIKE '%.sv' THEN 'verilog'
  WHEN file_path LIKE '%.vhd' OR file_path LIKE '%.vhdl' THEN 'vhdl'
  WHEN file_path LIKE '%.cmake' THEN 'cmake'
  ELSE 'unknown'
END
WHERE language IS NULL;
