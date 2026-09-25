import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260925133823_harden_remaining_public_table_privileges.sql", import.meta.url),
  "utf8",
);

test("anonymous clients have no direct public-table access", () => {
  assert.match(migration, /revoke all privileges on all tables in schema public from anon;/i);
});

test("authenticated table writes remain limited to reviewed RLS paths", () => {
  assert.match(migration, /revoke insert, update, delete on all tables in schema public from authenticated;/i);
  assert.match(migration, /grant update on table public\.profiles to authenticated;/i);
  assert.match(migration, /grant insert, update, delete on table public\.league_members to authenticated;/i);
  assert.match(migration, /grant update, delete on table public\.leagues to authenticated;/i);
  assert.match(migration, /revoke execute on function public\.set_updated_at\(\) from public, anon;/i);
});
