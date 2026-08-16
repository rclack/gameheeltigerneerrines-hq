import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260816130351_revoke_anonymous_authenticated_rpcs.sql", import.meta.url),
  "utf8",
);

test("authenticated mutations are not executable by anonymous callers", () => {
  for (const signature of [
    "accept_league_invitation(text)",
    "add_manual_scoring_event(uuid, uuid, uuid, integer, date, text)",
    "apply_external_game_sync(uuid, jsonb, jsonb, jsonb)",
    "begin_external_sync(uuid, text, text)",
    "create_league_invitation(uuid, text)",
    "process_cfb_game_scoring(uuid)",
    "randomize_draft_order(uuid)",
    "reset_draft(uuid)",
    "revoke_league_invitation(uuid)",
    "set_draft_paused(uuid, boolean)",
    "start_draft(uuid)",
    "update_my_team_name(uuid, text)",
    "void_manual_scoring_event(uuid, text)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")} from public, anon;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to authenticated;`));
  }
});

test("trigger functions are unavailable through Data API roles", () => {
  assert.match(migration, /revoke all on function public\.add_league_commissioner_membership\(\) from public, anon, authenticated, service_role;/);
  assert.match(migration, /revoke all on function public\.handle_new_user\(\) from public, anon, authenticated, service_role;/);
});
