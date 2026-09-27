-- Run in a new Supabase project's SQL editor. Never expose a service-role key in The List.
create extension if not exists pgcrypto;

create table public.list_households (
  id uuid primary key default gen_random_uuid(),
  invite_code uuid not null unique default gen_random_uuid(),
  name text not null default 'Our home',
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.list_household_members (
  household_id uuid not null references public.list_households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(household_id,user_id)
);
create table public.list_household_snapshots (
  household_id uuid primary key references public.list_households(id) on delete cascade,
  revision bigint not null default 0,
  snapshot jsonb,
  updated_at timestamptz not null default now()
);

create function public.list_is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.list_household_members
    where household_id = p_household and user_id = (select auth.uid()));
$$;

alter table public.list_households enable row level security;
alter table public.list_household_members enable row level security;
alter table public.list_household_snapshots enable row level security;
create policy list_households_read on public.list_households for select to authenticated
  using (public.list_is_member(id));
create policy list_members_read on public.list_household_members for select to authenticated
  using (public.list_is_member(household_id));
create policy list_snapshots_read on public.list_household_snapshots for select to authenticated
  using (public.list_is_member(household_id));

create function public.list_create_household(p_name text default 'Our home')
returns table(household_id uuid, code uuid)
language plpgsql security definer set search_path = '' as $$
declare h public.list_households%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.list_households(name,owner_id)
    values(left(coalesce(nullif(trim(p_name),''),'Our home'),80),auth.uid()) returning * into h;
  insert into public.list_household_members(household_id,user_id) values(h.id,auth.uid());
  insert into public.list_household_snapshots(household_id) values(h.id);
  return query select h.id,h.invite_code;
end; $$;

create function public.list_join_household(p_code uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into h from public.list_households where invite_code=p_code;
  if h is null then raise exception 'Invitation not found'; end if;
  insert into public.list_household_members(household_id,user_id) values(h,auth.uid())
    on conflict do nothing;
  return h;
end; $$;

-- Conditional writes stop one phone from silently replacing newer work on another.
create function public.list_save_snapshot(p_household uuid,p_revision bigint,p_snapshot jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
  if not public.list_is_member(p_household) then raise exception 'Not a household member'; end if;
  if jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 6000000
    then raise exception 'Invalid or oversized snapshot'; end if;
  update public.list_household_snapshots
    set snapshot=p_snapshot,revision=revision+1,updated_at=now()
    where household_id=p_household and revision=p_revision
    returning revision into new_revision;
  if new_revision is null then raise exception 'Household changed on another phone. Review changes before saving.'; end if;
  return new_revision;
end; $$;

revoke all on function public.list_is_member(uuid),public.list_create_household(text),
  public.list_join_household(uuid),public.list_save_snapshot(uuid,bigint,jsonb) from public, anon;
grant execute on function public.list_is_member(uuid),public.list_create_household(text),
  public.list_join_household(uuid),public.list_save_snapshot(uuid,bigint,jsonb) to authenticated;

-- Create a PRIVATE Storage bucket named list-project-photos in Storage first.
create policy list_photo_read on storage.objects for select to authenticated
  using (bucket_id='list-project-photos' and
    public.list_is_member(((storage.foldername(name))[1])::uuid));
create policy list_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id='list-project-photos' and
    public.list_is_member(((storage.foldername(name))[1])::uuid));
