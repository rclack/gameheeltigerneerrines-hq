-- Normalize only the security attributes and execution privileges of the
-- existing private draft queue functions. Queue behavior and table data are
-- unchanged; the move function's constraint references are schema-qualified.

begin;

alter function public.add_team_to_my_draft_queue(uuid, uuid)
  security definer
  set search_path to '';

alter function public.remove_team_from_my_draft_queue(uuid)
  security definer
  set search_path to '';

-- This is the only function body replaced. Its logic is unchanged except that
-- the deferrable constraint is schema-qualified for the empty search_path.
create or replace function public.move_team_in_my_draft_queue(
  target_queue_item_id uuid,
  move_direction integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_item public.draft_queue_items;
  target_position integer;
begin
  if move_direction not in (-1, 1) then raise exception 'Invalid queue direction' using errcode = '22023'; end if;

  select item.* into owned_item
  from public.draft_queue_items item
  join public.league_members member on member.id = item.league_member_id
  where item.id = target_queue_item_id and member.user_id = auth.uid()
  for update of item;

  if owned_item.id is null then raise exception 'Queue item not found' using errcode = '42501'; end if;
  if (select status from public.drafts where id = owned_item.draft_id) = 'complete' then
    raise exception 'Completed drafts cannot be changed' using errcode = 'P0001';
  end if;

  target_position := owned_item.queue_position + move_direction;
  if target_position < 1 or not exists (
    select 1 from public.draft_queue_items
    where draft_id = owned_item.draft_id
      and league_member_id = owned_item.league_member_id
      and queue_position = target_position
  ) then return false; end if;

  set constraints public.draft_queue_items_member_position_key deferred;
  update public.draft_queue_items
  set queue_position = case
    when id = owned_item.id then target_position
    when queue_position = target_position then owned_item.queue_position
  end
  where draft_id = owned_item.draft_id
    and league_member_id = owned_item.league_member_id
    and (id = owned_item.id or queue_position = target_position);
  set constraints public.draft_queue_items_member_position_key immediate;
  return true;
end;
$$;

alter function public.remove_drafted_team_from_queues()
  security definer
  set search_path to '';

revoke execute on function public.add_team_to_my_draft_queue(uuid, uuid) from public, anon;
revoke execute on function public.remove_team_from_my_draft_queue(uuid) from public, anon;
revoke execute on function public.move_team_in_my_draft_queue(uuid, integer) from public, anon;
revoke execute on function public.remove_drafted_team_from_queues() from public, anon;

grant execute on function public.add_team_to_my_draft_queue(uuid, uuid) to authenticated;
grant execute on function public.remove_team_from_my_draft_queue(uuid) to authenticated;
grant execute on function public.move_team_in_my_draft_queue(uuid, integer) to authenticated;
revoke execute on function public.remove_drafted_team_from_queues() from authenticated;

commit;
