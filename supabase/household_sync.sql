-- The List household sync. Apply once to the Supabase project.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_hash text,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members(user_id);

create table public.household_snapshots (
  household_id uuid primary key references public.households(id) on delete cascade,
  revision bigint not null default 0,
  payload jsonb,
  updated_at timestamptz not null default now(),
  constraint household_snapshots_revision_nonnegative check (revision >= 0)
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_snapshots enable row level security;

revoke all on public.households, public.household_members, public.household_snapshots from anon, authenticated;
grant select on public.households, public.household_members, public.household_snapshots to authenticated;
grant update (payload, revision, updated_at) on public.household_snapshots to authenticated;

create policy household_members_read_self on public.household_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy households_read_member on public.households
  for select to authenticated using (exists (
    select 1 from public.household_members m
    where m.household_id = id and m.user_id = (select auth.uid())
  ));
create policy household_snapshots_read_member on public.household_snapshots
  for select to authenticated using (exists (
    select 1 from public.household_members m
    where m.household_id = household_snapshots.household_id and m.user_id = (select auth.uid())
  ));
create policy household_snapshots_update_member on public.household_snapshots
  for update to authenticated
  using (exists (
    select 1 from public.household_members m
    where m.household_id = household_snapshots.household_id and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = household_snapshots.household_id and m.user_id = (select auth.uid())
  ));

create function public.create_household()
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a household';
  end if;
  insert into public.households(owner_user_id) values (auth.uid()) returning id into new_id;
  insert into public.household_members(household_id,user_id) values (new_id,auth.uid());
  insert into public.household_snapshots(household_id) values (new_id);
  return new_id;
end $$;

create function public.create_household_invite()
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  code := encode(extensions.gen_random_bytes(18),'hex');
  update public.households set
    invite_hash = encode(extensions.digest(code,'sha256'),'hex'),
    invite_expires_at = now() + interval '24 hours'
  where owner_user_id = auth.uid();
  if not found then raise exception 'Only the household owner can invite'; end if;
  return code;
end $$;

create function public.join_household(invite_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a household';
  end if;
  select id into target_id from public.households
    where invite_hash = encode(extensions.digest(invite_code,'sha256'),'hex')
      and invite_expires_at > now()
    for update;
  if target_id is null then raise exception 'Invite invalid or expired'; end if;
  insert into public.household_members(household_id,user_id) values (target_id,auth.uid());
  update public.households set invite_hash = null, invite_expires_at = null where id = target_id;
  return target_id;
end $$;

revoke all on function public.create_household() from public, anon;
revoke all on function public.create_household_invite() from public, anon;
revoke all on function public.join_household(text) from public, anon;
grant execute on function public.create_household() to authenticated;
grant execute on function public.create_household_invite() to authenticated;
grant execute on function public.join_household(text) to authenticated;
