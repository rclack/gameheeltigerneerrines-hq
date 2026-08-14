# Supabase database setup

The migration in `migrations/` is the source of truth for the application schema,
triggers, and Row Level Security policies.

## Apply to a new or empty project

Either link the Supabase CLI and run `supabase db push`, or open the Supabase SQL
Editor and run the complete migration file in timestamp order.

## Existing legacy `leagues` table

The earlier prototype wrote to an unversioned `leagues` table. Before applying this
migration, check whether that table exists. The migration intentionally does not
drop, rename, or guess how to migrate it.

If its data is disposable, remove the legacy table in the Supabase dashboard and
then apply the migration. If its data must be retained, export/back it up and map
each legacy commissioner to an `auth.users.id` before adding the required
`commissioner_id` foreign key. Do not drop a table containing data you need.

After applying the migration, regenerate `src/types/database.ts` from the linked
project whenever the schema changes.

## Draft engine and FBS seed

Apply migrations in timestamp order. After
`20260815000000_college_team_draft.sql` succeeds, run `seed.sql` to populate or
refresh the FBS catalog. The seed is repeatable and upserts teams by abbreviation.

For a linked local Supabase workflow, `supabase db reset` applies all migrations
and then runs `seed.sql` because seed execution is enabled in `config.toml`.

## Private owner draft queues

After the draft migration, apply
`20260816000000_private_draft_queues.sql`. It adds private per-member queue
storage, secure queue mutation functions, automatic cleanup when a team is
drafted, and Realtime publication for queue changes. No additional seed is
required.

## Season scoring and standings

Apply `20260819000000_season_scoring.sql` after the draft reset migration. It
creates the official scoring-rule catalog, conference classifications, internal
game and ranking models, the auditable scoring-event ledger, and commissioner-only
scoring RPCs. The migration seeds the official rules and 2026 conference tiers;
`seed.sql` does not need to be rerun when adding scoring to an existing project.
