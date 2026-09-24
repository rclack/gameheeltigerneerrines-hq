-- Allow a commissioner to atomically persist a complete, explicit pre-draft
-- order using the same draft_slots rows as randomized draft order.

create function public.set_manual_draft_order(
  target_league_id uuid,
  target_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league public.leagues;
  target_draft_id uuid;
  accepted_count integer;
  requested_count integer;
  distinct_requested_count integer;
  matching_count integer;
begin
  select league.* into target_league
  from public.leagues league
  where league.id = target_league_id
    and league.commissioner_id = auth.uid()
  for update;

  if target_league.id is null then
    raise exception 'League not found or access denied' using errcode = '42501';
  end if;

  select count(*) into accepted_count
  from public.league_members member
  where member.league_id = target_league_id;

  if accepted_count <> target_league.owner_count then
    raise exception 'League membership is incomplete' using errcode = 'P0001';
  end if;

  requested_count := coalesce(cardinality(target_member_ids), 0);
  select count(distinct requested.member_id) into distinct_requested_count
  from unnest(coalesce(target_member_ids, array[]::uuid[])) as requested(member_id);

  select count(*) into matching_count
  from public.league_members member
  where member.league_id = target_league_id
    and member.id = any(coalesce(target_member_ids, array[]::uuid[]));

  if requested_count <> target_league.owner_count
    or distinct_requested_count <> target_league.owner_count
    or matching_count <> target_league.owner_count
  then
    raise exception 'Draft order must contain every accepted owner exactly once' using errcode = '22023';
  end if;

  insert into public.drafts (league_id)
  values (target_league_id)
  on conflict (league_id) do nothing;

  select draft.id into target_draft_id
  from public.drafts draft
  where draft.league_id = target_league_id
  for update;

  if (select draft.status from public.drafts draft where draft.id = target_draft_id) <> 'not_started' then
    raise exception 'Draft order cannot change after the draft starts' using errcode = 'P0001';
  end if;

  delete from public.draft_slots slot
  where slot.draft_id = target_draft_id;

  insert into public.draft_slots (draft_id, league_member_id, draft_position)
  select target_draft_id, requested.member_id, requested.position::integer
  from unnest(target_member_ids) with ordinality as requested(member_id, position);

  return target_draft_id;
end;
$$;

revoke all on function public.set_manual_draft_order(uuid, uuid[]) from public;
grant execute on function public.set_manual_draft_order(uuid, uuid[]) to authenticated;
