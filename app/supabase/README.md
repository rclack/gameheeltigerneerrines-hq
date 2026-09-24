# Supabase database setup

The ordered files in `migrations/` are the canonical, from-zero source of truth
for application schema, required reference data, triggers, and Row Level
Security policies. `migration-provenance.json` records each file's original
repository version, canonical replay version, independently verified production
ledger version (when known), and classification.

## Apply to a new or empty project

Either link the Supabase CLI and run `supabase db push`, or open the Supabase SQL
Editor and run every file in `migrations/` in filename order.

The compact `20260816000001` through `20260816000010` versions are deliberate
canonical replay ordering for migrations that were not present in the production
ledger. They are not claims about historical production execution times.

Files under `production-repairs/` preserve one-time, populated-production data
operations for auditability. Migration tooling must never execute that directory
against a clean environment. When a production repair already has a truthful
ledger version, `migrations/` retains a harmless same-version provenance marker
so a reconstructed canonical ledger can represent it without replaying its data.

Create every future migration with `supabase migration new <name>` from the
repository root. Do not hand-invent timestamps, reuse a production version, or
place environment-specific identities/league/game data in the clean replay path.

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

Apply migrations in filename order. After
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

`20260816000001_season_scoring.sql` establishes the scoring and classification
dependency before later roster-rule migrations. It
creates the official scoring-rule catalog, conference classifications, internal
game and ranking models, the auditable scoring-event ledger, and commissioner-only
scoring RPCs. The migration seeds the official rules and 2026 conference tiers;
`seed.sql` does not need to be rerun when adding scoring to an existing project.

## CFBD provider foundation

`20260816000002_cfbd_foundation.sql` follows the season-scoring migration.
It adds provider-aware game identity, durable CFBD team mappings, sync-run audit,
conservative manual overrides, and commissioner-only synchronization RPCs. It
does not seed provider mappings and does not require `seed.sql`; the first CFBD
schedule sync persists only deterministic mappings and reports unresolved names.
`20260816000003_cfbd_sync_counter_ambiguity_repair.sql` follows immediately;
it replaces the import RPC with unambiguous local
counter names while preserving its signature, authorization, and behavior.
