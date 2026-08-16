import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync(new URL("../../src/app/league/[leagueId]/actions.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260830000000_owner_favorite_team_personalization.sql", import.meta.url), "utf8");

test("favorite team is an account preference, independent of league membership", () => {
  assert.match(migration, /alter table public\.profiles[\s\S]*favorite_team_id uuid references public\.teams/);
  assert.match(actions, /from\("profiles"\)[\s\S]*update\(\{ favorite_team_id: teamId \}\)[\s\S]*eq\("id", user\.id\)/);
  assert.doesNotMatch(migration, /alter table public\.league_members[\s\S]*favorite_team/i);
});

test("saving, changing, and clearing require an authenticated owner and active catalog team", () => {
  assert.match(actions, /if \(!user\) return \{ error: "Sign in and try again\." \}/);
  assert.match(actions, /from\("teams"\)[\s\S]*eq\("active", true\)/);
  assert.match(actions, /String\(formData\.get\("favoriteTeamId"\)[\s\S]*\|\| null/);
  assert.match(actions, /revalidatePath\(`\/league\/\$\{leagueId\}`\)/);
});
