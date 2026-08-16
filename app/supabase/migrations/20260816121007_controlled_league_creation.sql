-- Controlled league creation and identity-bound site-administrator review.
-- Authenticated users may request leagues, but only an approved administrator
-- identity can atomically create one. Review secrets are stored as digests in
-- the private schema and never exposed through the Data API.

create type public.league_creation_request_status as enum ('pending', 'approved', 'denied', 'expired');

create table public.league_creation_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  requester_email text not null check (requester_email = lower(trim(requester_email))),
  proposed_name text not null check (char_length(trim(proposed_name)) between 2 and 100),
  season text not null check (season ~ '^[0-9]{4}$'),
  owner_count integer not null check (owner_count between 4 and 16),
  teams_per_owner integer not null check (teams_per_owner between 3 and 8),
  roster_rules jsonb not null default '[]'::jsonb,
  status public.league_creation_request_status not null default 'pending',
  expires_at timestamptz not null,
  approved_league_id uuid references public.leagues(id) on delete restrict,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete restrict,
  notification_status text not null default 'pending' check (notification_status in ('pending', 'sent', 'failed')),
  notification_version integer not null default 1 check (notification_version > 0),
  notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_creation_requests_decision_consistent check (
    (status = 'pending' and approved_league_id is null and decided_at is null and decided_by is null)
    or (status = 'approved' and approved_league_id is not null and decided_at is not null and decided_by is not null)
    or (status in ('denied', 'expired') and approved_league_id is null)
  )
);

create unique index league_creation_requests_one_pending_user_idx
on public.league_creation_requests (requester_id) where status = 'pending';
create index league_creation_requests_status_created_idx
on public.league_creation_requests (status, created_at desc);
create index league_creation_requests_expiry_idx
on public.league_creation_requests (expires_at) where status = 'pending';

create trigger league_creation_requests_set_updated_at
before update on public.league_creation_requests
for each row execute function public.set_updated_at();

create table private.site_administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table private.league_creation_review_tokens (
  request_id uuid primary key references public.league_creation_requests(id) on delete cascade,
  approve_token_hash bytea not null unique,
  deny_token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint league_creation_review_tokens_distinct check (approve_token_hash <> deny_token_hash)
);

do $$
declare
  administrator_id uuid;
  administrator_count integer;
begin
  select count(*) into administrator_count
  from auth.users where lower(email) = 'cfbpooltest@gmail.com';
  if administrator_count <> 1 then
    raise exception 'Expected exactly one authenticated site-administrator account';
  end if;
  select id into administrator_id from auth.users where lower(email) = 'cfbpooltest@gmail.com';
  insert into private.site_administrators (user_id) values (administrator_id);
end;
$$;

revoke all on table private.site_administrators, private.league_creation_review_tokens from public, anon, authenticated;

create function private.is_site_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.site_administrators administrator
    where administrator.user_id = auth.uid()
  );
$$;

revoke all on function private.is_site_administrator() from public, anon, authenticated;

create function private.team_matches_roster_rule_payload(
  target_team_id uuid,
  target_season text,
  target_slot jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((target_slot->>'unrestricted')::boolean, false) or exists (
    select 1
    from jsonb_array_elements(coalesce(target_slot->'criteria', '[]'::jsonb)) criterion
    join public.teams team on team.id = target_team_id and team.active
    left join public.conference_classifications classification
      on classification.season = target_season and classification.conference = team.conference
    where
      (criterion->>'dimension' = 'conference' and (
        criterion->>'value' = team.conference
        or exists (
          select 1 from public.team_draft_rule_memberships membership
          where membership.season = target_season and membership.team_id = team.id
            and membership.dimension = 'conference' and membership.value = criterion->>'value'
        )
      ))
      or (criterion->>'dimension' = 'classification' and (
        criterion->>'value' = classification.classification
        or exists (
          select 1 from public.team_draft_rule_memberships membership
          where membership.season = target_season and membership.team_id = team.id
            and membership.dimension = 'classification' and membership.value = criterion->>'value'
        )
      ))
  );
$$;

create function private.assert_roster_rule_payload_feasible(
  target_season text,
  target_owner_count integer,
  target_teams_per_owner integer,
  target_rules jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  slot_count integer;
  subset_mask integer;
  subset_size integer;
  eligible_count integer;
begin
  if jsonb_typeof(target_rules) <> 'array' then
    raise exception 'Roster rules must be an array' using errcode = '22023';
  end if;
  slot_count := jsonb_array_length(target_rules);
  if slot_count = 0 then return; end if;
  if slot_count <> target_teams_per_owner then
    raise exception 'Roster rules must define exactly one slot per team drafted' using errcode = '22023';
  end if;
  if slot_count > 12 then raise exception 'Restricted roster rules support at most 12 slots' using errcode = '22023'; end if;

  if exists (
    select 1 from jsonb_array_elements(target_rules) slot
    where jsonb_typeof(slot) <> 'object'
      or char_length(trim(coalesce(slot->>'label', ''))) not between 2 and 80
      or jsonb_typeof(coalesce(slot->'criteria', '[]'::jsonb)) <> 'array'
      or (not coalesce((slot->>'unrestricted')::boolean, false) and jsonb_array_length(coalesce(slot->'criteria', '[]'::jsonb)) = 0)
  ) then raise exception 'Every roster slot needs a valid label and eligibility criteria' using errcode = '22023'; end if;

  if exists (
    select 1
    from jsonb_array_elements(target_rules) slot,
      jsonb_array_elements(coalesce(slot->'criteria', '[]'::jsonb)) criterion
    where criterion->>'dimension' not in ('conference', 'classification')
      or char_length(trim(coalesce(criterion->>'value', ''))) not between 2 and 80
      or (criterion->>'dimension' = 'conference' and not exists (
        select 1 from public.teams where active and conference = trim(criterion->>'value')
      ))
      or (criterion->>'dimension' = 'classification' and trim(criterion->>'value') not in ('POWER', 'G5', 'INDEPENDENT'))
  ) then raise exception 'Roster slot criteria are invalid' using errcode = '22023'; end if;

  for subset_mask in 1..((1 << slot_count) - 1) loop
    select count(*) into subset_size
    from generate_series(1, slot_count) as positions(position)
    where (subset_mask & (1 << (position - 1))) <> 0;

    select count(*) into eligible_count
    from public.teams team
    where team.active and exists (
      select 1
      from jsonb_array_elements(target_rules) with ordinality slot(value, position)
      where (subset_mask & (1 << (slot.position::integer - 1))) <> 0
        and private.team_matches_roster_rule_payload(team.id, target_season, slot.value)
    );

    if eligible_count < target_owner_count * subset_size then
      raise exception 'Roster rules cannot supply enough unique eligible teams for every owner' using errcode = '22023';
    end if;
  end loop;
end;
$$;

alter table public.league_creation_requests enable row level security;
create policy "Requesters can read their league requests"
on public.league_creation_requests for select to authenticated
using (requester_id = (select auth.uid()));
grant select on public.league_creation_requests to authenticated;

create function public.create_league_creation_request(
  target_name text,
  target_season text,
  target_owner_count integer,
  target_teams_per_owner integer,
  target_roster_rules jsonb,
  target_approve_token_hash text,
  target_deny_token_hash text
)
returns public.league_creation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_email text;
  created_request public.league_creation_requests;
  token_expiry timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select lower(email) into caller_email from auth.users where id = auth.uid();
  if caller_email is null then raise exception 'Authenticated account email is required' using errcode = '42501'; end if;
  if char_length(trim(target_name)) not between 2 and 100
    or target_season !~ '^[0-9]{4}$'
    or target_owner_count not between 4 and 16
    or target_teams_per_owner not between 3 and 8
  then raise exception 'League request settings are invalid' using errcode = '22023'; end if;
  if target_approve_token_hash !~ '^[0-9a-f]{64}$' or target_deny_token_hash !~ '^[0-9a-f]{64}$'
    or target_approve_token_hash = target_deny_token_hash
  then raise exception 'Review credentials are invalid' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  update public.league_creation_requests set status = 'expired'
  where requester_id = auth.uid() and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.league_creation_requests where requester_id = auth.uid() and status = 'pending') then
    raise exception 'A pending league request already exists' using errcode = '23505';
  end if;

  perform private.assert_roster_rule_payload_feasible(target_season, target_owner_count, target_teams_per_owner, target_roster_rules);
  insert into public.league_creation_requests (
    requester_id, requester_email, proposed_name, season, owner_count,
    teams_per_owner, roster_rules, expires_at
  ) values (
    auth.uid(), caller_email, trim(target_name), target_season, target_owner_count,
    target_teams_per_owner, target_roster_rules, token_expiry
  ) returning * into created_request;

  insert into private.league_creation_review_tokens (
    request_id, approve_token_hash, deny_token_hash, expires_at
  ) values (
    created_request.id, decode(target_approve_token_hash, 'hex'), decode(target_deny_token_hash, 'hex'), token_expiry
  );
  return created_request;
end;
$$;

create function public.rotate_league_creation_review_tokens(
  target_request_id uuid,
  target_approve_token_hash text,
  target_deny_token_hash text
)
returns public.league_creation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.league_creation_requests;
  token_expiry timestamptz := now() + interval '7 days';
begin
  if target_approve_token_hash !~ '^[0-9a-f]{64}$' or target_deny_token_hash !~ '^[0-9a-f]{64}$'
    or target_approve_token_hash = target_deny_token_hash
  then raise exception 'Review credentials are invalid' using errcode = '22023'; end if;
  select * into target_request from public.league_creation_requests
  where id = target_request_id and requester_id = auth.uid() for update;
  if target_request.id is null or target_request.status <> 'pending' then
    raise exception 'Pending league request not found' using errcode = '42501';
  end if;
  update public.league_creation_requests
  set expires_at = token_expiry, notification_status = 'pending', notification_version = notification_version + 1,
    notification_sent_at = null
  where id = target_request.id returning * into target_request;
  update private.league_creation_review_tokens
  set approve_token_hash = decode(target_approve_token_hash, 'hex'),
    deny_token_hash = decode(target_deny_token_hash, 'hex'), expires_at = token_expiry
  where request_id = target_request.id;
  return target_request;
end;
$$;

create function public.mark_league_request_notification(target_request_id uuid, was_sent boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.league_creation_requests
  set notification_status = case when was_sent then 'sent' else 'failed' end,
    notification_sent_at = case when was_sent then now() else null end
  where id = target_request_id and requester_id = auth.uid() and status = 'pending';
  return found;
end;
$$;

create function public.inspect_league_creation_review(target_token text, target_decision text)
returns table (
  request_id uuid, requester_email text, requester_name text, proposed_name text,
  season text, owner_count integer, teams_per_owner integer, roster_rules jsonb, expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select request.id, request.requester_email, profile.display_name, request.proposed_name,
    request.season, request.owner_count, request.teams_per_owner, request.roster_rules, request.expires_at
  from public.league_creation_requests request
  join public.profiles profile on profile.id = request.requester_id
  join private.league_creation_review_tokens token on token.request_id = request.id
  where private.is_site_administrator()
    and target_token ~ '^[0-9a-f]{64}$'
    and target_decision in ('approve', 'deny')
    and request.status = 'pending' and request.expires_at > now() and token.expires_at > now()
    and case target_decision
      when 'approve' then token.approve_token_hash = extensions.digest(target_token, 'sha256')
      else token.deny_token_hash = extensions.digest(target_token, 'sha256')
    end;
$$;

create function public.decide_league_creation_request(target_token text, target_decision text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.league_creation_requests;
  token_record private.league_creation_review_tokens;
  created_league_id uuid;
  slot_record record;
  criterion_record record;
  created_slot_id uuid;
begin
  if not private.is_site_administrator() then raise exception 'Site administrator access required' using errcode = '42501'; end if;
  if target_token !~ '^[0-9a-f]{64}$' or target_decision not in ('approve', 'deny') then
    raise exception 'Review request is invalid' using errcode = '22023';
  end if;

  select request.* into target_request
  from public.league_creation_requests request
  join private.league_creation_review_tokens token on token.request_id = request.id
  where request.status = 'pending'
    and case target_decision
      when 'approve' then token.approve_token_hash = extensions.digest(target_token, 'sha256')
      else token.deny_token_hash = extensions.digest(target_token, 'sha256')
    end
  for update of request;
  if target_request.id is null then raise exception 'Review request is invalid or already used' using errcode = 'P0002'; end if;
  select * into token_record from private.league_creation_review_tokens where request_id = target_request.id for update;
  if target_request.expires_at <= now() or token_record.expires_at <= now() then
    raise exception 'Review request has expired' using errcode = 'P0001';
  end if;

  if target_decision = 'deny' then
    update public.league_creation_requests
    set status = 'denied', decided_at = now(), decided_by = auth.uid()
    where id = target_request.id;
    delete from private.league_creation_review_tokens where request_id = target_request.id;
    return null;
  end if;

  perform private.assert_roster_rule_payload_feasible(
    target_request.season, target_request.owner_count,
    target_request.teams_per_owner, target_request.roster_rules
  );
  insert into public.leagues (name, season, commissioner_id, owner_count, teams_per_owner)
  values (target_request.proposed_name, target_request.season, target_request.requester_id,
    target_request.owner_count, target_request.teams_per_owner)
  returning id into created_league_id;

  for slot_record in
    select item.value as slot, item.ordinality::integer as position
    from jsonb_array_elements(target_request.roster_rules) with ordinality item(value, ordinality)
  loop
    insert into public.league_draft_roster_slots (league_id, slot_position, label, unrestricted)
    values (created_league_id, slot_record.position, trim(slot_record.slot->>'label'), coalesce((slot_record.slot->>'unrestricted')::boolean, false))
    returning id into created_slot_id;
    for criterion_record in
      select criterion.value as criterion
      from jsonb_array_elements(coalesce(slot_record.slot->'criteria', '[]'::jsonb)) criterion(value)
    loop
      insert into public.league_draft_roster_slot_criteria (roster_slot_id, dimension, value)
      values (created_slot_id, criterion_record.criterion->>'dimension', trim(criterion_record.criterion->>'value'));
    end loop;
  end loop;

  update public.league_creation_requests
  set status = 'approved', approved_league_id = created_league_id,
    decided_at = now(), decided_by = auth.uid()
  where id = target_request.id;
  delete from private.league_creation_review_tokens where request_id = target_request.id;
  return created_league_id;
end;
$$;

revoke all on function public.create_league_creation_request(text, text, integer, integer, jsonb, text, text) from public, anon;
revoke all on function public.rotate_league_creation_review_tokens(uuid, text, text) from public, anon;
revoke all on function public.mark_league_request_notification(uuid, boolean) from public, anon;
revoke all on function public.inspect_league_creation_review(text, text) from public, anon;
revoke all on function public.decide_league_creation_request(text, text) from public, anon;
grant execute on function public.create_league_creation_request(text, text, integer, integer, jsonb, text, text) to authenticated;
grant execute on function public.rotate_league_creation_review_tokens(uuid, text, text) to authenticated;
grant execute on function public.mark_league_request_notification(uuid, boolean) to authenticated;
grant execute on function public.inspect_league_creation_review(text, text) to authenticated;
grant execute on function public.decide_league_creation_request(text, text) to authenticated;

drop policy "Commissioners can create their own leagues" on public.leagues;
revoke insert on public.leagues from anon, authenticated;
