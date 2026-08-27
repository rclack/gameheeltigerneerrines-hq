-- Treat Week 0 as a first-class competition week while preserving CFBD's provider week.

alter table public.cfb_games add column provider_week integer;
alter table public.team_ranking_snapshots add column provider_week integer;

update public.cfb_games
set provider_week = week
where external_provider = 'cfbd' and provider_week is null;

update public.team_ranking_snapshots snapshot
set provider_week = game.provider_week
from public.cfb_games game
where game.id = snapshot.game_id and snapshot.provider_week is null;

alter table public.cfb_games
  add constraint cfb_games_provider_week_check check (provider_week is null or provider_week >= 0);
alter table public.team_ranking_snapshots
  add constraint team_ranking_snapshots_provider_week_check check (provider_week is null or provider_week >= 0);

alter table public.cfb_games drop constraint cfb_games_week_check;
alter table public.cfb_games add constraint cfb_games_week_check check (week >= 0);
alter table public.team_ranking_snapshots drop constraint team_ranking_snapshots_week_check;
alter table public.team_ranking_snapshots add constraint team_ranking_snapshots_week_check check (week >= 0);
alter table public.scoring_events drop constraint scoring_events_week_check;
alter table public.scoring_events add constraint scoring_events_week_check check (week is null or week >= 0);
alter table public.weekly_recap_snapshots drop constraint weekly_recap_snapshots_week_check;
alter table public.weekly_recap_snapshots add constraint weekly_recap_snapshots_week_check check (week >= 0);
alter table public.sunday_recaps drop constraint sunday_recaps_week_check;
alter table public.sunday_recaps add constraint sunday_recaps_week_check check (week >= 0);
alter table public.weekly_lineups drop constraint weekly_lineups_week_check;
alter table public.weekly_lineups add constraint weekly_lineups_week_check check (week >= 0);
alter table public.leagues drop constraint leagues_lineups_enabled_from_week_check;
alter table public.leagues add constraint leagues_lineups_enabled_from_week_check
  check (lineups_enabled_from_week is null or lineups_enabled_from_week >= 0);

create or replace function private.preserve_provider_week()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.external_provider = 'cfbd' and new.provider_week is null then
    new.provider_week := case when new.season = '2026' and new.week = 0 then 1 else new.week end;
  end if;
  return new;
end;
$$;

create trigger cfb_games_preserve_provider_week
before insert or update of season, week, provider_week on public.cfb_games
for each row execute function private.preserve_provider_week();

create or replace function private.preserve_ranking_provider_week()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.game_id is not null then
    select game.provider_week into new.provider_week
    from public.cfb_games game where game.id = new.game_id;
  end if;
  return new;
end;
$$;

create trigger team_ranking_snapshots_preserve_provider_week
before insert or update of game_id, provider_week on public.team_ranking_snapshots
for each row execute function private.preserve_ranking_provider_week();

alter table public.weekly_lineup_entries
  drop constraint weekly_lineup_entries_selection_source_check;
alter table public.weekly_lineup_entries
  add constraint weekly_lineup_entries_selection_source_check
  check (selection_source in ('week0_auto', 'week1_auto', 'carry_forward', 'bye_replacement', 'owner', 'commissioner'));

-- Safely widen installed function guards without changing signatures, grants, security posture, or behavior.
do $migration$
declare
  v_oid regprocedure;
  v_definition text;
begin
  foreach v_oid in array array[
    'public.save_cfb_game(uuid,uuid,text,integer,date,uuid,uuid,integer,integer,text,boolean,boolean,text,integer,integer)'::regprocedure,
    'public.add_manual_scoring_event(uuid,uuid,uuid,integer,date,text)'::regprocedure,
    'public.create_weekly_recap_snapshot(uuid,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(v_oid) into v_definition;
    v_definition := replace(v_definition, 'target_week < 1', 'target_week < 0');
    v_definition := replace(v_definition, 'target_week < 1 then', 'target_week < 0 then');
    execute v_definition;
  end loop;
end;
$migration$;

-- Materialization has additional initial-week and carry-forward semantics.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.materialize_weekly_lineup(uuid,integer,uuid)'::regprocedure)
  into v_definition;
  v_definition := replace(v_definition, 'target_week < 1', 'target_week < 0');
  v_definition := replace(v_definition, 'target_week > 1', 'target_week > 0');
  v_definition := replace(v_definition, 'target_week = 1 then ''week1_auto''', 'target_week = 0 then ''week0_auto''');
  execute v_definition;
end;
$migration$;
