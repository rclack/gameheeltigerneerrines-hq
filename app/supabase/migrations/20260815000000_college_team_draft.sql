-- College team catalog and atomic snake-draft engine.

create type public.draft_status as enum ('not_started', 'live', 'paused', 'complete');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  school_name text not null check (char_length(trim(school_name)) between 2 and 120),
  short_name text not null check (char_length(trim(short_name)) between 2 and 80),
  abbreviation text not null check (abbreviation = upper(trim(abbreviation)) and char_length(abbreviation) between 2 and 10),
  conference text not null check (char_length(trim(conference)) between 2 and 80),
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint teams_school_name_key unique (school_name),
  constraint teams_abbreviation_key unique (abbreviation)
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  status public.draft_status not null default 'not_started',
  current_round integer not null default 1 check (current_round > 0),
  current_pick integer not null default 1 check (current_pick > 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drafts_league_key unique (league_id),
  constraint drafts_timestamps_consistent check (
    (status = 'not_started' and started_at is null and completed_at is null)
    or (status in ('live', 'paused') and started_at is not null and completed_at is null)
    or (status = 'complete' and started_at is not null and completed_at is not null)
  )
);

create table public.draft_slots (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  league_member_id uuid not null references public.league_members(id) on delete cascade,
  draft_position integer not null check (draft_position > 0),
  created_at timestamptz not null default now(),
  constraint draft_slots_member_key unique (draft_id, league_member_id),
  constraint draft_slots_position_key unique (draft_id, draft_position)
);

create table public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  league_member_id uuid not null references public.league_members(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  round_number integer not null check (round_number > 0),
  pick_number integer not null check (pick_number > 0),
  overall_pick integer not null check (overall_pick > 0),
  created_at timestamptz not null default now(),
  constraint draft_picks_team_key unique (draft_id, team_id),
  constraint draft_picks_overall_key unique (draft_id, overall_pick),
  constraint draft_picks_round_pick_key unique (draft_id, round_number, pick_number),
  constraint draft_picks_member_round_key unique (draft_id, league_member_id, round_number)
);

create index teams_active_conference_name_idx on public.teams (active, conference, school_name);
create index draft_slots_member_id_idx on public.draft_slots (league_member_id);
create index draft_picks_member_id_idx on public.draft_picks (league_member_id);
create index draft_picks_team_id_idx on public.draft_picks (team_id);

create trigger drafts_set_updated_at
before update on public.drafts
for each row execute function public.set_updated_at();

alter table public.teams enable row level security;
alter table public.drafts enable row level security;
alter table public.draft_slots enable row level security;
alter table public.draft_picks enable row level security;

create policy "Authenticated users can read active teams"
on public.teams for select to authenticated
using (active);

create policy "League members can read their drafts"
on public.drafts for select to authenticated
using (private.is_league_member(league_id));

create policy "League members can read draft slots"
on public.draft_slots for select to authenticated
using (
  exists (
    select 1 from public.drafts
    where drafts.id = draft_slots.draft_id
      and private.is_league_member(drafts.league_id)
  )
);

create policy "League members can read draft picks"
on public.draft_picks for select to authenticated
using (
  exists (
    select 1 from public.drafts
    where drafts.id = draft_picks.draft_id
      and private.is_league_member(drafts.league_id)
  )
);

grant select on public.teams, public.drafts, public.draft_slots, public.draft_picks to authenticated;

-- Creates or re-randomizes the not-started draft order. The commissioner can
-- prepare an incomplete league, but start_draft enforces a full accepted roster.
create function public.randomize_draft_order(target_league_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_draft_id uuid;
begin
  if not exists (
    select 1 from public.leagues
    where id = target_league_id and commissioner_id = auth.uid()
  ) then
    raise exception 'League not found or access denied' using errcode = '42501';
  end if;

  insert into public.drafts (league_id)
  values (target_league_id)
  on conflict (league_id) do nothing;

  select id into target_draft_id
  from public.drafts where league_id = target_league_id for update;

  if (select status from public.drafts where id = target_draft_id) <> 'not_started' then
    raise exception 'Draft order cannot change after the draft starts' using errcode = 'P0001';
  end if;

  delete from public.draft_slots where draft_id = target_draft_id;

  insert into public.draft_slots (draft_id, league_member_id, draft_position)
  select target_draft_id, id, row_number() over (order by random())
  from public.league_members
  where league_id = target_league_id;

  return target_draft_id;
end;
$$;

create function public.start_draft(target_draft_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league public.leagues;
  accepted_count integer;
  slot_count integer;
  pending_count integer;
begin
  select league.* into target_league
  from public.drafts draft
  join public.leagues league on league.id = draft.league_id
  where draft.id = target_draft_id and league.commissioner_id = auth.uid()
  for update of draft, league;

  if target_league.id is null then
    raise exception 'Draft not found or access denied' using errcode = '42501';
  end if;

  if (select status from public.drafts where id = target_draft_id) <> 'not_started' then
    raise exception 'Draft has already started' using errcode = 'P0001';
  end if;

  select count(*) into accepted_count from public.league_members where league_id = target_league.id;
  select count(*) into slot_count from public.draft_slots where draft_id = target_draft_id;
  select count(*) into pending_count from public.league_invitations
  where league_id = target_league.id and status = 'pending' and expires_at > now();

  if accepted_count <> target_league.owner_count then
    raise exception 'League membership is incomplete' using errcode = 'P0001';
  end if;
  if pending_count > 0 then
    raise exception 'Pending invitations must be resolved before starting' using errcode = 'P0001';
  end if;
  if slot_count <> accepted_count then
    raise exception 'Randomize the complete draft order before starting' using errcode = 'P0001';
  end if;
  if (select count(*) from public.teams where active) < target_league.owner_count * target_league.teams_per_owner then
    raise exception 'Not enough active teams are seeded for this draft' using errcode = 'P0001';
  end if;

  update public.drafts
  set status = 'live', current_round = 1, current_pick = 1, started_at = now()
  where id = target_draft_id;
  return true;
end;
$$;

create function public.set_draft_paused(target_draft_id uuid, should_pause boolean)
returns public.draft_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_status public.draft_status;
begin
  update public.drafts draft
  set status = case when should_pause then 'paused'::public.draft_status else 'live'::public.draft_status end
  from public.leagues league
  where draft.id = target_draft_id
    and draft.league_id = league.id
    and league.commissioner_id = auth.uid()
    and ((should_pause and draft.status = 'live') or (not should_pause and draft.status = 'paused'))
  returning draft.status into new_status;

  if new_status is null then
    raise exception 'Draft cannot make that status transition' using errcode = 'P0001';
  end if;
  return new_status;
end;
$$;

-- Locks the draft, derives the on-clock member and all pick numbers, inserts the
-- selection, then advances or completes the snake draft in one transaction.
create function public.submit_draft_pick(target_draft_id uuid, target_team_id uuid)
returns public.draft_picks
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_state public.drafts;
  league_state public.leagues;
  on_clock_member public.league_members;
  member_count integer;
  next_overall integer;
  created_pick public.draft_picks;
begin
  select * into draft_state from public.drafts where id = target_draft_id for update;
  if draft_state.id is null then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft_state.status <> 'live' then raise exception 'Draft is not live' using errcode = 'P0001'; end if;

  select * into league_state from public.leagues where id = draft_state.league_id;
  select count(*) into member_count from public.draft_slots where draft_id = target_draft_id;

  select member.* into on_clock_member
  from public.draft_slots slot
  join public.league_members member on member.id = slot.league_member_id
  where slot.draft_id = target_draft_id and slot.draft_position = draft_state.current_pick;

  if on_clock_member.user_id is distinct from auth.uid() then
    raise exception 'It is not your turn' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams where id = target_team_id and active) then
    raise exception 'Team is unavailable' using errcode = 'P0001';
  end if;

  select count(*) + 1 into next_overall from public.draft_picks where draft_id = target_draft_id;

  insert into public.draft_picks (
    draft_id, league_member_id, team_id, round_number, pick_number, overall_pick
  ) values (
    target_draft_id, on_clock_member.id, target_team_id,
    draft_state.current_round, draft_state.current_pick, next_overall
  ) returning * into created_pick;

  if next_overall >= member_count * league_state.teams_per_owner then
    update public.drafts set status = 'complete', completed_at = now()
    where id = target_draft_id;
  elsif mod(draft_state.current_round, 2) = 1 then
    if draft_state.current_pick < member_count then
      update public.drafts set current_pick = current_pick + 1 where id = target_draft_id;
    else
      update public.drafts set current_round = current_round + 1 where id = target_draft_id;
    end if;
  else
    if draft_state.current_pick > 1 then
      update public.drafts set current_pick = current_pick - 1 where id = target_draft_id;
    else
      update public.drafts set current_round = current_round + 1 where id = target_draft_id;
    end if;
  end if;

  return created_pick;
exception
  when unique_violation then
    raise exception 'That team has already been drafted' using errcode = '23505';
end;
$$;

create function public.update_my_team_name(target_league_id uuid, new_team_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(trim(new_team_name)) not between 2 and 80 then
    raise exception 'Team name must contain 2 to 80 characters' using errcode = '22023';
  end if;

  update public.league_members
  set team_name = trim(new_team_name)
  where league_id = target_league_id and user_id = auth.uid();

  if not found then raise exception 'League membership not found' using errcode = '42501'; end if;
  return true;
end;
$$;

revoke all on function public.randomize_draft_order(uuid) from public;
revoke all on function public.start_draft(uuid) from public;
revoke all on function public.set_draft_paused(uuid, boolean) from public;
revoke all on function public.submit_draft_pick(uuid, uuid) from public;
revoke all on function public.update_my_team_name(uuid, text) from public;
grant execute on function public.randomize_draft_order(uuid) to authenticated;
grant execute on function public.start_draft(uuid) to authenticated;
grant execute on function public.set_draft_paused(uuid, boolean) to authenticated;
grant execute on function public.submit_draft_pick(uuid, uuid) to authenticated;
grant execute on function public.update_my_team_name(uuid, text) to authenticated;

-- Supabase Realtime broadcasts committed state changes. The UI also polls as a
-- fallback for projects where Realtime replication is disabled.
alter publication supabase_realtime add table public.drafts;
alter publication supabase_realtime add table public.draft_picks;
