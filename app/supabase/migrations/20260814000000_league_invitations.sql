-- Owner invitation lifecycle and secure acceptance workflow.

create type public.league_invitation_status as enum (
  'pending',
  'accepted',
  'revoked',
  'expired'
);

create table public.league_invitations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  invited_email text not null check (
    invited_email = lower(trim(invited_email))
    and invited_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status public.league_invitation_status not null default 'pending',
  invitation_token text not null default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint league_invitations_token_key unique (invitation_token),
  constraint league_invitations_acceptance_consistent check (
    (status = 'accepted' and accepted_by is not null and accepted_at is not null)
    or (status <> 'accepted' and accepted_by is null and accepted_at is null)
  )
);

create unique index league_invitations_one_pending_email_idx
on public.league_invitations (league_id, invited_email)
where status = 'pending';

create index league_invitations_league_status_idx
on public.league_invitations (league_id, status, created_at desc);

create index league_invitations_email_status_idx
on public.league_invitations (invited_email, status);

create index league_invitations_expires_at_idx
on public.league_invitations (expires_at)
where status = 'pending';

create trigger league_invitations_set_updated_at
before update on public.league_invitations
for each row execute function public.set_updated_at();

-- Shared league participants may read one another's display names. Email
-- addresses remain in auth.users and are never exposed through profiles.
create function private.shares_league_with_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members mine
    join public.league_members theirs on theirs.league_id = mine.league_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;

revoke all on function private.shares_league_with_user(uuid) from public;
grant execute on function private.shares_league_with_user(uuid) to authenticated;

create policy "League participants can read shared profiles"
on public.profiles for select to authenticated
using (private.shares_league_with_user(id));

alter table public.league_invitations enable row level security;

-- Commissioners can inspect every invitation for leagues they own.
create policy "Commissioners can read league invitations"
on public.league_invitations for select to authenticated
using (private.is_league_commissioner(league_id));

-- Invitees can inspect only invitations matching their verified JWT email.
create policy "Invitees can read invitations sent to their email"
on public.league_invitations for select to authenticated
using (invited_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Mutations are intentionally available only through the security-definer
-- functions below, where ownership, capacity, and state transitions are checked
-- atomically. Authenticated clients receive read access to the table itself.
grant select on public.league_invitations to authenticated;

-- Creates an invitation only after deriving the caller from auth.uid() and
-- checking league ownership, capacity, current membership, and pending invites.
create function public.create_league_invitation(
  target_league_id uuid,
  target_email text
)
returns public.league_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(target_email));
  league_capacity integer;
  occupied_slots integer;
  invitation public.league_invitations;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select owner_count into league_capacity
  from public.leagues
  where id = target_league_id and commissioner_id = auth.uid()
  for update;

  if league_capacity is null then
    raise exception 'League not found or access denied' using errcode = '42501';
  end if;

  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  update public.league_invitations
  set status = 'expired'
  where league_id = target_league_id and status = 'pending' and expires_at <= now();

  select
    (select count(*) from public.league_members where league_id = target_league_id)
    +
    (select count(*) from public.league_invitations
      where league_id = target_league_id and status = 'pending' and expires_at > now())
  into occupied_slots;

  if occupied_slots >= league_capacity then
    raise exception 'League roster is full' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.league_members membership
    join auth.users account on account.id = membership.user_id
    where membership.league_id = target_league_id
      and lower(account.email) = normalized_email
  ) then
    raise exception 'This email already belongs to a league member' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.league_invitations
    where league_id = target_league_id
      and invited_email = normalized_email
      and status = 'pending'
      and expires_at > now()
  ) then
    raise exception 'A pending invitation already exists for this email' using errcode = '23505';
  end if;

  insert into public.league_invitations (league_id, invited_email, invited_by)
  values (target_league_id, normalized_email, auth.uid())
  returning * into invitation;

  return invitation;
end;
$$;

-- Revocation never accepts a client-provided status and operates only on a
-- pending invitation belonging to a league owned by the caller.
create function public.revoke_league_invitation(target_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.league_invitations invitation
  set status = 'revoked'
  from public.leagues league
  where invitation.id = target_invitation_id
    and invitation.league_id = league.id
    and league.commissioner_id = auth.uid()
    and invitation.status = 'pending';

  return found;
end;
$$;

-- Acceptance is one transaction. The authenticated email must match, capacity
-- is locked and rechecked, membership is always owner, and the invitation state
-- changes only after the membership insert succeeds.
create function public.accept_league_invitation(target_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.league_invitations;
  league_capacity integer;
  member_count integer;
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or caller_email = '' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into invitation
  from public.league_invitations
  where invitation_token = target_token
  for update;

  if invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;

  if invitation.invited_email <> caller_email then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  if invitation.status <> 'pending' then
    raise exception 'Invitation is no longer pending' using errcode = 'P0001';
  end if;

  if invitation.expires_at <= now() then
    update public.league_invitations set status = 'expired' where id = invitation.id;
    return null;
  end if;

  select owner_count into league_capacity
  from public.leagues where id = invitation.league_id for update;

  select count(*) into member_count
  from public.league_members where league_id = invitation.league_id;

  if member_count >= league_capacity then
    raise exception 'League roster is full' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.league_members
    where league_id = invitation.league_id and user_id = auth.uid()
  ) then
    raise exception 'You are already a member of this league' using errcode = '23505';
  end if;

  insert into public.league_members (league_id, user_id, role)
  values (invitation.league_id, auth.uid(), 'owner');

  update public.league_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = invitation.id;

  return invitation.league_id;
end;
$$;

revoke all on function public.create_league_invitation(uuid, text) from public;
revoke all on function public.revoke_league_invitation(uuid) from public;
revoke all on function public.accept_league_invitation(text) from public;
grant execute on function public.create_league_invitation(uuid, text) to authenticated;
grant execute on function public.revoke_league_invitation(uuid) to authenticated;
grant execute on function public.accept_league_invitation(text) to authenticated;
