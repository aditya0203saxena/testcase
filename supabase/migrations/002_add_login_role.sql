alter table if exists public.login
  add column if not exists role text not null default 'researcher';

alter table if exists public.login
  drop constraint if exists login_role_check;

alter table if exists public.login
  add constraint login_role_check check (role in ('visitor', 'researcher', 'admin'));

drop function if exists public.verify_login(text, text);

create or replace function public.verify_login(
  login_identifier text,
  login_password text
)
returns table (
  id uuid,
  email text,
  username text,
  name text,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select l.id, l.email, l.username, l.name, coalesce(l.role, 'researcher')
  from public.login l
  where (lower(l.email) = lower(trim(login_identifier))
         or lower(coalesce(l.username, '')) = lower(trim(login_identifier)))
    and l.password = login_password
  limit 1;
end;
$$;

revoke all on function public.verify_login(text, text) from public;
grant execute on function public.verify_login(text, text) to anon, authenticated;