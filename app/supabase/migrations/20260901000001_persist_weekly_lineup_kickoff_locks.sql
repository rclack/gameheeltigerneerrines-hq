-- Persist authoritative kickoff locks even when the requested owner mutation is rejected.

create or replace function public.set_weekly_lineup_starters(
  target_lineup_id uuid,
  target_starter_team_ids uuid[],
  target_request_key uuid
)
returns public.weekly_lineups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineup public.weekly_lineups;
  v_entry record;
  v_now timestamptz;
  v_locked_starters integer;
begin
  select lineup.* into v_lineup from public.weekly_lineups lineup
  join public.league_members member on member.id = lineup.league_member_id
  where lineup.id = target_lineup_id and member.user_id = auth.uid()
  for update of lineup;
  if v_lineup.id is null then raise exception 'Lineup not found or access denied' using errcode = '42501'; end if;
  if target_request_key is null then raise exception 'Request key is required' using errcode = '22023'; end if;
  if cardinality(target_starter_team_ids) <> (select count(distinct value) from unnest(target_starter_team_ids) value) then
    raise exception 'Starter selection contains duplicates' using errcode = '22023';
  end if;

  -- Read wall-clock database time only after the parent lock is acquired so a
  -- request which waited across kickoff cannot retain a pre-kickoff timestamp.
  v_now := clock_timestamp();
  update public.weekly_lineup_entries set locked_at = coalesce(locked_at, v_now)
  where weekly_lineup_id = v_lineup.id and lock_at <= v_now and locked_at is null;

  if exists (
    select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id and entry.locked_at is not null
      and ((entry.status = 'starter') is distinct from (entry.team_id = any(target_starter_team_ids)))
  ) then return null; end if;

  if exists (select 1 from unnest(target_starter_team_ids) team_id where not exists (
    select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id
      and entry.team_id = team_id and entry.status <> 'no_game' and entry.locked_at is null
  ) and not exists (
    select 1 from public.weekly_lineup_entries entry where entry.weekly_lineup_id = v_lineup.id
      and entry.team_id = team_id and entry.status = 'starter' and entry.locked_at is not null
  )) then raise exception 'Starter is not eligible or owned' using errcode = '22023'; end if;

  select count(*) into v_locked_starters from public.weekly_lineup_entries
  where weekly_lineup_id = v_lineup.id and locked_at is not null and status = 'starter';
  if cardinality(target_starter_team_ids) > v_lineup.starters_limit_snapshot
     or cardinality(target_starter_team_ids) < v_locked_starters then
    raise exception 'Starter limit would be violated' using errcode = '23514';
  end if;

  for v_entry in select * from public.weekly_lineup_entries where weekly_lineup_id = v_lineup.id and locked_at is null and status <> 'no_game' for update
  loop
    if v_entry.status is distinct from (case when v_entry.team_id = any(target_starter_team_ids) then 'starter' else 'bench' end) then
      insert into public.weekly_lineup_changes (weekly_lineup_entry_id, from_status, to_status, change_source, actor_id, request_key, kickoff_at_snapshot)
      values (v_entry.id, v_entry.status, case when v_entry.team_id = any(target_starter_team_ids) then 'starter' else 'bench' end,
        'owner', auth.uid(), target_request_key, v_entry.kickoff_at_snapshot);
      update public.weekly_lineup_entries set status = case when team_id = any(target_starter_team_ids) then 'starter' else 'bench' end,
        selection_source = 'owner' where id = v_entry.id;
    end if;
  end loop;
  return v_lineup;
end;
$$;
