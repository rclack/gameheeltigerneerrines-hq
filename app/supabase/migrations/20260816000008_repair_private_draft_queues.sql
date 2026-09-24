-- Repair the executable and privilege portions of the private draft queue
-- migration without rebuilding the existing table or touching queue data.

create or replace trigger draft_queue_items_set_updated_at
before update on public.draft_queue_items
for each row execute function public.set_updated_at();

-- Queue writes must go through the security-definer RPCs below.
revoke insert, update, delete on public.draft_queue_items from public;
revoke insert, update, delete on public.draft_queue_items from authenticated;
grant select on public.draft_queue_items to authenticated;

create or replace function public.add_team_to_my_draft_queue(target_draft_id uuid, target_team_id uuid)
returns public.draft_queue_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_member_id uuid;
  next_position integer;
  created_item public.draft_queue_items;
begin
  select member.id into caller_member_id
  from public.drafts draft
  join public.league_members member on member.league_id = draft.league_id
  where draft.id = target_draft_id and member.user_id = auth.uid();

  if caller_member_id is null then raise exception 'Draft membership not found' using errcode = '42501'; end if;
  if (select status from public.drafts where id = target_draft_id) = 'complete' then
    raise exception 'Completed drafts cannot be changed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.teams where id = target_team_id and active) then
    raise exception 'Team is unavailable' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.draft_picks where draft_id = target_draft_id and team_id = target_team_id) then
    raise exception 'Team has already been drafted' using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_draft_id::text || caller_member_id::text, 0));
  select coalesce(max(queue_position), 0) + 1 into next_position
  from public.draft_queue_items
  where draft_id = target_draft_id and league_member_id = caller_member_id;

  insert into public.draft_queue_items (draft_id, league_member_id, team_id, queue_position)
  values (target_draft_id, caller_member_id, target_team_id, next_position)
  returning * into created_item;
  return created_item;
exception
  when unique_violation then
    raise exception 'Team is already in your queue' using errcode = '23505';
end;
$$;

create or replace function public.remove_team_from_my_draft_queue(target_queue_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_item public.draft_queue_items;
begin
  select item.* into owned_item
  from public.draft_queue_items item
  join public.league_members member on member.id = item.league_member_id
  where item.id = target_queue_item_id and member.user_id = auth.uid()
  for update of item;

  if owned_item.id is null then raise exception 'Queue item not found' using errcode = '42501'; end if;
  if (select status from public.drafts where id = owned_item.draft_id) = 'complete' then
    raise exception 'Completed drafts cannot be changed' using errcode = 'P0001';
  end if;

  delete from public.draft_queue_items where id = owned_item.id;
  update public.draft_queue_items
  set queue_position = queue_position - 1
  where draft_id = owned_item.draft_id
    and league_member_id = owned_item.league_member_id
    and queue_position > owned_item.queue_position;
  return true;
end;
$$;

create or replace function public.move_team_in_my_draft_queue(target_queue_item_id uuid, move_direction integer)
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

  set constraints draft_queue_items_member_position_key deferred;
  update public.draft_queue_items
  set queue_position = case
    when id = owned_item.id then target_position
    when queue_position = target_position then owned_item.queue_position
  end
  where draft_id = owned_item.draft_id
    and league_member_id = owned_item.league_member_id
    and (id = owned_item.id or queue_position = target_position);
  set constraints draft_queue_items_member_position_key immediate;
  return true;
end;
$$;

create or replace function public.remove_drafted_team_from_queues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.draft_queue_items
  where draft_id = new.draft_id and team_id = new.team_id;

  with ranked as (
    select id, row_number() over (
      partition by draft_id, league_member_id order by queue_position, created_at
    ) as normalized_position
    from public.draft_queue_items
    where draft_id = new.draft_id
  )
  update public.draft_queue_items item
  set queue_position = ranked.normalized_position
  from ranked where item.id = ranked.id;
  return new;
end;
$$;

create or replace trigger draft_pick_cleans_private_queues
after insert on public.draft_picks
for each row execute function public.remove_drafted_team_from_queues();

revoke all on function public.add_team_to_my_draft_queue(uuid, uuid) from public;
revoke all on function public.remove_team_from_my_draft_queue(uuid) from public;
revoke all on function public.move_team_in_my_draft_queue(uuid, integer) from public;
revoke all on function public.remove_drafted_team_from_queues() from public;
grant execute on function public.add_team_to_my_draft_queue(uuid, uuid) to authenticated;
grant execute on function public.remove_team_from_my_draft_queue(uuid) to authenticated;
grant execute on function public.move_team_in_my_draft_queue(uuid, integer) to authenticated;
