import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const infrastructure = readFileSync(new URL("../../supabase/migrations/20260903000005_supabase_live_scoreboard_dispatch.sql", import.meta.url), "utf8");
const schedule = readFileSync(new URL("../../supabase/migrations/20260903000006_activate_live_scoreboard_dispatch_schedule.sql", import.meta.url), "utf8");

test("Supabase dispatches the existing protected endpoint without embedding a credential", () => {
  assert.match(infrastructure, /create extension if not exists pg_cron/);
  assert.match(infrastructure, /create extension if not exists pg_net/);
  assert.match(infrastructure, /vault\.decrypted_secrets/);
  assert.match(infrastructure, /Authorization', 'Bearer ' \|\| dispatch_secret/);
  assert.match(infrastructure, /https:\/\/gameheeltigerneerrines\.com\/api\/cron\/cfbd-live/);
  assert.doesNotMatch(infrastructure, /sb_secret_|CFBD_API_KEY|eyJ[A-Za-z0-9_-]{20,}/);
});

test("dispatcher authority is private and diagnostics contain no request headers or bodies", () => {
  assert.match(infrastructure, /revoke all on function private\.dispatch_live_scoreboard_poll\(\) from public, anon, authenticated, service_role/);
  assert.match(infrastructure, /revoke all on function public\.configure_live_scoreboard_dispatch_secret\(text\) from public, anon, authenticated/);
  assert.match(infrastructure, /grant execute on function public\.configure_live_scoreboard_dispatch_secret\(text\) to service_role/);
  assert.doesNotMatch(infrastructure, /authorization_header|response_body|request_headers/);
});

test("one-minute dispatch and bounded fourteen-day retention are explicit", () => {
  assert.match(schedule, /'\* \* \* \* \*'/);
  assert.match(schedule, /private\.dispatch_live_scoreboard_poll\(\)/);
  assert.match(schedule, /private\.cleanup_live_scoreboard_dispatch_history\(\)/);
  assert.match(infrastructure, /cron\.job_run_details/);
  assert.match(infrastructure, /interval '14 days'/);
});
