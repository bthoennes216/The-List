create schema if not exists the_list_private;
grant usage on schema the_list_private to authenticated;
create or replace function the_list_private.family_members()
returns table(user_id uuid, display_name text, member_role text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id,
    coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''), split_part(u.email,'@',1), 'Family member'),
    case when h.owner_user_id = m.user_id then 'Owner' else 'Member' end
  from public.household_members m
  join public.households h on h.id = m.household_id
  join auth.users u on u.id = m.user_id
  where (select auth.uid()) is not null
    and exists (select 1 from public.household_members self
      where self.household_id = m.household_id and self.user_id = (select auth.uid()))
  order by (h.owner_user_id = m.user_id) desc, m.joined_at;
$$;
revoke all on function the_list_private.family_members() from public, anon;
grant execute on function the_list_private.family_members() to authenticated;
create or replace function public.list_family_members()
returns table(user_id uuid, display_name text, member_role text)
language sql stable security invoker set search_path = ''
as $$ select * from the_list_private.family_members(); $$;
revoke all on function public.list_family_members() from public, anon;
grant execute on function public.list_family_members() to authenticated;