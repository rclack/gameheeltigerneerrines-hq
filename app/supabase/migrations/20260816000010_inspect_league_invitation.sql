-- Authenticated invitation-link holders need enough metadata to render the
-- correct invitation state even when the current account is not the invitee.
-- The secret token is the only lookup key; this function does not inspect or
-- disclose whether the invited email has an Auth account.

begin;

create function public.inspect_league_invitation(target_token text)
returns table (
  invited_email text,
  invitation_status public.league_invitation_status,
  expires_at timestamptz,
  league_id uuid,
  accepted_by_current_user boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if target_token !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  return query
  select
    invitation.invited_email,
    invitation.status,
    invitation.expires_at,
    invitation.league_id,
    coalesce(invitation.accepted_by = auth.uid(), false)
  from public.league_invitations invitation
  where invitation.invitation_token = target_token
  limit 1;
end;
$$;

revoke all on function public.inspect_league_invitation(text) from public;
revoke all on function public.inspect_league_invitation(text) from anon;
grant execute on function public.inspect_league_invitation(text) to authenticated;

commit;
