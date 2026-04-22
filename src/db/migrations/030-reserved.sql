-- 030-reserved.sql
-- Reserved migration slot.
--
-- Migration 030 was left unused historically between 029 and 031. We reserve it
-- explicitly so the sequence is no longer ambiguous and later rollback proofs can
-- reason about a contiguous migration timeline.
--
-- This file must remain schema-neutral even if applied late to an existing
-- database. Do not add DDL here.
SELECT 1;
