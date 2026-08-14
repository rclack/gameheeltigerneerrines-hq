import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { buildTeamMappingAudit } from "../src/lib/cfbd/mapping.ts";
import { normalizeCfbdGame, parseCfbdGames, parseCfbdTeams } from "../src/lib/cfbd/normalization.ts";
import { prepareCfbdSchedule } from "../src/lib/cfbd/schedule.ts";

const SEASON = "2025";
const OWNER_COUNT = 4;
const TEAMS_PER_OWNER = 6;
const CFBD_BASE_URL = "https://api.collegefootballdata.com";
const fixture = { leagueId: null, users: [], createdExternalOpponentIds: [], createdMappingIds: [], insertedClassifications: [] };
const startedAt = performance.now();

function publicConfig() {
  const values = {};
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? values.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

const config = publicConfig();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cfbdKey = process.env.CFBD_API_KEY;
if (!config.url || !config.key || !serviceKey || !cfbdKey) {
  console.error("BLOCKED: test:season requires the public Supabase configuration plus SUPABASE_SERVICE_ROLE_KEY and CFBD_API_KEY at runtime.");
  console.error("No credential values are stored or printed by this test.");
  process.exit(2);
}

const admin = createClient(config.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
const clients = [];
const checks = [];
function assert(condition, message) { if (!condition) throw new Error(message); }
function pass(label, detail) { checks.push(label); console.log(`PASS ${label}: ${detail}`); }
function elapsed(since) { return Math.round(performance.now() - since); }
async function result(promise, label) { const response = await promise; if (response.error) throw new Error(`${label}: ${response.error.message}`); return response.data; }
async function expectDenied(promise, label) { const response = await promise; assert(response.error, `${label}: request unexpectedly succeeded`); }

async function membershipSnapshot(membershipId) {
  return result(admin.from("league_members").select("id,league_id,user_id,role,team_name,created_at").eq("id", membershipId).single(), "read authoritative membership");
}

async function expectMembershipUnchanged(promise, target, label) {
  const before = await membershipSnapshot(target.id);
  const response = await promise;
  const after = await membershipSnapshot(target.id);
  assert(JSON.stringify(after) === JSON.stringify(before), `${label}: unauthorized membership row actually changed`);
  const affected = Array.isArray(response.data) ? response.data.length : 0;
  assert(response.error || affected === 0, `${label}: request returned a representation for an unauthorized row`);
  console.log(`PASS ${label}: ${response.error ? "request denied" : "request returned no error but affected zero rows"}; authoritative row unchanged`);
}

async function leagueMembershipSnapshot(leagueId) {
  return result(
    admin.from("league_members").select("id,league_id,user_id,role,team_name,created_at").eq("league_id", leagueId).order("id"),
    "read authoritative league memberships",
  );
}

async function expectMembershipSetUnchanged(promise, leagueId, label) {
  const before = await leagueMembershipSnapshot(leagueId);
  const response = await promise;
  const after = await leagueMembershipSnapshot(leagueId);
  assert(JSON.stringify(after) === JSON.stringify(before), `${label}: unauthorized membership set actually changed`);
  const affected = Array.isArray(response.data) ? response.data.length : 0;
  assert(response.error || affected === 0, `${label}: request returned a representation for an unauthorized row`);
  console.log(`PASS ${label}: ${response.error ? "request denied" : "request returned no error but affected zero rows"}; authoritative membership set unchanged`);
}

async function cfbd(path, params) {
  const url = new URL(path, CFBD_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${cfbdKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CFBD ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function createUser(index) {
  const password = randomBytes(24).toString("base64url");
  const email = `season-qa-${Date.now()}-${index}-${randomBytes(3).toString("hex")}@example.invalid`;
  const created = await result(admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Season QA Owner ${index + 1}` } }), `create user ${index + 1}`);
  fixture.users.push(created.user.id);
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  await result(client.auth.signInWithPassword({ email, password }), `sign in user ${index + 1}`);
  clients.push({ id: created.user.id, email, client });
}

function snakePosition(round, offset) { return round % 2 === 1 ? offset + 1 : OWNER_COUNT - offset; }

async function prepareDraft(league, teams) {
  const commissioner = clients[0];
  const draftId = await result(commissioner.client.rpc("randomize_draft_order", { target_league_id: league.id }), "randomize draft");
  await result(commissioner.client.rpc("start_draft", { target_draft_id: draftId }), "start draft");
  const slots = await result(admin.from("draft_slots").select("*").eq("draft_id", draftId).order("draft_position"), "load draft slots");
  const clientByUser = new Map(clients.map((item) => [item.id, item.client]));
  const membershipById = new Map((await result(admin.from("league_members").select("*").eq("league_id", league.id), "load members")).map((item) => [item.id, item]));
  const preferred = [
    "Ohio State", "Indiana", "Georgia", "Alabama", "Texas", "Oregon", "Notre Dame", "Ole Miss",
    "Tulane", "Memphis", "Boise State", "James Madison", "South Carolina", "Florida State", "UCLA", "Wisconsin",
    "UConn", "Army", "Navy", "Liberty", "Appalachian State", "Colorado State", "UTSA", "North Carolina",
  ];
  const byName = new Map(teams.map((team) => [team.school_name.toLowerCase(), team]));
  const selections = preferred.map((name) => byName.get(name.toLowerCase())).filter(Boolean);
  for (const team of teams) if (selections.length < OWNER_COUNT * TEAMS_PER_OWNER && !selections.some((item) => item.id === team.id)) selections.push(team);
  assert(selections.length >= OWNER_COUNT * TEAMS_PER_OWNER, "not enough distinct active teams for historical draft");
  const picks = [];
  for (let overall = 1; overall <= OWNER_COUNT * TEAMS_PER_OWNER; overall += 1) {
    const round = Math.ceil(overall / OWNER_COUNT);
    const offset = (overall - 1) % OWNER_COUNT;
    const position = snakePosition(round, offset);
    const slot = slots.find((item) => item.draft_position === position);
    const member = membershipById.get(slot.league_member_id);
    const pick = await result(clientByUser.get(member.user_id).rpc("submit_draft_pick", { target_draft_id: draftId, target_team_id: selections[overall - 1].id }), `draft pick ${overall}`);
    picks.push({ ...pick, team: selections[overall - 1], owner: member.team_name, position });
  }
  const state = await result(admin.from("drafts").select("*").eq("id", draftId).single(), "load completed draft");
  assert(state.status === "complete", "draft did not complete");
  assert(new Set(picks.map((pick) => pick.team_id)).size === 24, "draft contains duplicate teams");
  for (const pick of picks) assert(pick.pick_number === snakePosition(pick.round_number, (pick.overall_pick - 1) % OWNER_COUNT), `snake sequence mismatch at pick ${pick.overall_pick}`);
  pass("DRAFT", "real six-round snake draft completed with 24 unique teams");
  return { draftId, picks, slots, members: [...membershipById.values()] };
}

async function syncSchedule(leagueId, internalTeams, externalTeams, rawGames) {
  const commissioner = clients[0].client;
  const run = await result(commissioner.rpc("begin_external_sync", { target_league_id: leagueId, target_provider: "cfbd", target_sync_type: "schedule" }), "begin schedule sync");
  const persisted = await result(admin.from("external_team_mappings").select("team_id,external_team_id,external_name").eq("provider", "cfbd"), "load mappings");
  const persistedIds = new Set((await result(admin.from("external_team_mappings").select("id").eq("provider", "cfbd"), "snapshot mapping ids")).map((item) => item.id));
  const audit = buildTeamMappingAudit(internalTeams, externalTeams, persisted);
  if (audit.created.length) await result(commissioner.rpc("save_external_team_mappings", { target_league_id: leagueId, target_provider: "cfbd", target_mappings: audit.created }), "save mappings");
  if (audit.created.length) {
    const afterMappings = await result(admin.from("external_team_mappings").select("id").eq("provider", "cfbd"), "load mappings after save");
    for (const item of afterMappings) if (!persistedIds.has(item.id) && !fixture.createdMappingIds.includes(item.id)) fixture.createdMappingIds.push(item.id);
  }
  const mappings = [...persisted, ...audit.created];
  const prepared = prepareCfbdSchedule(rawGames.map(normalizeCfbdGame), new Set(externalTeams.map((team) => String(team.id))), new Map(mappings.map((item) => [item.external_team_id, item.team_id])));
  const existingExternal = new Map((await result(admin.from("external_opponents").select("id,provider,external_id"), "snapshot external opponents")).map((item) => [`${item.provider}:${item.external_id}`, item.id]));
  const summary = { mappings_created: audit.created.length, ambiguous_count: audit.ambiguous.length, unmapped_games: prepared.unresolvedGames, unresolved_fbs_mapping_game_count: prepared.unresolvedGames.length, external_opponent_count: prepared.externalOpponents.length };
  const completed = await result(commissioner.rpc("apply_external_game_sync", { target_sync_run_id: run.id, target_games: prepared.games, target_external_opponents: prepared.externalOpponents, target_mapping_summary: summary }), "apply schedule sync");
  const afterExternal = await result(admin.from("external_opponents").select("id,provider,external_id"), "load external opponents after sync");
  for (const item of afterExternal) if (!existingExternal.has(`${item.provider}:${item.external_id}`) && !fixture.createdExternalOpponentIds.includes(item.id)) fixture.createdExternalOpponentIds.push(item.id);
  return { run: completed, audit, prepared };
}

async function ensureHistoricalClassifications() {
  const existing = await result(admin.from("conference_classifications").select("conference,classification").eq("season", SEASON), "load 2025 classifications");
  if (existing.length) return { source: "existing", count: existing.length };
  const rows = [
    ["ACC", "POWER"], ["Big Ten", "POWER"], ["Big 12", "POWER"], ["SEC", "POWER"],
    ["American", "G5"], ["Conference USA", "G5"], ["MAC", "G5"], ["Mountain West", "G5"], ["Pac-12", "G5"], ["Sun Belt", "G5"], ["Independent", "INDEPENDENT"],
  ].map(([conference, classification]) => ({ season: SEASON, conference, classification }));
  const inserted = await result(admin.from("conference_classifications").insert(rows).select("id"), "insert disposable 2025 classifications");
  fixture.insertedClassifications.push(...inserted.map((item) => item.id));
  return { source: "disposable fixture", count: inserted.length };
}

async function scoreSeason(leagueId, draftedTeamIds) {
  const commissioner = clients[0].client;
  const games = await result(admin.from("cfb_games").select("*").eq("league_id", leagueId).eq("status", "final").order("game_date"), "load final games");
  const eligible = games.filter((game) => draftedTeamIds.has(game.home_team_id) || draftedTeamIds.has(game.away_team_id));
  const errors = [];
  const started = performance.now();
  for (const [index, game] of eligible.entries()) {
    const response = await commissioner.rpc("process_cfb_game_scoring", { target_game_id: game.id });
    if (response.error) errors.push({ game: game.id, message: response.error.message });
    if ((index + 1) % 100 === 0) console.log(`PROGRESS scoring ${index + 1}/${eligible.length}`);
  }
  assert(errors.length === 0, `${errors.length} scoring RPC errors; first: ${errors[0]?.message}`);
  pass("SEASON-SCORING", `${eligible.length} eligible finals processed in ${elapsed(started)}ms`);
  return { games, eligible, durationMs: elapsed(started) };
}

async function ledgerAudit(leagueId, draft) {
  const [events, rules, games, teams] = await Promise.all([
    result(admin.from("scoring_events").select("*").eq("league_id", leagueId), "load ledger"),
    result(admin.from("scoring_rules").select("id,code,points"), "load rules"),
    result(admin.from("cfb_games").select("id,home_team_id,away_team_id,home_external_opponent_id,away_external_opponent_id,external_provider,external_id").eq("league_id", leagueId), "load audit games"),
    result(admin.from("teams").select("id"), "load scoring team identities"),
  ]);
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const active = events.filter((event) => !event.voided_at);
  const activeKeys = active.map((event) => `${event.source_identifier}:${event.team_id}:${ruleById.get(event.scoring_rule_id)?.code}`);
  assert(new Set(activeKeys).size === activeKeys.length, "duplicate active game scoring event detected");
  assert(new Set(games.filter((game) => game.external_provider).map((game) => `${game.external_provider}:${game.external_id}`)).size === games.filter((game) => game.external_provider).length, "duplicate provider game detected");
  assert(games.every((game) => Number(Boolean(game.home_team_id)) + Number(Boolean(game.home_external_opponent_id)) === 1 && Number(Boolean(game.away_team_id)) + Number(Boolean(game.away_external_opponent_id)) === 1), "malformed game participant representation");
  const internalTeamIds = new Set(teams.map((team) => team.id));
  assert(events.every((event) => internalTeamIds.has(event.team_id)), "scoring event targets an external opponent or missing internal team");
  const gameIds = new Set(games.map((game) => game.id));
  assert(events.every((event) => event.source_type !== "game" || gameIds.has(event.source_identifier)), "orphan game scoring event detected");
  const pickedIds = new Set(draft.picks.map((pick) => pick.team_id));
  const ownerByTeam = new Map(draft.picks.map((pick) => [pick.team_id, pick.league_member_id]));
  const standings = draft.members.map((member) => ({ member, total: active.filter((event) => ownerByTeam.get(event.team_id) === member.id).reduce((sum, event) => sum + event.points, 0), teams: draft.picks.filter((pick) => pick.league_member_id === member.id).length })).sort((a, b) => b.total - a.total);
  let prior = null; let rank = 0;
  standings.forEach((row, index) => { if (row.total !== prior) rank = index + 1; row.rank = rank; prior = row.total; });
  assert(active.every((event) => ruleById.has(event.scoring_rule_id)), "orphan scoring rule reference");
  assert(active.filter((event) => pickedIds.has(event.team_id)).every((event) => ownerByTeam.has(event.team_id)), "drafted scoring event lacks owner");
  const breakdown = Object.fromEntries([...new Set(active.map((event) => ruleById.get(event.scoring_rule_id)?.code))].filter(Boolean).map((code) => [code, active.filter((event) => ruleById.get(event.scoring_rule_id)?.code === code).length]));
  return { events, active, standings, breakdown, ruleById };
}

async function main() {
  console.log("START Milestone 3C disposable 2025 historical season QA");
  for (let index = 0; index < OWNER_COUNT; index += 1) await createUser(index);
  const league = await result(admin.from("leagues").insert({ name: `Historical Chaos QA ${randomUUID()}`, season: SEASON, commissioner_id: clients[0].id, owner_count: OWNER_COUNT, teams_per_owner: TEAMS_PER_OWNER }).select().single(), "create disposable league");
  fixture.leagueId = league.id;
  await result(admin.from("league_members").insert(clients.slice(1).map((owner, index) => ({ league_id: league.id, user_id: owner.id, role: "owner", team_name: `Chaos Owner ${index + 2}` }))), "create owner memberships");
  await result(admin.from("league_members").update({ team_name: "Chaos Commissioner" }).eq("league_id", league.id).eq("user_id", clients[0].id), "name commissioner team");
  const internalTeams = await result(admin.from("teams").select("*").eq("active", true), "load FBS catalog");
  const draft = await prepareDraft(league, internalTeams);
  console.log("DRAFT PICKS", JSON.stringify(draft.picks.map((pick) => ({ overall: pick.overall_pick, round: pick.round_number, position: pick.pick_number, owner: pick.owner, team: pick.team.school_name, conference: pick.team.conference }))));

  const fetchStarted = performance.now();
  const [externalTeams, games] = await Promise.all([cfbd("/teams/fbs", { year: SEASON }), cfbd("/games", { year: SEASON, classification: "fbs" })]);
  const parsedTeams = parseCfbdTeams(externalTeams); const parsedGames = parseCfbdGames(games);
  console.log(`FETCH teams=${parsedTeams.length} games=${parsedGames.length} duration_ms=${elapsed(fetchStarted)}`);
  const first = await syncSchedule(league.id, internalTeams, parsedTeams, parsedGames);
  console.log("FIRST SYNC", JSON.stringify({ fetched: first.run.fetched_count, created: first.run.created_count, updated: first.run.updated_count, unchanged: first.run.unchanged_count, skipped: first.run.skipped_count, external_opponents: first.prepared.externalOpponents.length, mapping_issues: first.prepared.unresolvedGames.length + first.audit.ambiguous.length }));
  const eventCountAfterSync = await result(admin.from("scoring_events").select("id", { count: "exact", head: true }).eq("league_id", league.id), "count post-sync events");
  assert(eventCountAfterSync === null || eventCountAfterSync === undefined, "unexpected PostgREST head payload");
  const postSyncEvents = await result(admin.from("scoring_events").select("id").eq("league_id", league.id), "verify sync scoring isolation");
  assert(postSyncEvents.length === 0, "schedule synchronization created scoring events");
  const second = await syncSchedule(league.id, internalTeams, parsedTeams, parsedGames);
  assert(second.run.created_count === 0 && second.run.updated_count === 0 && second.run.skipped_count === 0 && second.run.unchanged_count === second.run.fetched_count, "second sync was not idempotent");
  console.log("SECOND SYNC", JSON.stringify({ fetched: second.run.fetched_count, created: second.run.created_count, updated: second.run.updated_count, unchanged: second.run.unchanged_count, skipped: second.run.skipped_count }));
  pass("SYNC", "historical import and identical second sync completed without scoring");

  const classifications = await ensureHistoricalClassifications();
  console.log("CLASSIFICATIONS", JSON.stringify(classifications));
  const draftedIds = new Set(draft.picks.map((pick) => pick.team_id));
  const season = await scoreSeason(league.id, draftedIds);
  const beforeReprocess = await result(admin.from("scoring_events").select("id").eq("league_id", league.id).is("voided_at", null), "snapshot events before reprocess");
  await scoreSeason(league.id, draftedIds);
  const afterReprocess = await result(admin.from("scoring_events").select("id").eq("league_id", league.id).is("voided_at", null), "snapshot events after reprocess");
  assert(JSON.stringify(beforeReprocess.map((item) => item.id).sort()) === JSON.stringify(afterReprocess.map((item) => item.id).sort()), "full unchanged-season reprocessing changed active event IDs");
  pass("REPROCESS", "full unchanged season preserved active event IDs");

  const correctionGame = season.eligible.find((game) => game.home_team_id && game.away_team_id && game.home_score !== game.away_score);
  assert(correctionGame, "no internal matchup was available for corrected-result chaos test");
  const originalCorrectionEvents = await result(admin.from("scoring_events").select("*").eq("league_id", league.id).eq("source_identifier", correctionGame.id).is("voided_at", null), "load correction baseline");
  await result(admin.from("cfb_games").update({ home_score: correctionGame.away_score, away_score: correctionGame.home_score, scoring_fingerprint: null }).eq("id", correctionGame.id), "correct disposable result");
  await result(clients[0].client.rpc("process_cfb_game_scoring", { target_game_id: correctionGame.id }), "reprocess corrected result");
  const correctedLedger = await result(admin.from("scoring_events").select("*").eq("league_id", league.id).eq("source_identifier", correctionGame.id), "audit corrected result");
  assert(originalCorrectionEvents.every((event) => correctedLedger.some((row) => row.id === event.id && row.voided_at && row.voided_by && row.void_reason)), "corrected result did not preserve complete void audit");
  assert(correctedLedger.some((event) => !event.voided_at), "corrected result has no active replacement events");
  pass("CORRECTION", "one disposable result was reversed and reprocessed with voided originals and active replacements");

  const rules = await result(admin.from("scoring_rules").select("*").is("league_id", null), "load manual rules");
  const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));
  const manualCodes = ["HEISMAN_WINNER", "BOWL_ELIGIBLE", "MAKE_CONFERENCE_CHAMPIONSHIP", "WIN_CONFERENCE", "MAKE_CFP"];
  const expectedManualPoints = { HEISMAN_WINNER: 10, BOWL_ELIGIBLE: 5, MAKE_CONFERENCE_CHAMPIONSHIP: 5, WIN_CONFERENCE: 10, MAKE_CFP: 5 };
  for (const code of manualCodes) assert(ruleByCode.get(code)?.points === expectedManualPoints[code], `${code} point value changed unexpectedly`);
  const manualEvents = [];
  for (const [index, code] of manualCodes.entries()) manualEvents.push(await result(clients[0].client.rpc("add_manual_scoring_event", { target_league_id: league.id, target_team_id: draft.picks[index].team_id, target_rule_id: ruleByCode.get(code).id, target_week: null, target_event_date: "2025-12-31", target_notes: "Milestone 3C disposable integration fixture" }), `add ${code}`));
  await result(clients[0].client.rpc("void_manual_scoring_event", { target_event_id: manualEvents[1].id, target_reason: "Milestone 3C void audit" }), "void BOWL_ELIGIBLE fixture");
  const manualLedger = await result(admin.from("scoring_events").select("id,points,voided_at,voided_by,void_reason").in("id", manualEvents.map((event) => event.id)), "audit manual events");
  assert(manualLedger.filter((event) => !event.voided_at).reduce((sum, event) => sum + event.points, 0) === 30, "active manual-event total did not reconcile to +30");
  const voidedManual = manualLedger.find((event) => event.id === manualEvents[1].id);
  assert(voidedManual?.voided_at && voidedManual.voided_by === clients[0].id && voidedManual.void_reason === "Milestone 3C void audit", "manual void audit is incomplete");
  pass("MANUAL", "five manual rule paths exercised and one event voided");

  const externalGame = (await result(admin.from("cfb_games").select("home_external_opponent_id,away_external_opponent_id").eq("league_id", league.id).or("home_external_opponent_id.not.is.null,away_external_opponent_id.not.is.null").limit(1), "load provider mutation target"))[0];
  const externalOpponentId = externalGame?.home_external_opponent_id ?? externalGame?.away_external_opponent_id;
  assert(externalOpponentId, "historical schedule contained no external opponent for provider security test");
  await expectDenied(clients[1].client.rpc("process_cfb_game_scoring", { target_game_id: season.eligible[0].id }), "owner process scoring");
  await expectDenied(clients[1].client.rpc("add_manual_scoring_event", { target_league_id: league.id, target_team_id: draft.picks[0].team_id, target_rule_id: ruleByCode.get("HEISMAN_WINNER").id, target_week: null, target_event_date: "2025-12-31", target_notes: "must fail" }), "owner manual scoring");
  await expectDenied(clients[1].client.from("external_opponents").update({ display_name: "Denied" }).eq("id", externalOpponentId).select("id"), "owner provider mutation");
  const ownerMembership = draft.members.find((member) => member.user_id === clients[1].id);
  const otherMembership = draft.members.find((member) => member.role === "owner" && member.user_id !== clients[1].id);
  assert(ownerMembership && otherMembership, "membership security fixtures are incomplete");
  const rosterRows = await result(clients[1].client.from("league_members").select("id,user_id,role,team_name").eq("league_id", league.id), "owner roster read");
  assert(rosterRows.length === OWNER_COUNT, "owner could not read intended league roster");
  await expectMembershipUnchanged(clients[1].client.from("league_members").update({ team_name: "Denied" }).eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "owner other membership team-name mutation");
  await expectMembershipUnchanged(clients[1].client.from("league_members").update({ role: "commissioner" }).eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "owner other membership role mutation");
  await expectMembershipUnchanged(clients[1].client.from("league_members").delete().eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "owner other membership delete");
  await expectMembershipUnchanged(clients[1].client.from("league_members").update({ team_name: "Direct Own Mutation" }).eq("id", ownerMembership.id).select("id", { count: "exact" }), ownerMembership, "owner direct own-membership mutation");
  await expectDenied(clients[1].client.from("league_members").insert({ league_id: league.id, user_id: randomUUID(), role: "owner", team_name: "Denied" }).select("id"), "owner arbitrary membership insert");
  await result(clients[1].client.rpc("update_my_team_name", { target_league_id: league.id, new_team_name: "Owner Self Service QA" }), "owner self-service team name");
  const selfUpdated = await membershipSnapshot(ownerMembership.id);
  assert(selfUpdated.team_name === "Owner Self Service QA" && selfUpdated.role === "owner" && selfUpdated.user_id === ownerMembership.user_id && selfUpdated.league_id === ownerMembership.league_id, "self-service team-name RPC changed unauthorized membership fields");
  const commissionerManagedName = "Commissioner Managed QA";
  const commissionerUpdate = await clients[0].client.from("league_members").update({ team_name: commissionerManagedName }).eq("id", otherMembership.id).select("id,team_name").single();
  if (commissionerUpdate.error) throw commissionerUpdate.error;
  assert(commissionerUpdate.data.team_name === commissionerManagedName, "commissioner membership-management policy failed");
  const anonymousRoster = await result(anon.from("league_members").select("id").eq("league_id", league.id), "anonymous membership read");
  assert(anonymousRoster.length === 0, "anonymous user read protected league memberships");
  await expectMembershipSetUnchanged(anon.from("league_members").insert({ league_id: league.id, user_id: randomUUID(), role: "owner", team_name: "Denied" }).select("id", { count: "exact" }), league.id, "anonymous membership insert");
  await expectMembershipUnchanged(anon.from("league_members").update({ team_name: "Denied" }).eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "anonymous membership team-name update");
  await expectMembershipUnchanged(anon.from("league_members").update({ role: "commissioner" }).eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "anonymous membership role update");
  await expectMembershipUnchanged(anon.from("league_members").update({ league_id: randomUUID(), user_id: randomUUID() }).eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "anonymous membership identity update");
  await expectMembershipUnchanged(anon.from("league_members").delete().eq("id", otherMembership.id).select("id", { count: "exact" }), otherMembership, "anonymous membership delete");
  const ownerEvents = await result(clients[1].client.from("scoring_events").select("id,points,team_id").eq("league_id", league.id), "owner ledger read");
  const ownerGames = await result(clients[1].client.from("cfb_games").select("id").eq("league_id", league.id), "owner games read");
  const ownerPicks = await result(clients[1].client.from("draft_picks").select("team_id").eq("draft_id", draft.draftId).eq("league_member_id", ownerMembership.id), "owner roster picks read");
  assert(ownerEvents.length > 0 && ownerGames.length > 0, "owner season-scale reads returned no data");
  const ownerTeamIds = new Set(ownerPicks.map((pick) => pick.team_id));
  const ownerVisibleTotal = ownerEvents.filter((event) => ownerTeamIds.has(event.team_id)).reduce((sum, event) => sum + event.points, 0);
  assert(Number.isFinite(ownerVisibleTotal) && ownerPicks.length === TEAMS_PER_OWNER, "owner score breakdown did not reconcile six drafted teams");
  const anonGames = await result(anon.from("cfb_games").select("id").eq("league_id", league.id), "anonymous game read");
  assert(anonGames.length === 0, "anonymous user read protected games");
  await expectDenied(anon.rpc("process_cfb_game_scoring", { target_game_id: season.eligible[0].id }), "anonymous scoring");
  pass("SECURITY", "owner reads succeeded; owner and anonymous mutations were denied");

  const audit = await ledgerAudit(league.id, draft);
  const tieProbe = [{ total: 10 }, { total: 10 }, { total: 5 }];
  let tiePrior = null; let tieRank = 0;
  tieProbe.forEach((row, index) => { if (row.total !== tiePrior) tieRank = index + 1; row.rank = tieRank; tiePrior = row.total; });
  assert(tieProbe[0].rank === 1 && tieProbe[1].rank === 1 && tieProbe[2].rank === 3, "competition ranking tie behavior regressed");
  const fcsGames = season.eligible.filter((game) => game.home_external_opponent_id || game.away_external_opponent_id);
  const fcsLosses = fcsGames.filter((game) => game.home_external_opponent_id ? game.away_score > game.home_score : game.home_score > game.away_score);
  const externalOpponentById = new Map((await result(admin.from("external_opponents").select("id,display_name,classification"), "load external opponents for FCS audit")).map((opponent) => [opponent.id, opponent]));
  const internalTeamById = new Map(internalTeams.map((team) => [team.id, team]));
  const fcsAudit = fcsGames.map((game) => {
    const internalTeamId = game.home_team_id ?? game.away_team_id;
    const externalOpponentId = game.home_external_opponent_id ?? game.away_external_opponent_id;
    const internalWon = game.home_team_id ? game.home_score > game.away_score : game.away_score > game.home_score;
    const events = audit.active.filter((event) => event.source_type === "game" && event.source_identifier === game.id).map((event) => ({
      id: event.id,
      team_id: event.team_id,
      rule_code: audit.ruleById.get(event.scoring_rule_id)?.code ?? null,
      points: event.points,
    }));
    return {
      game_id: game.id,
      internal_team_id: internalTeamId,
      internal_team: internalTeamById.get(internalTeamId)?.school_name ?? internalTeamId,
      external_opponent: externalOpponentById.get(externalOpponentId)?.display_name ?? externalOpponentId,
      external_classification: externalOpponentById.get(externalOpponentId)?.classification ?? null,
      home_score: game.home_score,
      away_score: game.away_score,
      internal_side: game.home_team_id ? "home" : "away",
      winner: internalWon ? "internal_fbs" : "external_fcs",
      expected_rule_code: internalWon ? "WIN" : "LOSS",
      events,
    };
  });
  const malformedFcsScoring = fcsAudit.filter((game) => game.events.length !== 1
    || game.events[0].team_id !== game.internal_team_id
    || game.events[0].rule_code !== game.expected_rule_code
    || game.events[0].points !== (game.expected_rule_code === "WIN" ? 1 : -1));
  assert(malformedFcsScoring.length === 0, `FCS game scoring mismatch: ${JSON.stringify(malformedFcsScoring.slice(0, 5))}`);
  console.log("FCS SCORING", JSON.stringify(fcsAudit));
  pass("FCS-SCORING", `${fcsAudit.length} FBS-vs-FCS games produced exactly one internal WIN +1 or LOSS -1 event`);
  console.log("SCALE", JSON.stringify({ imported_games: first.run.fetched_count, drafted_team_games: season.eligible.length, final_games_processed: season.eligible.length, events: audit.events.length, active_events: audit.active.length, voided_events: audit.events.length - audit.active.length, owners: OWNER_COUNT, drafted_teams: draft.picks.length, fcs_games: fcsGames.length, drafted_fbs_losses_to_fcs: fcsLosses.length, scoring_duration_ms: season.durationMs, total_duration_ms: elapsed(startedAt) }));
  console.log("RULE BREAKDOWN", JSON.stringify(audit.breakdown));
  console.log("STANDINGS", JSON.stringify(audit.standings.map((row) => ({ rank: row.rank, owner: row.member.team_name, total: row.total, drafted_teams: row.teams }))));
  console.log("RANKINGS", JSON.stringify({ status: "NOT TESTED", reason: "No approved authoritative historical pre-game ranking importer exists; no ranking snapshots were invented." }));
  pass("INTEGRITY", "ledger, participants, provider identities, ownership, and standings reconciled");
  console.log(`PASS COMPLETE: ${checks.length} historical season QA groups passed.`);
}

try { await main(); }
catch (error) { console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
finally {
  if (fixture.leagueId) await admin.from("leagues").delete().eq("id", fixture.leagueId);
  for (const id of fixture.createdExternalOpponentIds) await admin.from("external_opponents").delete().eq("id", id);
  for (const id of fixture.createdMappingIds) await admin.from("external_team_mappings").delete().eq("id", id);
  if (fixture.insertedClassifications.length) await admin.from("conference_classifications").delete().in("id", fixture.insertedClassifications);
  for (const userId of fixture.users.reverse()) await admin.auth.admin.deleteUser(userId);
  console.log("CLEANUP: disposable 2025 league, provider opponents/mappings, classifications, and temporary users removed.");
}
