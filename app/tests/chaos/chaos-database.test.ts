import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261021013518_league_chaos_transition_persistence.sql", import.meta.url), "utf8");
const duplicateTouchMigration = readFileSync(new URL("../../supabase/migrations/20261021115750_touch_duplicate_chaos_observation.sql", import.meta.url), "utf8");
const leagueId = "00000000-0000-4000-8000-000000000001";
const gameId = "00000000-0000-4000-8000-000000000010";
const teamId = "00000000-0000-4000-8000-000000000020";
const memberId = "00000000-0000-4000-8000-000000000040";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.leagues(id uuid primary key);
    create table public.teams(id uuid primary key);
    create table public.league_members(id uuid primary key, league_id uuid not null references public.leagues(id));
    create table public.cfb_games(id uuid primary key, league_id uuid not null references public.leagues(id));
    create function private.is_league_member(target uuid) returns boolean language sql stable as $$ select true $$;
    insert into public.leagues values ('${leagueId}');
    insert into public.teams values ('${teamId}');
    insert into public.league_members values ('${memberId}','${leagueId}');
    insert into public.cfb_games values ('${gameId}','${leagueId}');
  `);
  await db.exec(migration);
  await db.exec(duplicateTouchMigration);
  await db.query("select public.set_league_chaos_enabled($1,true)", [leagueId]);
  return db;
}

function candidate(points = 8, severity = "major") {
  return { leagueId, season: "2026", week: 3, type: "CAPTAIN_POSITIVE", severity, state: "active",
    eventKey: "chaos_key_00000000000000000000000000000001", stateFingerprint: `state-${points}`,
    gameId, providerGameId: "401", teamId, memberId, opponentTeamId: null, opponentMemberId: null,
    facts: { gameState: "live", projectedPoints: points }, significance: { reasonCodes: ["CAPTAIN_COUNTING_POSITIVE"] },
    source: { freshness: "fresh", canonicalStateFingerprint: `canonical-${points}` } };
}

async function reconcile(db: PGlite, key: string, candidates: unknown[], authority = "fresh", stale: string[] = [], settled: string[] = []) {
  return db.query<{ result: Record<string, unknown> }>(
    "select public.reconcile_league_chaos($1,$2,$3,'manual_validation',$4,$5::jsonb,$6::uuid[],$7::uuid[]) as result",
    [leagueId, key, "2026-09-19T18:00:00Z", authority, JSON.stringify(candidates), stale, settled]);
}

test("isolated Postgres replay preserves episodes, recurring states, stale suspension, and official settlement", async () => {
  const db = await database();
  await reconcile(db, "observation-created-0001", [candidate()]);
  const first = await db.query<{ episode_id: string }>("select episode_id from public.league_chaos_events");
  const firstEpisode = first.rows[0]!.episode_id;

  const duplicate = await reconcile(db, "observation-created-0001", [candidate()]);
  assert.equal(duplicate.rows[0]!.result.duplicate, true);
  assert.equal((await db.query("select 1 from public.league_chaos_transitions")).rows.length, 1);

  await reconcile(db, "observation-escalated-0002", [candidate(12, "chaos")]);
  const escalated = await db.query<{ episode_id: string; transition_type: string }>("select episode_id,transition_type from public.league_chaos_transitions order by sequence");
  assert.deepEqual(escalated.rows.map((row) => row.transition_type), ["created", "escalated"]);
  assert.ok(escalated.rows.every((row) => row.episode_id === firstEpisode));

  await reconcile(db, "observation-stale-0003", [], "stale", [gameId]);
  await reconcile(db, "observation-resumed-0004", [candidate(12, "chaos")]);
  const lifecycle = await db.query<{ transition_type: string }>("select transition_type from public.league_chaos_transitions order by sequence");
  assert.deepEqual(lifecycle.rows.map((row) => row.transition_type), ["created", "escalated", "suspended", "resumed"]);

  await reconcile(db, "observation-tied-0005", []);
  const resolved = await db.query<{ lifecycle_state: string }>("select lifecycle_state from public.league_chaos_events");
  assert.equal(resolved.rows[0]!.lifecycle_state, "resolved");

  await reconcile(db, "observation-returned-0006", [candidate(8, "major")]);
  const second = await db.query<{ episode_id: string }>("select episode_id from public.league_chaos_events");
  assert.notEqual(second.rows[0]!.episode_id, firstEpisode);

  await reconcile(db, "observation-settled-0007", [], "fresh", [], [gameId]);
  const final = await db.query<{ lifecycle_state: string; resolution_reason: string }>("select lifecycle_state,resolution_reason from public.league_chaos_events");
  assert.deepEqual(final.rows[0], { lifecycle_state: "resolved", resolution_reason: "OFFICIAL_SETTLED" });
  await db.close();
});

test("overlapping identical isolated reconciliations serialize to one created transition", async () => {
  const db = await database();
  await Promise.all([
    reconcile(db, "observation-concurrent-0001", [candidate()]),
    reconcile(db, "observation-concurrent-0001", [candidate()]),
  ]);
  const counts = await db.query<{ transitions: number; runs: number }>(`select
    (select count(*)::int from public.league_chaos_transitions) transitions,
    (select count(*)::int from public.league_chaos_reconciliation_runs) runs`);
  assert.deepEqual(counts.rows[0], { transitions: 1, runs: 1 });
  await db.close();
});

test("duplicate observations can advance freshness without creating history", async () => {
  const db = await database();
  await reconcile(db, "observation-duplicate-touch-0001", [candidate()]);
  const before = await db.query<{ last_success_at: Date }>("select last_success_at from public.league_chaos_settings where league_id=$1", [leagueId]);
  await db.query("select public.touch_duplicate_chaos_observation($1,$2,$3)", [
    leagueId, "observation-duplicate-touch-0001", "2026-09-19T18:01:00Z",
  ]);
  const after = await db.query<{ last_success_at: Date; last_observation_at: Date }>(
    "select last_success_at,last_observation_at from public.league_chaos_settings where league_id=$1", [leagueId]);
  assert.ok(after.rows[0]!.last_success_at >= before.rows[0]!.last_success_at);
  assert.equal(after.rows[0]!.last_observation_at.toISOString(), "2026-09-19T18:01:00.000Z");
  assert.equal((await db.query("select 1 from public.league_chaos_reconciliation_runs")).rows.length, 1);
  assert.equal((await db.query("select 1 from public.league_chaos_transitions")).rows.length, 1);
  await db.close();
});

test("authenticated can read its scoped history but has no write grants", async () => {
  const db = await database();
  const grants = await db.query<{ privilege_type: string }>(`select privilege_type from information_schema.role_table_grants
    where grantee='authenticated' and table_name in ('league_chaos_events','league_chaos_transitions') order by privilege_type`);
  assert.deepEqual([...new Set(grants.rows.map((row) => row.privilege_type))], ["SELECT"]);
  const functionGrants = await db.query<{ grantee: string }>(`select grantee from information_schema.role_routine_grants
    where routine_name in ('reconcile_league_chaos','touch_duplicate_chaos_observation') and grantee in ('PUBLIC','anon','authenticated')`);
  assert.equal(functionGrants.rows.length, 0);
  await db.close();
});
