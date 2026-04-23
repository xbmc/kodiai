-- 030-reserved.down.sql
-- Reserved migration slot rollback.
--
-- The paired down migration is intentionally schema-neutral because the reserved
-- slot must not mutate schema state during rollback proofs or late application.
-- Keep this file as a no-op.
SELECT 1;
