-- Atomically reset a draft for repeatable testing while preserving its league,
-- membership, team catalog, and randomized draft order.

create function public.reset_draft(target_draft_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_league_id uuid;
begin
  select draft.league_id into target_league_id
  from public.drafts draft
  join public.leagues league on league.id = draft.league_id
  where draft.id = target_draft_id
    and league.commissioner_id = auth.uid()
  for update of draft;

  if target_league_id is null then
    raise exception 'Draft not found or access denied' using errcode = '42501';
  end if;

  delete from public.draft_picks
  where draft_id = target_draft_id;

  delete from public.draft_queue_items
  where draft_id = target_draft_id;

  update public.drafts
  set status = 'not_started',
      current_round = 1,
      current_pick = 1,
      started_at = null,
      completed_at = null
  where id = target_draft_id;

  return true;
end;
$$;

revoke all on function public.reset_draft(uuid) from public;
grant execute on function public.reset_draft(uuid) to authenticated;
