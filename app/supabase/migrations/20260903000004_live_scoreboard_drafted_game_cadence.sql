alter table public.live_scoreboard_poll_runs
  add column scoreboard_calls integer not null default 0 check (scoreboard_calls >= 0),
  add column info_calls integer not null default 0 check (info_calls >= 0);

create function public.record_live_scoreboard_call_breakdown(
  target_run_id uuid,
  target_lease_token uuid,
  target_scoreboard_calls integer,
  target_info_calls integer
)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if target_scoreboard_calls < 0 or target_info_calls < 0 then
    raise exception 'Invalid live scoreboard call breakdown' using errcode = '22023';
  end if;

  update public.live_scoreboard_poll_runs
  set scoreboard_calls = target_scoreboard_calls,
      info_calls = target_info_calls
  where id = target_run_id
    and lease_token = target_lease_token
    and status = 'running';

  return found;
end; $$;

do $$
declare
  function_definition text;
  old_fragment text := $fragment$
  if target_trigger = 'scheduled' and not exists (
    select 1 from public.cfb_games game
    where game.league_id = any(target_league_ids) and game.external_provider = 'cfbd'
      and game.start_at between clock_timestamp() - interval '6 hours' and clock_timestamp() + interval '12 hours'
      and game.status not in ('canceled', 'postponed')
  ) then return null; end if;$fragment$;
  new_fragment text := $fragment$
  if target_trigger = 'scheduled' and not exists (
    select 1
    from public.cfb_games game
    join public.drafts draft on draft.league_id = game.league_id and draft.status = 'complete'
    join public.draft_picks pick on pick.draft_id = draft.id
      and pick.team_id in (game.home_team_id, game.away_team_id)
    where game.league_id = any(target_league_ids) and game.external_provider = 'cfbd'
      and game.start_at between clock_timestamp() - interval '6 hours' and clock_timestamp() + interval '12 hours'
      and game.status not in ('canceled', 'postponed')
  ) then return null; end if;$fragment$;
begin
  select pg_get_functiondef('public.begin_live_scoreboard_poll(text,uuid[])'::regprocedure)
  into function_definition;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'Expected begin_live_scoreboard_poll cadence fragment was not found';
  end if;
  execute replace(function_definition, old_fragment, new_fragment);
end; $$;

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.complete_live_scoreboard_poll(uuid,uuid,jsonb,integer,jsonb)'::regprocedure)
  into function_definition;

  if position('v_any_live boolean := false;' in function_definition) = 0
    or position('v_any_live := v_any_live or v_item->>''status'' = ''in_progress'';' in function_definition) = 0
    or position('case when v_any_live then live_interval_seconds else pregame_interval_seconds end' in function_definition) = 0 then
    raise exception 'Expected complete_live_scoreboard_poll cadence fragments were not found';
  end if;

  function_definition := replace(function_definition,
    'v_any_live boolean := false;',
    'v_any_drafted_live boolean := false;');
  function_definition := replace(function_definition,
    'v_any_live := v_any_live or v_item->>''status'' = ''in_progress'';',
    $fragment$if v_item->>'status' = 'in_progress' and exists (
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
    end if;$fragment$);
  function_definition := replace(function_definition,
    'case when v_any_live then live_interval_seconds else pregame_interval_seconds end',
    'case when v_any_drafted_live then live_interval_seconds else pregame_interval_seconds end');
  execute function_definition;
end; $$;

revoke all on function public.record_live_scoreboard_call_breakdown(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.record_live_scoreboard_call_breakdown(uuid, uuid, integer, integer) to service_role;
revoke all on function public.begin_live_scoreboard_poll(text, uuid[]) from public, anon, authenticated;
grant execute on function public.begin_live_scoreboard_poll(text, uuid[]) to service_role;
revoke all on function public.complete_live_scoreboard_poll(uuid, uuid, jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.complete_live_scoreboard_poll(uuid, uuid, jsonb, integer, jsonb) to service_role;
