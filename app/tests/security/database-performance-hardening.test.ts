import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260925135222_database_performance_hardening.sql", import.meta.url),
  "utf8",
);

test("performance migration adds only the justified schedule foreign-key indexes", () => {
  assert.match(migration, /create index if not exists cfb_games_home_team_id_idx\s+on public\.cfb_games \(home_team_id\)/i);
  assert.match(migration, /create index if not exists cfb_games_away_team_id_idx\s+on public\.cfb_games \(away_team_id\)/i);
  assert.equal((migration.match(/create index/gi) ?? []).length, 2);
  assert.doesNotMatch(migration, /drop\s+index/i);
});

test("all affected RLS policies use statement-level auth initialization plans", () => {
  assert.equal((migration.match(/alter policy/gi) ?? []).length, 11);
  assert.doesNotMatch(migration, /(?<!select )auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /(?<!select )auth\.jwt\(\)/i);
  assert.doesNotMatch(migration, /\b(?:grant|revoke|create\s+(?:or\s+replace\s+)?function|drop\s+policy)\b/i);
});
