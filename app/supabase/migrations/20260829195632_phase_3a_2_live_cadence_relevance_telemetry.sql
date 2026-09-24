alter table public.live_scoreboard_poll_runs
  add column canonical_game_count integer not null default 0 check (canonical_game_count >= 0),
  add column drafted_relevant_game_count integer not null default 0 check (drafted_relevant_game_count >= 0),
  add column drafted_live_game_count integer not null default 0 check (drafted_live_game_count >= 0);

update public.live_scoreboard_poll_runs
set canonical_game_count = relevant_game_count;

do $$
declare
  function_definition text;
  old_declarations text := $fragment$
  v_relevant integer := 0;
  v_changed integer := 0;$fragment$;
  new_declarations text := $fragment$
  v_relevant integer := 0;
  v_drafted_relevant integer := 0;
  v_drafted_live integer := 0;
  v_changed integer := 0;$fragment$;
  old_relevance text := $fragment$
    v_relevant := v_relevant + 1;
    if v_item->>'status' = 'in_progress' and exists (
      select 1
      from public.cfb_games game
      join public.drafts draft on draft.league_id = game.league_id and draft.status = 'complete'
      join public.draft_picks pick on pick.draft_id = draft.id
        and pick.team_id in (game.home_team_id, game.away_team_id)
      where game.league_id = any(v_run.league_ids)
        and game.external_provider = 'cfbd'
        and game.external_id = v_item->>'provider_game_id'
    ) then
      v_any_drafted_live := true;
    end if;$fragment$;
  new_relevance text := $fragment$
    v_relevant := v_relevant + 1;
    if exists (
      select 1
      from public.cfb_games game
      join public.drafts draft on draft.league_id = game.league_id and draft.status = 'complete'
      join public.draft_picks pick on pick.draft_id = draft.id
        and pick.team_id in (game.home_team_id, game.away_team_id)
      where game.league_id = any(v_run.league_ids)
        and game.external_provider = 'cfbd'
        and game.external_id = v_item->>'provider_game_id'
    ) then
      v_drafted_relevant := v_drafted_relevant + 1;
      if v_item->>'status' = 'in_progress' then
        v_drafted_live := v_drafted_live + 1;
        v_any_drafted_live := true;
      end if;
    end if;$fragment$;
  old_run_update text := $fragment$
    provider_game_count = v_provider_count, relevant_game_count = v_relevant, changed_game_count = v_changed,
    unchanged_game_count = v_unchanged, unmatched_game_count = v_unmatched,$fragment$;
  new_run_update text := $fragment$
    provider_game_count = v_provider_count, relevant_game_count = v_relevant,
    canonical_game_count = v_relevant, drafted_relevant_game_count = v_drafted_relevant,
    drafted_live_game_count = v_drafted_live, changed_game_count = v_changed,
    unchanged_game_count = v_unchanged, unmatched_game_count = v_unmatched,$fragment$;
  old_cadence text := $fragment$
    next_poll_at = v_now + make_interval(secs => v_interval), last_success_at = v_now, consecutive_errors = 0,$fragment$;
  new_cadence text := $fragment$
    next_poll_at = greatest(v_run.started_at + make_interval(secs => v_interval), v_now),
    last_success_at = v_now, consecutive_errors = 0,$fragment$;
begin
  select pg_get_functiondef('public.complete_live_scoreboard_poll(uuid,uuid,jsonb,integer,jsonb)'::regprocedure)
  into function_definition;

  if position(old_declarations in function_definition) = 0
    or position(old_relevance in function_definition) = 0
    or position(old_run_update in function_definition) = 0
    or position(old_cadence in function_definition) = 0 then
    raise exception 'Expected Phase 3A live-scoreboard function fragments were not found';
  end if;

  function_definition := replace(function_definition, old_declarations, new_declarations);
  function_definition := replace(function_definition, old_relevance, new_relevance);
  function_definition := replace(function_definition, old_run_update, new_run_update);
  function_definition := replace(function_definition, old_cadence, new_cadence);
  execute function_definition;
end; $$;

comment on column public.live_scoreboard_poll_runs.provider_game_count is
  'Number of games returned by the shared CFBD scoreboard request.';
comment on column public.live_scoreboard_poll_runs.canonical_game_count is
  'Number of provider games matched to canonical schedule identity in the configured league scope.';
comment on column public.live_scoreboard_poll_runs.drafted_relevant_game_count is
  'Number of canonical games involving a drafted team in a completed, explicitly scoped production league.';
comment on column public.live_scoreboard_poll_runs.drafted_live_game_count is
  'Number of drafted-relevant games reported in progress; this alone selects accelerated live cadence.';

revoke all on function public.complete_live_scoreboard_poll(uuid, uuid, jsonb, integer, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_live_scoreboard_poll(uuid, uuid, jsonb, integer, jsonb)
to service_role;
