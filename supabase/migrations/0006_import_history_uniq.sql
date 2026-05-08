-- 0006_import_history_uniq.sql
-- Race-safe re-import idempotency.
--
-- The orchestrator in lib/import/run.ts short-circuits when a prior import
-- with the same (gym_id, source_hash) exists. That check is application-level
-- and can race: two concurrent imports of the same file could both pass the
-- "no existing row" check and then both insert. This partial unique index
-- pushes the guarantee into the database.
--
-- WHERE source_hash IS NOT NULL because failed imports may record an
-- import_history row before a hash is computable.

create unique index if not exists import_history_gym_source_hash_uniq
  on import_history (gym_id, source_hash)
  where source_hash is not null;
