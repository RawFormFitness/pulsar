# Migrations

Forward-only SQL migrations for Pulsar's Supabase schema. One file per change, sequentially numbered, **never edited after merge**.

## Conventions

### Naming

`NNNN_short_description.sql` where `NNNN` is the next zero-padded sequence number (e.g. `0009_add_member_email_index.sql`). Use lowercase + underscores. The filename is part of the public history — be specific.

### Multi-tenancy

Every domain table must declare `gym_id uuid not null references gyms(id)` and an RLS policy that scopes SELECT/INSERT/UPDATE/DELETE to rows where `gym_id` matches the authenticated user's gym membership (typically via the `gym_members` join). RLS stays enabled on every domain table — no `bypass_rls` shortcuts in production.

A natural-key constraint on a domain table must include `gym_id` (e.g. `unique (gym_id, agreement_number)`), not just the natural key alone. Stable keys are unique per gym, not globally.

### Forward-only

Don't edit a migration that has been applied to a hosted environment. If a migration shipped with the wrong shape, fix it in a NEW migration. The two-step `0007_cancel_ledger_schema.sql` / `0008_cancel_ledger_contact_columns.sql` pair is an example: `0007` defined the cancel ledger table; `0008` patched in `primary_phone` and `email` once we discovered the ledger CSV carries them. **This sequential additive pattern is acceptable** for incremental schema discovery during early development — never edit a merged migration to "tidy up."

### Destructive changes — leave a paper trail

Migrations that delete or rewrite data should `RAISE NOTICE` the affected row counts so a deployment leaves a record. Pattern:

```sql
do $$
declare
  affected int;
begin
  select count(*) into affected from public.cancellations;
  raise notice 'cancellations: deleting % rows for cancel-ledger migration', affected;
  delete from public.cancellations;
end;
$$;
```

`0007` does an unguarded `delete from public.cancellations` because no production data existed at the time it was written; future destructive migrations should include the audit-trail block above so an operator running them in any non-bootstrap environment sees what was wiped.

Destructive changes (drop column, narrow type, delete data) also require a one-line "why" comment at the top of the migration file and a back-out plan if non-trivial.

### Locking and large tables

Schema changes on tables with significant data should:
- Use `concurrently` for index creation when supported.
- Add `not null` columns in two steps if the table is large: nullable + backfill + then `set not null`.
- Avoid long transactions that block writes.

(Pulsar's tables are small in v1; this becomes load-bearing as gyms scale.)

### Idempotency

Use `if not exists` / `if exists` clauses where practical so a partial apply can be re-run cleanly. The Supabase CLI tracks applied migrations, but defensive idempotency saves an operator from a dropped connection mid-migration.

## Workflow

1. Add `NNNN_<description>.sql` under `supabase/migrations/`.
2. Run `supabase migration list` against the local stack and the hosted project to confirm both see the new file.
3. Apply locally first via `supabase db reset` or `supabase db push --local`.
4. Once green, push to hosted: `supabase db push` (requires the PAT — see `~/.claude/projects/-workspaces-pulsar/memory/reference_supabase_cli_auth.md`).
5. Regenerate types: `supabase gen types typescript --project-id <ref> > lib/db/types.ts`.

## Where this fits

- The database agent (`/.claude/agents/database.md`) owns the schema rules and the per-table contract.
- `lib/db/` holds the typed query helpers that consume what migrations create.
- `lib/db/types.ts` is generated; never hand-edit it.
