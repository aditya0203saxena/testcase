create table if not exists public.datasets (
  module text primary key check (module in ('polaris', 'infrastructure', 'utilities', 'data-transfer', 'alerts')),
  data jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.datasets enable row level security;

revoke all on table public.datasets from anon, authenticated;

drop function if exists public.add_login_user(text, text, text, text, text);
create or replace function public.add_login_user(
  user_email text,
  user_username text,
  user_name text,
  user_password text,
  user_role text default 'visitor'
)
returns public.login
language plpgsql
security definer
set search_path = public
as $$
declare
  created_user public.login;
begin
  if user_role not in ('visitor', 'researcher', 'admin') then
    raise exception 'Invalid role';
  end if;

  insert into public.login (email, username, name, password, role)
  values (lower(trim(user_email)), nullif(trim(user_username), ''), trim(user_name), user_password, user_role)
  returning * into created_user;

  return created_user;
end;
$$;

revoke all on function public.add_login_user(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.add_login_user(text, text, text, text, text) to service_role;

drop function if exists public.remove_login_user(text);
create or replace function public.remove_login_user(user_identifier text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  delete from public.login
  where lower(email) = lower(trim(user_identifier))
     or lower(coalesce(username, '')) = lower(trim(user_identifier));
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;

revoke all on function public.remove_login_user(text) from public, anon, authenticated;
grant execute on function public.remove_login_user(text) to service_role;

drop function if exists public.set_login_role(text, text);
create or replace function public.set_login_role(user_identifier text, user_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if user_role not in ('visitor', 'researcher', 'admin') then
    raise exception 'Invalid role';
  end if;

  update public.login
  set role = user_role
  where lower(email) = lower(trim(user_identifier))
     or lower(coalesce(username, '')) = lower(trim(user_identifier));
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function public.set_login_role(text, text) from public, anon, authenticated;
grant execute on function public.set_login_role(text, text) to service_role;
