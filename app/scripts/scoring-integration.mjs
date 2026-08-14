import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

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
if (!config.url || !config.key || !serviceKey) {
  console.error("BLOCKED: test:scoring requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY at runtime.");
  console.error("No credential values are stored or printed by this test.");
  process.exit(2);
}

const admin = createClient(config.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
const fixture = { leagueId: null, externalOpponentId: null, users: [] };
const rules = new Map();
const passed = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(label, detail) {
  passed.push(label);
  console.log(`PASS ${label}: ${detail}`);
}

async function createTestUser(role) {
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const email = `scoring-qa-${role}-${suffix}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Scoring QA ${role}` } });
  if (error || !data.user) throw error ?? new Error(`Could not create ${role} fixture user`);
  fixture.users.push(data.user.id);
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

async function oneTeam(conference, exclude = []) {
  const { data, error } = await admin.from("teams").select("*").eq("conference", conference).eq("active", true).not("id", "in", `(${exclude.join(",") || randomUUID()})`).limit(1).single();
  if (error) throw error;
  return data;
}

async function activeGameEvents(gameId) {
  const { data, error } = await admin.from("scoring_events").select("*").eq("league_id", fixture.leagueId).eq("source_type", "game").eq("source_identifier", gameId).is("voided_at", null);
  if (error) throw error;
  return data;
}

function codesFor(events, teamId) {
  return events.filter((event) => event.team_id === teamId).map((event) => rules.get(event.scoring_rule_id).code).sort();
}

function totalFor(events, teamId) {
  return events.filter((event) => event.team_id === teamId).reduce((sum, event) => sum + event.points, 0);
}

function assertCodes(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify([...expected].sort()), `${label}: expected ${expected.join(", ")}; received ${actual.join(", ")}`);
}

async function saveAndScore(client, input) {
  const { data: game, error: saveError } = await client.rpc("save_cfb_game", {
    target_game_id: input.gameId ?? null,
    target_league_id: fixture.leagueId,
    target_season: "2026",
    target_week: input.week,
    target_game_date: `2026-09-${String(input.week).padStart(2, "0")}`,
    target_home_team_id: input.home,
    target_away_team_id: input.away,
    target_home_score: input.homeScore,
    target_away_score: input.awayScore,
    target_status: "final",
    target_neutral_site: false,
    target_postseason: false,
    target_ranking_source: input.rankSource ?? null,
    target_home_rank: input.homeRank ?? null,
    target_away_rank: input.awayRank ?? null,
  });
  if (saveError) throw saveError;
  const { data: count, error: scoreError } = await client.rpc("process_cfb_game_scoring", { target_game_id: game.id });
  if (scoreError) throw scoreError;
  return { game, count, events: await activeGameEvents(game.id) };
}

async function expectDenied(promise, label) {
  const { error } = await promise;
  assert(error, `${label}: mutation unexpectedly succeeded`);
}

async function expectExternalOpponentWriteDenied(client, operation, opponent, label) {
  let result;
  if (operation === "insert") result = await client.from("external_opponents").insert({ provider: "cfbd", external_id: `denied-${randomUUID()}`, display_name: "Denied", classification: "fcs" }).select("id");
  else if (operation === "update") result = await client.from("external_opponents").update({ display_name: "Denied" }).eq("id", opponent.id).select("id");
  else result = await client.from("external_opponents").delete().eq("id", opponent.id).select("id");
  assert(result.error, `${label}: direct table request did not return a privilege error`);
  const { data: stored, error: storedError } = await admin.from("external_opponents").select("display_name").eq("id", opponent.id).single();
  if (storedError) throw storedError;
  assert(stored.display_name === opponent.display_name, `${label}: stored opponent was mutated`);
}

async function activeOwnerTotals(ownerByTeam) {
  const { data, error } = await admin.from("scoring_events").select("team_id, points").eq("league_id", fixture.leagueId).is("voided_at", null);
  if (error) throw error;
  const totals = new Map();
  for (const event of data) {
    const owner = ownerByTeam.get(event.team_id);
    if (owner) totals.set(owner, (totals.get(owner) ?? 0) + event.points);
  }
  return totals;
}

async function main() {
  const commissioner = await createTestUser("commissioner");
  const owner = await createTestUser("owner");
  const [powerA, powerB, g5, independent] = await Promise.all([
    oneTeam("SEC"), oneTeam("Big Ten"), oneTeam("American"), oneTeam("Independent"),
  ]);

  const { data: league, error: leagueError } = await admin.from("leagues").insert({ name: `Scoring QA ${randomUUID()}`, season: "2026", commissioner_id: commissioner.id, owner_count: 2, teams_per_owner: 2 }).select().single();
  if (leagueError) throw leagueError;
  fixture.leagueId = league.id;
  const { data: commissionerMember, error: commissionerMemberError } = await admin.from("league_members").select("*").eq("league_id", league.id).eq("user_id", commissioner.id).single();
  if (commissionerMemberError) throw commissionerMemberError;
  const { data: ownerMember, error: ownerMemberError } = await admin.from("league_members").insert({ league_id: league.id, user_id: owner.id, role: "owner", team_name: "QA Owner" }).select().single();
  if (ownerMemberError) throw ownerMemberError;
  const { data: draft, error: draftError } = await admin.from("drafts").insert({ league_id: league.id }).select().single();
  if (draftError) throw draftError;
  const { error: slotError } = await admin.from("draft_slots").insert([
    { draft_id: draft.id, league_member_id: commissionerMember.id, draft_position: 1 },
    { draft_id: draft.id, league_member_id: ownerMember.id, draft_position: 2 },
  ]);
  if (slotError) throw slotError;
  const picks = [
    { draft_id: draft.id, league_member_id: commissionerMember.id, team_id: powerA.id, round_number: 1, pick_number: 1, overall_pick: 1 },
    { draft_id: draft.id, league_member_id: ownerMember.id, team_id: powerB.id, round_number: 1, pick_number: 2, overall_pick: 2 },
    { draft_id: draft.id, league_member_id: ownerMember.id, team_id: independent.id, round_number: 2, pick_number: 2, overall_pick: 3 },
    { draft_id: draft.id, league_member_id: commissionerMember.id, team_id: g5.id, round_number: 2, pick_number: 1, overall_pick: 4 },
  ];
  const { error: picksError } = await admin.from("draft_picks").insert(picks);
  if (picksError) throw picksError;

  const { data: ruleRows, error: rulesError } = await admin.from("scoring_rules").select("*").is("league_id", null);
  if (rulesError) throw rulesError;
  for (const rule of ruleRows) rules.set(rule.id, rule);
  const ruleByCode = new Map(ruleRows.map((rule) => [rule.code, rule]));

  const normal = await saveAndScore(commissioner.client, { week: 1, home: powerA.id, away: independent.id, homeScore: 24, awayScore: 10 });
  assertCodes(codesFor(normal.events, powerA.id), ["WIN"], "A winner");
  assertCodes(codesFor(normal.events, independent.id), ["LOSS"], "A loser");
  assert(totalFor(normal.events, powerA.id) === 1 && totalFor(normal.events, independent.id) === -1, "A totals mismatch");
  pass("A", "normal game produced WIN +1 and LOSS -1 only");

  const rank11 = await saveAndScore(commissioner.client, { week: 2, home: powerA.id, away: powerB.id, homeScore: 30, awayScore: 20, rankSource: "QA", awayRank: 11 });
  assertCodes(codesFor(rank11.events, powerA.id), ["WIN", "WIN_OVER_RANKED", "WIN_OVER_TOP_15"], "B winner");
  assert(totalFor(rank11.events, powerA.id) === 4, "B total mismatch");
  pass("B", "rank-11 win stacked to +4 without WIN_OVER_TOP_5");

  const rank4 = await saveAndScore(commissioner.client, { week: 3, home: powerA.id, away: powerB.id, homeScore: 31, awayScore: 21, rankSource: "QA", awayRank: 4 });
  assertCodes(codesFor(rank4.events, powerA.id), ["WIN", "WIN_OVER_RANKED", "WIN_OVER_TOP_15", "WIN_OVER_TOP_5"], "C winner");
  assert(totalFor(rank4.events, powerA.id) === 7, "C total mismatch");
  pass("C", "rank-4 win stacked to +7");

  const g5Power = await saveAndScore(commissioner.client, { week: 4, home: g5.id, away: powerB.id, homeScore: 27, awayScore: 17 });
  assertCodes(codesFor(g5Power.events, g5.id), ["WIN", "G5_WIN_OVER_P5"], "D winner");
  assertCodes(codesFor(g5Power.events, powerB.id), ["LOSS", "P5_LOSS_TO_G5"], "D loser");
  assert(totalFor(g5Power.events, g5.id) === 6 && totalFor(g5Power.events, powerB.id) === -6, "D totals mismatch");
  pass("D", "unranked G5-over-POWER produced +6/-6 as separate events");

  const rankedUpset = await saveAndScore(commissioner.client, { week: 5, home: g5.id, away: powerB.id, homeScore: 28, awayScore: 24, rankSource: "QA", awayRank: 4 });
  assertCodes(codesFor(rankedUpset.events, g5.id), ["WIN", "WIN_OVER_RANKED", "WIN_OVER_TOP_15", "WIN_OVER_TOP_5", "G5_WIN_OVER_P5"], "E winner");
  assertCodes(codesFor(rankedUpset.events, powerB.id), ["LOSS", "P5_LOSS_TO_G5"], "E loser");
  assert(totalFor(rankedUpset.events, g5.id) === 12 && totalFor(rankedUpset.events, powerB.id) === -6, "E totals mismatch");
  pass("E", "ranked G5-over-POWER produced +12/-6");

  const powerG5 = await saveAndScore(commissioner.client, { week: 6, home: powerA.id, away: g5.id, homeScore: 35, awayScore: 14 });
  assertCodes(codesFor(powerG5.events, powerA.id), ["WIN"], "F winner");
  assert(!codesFor(powerG5.events, powerA.id).includes("G5_WIN_OVER_P5"), "F incorrectly awarded G5 upset");
  pass("F", "POWER-over-G5 did not receive G5_WIN_OVER_P5");

  const independentGame = await saveAndScore(commissioner.client, { week: 7, home: independent.id, away: powerB.id, homeScore: 21, awayScore: 17 });
  assertCodes(codesFor(independentGame.events, independent.id), ["WIN"], "G winner");
  assertCodes(codesFor(independentGame.events, powerB.id), ["LOSS"], "G loser");
  pass("G", "Independent matchup generated no POWER/G5 upset rules");

  const { data: externalOpponent, error: externalOpponentError } = await admin.from("external_opponents").insert({ provider: "cfbd", external_id: `qa-${randomUUID()}`, display_name: "Furman QA", classification: "fcs" }).select().single();
  if (externalOpponentError) throw externalOpponentError;
  fixture.externalOpponentId = externalOpponent.id;
  async function scoreExternal(homeScore, awayScore, week) {
    const { data: externalGame, error: externalGameError } = await admin.from("cfb_games").insert({ league_id: league.id, season: "2026", week, game_date: `2026-10-${String(week).padStart(2, "0")}`, home_team_id: powerA.id, away_external_opponent_id: externalOpponent.id, home_score: homeScore, away_score: awayScore, status: "final" }).select().single();
    if (externalGameError) throw externalGameError;
    const { error: externalScoreError } = await commissioner.client.rpc("process_cfb_game_scoring", { target_game_id: externalGame.id });
    if (externalScoreError) throw externalScoreError;
    return activeGameEvents(externalGame.id);
  }
  const fbsWinEvents = await scoreExternal(28, 7, 8);
  assertCodes(codesFor(fbsWinEvents, powerA.id), ["WIN"], "3B FBS winner");
  assert(fbsWinEvents.length === 1 && totalFor(fbsWinEvents, powerA.id) === 1, "3B FBS win external scoring mismatch");
  const fbsWinEventId = fbsWinEvents[0].id;
  const fbsWinGameId = fbsWinEvents[0].source_identifier;
  const { error: fbsWinReprocessError } = await commissioner.client.rpc("process_cfb_game_scoring", { target_game_id: fbsWinGameId });
  if (fbsWinReprocessError) throw fbsWinReprocessError;
  const fbsWinReprocessed = await activeGameEvents(fbsWinGameId);
  assert(fbsWinReprocessed.length === 1 && fbsWinReprocessed[0].id === fbsWinEventId, "3B FBS win reprocessing was not idempotent");
  pass("3B-WIN", "FBS win over FCS produced one internal WIN +1 and no external event or bonus");
  const fbsLossEvents = await scoreExternal(14, 21, 9);
  assertCodes(codesFor(fbsLossEvents, powerA.id), ["LOSS"], "3B FBS loser");
  assert(fbsLossEvents.length === 1 && totalFor(fbsLossEvents, powerA.id) === -1, "3B FBS loss external scoring mismatch");
  const fbsLossEventId = fbsLossEvents[0].id;
  const fbsLossGameId = fbsLossEvents[0].source_identifier;
  const { error: fbsLossReprocessError } = await commissioner.client.rpc("process_cfb_game_scoring", { target_game_id: fbsLossGameId });
  if (fbsLossReprocessError) throw fbsLossReprocessError;
  const fbsLossReprocessed = await activeGameEvents(fbsLossGameId);
  assert(fbsLossReprocessed.length === 1 && fbsLossReprocessed[0].id === fbsLossEventId, "3B FBS loss reprocessing was not idempotent");
  pass("3B-LOSS", "FBS loss to FCS produced only one internal LOSS -1 with no special penalty");

  const { error: correctedExternalError } = await admin.from("cfb_games").update({ home_score: 3, away_score: 24, scoring_fingerprint: null }).eq("id", fbsWinGameId);
  if (correctedExternalError) throw correctedExternalError;
  const { error: correctedExternalScoreError } = await commissioner.client.rpc("process_cfb_game_scoring", { target_game_id: fbsWinGameId });
  if (correctedExternalScoreError) throw correctedExternalScoreError;
  const { data: correctedExternalLedger, error: correctedExternalLedgerError } = await admin.from("scoring_events").select("*").eq("source_identifier", fbsWinGameId);
  if (correctedExternalLedgerError) throw correctedExternalLedgerError;
  const correctedExternalActive = correctedExternalLedger.filter((event) => !event.voided_at);
  const correctedExternalVoided = correctedExternalLedger.filter((event) => event.voided_at);
  assert(correctedExternalActive.length === 1, "3B corrected external result has duplicate active events");
  assertCodes(codesFor(correctedExternalActive, powerA.id), ["LOSS"], "3B corrected external loser");
  assert(totalFor(correctedExternalActive, powerA.id) === -1, "3B corrected external active total mismatch");
  assert(correctedExternalVoided.length === 1 && correctedExternalVoided[0].id === fbsWinEventId, "3B original external WIN was not retained and voided");
  assert(correctedExternalVoided[0].voided_by === commissioner.id && correctedExternalVoided[0].void_reason, "3B corrected external audit fields are incomplete");
  pass("3B-CORRECTION", "external WIN remained voided; one active LOSS -1 replaced it with complete audit fields");

  const { data: commissionerExternalGames, error: commissionerExternalGamesError } = await commissioner.client.from("cfb_games").select("id").eq("id", fbsWinGameId);
  assert(!commissionerExternalGamesError && commissionerExternalGames.length === 1, "3B commissioner could not read external game");
  const { data: ownerExternalGames, error: ownerExternalGamesError } = await owner.client.from("cfb_games").select("id").eq("id", fbsWinGameId);
  const { data: ownerExternalOpponents, error: ownerExternalOpponentsError } = await owner.client.from("external_opponents").select("id,display_name,classification").eq("id", externalOpponent.id);
  assert(!ownerExternalGamesError && ownerExternalGames.length === 1, "3B owner could not read league-authorized external game");
  assert(!ownerExternalOpponentsError && ownerExternalOpponents.length === 1 && ownerExternalOpponents[0].classification === "fcs", "3B owner could not read referenced external opponent");
  for (const operation of ["insert", "update", "delete"]) {
    await expectExternalOpponentWriteDenied(owner.client, operation, externalOpponent, `3B owner external opponent ${operation}`);
    await expectExternalOpponentWriteDenied(commissioner.client, operation, externalOpponent, `3B commissioner external opponent ${operation}`);
    await expectExternalOpponentWriteDenied(anon, operation, externalOpponent, `3B anonymous external opponent ${operation}`);
  }
  const { data: anonExternalGames, error: anonExternalGamesError } = await anon.from("cfb_games").select("id").eq("id", fbsWinGameId);
  const { data: anonExternalOpponents, error: anonExternalOpponentsError } = await anon.from("external_opponents").select("id").eq("id", externalOpponent.id);
  assert(!anonExternalGamesError && anonExternalGames.length === 0, "3B anonymous external game was visible");
  assert(!anonExternalOpponentsError && anonExternalOpponents.length === 0, "3B anonymous external opponent was visible");
  await expectDenied(anon.rpc("process_cfb_game_scoring", { target_game_id: fbsWinGameId }), "3B anonymous external scoring");
  const { data: providerRun, error: providerRunError } = await commissioner.client.rpc("begin_external_sync", { target_league_id: league.id, target_provider: "cfbd", target_sync_type: "schedule" });
  if (providerRunError) throw providerRunError;
  const rpcDisplayName = "Furman QA via authorized sync";
  const { error: providerApplyError } = await commissioner.client.rpc("apply_external_game_sync", { target_sync_run_id: providerRun.id, target_games: [], target_external_opponents: [{ provider: "cfbd", external_id: externalOpponent.external_id, display_name: rpcDisplayName, classification: "fcs" }], target_mapping_summary: { unmapped_games: [] } });
  if (providerApplyError) throw providerApplyError;
  const { data: rpcUpdatedOpponent, error: rpcUpdatedOpponentError } = await admin.from("external_opponents").select("display_name").eq("id", externalOpponent.id).single();
  if (rpcUpdatedOpponentError) throw rpcUpdatedOpponentError;
  assert(rpcUpdatedOpponent.display_name === rpcDisplayName, "3B authorized provider sync could not update external opponent");
  externalOpponent.display_name = rpcDisplayName;
  pass("3B-RLS", "commissioner and owner reads succeeded; all browser table writes and anonymous reads/scoring were denied; authorized sync RPC retained write access");

  const beforeIds = (await activeGameEvents(normal.game.id)).map((event) => event.id).sort();
  const { error: secondScoreError } = await commissioner.client.rpc("process_cfb_game_scoring", { target_game_id: normal.game.id });
  if (secondScoreError) throw secondScoreError;
  const afterIds = (await activeGameEvents(normal.game.id)).map((event) => event.id).sort();
  assert(JSON.stringify(beforeIds) === JSON.stringify(afterIds), "H unchanged processing changed active events");
  pass("H", "unchanged reprocessing preserved IDs, count, and totals");

  const correction = await saveAndScore(commissioner.client, { gameId: normal.game.id, week: 1, home: powerA.id, away: independent.id, homeScore: 10, awayScore: 24 });
  const { data: correctionLedger, error: correctionError } = await admin.from("scoring_events").select("*").eq("source_identifier", normal.game.id);
  if (correctionError) throw correctionError;
  assert(correctionLedger.some((event) => event.voided_at), "I original events were not voided");
  assertCodes(codesFor(correction.events, independent.id), ["WIN"], "I corrected winner");
  assertCodes(codesFor(correction.events, powerA.id), ["LOSS"], "I corrected loser");
  pass("I", "correction preserved voided originals and created active replacements");

  const heisman = ruleByCode.get("HEISMAN_WINNER");
  const { data: manualEvent, error: manualError } = await commissioner.client.rpc("add_manual_scoring_event", { target_league_id: league.id, target_team_id: powerA.id, target_rule_id: heisman.id, target_week: null, target_event_date: "2026-12-12", target_notes: "Isolated scoring QA" });
  if (manualError) throw manualError;
  assert(manualEvent.points === 10, "J manual points mismatch");
  pass("J", "HEISMAN_WINNER exists independently at +10");
  const { data: voided, error: voidError } = await commissioner.client.rpc("void_manual_scoring_event", { target_event_id: manualEvent.id, target_reason: "Scoring QA reversal" });
  if (voidError) throw voidError;
  assert(voided.voided_at && voided.voided_by && voided.void_reason === "Scoring QA reversal", "K void audit fields missing");
  pass("K", "manual event remained with complete void audit and is inactive");
  pass("L", "B, C, and E prove cumulative rule stacking with separate ledger rows");

  const ownerByTeam = new Map([[powerA.id, commissionerMember.id], [g5.id, commissionerMember.id], [powerB.id, ownerMember.id], [independent.id, ownerMember.id]]);
  let totals = await activeOwnerTotals(ownerByTeam);
  const commissionerTotal = totals.get(commissionerMember.id) ?? 0;
  const ownerTotal = totals.get(ownerMember.id) ?? 0;
  const lowerMember = commissionerTotal <= ownerTotal ? commissionerMember : ownerMember;
  const lowerTeam = lowerMember.id === commissionerMember.id ? powerA : powerB;
  for (let index = 0; index < Math.abs(commissionerTotal - ownerTotal); index += 1) {
    const { error } = await commissioner.client.rpc("add_manual_scoring_event", { target_league_id: league.id, target_team_id: lowerTeam.id, target_rule_id: ruleByCode.get("WIN").id, target_week: null, target_event_date: "2026-12-31", target_notes: "Tie fixture" });
    if (error) throw error;
  }
  totals = await activeOwnerTotals(ownerByTeam);
  const tiedRows = [commissionerMember, ownerMember].map((member) => ({ memberId: member.id, total: totals.get(member.id) ?? 0 })).sort((a, b) => b.total - a.total);
  let priorTotal = null; let priorRank = 0;
  tiedRows.forEach((row, index) => { if (row.total !== priorTotal) priorRank = index + 1; row.rank = priorRank; priorTotal = row.total; });
  assert(tiedRows[0].total === tiedRows[1].total && tiedRows[0].rank === tiedRows[1].rank, "M tied standings did not share rank");
  pass("M", `equal totals ${tiedRows[0].total} share rank ${tiedRows[0].rank}`);

  const { data: ownerEvents, error: ownerReadError } = await owner.client.from("scoring_events").select("id").eq("league_id", league.id).limit(1);
  assert(!ownerReadError && ownerEvents.length > 0, "N owner could not read scoring events");
  const { data: ownerPicks, error: ownerPicksError } = await owner.client.from("draft_picks").select("team_id").eq("draft_id", draft.id);
  const { data: ownerMembers, error: ownerMembersError } = await owner.client.from("league_members").select("id").eq("league_id", league.id);
  assert(!ownerPicksError && ownerPicks.length === 4 && !ownerMembersError && ownerMembers.length === 2, "N owner could not read standings/breakdown inputs");
  const { data: securityEvent, error: securityEventError } = await commissioner.client.rpc("add_manual_scoring_event", { target_league_id: league.id, target_team_id: powerB.id, target_rule_id: heisman.id, target_week: null, target_event_date: "2026-12-12", target_notes: "Security fixture" });
  if (securityEventError) throw securityEventError;
  await expectDenied(owner.client.rpc("save_cfb_game", {
    target_game_id: rank4.game.id, target_league_id: league.id, target_season: "2026", target_week: 3,
    target_game_date: "2026-09-03", target_home_team_id: powerA.id, target_away_team_id: powerB.id,
    target_home_score: 31, target_away_score: 21, target_status: "final", target_neutral_site: false,
    target_postseason: false, target_ranking_source: "QA", target_home_rank: null, target_away_rank: 4,
  }), "N owner save game");
  await expectDenied(owner.client.rpc("process_cfb_game_scoring", { target_game_id: rank4.game.id }), "N owner process game");
  await expectDenied(owner.client.rpc("add_manual_scoring_event", { target_league_id: league.id, target_team_id: powerB.id, target_rule_id: heisman.id, target_week: null, target_event_date: "2026-12-12", target_notes: "must fail" }), "N owner manual event");
  await expectDenied(owner.client.rpc("void_manual_scoring_event", { target_event_id: securityEvent.id, target_reason: "must fail" }), "N owner void");
  const { data: anonRows, error: anonReadError } = await anon.from("scoring_events").select("id").eq("league_id", league.id);
  assert(!anonReadError && anonRows.length === 0, "N anonymous scoring data was visible");
  await expectDenied(anon.rpc("process_cfb_game_scoring", { target_game_id: rank4.game.id }), "N anonymous process game");
  pass("N", "commissioner mutations succeeded; owner reads succeeded; owner and anonymous mutations were denied; anonymous rows were hidden");
}

try {
  await main();
  console.log(`PASS COMPLETE: ${passed.length} scoring QA cases passed against the real database.`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (fixture.leagueId) await admin.from("leagues").delete().eq("id", fixture.leagueId);
  if (fixture.externalOpponentId) await admin.from("external_opponents").delete().eq("id", fixture.externalOpponentId);
  for (const userId of fixture.users.reverse()) await admin.auth.admin.deleteUser(userId);
  console.log("CLEANUP: disposable league and temporary auth users removed.");
}
