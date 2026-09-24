-- Optional, commissioner-configured roster requirements for the college team
-- draft. Factual conference identity remains in teams; season-specific draft
-- memberships add explicit pool-rule equivalencies without relabeling teams.

create table public.league_draft_roster_slots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  slot_position integer not null check (slot_position > 0),
  label text not null check (char_length(trim(label)) between 2 and 80),
  unrestricted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_draft_roster_slots_position_key unique (league_id, slot_position)
);

create table public.league_draft_roster_slot_criteria (
  id uuid primary key default gen_random_uuid(),
  roster_slot_id uuid not null references public.league_draft_roster_slots(id) on delete cascade,
  dimension text not null check (dimension in ('conference', 'classification')),
  value text not null check (char_length(trim(value)) between 2 and 80),
  created_at timestamptz not null default now(),
  constraint league_draft_roster_slot_criteria_key unique (roster_slot_id, dimension, value)
);

create table public.team_draft_rule_memberships (
  id uuid primary key default gen_random_uuid(),
  season text not null check (season ~ '^[0-9]{4}$'),
  team_id uuid not null references public.teams(id) on delete cascade,
  dimension text not null check (dimension in ('conference', 'classification')),
  value text not null check (char_length(trim(value)) between 2 and 80),
  note text not null check (char_length(trim(note)) between 2 and 300),
  created_at timestamptz not null default now(),
  constraint team_draft_rule_memberships_key unique (season, team_id, dimension, value)
);

alter table public.draft_picks
add column roster_slot_id uuid references public.league_draft_roster_slots(id) on delete restrict;

create unique index draft_picks_member_roster_slot_key
on public.draft_picks (draft_id, league_member_id, roster_slot_id)
where roster_slot_id is not null;
create index league_draft_roster_slots_league_idx on public.league_draft_roster_slots (league_id, slot_position);
create index league_draft_roster_slot_criteria_slot_idx on public.league_draft_roster_slot_criteria (roster_slot_id);
create index team_draft_rule_memberships_lookup_idx on public.team_draft_rule_memberships (season, team_id);

create trigger league_draft_roster_slots_set_updated_at
before update on public.league_draft_roster_slots
for each row execute function public.set_updated_at();

alter table public.league_draft_roster_slots enable row level security;
alter table public.league_draft_roster_slot_criteria enable row level security;
alter table public.team_draft_rule_memberships enable row level security;

create policy "League members can read draft roster slots"
on public.league_draft_roster_slots for select to authenticated
using (private.is_league_member(league_id));

create policy "League members can read draft roster criteria"
on public.league_draft_roster_slot_criteria for select to authenticated
using (
  exists (
    select 1 from public.league_draft_roster_slots slot
    where slot.id = roster_slot_id and private.is_league_member(slot.league_id)
  )
);

create policy "Authenticated users can read draft team memberships"
on public.team_draft_rule_memberships for select to authenticated
using (true);

grant select on public.league_draft_roster_slots,
  public.league_draft_roster_slot_criteria,
  public.team_draft_rule_memberships to authenticated;

insert into public.team_draft_rule_memberships (season, team_id, dimension, value, note)
select '2026', team.id, membership.dimension, membership.value,
  'Approved Independent-team pool roster-rule membership.'
from public.teams team
join (values
  ('Notre Dame', 'conference', 'Independent'),
  ('Notre Dame', 'conference', 'ACC'),
  ('Notre Dame', 'classification', 'POWER'),
  ('UConn', 'conference', 'Independent'),
  ('UConn', 'classification', 'G5')
) as membership(school_name, dimension, value)
  on membership.school_name = team.school_name
on conflict do nothing;

create function private.team_matches_draft_roster_slot(
  target_team_id uuid,
  target_roster_slot_id uuid,
  target_season text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(slot.unrestricted or exists (
    select 1
    from public.league_draft_roster_slot_criteria criterion
    join public.teams team on team.id = target_team_id and team.active
    left join public.conference_classifications classification
      on classification.season = target_season and classification.conference = team.conference
    where criterion.roster_slot_id = slot.id
      and (
        (criterion.dimension = 'conference' and (
          criterion.value = team.conference
          or exists (
            select 1 from public.team_draft_rule_memberships membership
            where membership.season = target_season and membership.team_id = team.id
              and membership.dimension = 'conference' and membership.value = criterion.value
          )
        ))
        or (criterion.dimension = 'classification' and (
          criterion.value = classification.classification
          or exists (
            select 1 from public.team_draft_rule_memberships membership
            where membership.season = target_season and membership.team_id = team.id
              and membership.dimension = 'classification' and membership.value = criterion.value
          )
        ))
      )
  ), false)
  from public.league_draft_roster_slots slot
  where slot.id = target_roster_slot_id;
$$;

create function private.assert_draft_roster_rules_feasible(target_league_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_league public.leagues;
  slot_count integer;
  subset_mask integer;
  subset_size integer;
  eligible_count integer;
begin
  select * into target_league from public.leagues where id = target_league_id;
  if target_league.id is null then raise exception 'League not found' using errcode = 'P0002'; end if;

  select count(*) into slot_count
  from public.league_draft_roster_slots where league_id = target_league_id;
  if slot_count = 0 then return; end if;
  if slot_count <> target_league.teams_per_owner then
    raise exception 'Roster rules must define exactly one slot per team drafted' using errcode = '22023';
  end if;
  if slot_count > 12 then
    raise exception 'Restricted roster rules support at most 12 slots' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.league_draft_roster_slots slot
    where slot.league_id = target_league_id and not slot.unrestricted
      and not exists (select 1 from public.league_draft_roster_slot_criteria criterion where criterion.roster_slot_id = slot.id)
  ) then raise exception 'Every restricted roster slot needs eligibility criteria' using errcode = '22023'; end if;

  -- Hall's condition over every slot subset. Because each owner receives the
  -- same slot template, a subset with N slots needs owner_count * N unique
  -- active teams in its combined eligibility pool.
  for subset_mask in 1..((1 << slot_count) - 1) loop
    select count(*) into subset_size
    from generate_series(1, slot_count) position
    where (subset_mask & (1 << (position - 1))) <> 0;

    select count(*) into eligible_count
    from public.teams team
    where team.active and exists (
      select 1 from public.league_draft_roster_slots slot
      where slot.league_id = target_league_id
        and (subset_mask & (1 << (slot.slot_position - 1))) <> 0
        and private.team_matches_draft_roster_slot(team.id, slot.id, target_league.season)
    );

    if eligible_count < target_league.owner_count * subset_size then
      raise exception 'Roster rules cannot supply enough unique eligible teams for every owner' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create function public.save_draft_roster_rules(target_league_id uuid, target_slots jsonb)
returns setof public.league_draft_roster_slots
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league public.leagues;
  target_draft public.drafts;
  slot_record record;
  created_slot_id uuid;
  criterion_record record;
begin
  select * into target_league from public.leagues
  where id = target_league_id and commissioner_id = auth.uid() for update;
  if target_league.id is null then raise exception 'League not found or access denied' using errcode = '42501'; end if;
  if jsonb_typeof(target_slots) <> 'array' then raise exception 'Roster slots must be an array' using errcode = '22023'; end if;

  select * into target_draft from public.drafts where league_id = target_league_id for update;
  if target_draft.id is not null and target_draft.status <> 'not_started' then
    raise exception 'Roster rules cannot change after the draft starts' using errcode = 'P0001';
  end if;
  if target_draft.id is not null and exists (select 1 from public.draft_picks where draft_id = target_draft.id) then
    raise exception 'Reset the draft before changing roster rules' using errcode = 'P0001';
  end if;
  if jsonb_array_length(target_slots) not in (0, target_league.teams_per_owner) then
    raise exception 'Roster rules must define exactly one slot per team drafted' using errcode = '22023';
  end if;

  delete from public.league_draft_roster_slots where league_id = target_league_id;

  for slot_record in
    select item.value as slot, item.ordinality::integer as position
    from jsonb_array_elements(target_slots) with ordinality item(value, ordinality)
  loop
    if jsonb_typeof(slot_record.slot) <> 'object'
      or char_length(trim(coalesce(slot_record.slot->>'label', ''))) not between 2 and 80
      or jsonb_typeof(coalesce(slot_record.slot->'criteria', '[]'::jsonb)) <> 'array'
    then raise exception 'Each roster slot needs a valid label and criteria list' using errcode = '22023'; end if;

    insert into public.league_draft_roster_slots (league_id, slot_position, label, unrestricted)
    values (target_league_id, slot_record.position, trim(slot_record.slot->>'label'), coalesce((slot_record.slot->>'unrestricted')::boolean, false))
    returning id into created_slot_id;

    for criterion_record in
      select criterion.value as criterion
      from jsonb_array_elements(coalesce(slot_record.slot->'criteria', '[]'::jsonb)) criterion(value)
    loop
      if criterion_record.criterion->>'dimension' not in ('conference', 'classification')
        or char_length(trim(coalesce(criterion_record.criterion->>'value', ''))) not between 2 and 80
      then raise exception 'Roster slot criteria are invalid' using errcode = '22023'; end if;
      if criterion_record.criterion->>'dimension' = 'conference' and not exists (
        select 1 from public.teams where conference = trim(criterion_record.criterion->>'value')
      ) then raise exception 'Roster slot conference is not in the active team catalog' using errcode = '22023'; end if;
      if criterion_record.criterion->>'dimension' = 'classification' and trim(criterion_record.criterion->>'value') not in ('POWER', 'G5', 'INDEPENDENT')
      then raise exception 'Roster slot classification is invalid' using errcode = '22023'; end if;

      insert into public.league_draft_roster_slot_criteria (roster_slot_id, dimension, value)
      values (created_slot_id, criterion_record.criterion->>'dimension', trim(criterion_record.criterion->>'value'));
    end loop;
  end loop;

  perform private.assert_draft_roster_rules_feasible(target_league_id);
  return query select slot.* from public.league_draft_roster_slots slot
    where slot.league_id = target_league_id order by slot.slot_position;
end;
$$;

create or replace function public.start_draft(target_draft_id uuid)
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
  from public.drafts draft join public.leagues league on league.id = draft.league_id
  where draft.id = target_draft_id and league.commissioner_id = auth.uid()
  for update of draft, league;
  if target_league.id is null then raise exception 'Draft not found or access denied' using errcode = '42501'; end if;
  if (select status from public.drafts where id = target_draft_id) <> 'not_started' then raise exception 'Draft has already started' using errcode = 'P0001'; end if;

  select count(*) into accepted_count from public.league_members where league_id = target_league.id;
  select count(*) into slot_count from public.draft_slots where draft_id = target_draft_id;
  select count(*) into pending_count from public.league_invitations
    where league_id = target_league.id and status = 'pending' and expires_at > now();
  if accepted_count <> target_league.owner_count then raise exception 'League membership is incomplete' using errcode = 'P0001'; end if;
  if pending_count > 0 then raise exception 'Pending invitations must be resolved before starting' using errcode = 'P0001'; end if;
  if slot_count <> accepted_count then raise exception 'Randomize the complete draft order before starting' using errcode = 'P0001'; end if;
  if (select count(*) from public.teams where active) < target_league.owner_count * target_league.teams_per_owner then
    raise exception 'Not enough active teams are seeded for this draft' using errcode = 'P0001';
  end if;
  perform private.assert_draft_roster_rules_feasible(target_league.id);

  update public.drafts set status = 'live', current_round = 1, current_pick = 1, started_at = now()
  where id = target_draft_id;
  return true;
end;
$$;

create function public.submit_draft_pick(target_draft_id uuid, target_team_id uuid, target_roster_slot_id uuid)
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
  roster_rule_count integer;
  next_overall integer;
  created_pick public.draft_picks;
begin
  select * into draft_state from public.drafts where id = target_draft_id for update;
  if draft_state.id is null then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft_state.status <> 'live' then raise exception 'Draft is not live' using errcode = 'P0001'; end if;
  select * into league_state from public.leagues where id = draft_state.league_id;
  select count(*) into member_count from public.draft_slots where draft_id = target_draft_id;
  select member.* into on_clock_member
  from public.draft_slots slot join public.league_members member on member.id = slot.league_member_id
  where slot.draft_id = target_draft_id and slot.draft_position = draft_state.current_pick;
  if on_clock_member.user_id is distinct from auth.uid() then raise exception 'It is not your turn' using errcode = '42501'; end if;
  if not exists (select 1 from public.teams where id = target_team_id and active) then raise exception 'Team is unavailable' using errcode = 'P0001'; end if;

  select count(*) into roster_rule_count from public.league_draft_roster_slots where league_id = league_state.id;
  if roster_rule_count = 0 then
    if target_roster_slot_id is not null then raise exception 'This league does not use roster slots' using errcode = '22023'; end if;
  else
    if target_roster_slot_id is null then raise exception 'Choose the roster slot this pick fills' using errcode = '22023'; end if;
    if not exists (select 1 from public.league_draft_roster_slots where id = target_roster_slot_id and league_id = league_state.id) then
      raise exception 'Roster slot is not part of this league' using errcode = '42501';
    end if;
    if exists (select 1 from public.draft_picks where draft_id = target_draft_id and league_member_id = on_clock_member.id and roster_slot_id = target_roster_slot_id) then
      raise exception 'That roster slot is already filled' using errcode = '23505';
    end if;
    if not private.team_matches_draft_roster_slot(target_team_id, target_roster_slot_id, league_state.season) then
      raise exception 'That team is not eligible for the selected roster slot' using errcode = '22023';
    end if;
  end if;

  select count(*) + 1 into next_overall from public.draft_picks where draft_id = target_draft_id;
  insert into public.draft_picks (draft_id, league_member_id, team_id, roster_slot_id, round_number, pick_number, overall_pick)
  values (target_draft_id, on_clock_member.id, target_team_id, target_roster_slot_id, draft_state.current_round, draft_state.current_pick, next_overall)
  returning * into created_pick;

  if next_overall >= member_count * league_state.teams_per_owner then
    update public.drafts set status = 'complete', completed_at = now() where id = target_draft_id;
  elsif mod(draft_state.current_round, 2) = 1 then
    if draft_state.current_pick < member_count then update public.drafts set current_pick = current_pick + 1 where id = target_draft_id;
    else update public.drafts set current_round = current_round + 1 where id = target_draft_id; end if;
  else
    if draft_state.current_pick > 1 then update public.drafts set current_pick = current_pick - 1 where id = target_draft_id;
    else update public.drafts set current_round = current_round + 1 where id = target_draft_id; end if;
  end if;
  return created_pick;
exception when unique_violation then raise exception 'That team has already been drafted' using errcode = '23505';
end;
$$;

create or replace function public.submit_draft_pick(target_draft_id uuid, target_team_id uuid)
returns public.draft_picks
language sql
security invoker
set search_path = ''
as $$ select public.submit_draft_pick(target_draft_id, target_team_id, null::uuid); $$;

revoke all on function public.save_draft_roster_rules(uuid, jsonb) from public, anon;
revoke all on function public.submit_draft_pick(uuid, uuid, uuid) from public, anon;
grant execute on function public.save_draft_roster_rules(uuid, jsonb) to authenticated;
grant execute on function public.submit_draft_pick(uuid, uuid, uuid) to authenticated;

create or replace function public.add_team_to_my_draft_queue(target_draft_id uuid, target_team_id uuid)
returns public.draft_queue_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_member_id uuid;
  league_season text;
  next_position integer;
  created_item public.draft_queue_items;
begin
  select member.id, league.season into caller_member_id, league_season
  from public.drafts draft
  join public.leagues league on league.id = draft.league_id
  join public.league_members member on member.league_id = draft.league_id
  where draft.id = target_draft_id and member.user_id = auth.uid();
  if caller_member_id is null then raise exception 'Draft membership not found' using errcode = '42501'; end if;
  if (select status from public.drafts where id = target_draft_id) = 'complete' then raise exception 'Completed drafts cannot be changed' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.teams where id = target_team_id and active) then raise exception 'Team is unavailable' using errcode = 'P0001'; end if;
  if exists (select 1 from public.draft_picks where draft_id = target_draft_id and team_id = target_team_id) then raise exception 'Team has already been drafted' using errcode = '23505'; end if;
  if exists (
    select 1 from public.league_draft_roster_slots slot
    join public.drafts draft on draft.league_id = slot.league_id
    where draft.id = target_draft_id
  ) and not exists (
    select 1 from public.league_draft_roster_slots slot
    join public.drafts draft on draft.league_id = slot.league_id
    where draft.id = target_draft_id
      and not exists (
        select 1 from public.draft_picks pick
        where pick.draft_id = target_draft_id and pick.league_member_id = caller_member_id and pick.roster_slot_id = slot.id
      )
      and private.team_matches_draft_roster_slot(target_team_id, slot.id, league_season)
  ) then raise exception 'Team cannot fill a remaining roster slot' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_draft_id::text || caller_member_id::text, 0));
  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.draft_queue_items where draft_id = target_draft_id and league_member_id = caller_member_id;
  insert into public.draft_queue_items (draft_id, league_member_id, team_id, queue_position)
  values (target_draft_id, caller_member_id, target_team_id, next_position)
  returning * into created_item;
  return created_item;
exception when unique_violation then raise exception 'Team is already in your queue' using errcode = '23505';
end;
$$;
